import { ChatInputCommandInteraction, EmbedBuilder, AttachmentBuilder } from 'discord.js';
import { GacService } from '../../services/gacService';
import { GacStrategyService } from '../../services/gacStrategyService';
import { GacApiClient } from './commandUtils';
import { logger } from '../../utils/logger';
import { getMaxSquadsForLeague, FALLBACK_SEASON_IDS } from '../../config/gacConstants';
import { comlinkClient, ComlinkDatacron } from '../../integrations/comlink/comlinkClient';
import {
  extractDatacronLeveragedCharacters,
  extractMetaActivatedCharacters,
} from '../../services/gacStrategy/utils/datacronUtils';
import { getMetaCronTags } from '../../services/gacStrategy/utils/datacronMetaService';
import { fromScraped, AssignedCron } from '../../services/datacronAllocator';

export async function handleStrategyCommand(
  interaction: ChatInputCommandInteraction,
  yourAllyCode: string,
  opponentAllyCode: string | null,
  format: string,
  strategyPreference: 'defensive' | 'balanced' | 'offensive',
  gacService: GacService,
  gacStrategyService: GacStrategyService,
  swgohGgApiClient: GacApiClient,
  updateStatus?: (content: string) => Promise<void>
): Promise<void> {
  // Determine which opponent to analyse – either explicit ally code or your next bracket opponent
  let targetAllyCode: string | null = null;
  let targetName: string | null = null;
  let opponentLeague: string | null = null;

  if (updateStatus) {
    await updateStatus('🔍 Finding your opponent...');
  }

  if (opponentAllyCode) {
    // Normalize ally code by removing dashes (users may type "123-456-789" but URLs need "123456789")
    targetAllyCode = opponentAllyCode.replace(/-/g, '');
    // Fetch player data to get the player's name
    try {
      const opponentPlayerData = await swgohGgApiClient.getFullPlayer(targetAllyCode);
      targetName = opponentPlayerData.data.name;
    } catch (error) {
      // If we can't fetch player data, fall back to ally code
      logger.warn(`Could not fetch player name for ally code ${targetAllyCode}:`, error);
      targetName = null;
    }
    // League is optional - will use default max if unavailable
    opponentLeague = null;
  } else {
    // Get live bracket data which includes real-time opponent detection
    const liveBracket = await gacService.getLiveBracket(yourAllyCode);

    // Use the bracket's league (all players in a bracket are in the same league)
    opponentLeague = liveBracket.league;

    // Round 1 with low confidence: require manual selection
    // GAC matchmaking for Round 1 is not publicly documented, so we can't reliably predict
    if (liveBracket.currentRound === 1 && liveBracket.opponentConfidence === 'low') {
      const embed = new EmbedBuilder()
        .setTitle('🎯 Round 1 - Please Select Your Opponent')
        .setDescription(
          'GAC Round 1 matchups cannot be auto-detected because the game\'s pairing algorithm is not public.\n\n' +
          '**How to find your opponent:**\n' +
          '1. Open the game and check your GAC bracket\n' +
          '2. Use `/gac strategy` and start typing in the `bracket_opponent` field\n' +
          '3. Select your actual opponent from the autocomplete list\n\n' +
          '_For Rounds 2-3, I can often auto-detect based on scores._'
        )
        .setColor(0xffaa00)
        .addFields({
          name: '📋 Your Bracket',
          value: liveBracket.bracket_players
            .map(p => `• ${p.player_name}${p.ally_code.toString() === yourAllyCode ? ' (You)' : ''}`)
            .join('\n') || 'No players found',
          inline: false
        });

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    if (!liveBracket.currentOpponent) {
      throw new Error('Could not determine your next GAC opponent from live bracket data.');
    }

    targetAllyCode = liveBracket.currentOpponent.ally_code.toString();
    targetName = liveBracket.currentOpponent.player_name;

    logger.info(
      `Real-time opponent for strategy (Round ${liveBracket.currentRound}): ${targetName} ` +
      `(Score: ${liveBracket.currentOpponent.bracket_score}, Real-time: ${liveBracket.isRealTime})`
    );
  }

  if (!targetAllyCode) {
    throw new Error('No opponent ally code was provided or resolved.');
  }

  const squads = await gacStrategyService.getOpponentDefensiveSquads(targetAllyCode, opponentLeague, format);

  if (squads.length === 0) {
    const embed = new EmbedBuilder()
      .setTitle('🛡 No Recent Defensive Squads Found')
      .setDescription(
        'I could not find any recent GAC defensive squads for this opponent. ' +
        'They may not have any recent rounds with recorded data yet.'
      )
      .setColor(0xffaa00);

    await interaction.editReply({ embeds: [embed] });
    return;
  }

  if (updateStatus) {
    await updateStatus('📊 Analysing your roster and matching counters...');
  }

  // Get user's roster to match counters (with stats for proper analysis)
  const getRosterWithStats = swgohGgApiClient.getFullPlayerWithStats
    ? swgohGgApiClient.getFullPlayerWithStats.bind(swgohGgApiClient)
    : swgohGgApiClient.getFullPlayer.bind(swgohGgApiClient);
  const userRoster = await getRosterWithStats(yourAllyCode);

  // Fetch user's datacron grid + meta datacron tags so we can FILTER OUT
  // counters that depend on a datacron the user doesn't own. Failures here
  // are non-fatal — empty sets bypass the filter entirely (best-effort
  // degradation: better to recommend a possibly-cron-dependent counter
  // than to drop everything because comlink hiccupped).
  let userDatacronLeveragedChars: Set<string> | undefined;
  let metaDatacronActivatedChars: Set<string> | undefined;
  let userDatacrons: ComlinkDatacron[] | undefined;
  try {
    const rosterBaseIds = new Set<string>(
      (userRoster.units ?? []).map(u => u.data.base_id)
    );
    const [playerData, metaTags] = await Promise.all([
      comlinkClient.getPlayer(yourAllyCode),
      getMetaCronTags(),
    ]);
    userDatacrons = playerData.datacron;
    userDatacronLeveragedChars = extractDatacronLeveragedCharacters(
      playerData.datacron,
      rosterBaseIds
    );
    metaDatacronActivatedChars = extractMetaActivatedCharacters(metaTags, rosterBaseIds);
    logger.info(
      `Datacron lookup: user owns ${userDatacronLeveragedChars.size} cron-leveraged character(s); ` +
      `meta has ${metaDatacronActivatedChars.size} cron-leverageable character(s) in your roster; ` +
      `${userDatacrons?.length ?? 0} total cron(s) in inventory`
    );
  } catch (error) {
    logger.warn('Could not fetch datacrons from comlink, cron filter disabled for this run:', error);
  }

  // Get season ID from bracket if available (for counter matching)
  // Always use the PREVIOUS season of the requested format, as the current season
  // may not have counter data available yet
  // If format is 3v3, we need an odd-numbered season (71, 69, 67, etc.)
  // If format is 5v5, we need an even-numbered season (72, 70, 68, etc.)
  let seasonId: string | undefined;
  let bracketFormat: string | undefined;
  try {
    const bracketData = await gacService.getBracketForAllyCode(yourAllyCode);
    const bracketSeasonId = bracketData.season_id;

    // Extract season number from season ID (e.g., "CHAMPIONSHIPS_GRAND_ARENA_GA2_EVENT_SEASON_72" -> 72)
    const seasonMatch = bracketSeasonId.match(/SEASON_(\d+)/);
    if (seasonMatch) {
      const seasonNumber = parseInt(seasonMatch[1], 10);
      const isBracket3v3 = seasonNumber % 2 === 1; // Odd = 3v3, Even = 5v5
      bracketFormat = isBracket3v3 ? '3v3' : '5v5';

      // Always use the previous season of the requested format to ensure counter data exists
      // If formats match, use previous season of that format (current - 2)
      // If formats differ, use the most recent season of the requested format (current - 1)
      let targetSeason: number;

      if (format === '3v3') {
        // For 3v3 (odd seasons)
        if (isBracket3v3) {
          // Bracket is 3v3, use previous 3v3 season (current - 2)
          targetSeason = seasonNumber - 2;
        } else {
          // Bracket is 5v5, use most recent 3v3 season (current - 1, which is odd)
          targetSeason = seasonNumber - 1;
        }
      } else {
        // For 5v5 (even seasons)
        if (!isBracket3v3) {
          // Bracket is 5v5, use previous 5v5 season (current - 2)
          targetSeason = seasonNumber - 2;
        } else {
          // Bracket is 3v3, use most recent 5v5 season (current - 1, which is even)
          targetSeason = seasonNumber - 1;
        }
      }

      // Ensure we don't go below season 1
      if (targetSeason < 1) {
        targetSeason = format === '3v3' ? 1 : 2;
      }

      seasonId = `CHAMPIONSHIPS_GRAND_ARENA_GA2_EVENT_SEASON_${targetSeason}`;
      logger.info(
        `Using previous ${format} season ${targetSeason} for counter data (bracket season: ${seasonNumber}, format: ${bracketFormat})`
      );
    } else {
      // Couldn't parse season number, use as-is
      seasonId = bracketSeasonId;
    }
  } catch {
    // If we can't get season ID, format will be used to determine season in getCounterSquads
    logger.warn('Could not get bracket season ID, will use format to determine season');
  }

  // If no seasonId resolved from bracket, use the configurable fallback
  if (!seasonId) {
    seasonId = FALLBACK_SEASON_IDS[format];
    if (seasonId) {
      logger.warn(
        `Using fallback season ID for ${format} format: ${seasonId}. ` +
        `Update FALLBACK_SEASON_IDS in gacConstants.ts when new seasons are released.`
      );
    }
  }

  // Get league and max defense squads for balancing
  let league: string | null = null;
  let maxDefenseSquads = getMaxSquadsForLeague(null, format);
  try {
    const bracketData = await gacService.getBracketForAllyCode(yourAllyCode);
    league = bracketData.league;
    maxDefenseSquads = getMaxSquadsForLeague(league, format);
    logger.info(`League detected: ${league}, max defense squads: ${maxDefenseSquads} (${format} format)`);
  } catch (error) {
    logger.warn('Could not get bracket data for defense squads, using default:', error);
  }

  // Step 1: Evaluate roster for defense candidates
  if (updateStatus) {
    await updateStatus('🛡 Evaluating roster for defense...');
  }

  const defenseCandidates = await gacStrategyService.evaluateRosterForDefense(
    userRoster,
    seasonId,
    format,
    strategyPreference
  );

  logger.info(
    `Evaluated ${defenseCandidates.length} defense candidate(s) from roster`
  );

  // Step 2: Match offense counters against full roster
  // The strategyPreference parameter adjusts GL prioritization internally
  if (updateStatus) {
    await updateStatus('📊 Matching offense counters...');
  }

  const matchedCounters = await gacStrategyService.matchCountersAgainstRoster(
    squads,
    userRoster,
    seasonId,
    format,
    strategyPreference,
    userDatacronLeveragedChars,
    metaDatacronActivatedChars
  );

  logger.info(
    `Offense matching complete: ${matchedCounters.length} counter(s) matched`
  );

  // Step 3: Suggest defense squads (avoiding offense characters where possible)
  if (updateStatus) {
    await updateStatus('🛡 Selecting defense squads...');
  }

  const offenseSquads = matchedCounters
    .filter(m => m.offense.leader.baseId)
    .map(m => m.offense);

  const defenseSuggestionsRequested = Math.max(Math.ceil(maxDefenseSquads * 2.5), 20);
  logger.info(
    `Requesting ${defenseSuggestionsRequested} defense suggestions (target: ${maxDefenseSquads} squads for ${league || 'Unknown'} league)`
  );

  const defenseSuggestions = await gacStrategyService.suggestDefenseSquads(
    userRoster,
    defenseSuggestionsRequested,
    seasonId,
    format,
    offenseSquads,
    defenseCandidates,
    strategyPreference
  );

  logger.info(
    `Received ${defenseSuggestions.length} defense suggestion(s) after filtering`
  );

  // Step 4: Balance offense and defense
  // The strategyPreference controls whether defense or offense takes priority in conflict resolution
  if (updateStatus) {
    await updateStatus('⚖️ Balancing offense and defense...');
  }

  const balanceResult = await gacStrategyService.balanceOffenseAndDefense(
    matchedCounters,
    defenseSuggestions,
    maxDefenseSquads,
    seasonId,
    strategyPreference,
    userRoster,
    format
  );
  const { balancedOffense, balancedDefense } = balanceResult;

  if (updateStatus) {
    await updateStatus('🎨 Generating strategy images...');
  }

  // Use opponent's name if available, otherwise fall back to ally code
  const opponentName = targetName || targetAllyCode;

  // Datacron allocation: build SquadInput[] from balanced lists, run the allocator
  // (snapshot-aware), and assemble the opponent-cron map from scraped defense data.
  let assignedCrons: Map<string, AssignedCron | null> | undefined;
  let opponentCronsByDefenseKey: Map<string, AssignedCron | null> | undefined;
  if (userDatacrons && userDatacrons.length > 0) {
    try {
      const defenseInputs = balancedDefense.map((def, idx) =>
        gacStrategyService.buildSquadInput(
          `def-${idx}`,
          def.squad.leader.baseId,
          def.squad.members.map(m => m.baseId),
          'defense'
        )
      );
      const counteredOffenseList = balancedOffense
        .filter(m => !!m.offense.leader.baseId)
        .slice(0, maxDefenseSquads);
      const offenseInputs = counteredOffenseList.map((m, idx) =>
        gacStrategyService.buildSquadInput(
          `off-${idx}`,
          m.offense.leader.baseId,
          m.offense.members.map(u => u.baseId),
          'offense'
        )
      );

      // Best-effort season ID — Comlink exposes the current GAC event instance.
      let seasonId: string | null = null;
      try {
        const live = await comlinkClient.getCurrentGacInstance();
        seasonId = live?.eventInstanceId ?? null;
      } catch (err) {
        logger.warn('Could not fetch GAC season ID for snapshot keying; allocation runs without lock-in:', err);
      }

      const result = await gacStrategyService.allocateDatacrons(
        yourAllyCode,
        userDatacrons,
        seasonId,
        defenseInputs,
        offenseInputs
      );
      if (result) {
        assignedCrons = result.assignments;
        logger.info(`Datacron allocation: assigned ${[...result.assignments.values()].filter(Boolean).length} crons across ${result.assignments.size} squads`);
      }

      // Opponent crons — map by the same offense battle index so the offense
      // template can match its YOUR-cron and OPP-cron on each row. Reads from
      // m.defense.datacron, which the scraper attaches in gacHistoryClient and
      // getOpponentDefensiveSquads preserves through the UniqueDefensiveSquad
      // conversion.
      opponentCronsByDefenseKey = new Map<string, AssignedCron | null>();
      let oppFound = 0;
      for (let idx = 0; idx < counteredOffenseList.length; idx++) {
        const m = counteredOffenseList[idx];
        const oppCron = m.defense.datacron;
        if (oppCron) {
          oppFound += 1;
          opponentCronsByDefenseKey.set(`opp-def-${idx}`, {
            candidate: fromScraped(oppCron as never),
            score: 0,
            filler: false,
          });
        } else {
          opponentCronsByDefenseKey.set(`opp-def-${idx}`, null);
        }
      }
      logger.info(`Opponent crons: ${oppFound}/${counteredOffenseList.length} battles have a scraped opponent cron`);
    } catch (err) {
      logger.warn('Datacron allocation failed; rendering without cron columns:', err);
      assignedCrons = undefined;
      opponentCronsByDefenseKey = undefined;
    }
  }

  // Generate split images: one for defense, one or more for offense (chunked)
  const { defenseImage, offenseImages } = await gacStrategyService.generateSplitStrategyImages(
    opponentName,
    balancedOffense,
    balancedDefense,
    format,
    maxDefenseSquads,
    userRoster,
    strategyPreference,
    targetAllyCode,
    assignedCrons,
    opponentCronsByDefenseKey
  );

  const defenseAttachment = new AttachmentBuilder(defenseImage, { name: 'gac-defense.png' });
  const offenseAttachments = offenseImages.map((buf, i) =>
    new AttachmentBuilder(buf, { name: `gac-offense-${i + 1}.png` })
  );

  const offenseCount = balancedOffense.filter(m => m.offense.leader.baseId).length;
  const uncounteredCount = balancedOffense.filter(m => !m.offense.leader.baseId).length;
  const defenseCount = balancedDefense.length;
  const strategyLabel = strategyPreference === 'defensive' ? 'Defensive' : strategyPreference === 'offensive' ? 'Offensive' : 'Balanced';

  // Create embed for defense image
  const defenseEmbed = new EmbedBuilder()
    .setTitle('🛡️ Your Defense')
    .setDescription(
      `${strategyLabel} strategy vs **${opponentName}**\n` +
      `**${defenseCount}** defense squad${defenseCount !== 1 ? 's' : ''}`
    )
    .setImage('attachment://gac-defense.png')
    .setColor(0xc4a35a)
    .setFooter({ text: `League: ${league || 'Unknown'} | Format: ${format}` });

  // Create one embed per offense chunk
  const totalChunks = offenseImages.length;
  const totalDefenseSlots = offenseCount + uncounteredCount;
  const uncounteredLine = uncounteredCount > 0
    ? `\n**${uncounteredCount}** opponent defence${uncounteredCount !== 1 ? 's' : ''} need manual counter${uncounteredCount !== 1 ? 's' : ''}`
    : '';
  const offenseEmbeds = offenseImages.map((_, i) => {
    const partLabel = totalChunks > 1 ? ` — Part ${i + 1}/${totalChunks}` : '';
    return new EmbedBuilder()
      .setTitle(`⚔️ Your Offense${partLabel}`)
      .setDescription(
        `Counter squads vs opponent's defense\n` +
        `**${offenseCount}** of **${totalDefenseSlots}** opponent defence${totalDefenseSlots !== 1 ? 's' : ''} countered` +
        uncounteredLine
      )
      .setImage(`attachment://gac-offense-${i + 1}.png`)
      .setColor(0x4ade80)
      .setFooter({ text: `Strategy: ${strategyLabel} | Squads balanced to avoid character reuse` });
  });

  try {
    await interaction.editReply({
      embeds: [defenseEmbed, ...offenseEmbeds],
      files: [defenseAttachment, ...offenseAttachments]
    });
  } finally {
    await gacStrategyService.closeBrowser();
  }
}
