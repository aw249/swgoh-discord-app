import { ChatInputCommandInteraction, EmbedBuilder, AttachmentBuilder } from 'discord.js';
import { GacService } from '../../services/gacService';
import { PlayerComparisonService } from '../../services/playerComparisonService';
import { GacApiClient } from './commandUtils';
import { logger } from '../../utils/logger';

export async function handleOpponentCommand(
  interaction: ChatInputCommandInteraction,
  yourAllyCode: string,
  opponentAllyCode: string | null,
  gacService: GacService,
  swgohGgApiClient: GacApiClient
): Promise<void> {
  // Get your bracket first
  const bracketData = await gacService.getBracketForAllyCode(yourAllyCode);

  let opponentBracketPlayer: import('../../integrations/swgohGgApi').GacBracketPlayer | null = null;
  let resolvedOpponentAllyCode: string | null = null;
  let detectedOpponentConfidence: 'high' | 'medium' | 'low' = 'low';

  if (opponentAllyCode) {
    // Normalize ally code by removing dashes (users may type "123-456-789" but URLs need "123456789")
    const normalizedAllyCode = opponentAllyCode.replace(/-/g, '');
    // Look for specific opponent in bracket (for bracket-selected opponents)
    const found = gacService.findOpponentInBracket(bracketData, normalizedAllyCode);
    if (found) {
      opponentBracketPlayer = found;
      resolvedOpponentAllyCode = normalizedAllyCode;
    } else {
      // If not in the bracket, still allow comparison by ally code (e.g. a guild member)
      resolvedOpponentAllyCode = normalizedAllyCode;
    }
  } else {
    // Get live bracket data which includes real-time opponent detection
    const liveBracket = await gacService.getLiveBracket(yourAllyCode);
    detectedOpponentConfidence = liveBracket.opponentConfidence;

    // Round 1 with low confidence: require manual selection
    // GAC matchmaking for Round 1 is not publicly documented, so we can't reliably predict
    if (liveBracket.currentRound === 1 && liveBracket.opponentConfidence === 'low') {
      const embed = new EmbedBuilder()
        .setTitle('🎯 Round 1 - Please Select Your Opponent')
        .setDescription(
          'GAC Round 1 matchups cannot be auto-detected because the game\'s pairing algorithm is not public.\n\n' +
          '**How to find your opponent:**\n' +
          '1. Open the game and check your GAC bracket\n' +
          '2. Use `/gac opponent` and start typing in the `bracket_opponent` field\n' +
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

    if (liveBracket.currentOpponent) {
      opponentBracketPlayer = liveBracket.currentOpponent;

      // Check if we have a valid ally code (not 0)
      if (liveBracket.currentOpponent.ally_code && liveBracket.currentOpponent.ally_code !== 0) {
        resolvedOpponentAllyCode = liveBracket.currentOpponent.ally_code.toString();
      } else {
        // Ally code is 0 - this happens when bracket data came from Comlink
        // but we failed to fetch the opponent's ally code
        logger.warn(
          `Opponent ${liveBracket.currentOpponent.player_name} has no valid ally code. ` +
          `Using player_id to fetch data.`
        );
        const playerId = liveBracket.currentOpponent.player_id;
        if (playerId) {
          // Fetch ally code via Comlink using player ID
          try {
            const { comlinkClient } = await import('../../integrations/comlink/comlinkClient');
            const playerData = await comlinkClient.getPlayerById(playerId);
            resolvedOpponentAllyCode = playerData.allyCode;
            logger.info(`Fetched ally code ${resolvedOpponentAllyCode} for opponent via player ID`);
          } catch (err) {
            logger.error(`Failed to fetch ally code for player ${playerId}:`, err);
          }
        }
      }

      if (resolvedOpponentAllyCode) {
        logger.info(
          `Real-time opponent detected for Round ${liveBracket.currentRound}: ` +
          `${liveBracket.currentOpponent.player_name} ` +
          `(Score: ${liveBracket.currentOpponent.bracket_score}, ` +
          `Real-time: ${liveBracket.isRealTime}, ` +
          `Confidence: ${liveBracket.opponentConfidence})`
        );
      }
    } else {
      logger.warn('Could not determine current opponent from live bracket data');
    }
  }

  // Track confidence for user messaging
  const matchConfidence = opponentAllyCode ? 'specified' : detectedOpponentConfidence;

  if (!resolvedOpponentAllyCode || resolvedOpponentAllyCode === '0') {
    const embed = new EmbedBuilder()
      .setTitle('❌ No Opponent Found')
      .setDescription('Could not find an opponent to display.')
      .setColor(0xff0000);

    await interaction.editReply({ embeds: [embed] });
    return;
  }

  // Fetch full player data for both players WITH STATS (comparison needs calculated stats)
  // Use getFullPlayerWithStats which always fetches from swgoh.gg since Comlink doesn't provide stats
  const getPlayerWithStats = swgohGgApiClient.getFullPlayerWithStats
    ? swgohGgApiClient.getFullPlayerWithStats.bind(swgohGgApiClient)
    : swgohGgApiClient.getFullPlayer.bind(swgohGgApiClient);

  const [yourPlayerData, opponentPlayerData] = await Promise.all([
    getPlayerWithStats(yourAllyCode),
    getPlayerWithStats(resolvedOpponentAllyCode)
  ]);

  // Generate comparison image
  const comparisonService = new PlayerComparisonService();
  try {
    const imageBuffer = await comparisonService.generateComparisonImage(yourPlayerData, opponentPlayerData);

    // Create attachment with explicit content type to ensure PNG format
    const attachment = new AttachmentBuilder(imageBuffer, {
      name: 'comparison.png',
      description: 'Player comparison'
    });

    const opponentName = opponentBracketPlayer?.player_name ?? opponentPlayerData.data.name;
    const opponentGuild =
      opponentBracketPlayer?.guild_name ?? (opponentPlayerData.data.guild_name || 'N/A');
    const opponentGp =
      opponentBracketPlayer?.player_gp ?? opponentPlayerData.data.galactic_power;
    const opponentRank = opponentBracketPlayer?.bracket_rank;
    const opponentScore = opponentBracketPlayer?.bracket_score;

    const embedFields = [
      {
        name: 'Galactic Power',
        value: opponentGp.toLocaleString(),
        inline: true
      },
      {
        name: 'Guild',
        value: opponentGuild,
        inline: false
      }
    ];

    if (opponentRank !== undefined && opponentScore !== undefined) {
      embedFields.unshift(
        { name: 'Rank', value: `#${opponentRank}`, inline: true },
        { name: 'Score', value: opponentScore.toString(), inline: true }
      );
    }

    // Build description with confidence indicator
    let description = `Ally Code: ${resolvedOpponentAllyCode}`;
    if (matchConfidence === 'medium') {
      description += '\n\n🎯 **Predicted** using Top 80 Character GP matching.';
    } else if (matchConfidence === 'low') {
      description += '\n\n⚠️ **Note:** Prediction confidence is low. ' +
        'Use `/gac opponent` with the `bracket_opponent` option to select manually.';
    }

    const embed = new EmbedBuilder()
      .setTitle(`👤 ${opponentName}`)
      .setDescription(description)
      .addFields(embedFields)
      .setImage('attachment://comparison.png')
      .setColor(matchConfidence === 'low' ? 0xffaa00 : 0x0099ff) // Orange for low confidence
      .setTimestamp();

    await interaction.editReply({ embeds: [embed], files: [attachment] });
  } finally {
    await comparisonService.closeBrowser();
  }
}
