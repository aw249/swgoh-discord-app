import { ChatInputCommandInteraction, EmbedBuilder, AttachmentBuilder } from 'discord.js';
import { GacService } from '../../services/gacService';
import { GacStrategyService } from '../../services/gacStrategyService';
import { GacApiClient } from './commandUtils';
import { logger } from '../../utils/logger';
import { getMaxSquadsForLeague } from '../../config/gacConstants';

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

  // If no seasonId from bracket and 3v3 is requested, default to a known 3v3 season
  if (!seasonId && format === '3v3') {
    seasonId = 'CHAMPIONSHIPS_GRAND_ARENA_GA2_EVENT_SEASON_71';
    logger.info('No seasonId from bracket, defaulting to Season 71 for 3v3 format');
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

  let matchedCounters: Awaited<ReturnType<typeof gacStrategyService.matchCountersAgainstRoster>>;
  let defenseCandidates: Awaited<ReturnType<typeof gacStrategyService.evaluateRosterForDefense>>;
  let defenseSuggestions: Awaited<ReturnType<typeof gacStrategyService.suggestDefenseSquads>>;
  let balancedOffense: Awaited<ReturnType<typeof gacStrategyService.balanceOffenseAndDefense>>['balancedOffense'];
  let balancedDefense: Awaited<ReturnType<typeof gacStrategyService.balanceOffenseAndDefense>>['balancedDefense'];

  if (strategyPreference === 'defensive') {
    // DEFENSIVE STRATEGY: Defense first (best hold %), then offense from remaining roster

    if (updateStatus) {
      await updateStatus('🛡 Evaluating roster for defense...');
    }

    // Step 1: Evaluate roster for top defense candidates
    defenseCandidates = await gacStrategyService.evaluateRosterForDefense(
      userRoster,
      seasonId,
      format,
      strategyPreference
    );

    logger.info(
      `Evaluated ${defenseCandidates.length} defense candidate(s) from roster (top candidates)`
    );

    if (updateStatus) {
      await updateStatus('🛡 Selecting defense squads...');
    }

    // Step 2: Get defense suggestions (no offense squads to avoid yet)
    const defenseSuggestionsRequested = Math.max(Math.ceil(maxDefenseSquads * 2.5), 20);
    logger.info(
      `Requesting ${defenseSuggestionsRequested} defense suggestions to ensure we can fill ${maxDefenseSquads} defense slots after filtering`
    );

    defenseSuggestions = await gacStrategyService.suggestDefenseSquads(
      userRoster,
      defenseSuggestionsRequested,
      seasonId,
      format,
      [], // No offense squads to avoid yet
      defenseCandidates,
      strategyPreference
    );

    logger.info(
      `Received ${defenseSuggestions.length} defense suggestion(s) after filtering (target: ${maxDefenseSquads} squads for ${league || 'Unknown'} league)`
    );

    // Step 3: Estimate which characters will be used in defense
    // For defensive strategy, balance logic will prioritize defense first
    // We'll estimate by taking top defense suggestions sorted by hold % (as balance logic does)
    // Sort by hold percentage descending (as balance logic does for defensive strategy)
    const sortedDefenseByHold = [...defenseSuggestions].sort((a, b) => {
      const aHold = a.holdPercentage ?? 0;
      const bHold = b.holdPercentage ?? 0;
      // Primary sort: by hold percentage (highest first)
      if (Math.abs(aHold - bHold) > 2) {
        return bHold - aHold;
      }
      // If hold % is close, sort by score
      return b.score - a.score;
    });

    // Estimate defense usage: take top candidates up to maxDefenseSquads
    // But be conservative - only estimate if we have enough suggestions
    const estimatedDefenseCount = Math.min(
      maxDefenseSquads,
      Math.floor(defenseSuggestions.length * 0.8) // Use 80% of available suggestions as estimate
    );

    const defenseUsedCharacters = new Set<string>();
    const defenseUsedLeaders = new Set<string>();
    // Estimate based on top candidates
    for (const def of sortedDefenseByHold.slice(0, estimatedDefenseCount)) {
      defenseUsedLeaders.add(def.squad.leader.baseId);
      defenseUsedCharacters.add(def.squad.leader.baseId);
      for (const member of def.squad.members) {
        defenseUsedCharacters.add(member.baseId);
      }
    }

    logger.info(
      `Estimated ${estimatedDefenseCount} defense squad(s) will be used (${defenseUsedCharacters.size} characters), ` +
      `filtering roster for offense matching`
    );

    // Step 4: Filter roster to exclude estimated defense characters, then match counters
    const remainingRoster: typeof userRoster = {
      ...userRoster,
      units: userRoster.units.filter(u => {
        if (!u.data || !u.data.base_id) return false;
        return !defenseUsedCharacters.has(u.data.base_id);
      })
    };

    logger.info(
      `Filtered roster for offense matching: ${remainingRoster.units.length} characters remaining ` +
      `(${defenseUsedCharacters.size} characters estimated for defense)`
    );

    if (updateStatus) {
      await updateStatus('📊 Matching offense counters from remaining roster...');
    }

    // Step 5: Match offense counters using only remaining roster
    matchedCounters = await gacStrategyService.matchCountersAgainstRoster(
      squads,
      remainingRoster,
      seasonId,
      format,
      strategyPreference
    );

    if (updateStatus) {
      await updateStatus('⚖️ Balancing offense and defense...');
    }

    // Step 6: Balance - balance logic will prioritize defense first for defensive strategy
    const balanceResult = await gacStrategyService.balanceOffenseAndDefense(
      matchedCounters,
      defenseSuggestions,
      maxDefenseSquads,
      seasonId,
      strategyPreference,
      userRoster,
      format
    );
    balancedOffense = balanceResult.balancedOffense;
    balancedDefense = balanceResult.balancedDefense;

  } else if (strategyPreference === 'offensive') {
    // OFFENSIVE STRATEGY: Offense first (prioritize GLs), then defense from remaining roster

    if (updateStatus) {
      await updateStatus('📊 Matching offense counters (prioritizing GLs)...');
    }

    // Step 1: Match offense counters (GLs prioritized in sorting logic)
    matchedCounters = await gacStrategyService.matchCountersAgainstRoster(
      squads,
      userRoster,
      seasonId,
      format,
      strategyPreference
    );

    // Step 2: Get characters used in offense
    const offenseUsedCharacters = new Set<string>();
    const offenseUsedLeaders = new Set<string>();
    for (const counter of matchedCounters) {
      if (counter.offense.leader.baseId) {
        offenseUsedLeaders.add(counter.offense.leader.baseId);
        offenseUsedCharacters.add(counter.offense.leader.baseId);
        for (const member of counter.offense.members) {
          offenseUsedCharacters.add(member.baseId);
        }
      }
    }

    logger.info(
      `Offense matching complete: ${matchedCounters.length} counter(s) matched, ` +
      `${offenseUsedCharacters.size} unique character(s) used`
    );

    if (updateStatus) {
      await updateStatus('🛡 Evaluating roster for defense...');
    }

    // Step 3: Evaluate roster for top defense candidates
    defenseCandidates = await gacStrategyService.evaluateRosterForDefense(
      userRoster,
      seasonId,
      format,
      strategyPreference
    );

    logger.info(
      `Evaluated ${defenseCandidates.length} defense candidate(s) from roster (top candidates)`
    );

    if (updateStatus) {
      await updateStatus('🛡 Selecting defense squads from remaining roster...');
    }

    // Step 4: Get defense suggestions (avoiding offense characters)
    const offenseSquads = matchedCounters
      .filter(m => m.offense.leader.baseId)
      .map(m => m.offense);

    const defenseSuggestionsRequested = Math.max(Math.ceil(maxDefenseSquads * 2.5), 20);
    logger.info(
      `Requesting ${defenseSuggestionsRequested} defense suggestions to ensure we can fill ${maxDefenseSquads} defense slots after filtering`
    );

    defenseSuggestions = await gacStrategyService.suggestDefenseSquads(
      userRoster,
      defenseSuggestionsRequested,
      seasonId,
      format,
      offenseSquads, // Avoid offense characters
      defenseCandidates,
      strategyPreference
    );

    logger.info(
      `Received ${defenseSuggestions.length} defense suggestion(s) after filtering (target: ${maxDefenseSquads} squads for ${league || 'Unknown'} league)`
    );

    if (updateStatus) {
      await updateStatus('⚖️ Balancing offense and defense...');
    }

    // Step 5: Balance offense and defense
    const balanceResult = await gacStrategyService.balanceOffenseAndDefense(
      matchedCounters,
      defenseSuggestions,
      maxDefenseSquads,
      seasonId,
      strategyPreference,
      userRoster,
      format
    );
    balancedOffense = balanceResult.balancedOffense;
    balancedDefense = balanceResult.balancedDefense;

  } else {
    // BALANCED STRATEGY: Current order (offense first, then defense)

    if (updateStatus) {
      await updateStatus('📊 Matching offense counters...');
    }

    // Step 1: Get offense counters against opponent's defense
    matchedCounters = await gacStrategyService.matchCountersAgainstRoster(
      squads,
      userRoster,
      seasonId,
      format,
      strategyPreference
    );

    if (updateStatus) {
      await updateStatus('🛡 Evaluating roster for defense...');
    }

    // Step 2: Evaluate roster for top defense candidates
    defenseCandidates = await gacStrategyService.evaluateRosterForDefense(
      userRoster,
      seasonId,
      format,
      strategyPreference
    );

    logger.info(
      `Evaluated ${defenseCandidates.length} defense candidate(s) from roster (top candidates)`
    );

    if (updateStatus) {
      await updateStatus('🛡 Selecting defense squads...');
    }

    // Step 3: Get defense suggestions (avoiding offense characters)
    const offenseSquads = matchedCounters
      .filter(m => m.offense.leader.baseId)
      .map(m => m.offense);

    const defenseSuggestionsRequested = Math.max(Math.ceil(maxDefenseSquads * 2.5), 20);
    logger.info(
      `Requesting ${defenseSuggestionsRequested} defense suggestions to ensure we can fill ${maxDefenseSquads} defense slots after filtering`
    );

    defenseSuggestions = await gacStrategyService.suggestDefenseSquads(
      userRoster,
      defenseSuggestionsRequested,
      seasonId,
      format,
      offenseSquads,
      defenseCandidates,
      strategyPreference
    );

    logger.info(
      `Received ${defenseSuggestions.length} defense suggestion(s) after filtering (target: ${maxDefenseSquads} squads for ${league || 'Unknown'} league)`
    );

    if (updateStatus) {
      await updateStatus('⚖️ Balancing offense and defense...');
    }

    // Step 4: Balance offense and defense
    const balanceResult = await gacStrategyService.balanceOffenseAndDefense(
      matchedCounters,
      defenseSuggestions,
      maxDefenseSquads,
      seasonId,
      strategyPreference,
      userRoster,
      format
    );
    balancedOffense = balanceResult.balancedOffense;
    balancedDefense = balanceResult.balancedDefense;
  }

  if (updateStatus) {
    await updateStatus('🎨 Generating strategy images...');
  }

  // Use opponent's name if available, otherwise fall back to ally code
  const opponentName = targetName || targetAllyCode;

  // Generate split images: one for defense, one for offense
  const { defenseImage, offenseImage } = await gacStrategyService.generateSplitStrategyImages(
    opponentName,
    balancedOffense,
    balancedDefense,
    format,
    maxDefenseSquads,
    userRoster,
    strategyPreference,
    targetAllyCode
  );

  const defenseAttachment = new AttachmentBuilder(defenseImage, { name: 'gac-defense.png' });
  const offenseAttachment = new AttachmentBuilder(offenseImage, { name: 'gac-offense.png' });

  const offenseCount = balancedOffense.filter(m => m.offense.leader.baseId).length;
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

  // Create embed for offense image
  const offenseEmbed = new EmbedBuilder()
    .setTitle('⚔️ Your Offense')
    .setDescription(
      `Counter squads vs opponent's defense\n` +
      `**${offenseCount}** offense squad${offenseCount !== 1 ? 's' : ''}`
    )
    .setImage('attachment://gac-offense.png')
    .setColor(0x4ade80)
    .setFooter({ text: `Strategy: ${strategyLabel} | Squads balanced to avoid character reuse` });

  try {
    await interaction.editReply({
      embeds: [defenseEmbed, offenseEmbed],
      files: [defenseAttachment, offenseAttachment]
    });
  } finally {
    await gacStrategyService.closeBrowser();
  }
}
