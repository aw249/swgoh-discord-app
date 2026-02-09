import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  SlashCommandBuilder,
  AttachmentBuilder,
  AutocompleteInteraction
} from 'discord.js';
import { PlayerService } from '../services/playerService';
import { GacService } from '../services/gacService';
import { PlayerComparisonService } from '../services/playerComparisonService';
import { SwgohGgApiClient, SwgohGgFullPlayerResponse, GacDefensiveSquad, GacCounterSquad, GacTopDefenseSquad } from '../integrations/swgohGgApi';
import { CombinedApiClient, LiveBracketData } from '../integrations/comlink';
import { GacStrategyService } from '../services/gacStrategyService';
import { logger } from '../utils/logger';
import { RequestQueue } from '../utils/requestQueue';
import { getMaxSquadsForLeague } from '../config/gacConstants';

/**
 * API client interface that works with both SwgohGgApiClient and CombinedApiClient
 */
interface GacApiClient {
  getFullPlayer(allyCode: string): Promise<SwgohGgFullPlayerResponse>;
  getFullPlayerWithStats?(allyCode: string): Promise<SwgohGgFullPlayerResponse>;
  getPlayerRecentGacDefensiveSquads(allyCode: string, format: string, maxRounds?: number): Promise<GacDefensiveSquad[]>;
  getCounterSquads(defensiveLeaderBaseId: string, seasonId?: string): Promise<GacCounterSquad[]>;
  getTopDefenseSquads(sortBy?: 'percent' | 'count' | 'banners', seasonId?: string, format?: string): Promise<GacTopDefenseSquad[]>;
}

// Global queue for GAC commands so that only one heavy GAC request
// is processed at a time. This helps avoid multiple concurrent
// Puppeteer/browser operations and makes behaviour predictable.
const gacCommandQueue = new RequestQueue({ maxConcurrency: 1 });

export const gacCommand = {
  data: new SlashCommandBuilder()
    .setName('gac')
    .setDescription('View your current GAC bracket and opponents')
    .addSubcommand((subcommand) =>
      subcommand
        .setName('bracket')
        .setDescription('View your current GAC bracket')
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('opponent')
        .setDescription('View details about a specific opponent')
        .addStringOption((option) =>
          option
            .setName('allycode')
            .setDescription('Opponent ally code (e.g. 123-456-789)')
            .setRequired(true)
        )
        // DISABLED: bracket_opponent autocomplete is too slow and unreliable
        // .addStringOption((option) =>
        //   option
        //     .setName('bracket_opponent')
        //     .setDescription('Select an opponent from your current GAC bracket')
        //     .setAutocomplete(true)
        //     .setRequired(false)
        // )
    )
    .addSubcommand((subcommand) =>
      subcommand
      .setName('strategy')
      .setDescription('Analyse an opponent\'s recent GAC defensive squads')
      .addStringOption((option) =>
        option
          .setName('format')
          .setDescription('GAC format (5v5 or 3v3)')
          .setRequired(true)
          .addChoices(
            { name: '5v5', value: '5v5' },
            { name: '3v3', value: '3v3' }
          )
        )
      .addStringOption((option) =>
        option
          .setName('allycode')
          .setDescription('Opponent ally code (e.g. 123-456-789)')
          .setRequired(true)
        )
      // DISABLED: bracket_opponent autocomplete is too slow and unreliable
      // .addStringOption((option) =>
      //   option
      //     .setName('bracket_opponent')
      //     .setDescription('Select an opponent from your current GAC bracket')
      //     .setAutocomplete(true)
      //     .setRequired(false)
      // )
      .addStringOption((option) =>
        option
          .setName('strategy')
          .setDescription('Strategy: Defensive (prioritize defense), Balanced, or Offensive (prioritize offense)')
          .setRequired(true)
          .addChoices(
            { name: 'Defensive', value: 'defensive' },
            { name: 'Balanced', value: 'balanced' },
            { name: 'Offensive', value: 'offensive' }
          )
        )
    ),

  async execute(
    interaction: ChatInputCommandInteraction,
    playerService: PlayerService,
    gacService: GacService,
    swgohGgApiClient: GacApiClient
  ): Promise<void> {
    // Declare statusMessage outside try block so it's accessible in catch block
    let statusMessage: import('discord.js').Message | null = null;
    
    try {
      const subcommand = interaction.options.getSubcommand();
      const discordUserId = interaction.user.id;
      const yourAllyCode = await playerService.getAllyCode(discordUserId);

      if (!yourAllyCode) {
        const embed = new EmbedBuilder()
          .setTitle('⚠️ Not Registered')
          .setDescription('You need to register your ally code first. Use `/register` to link your account.')
          .setColor(0xffaa00);

        await interaction.reply({ embeds: [embed], ephemeral: true });
        return;
      }

      // Defer the interaction immediately so Discord knows we are working on it.
      await interaction.deferReply();

      // Determine current queue position before enqueuing this request.
      const position = gacCommandQueue.getSize() + 1;

      // Initial status message that we will update as the job progresses.
      statusMessage = await interaction.followUp({
        content:
          position === 1
            ? 'I am processing your request now...'
            : `Your request is in a queue and will be processed soon.\nYou are **#${position}** in line.`,
        ephemeral: true,
        fetchReply: true
      });

      // Helper function to safely edit the status message, handling channel cache issues
      // For ephemeral follow-up messages, we need to use interaction.webhook.editMessage()
      const safeEditStatusMessage = async (content: string): Promise<void> => {
        if (!statusMessage) {
          return;
        }
        try {
          // Use webhook.editMessage() for ephemeral follow-up messages
          await interaction.webhook.editMessage(statusMessage.id, { content });
        } catch (error) {
          logger.warn(`Failed to update status message via webhook:`, error);
          // Fallback: try editing the message directly if webhook method fails
          try {
            await statusMessage.edit(content);
          } catch (editError) {
            // If the channel is not cached, try to fetch the message from the channel
            if (editError instanceof Error && 'code' in editError && editError.code === 'ChannelNotCached') {
              try {
                const channel = interaction.channel;
                if (channel && 'messages' in channel) {
                  const fetchedMessage = await channel.messages.fetch(statusMessage.id);
                  await fetchedMessage.edit(content);
                }
              } catch (fetchError) {
                // If fetching also fails, log but don't throw - status update is non-critical
                logger.warn('Could not update status message after all fallbacks:', fetchError);
              }
            } else {
              // For other errors, log but don't throw - status update is non-critical
              logger.warn('Error updating status message:', editError);
            }
          }
        }
      };


      // Enqueue the heavy work so that only one GAC request is processed
      // at a time. We also update the status message when this job starts
      // running and when it completes.
      const { promise } = gacCommandQueue.addWithPosition(
        async () => {
          if (subcommand === 'bracket') {
            await this.handleBracketCommand(interaction, yourAllyCode, gacService);
          } else if (subcommand === 'opponent') {
            const opponentAllyCode = interaction.options.getString('allycode');
            if (!opponentAllyCode) {
              throw new Error('Ally code is required. Please provide an opponent ally code.');
            }
            await this.handleOpponentCommand(
              interaction,
              yourAllyCode,
              opponentAllyCode,
              gacService,
              swgohGgApiClient
            );
          } else if (subcommand === 'strategy') {
            const opponentAllyCode = interaction.options.getString('allycode');
            if (!opponentAllyCode) {
              throw new Error('Ally code is required. Please provide an opponent ally code.');
            }
            const format = interaction.options.getString('format');
            if (!format) {
              throw new Error('Format is required. Please select either 5v5 or 3v3.');
            }
            const strategyPreference = interaction.options.getString('strategy');
            if (!strategyPreference) {
              throw new Error('Strategy is required. Please select either Defensive, Balanced, or Offensive.');
            }
            const strategyPreferenceTyped = strategyPreference as 'defensive' | 'balanced' | 'offensive';
            const strategyService = new GacStrategyService(swgohGgApiClient, swgohGgApiClient, swgohGgApiClient, swgohGgApiClient);
            // For strategy command, also update the main reply with status
            const updateMainReply = async (content: string): Promise<void> => {
              try {
                await interaction.editReply({ content });
              } catch (error) {
                logger.warn('Could not update main reply:', error);
              }
            };
            await this.handleStrategyCommand(
              interaction,
              yourAllyCode,
              opponentAllyCode,
              format,
              strategyPreferenceTyped,
              gacService,
              strategyService,
              swgohGgApiClient,
              async (content: string) => {
                // Update both the ephemeral status message and the main reply
                await Promise.all([
                  safeEditStatusMessage(content),
                  updateMainReply(content)
                ]).catch(err => logger.warn('Error updating status messages:', err));
              }
            );
          }
        },
        {
          onStart: () => {
            // When this job becomes active (i.e. the previous one has finished),
            // update the queued message so the user knows we are now processing.
            if (position > 1) {
              // eslint-disable-next-line @typescript-eslint/no-floating-promises
              safeEditStatusMessage(
                'I am processing your GAC request now. This may take a little while.'
              );
            }
          },
          onComplete: () => {
            // Once the work is done, update the status message to indicate
            // where the user can find the result.
            let completionMessage: string;
            if (subcommand === 'opponent') {
              completionMessage = 'Please find your opponent comparison below:';
            } else if (subcommand === 'strategy') {
              completionMessage = 'Please find your balanced offense and defense strategy below:';
            } else {
              // bracket command
              completionMessage = 'Please find your GAC bracket information below:';
            }
            // eslint-disable-next-line @typescript-eslint/no-floating-promises
            safeEditStatusMessage(completionMessage);
          }
        }
      );

      await promise;
    } catch (error) {
      logger.error('Error in GAC command:', error);

      // Update the status message on error to indicate an error occurred
      if (statusMessage) {
        try {
          await interaction.webhook.editMessage(statusMessage.id, { 
            content: 'An error occurred while processing your request.' 
          });
        } catch (editError) {
          // Non-critical - log but don't throw
          logger.warn('Could not update status message on error:', editError);
        }
      }

      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred.';
      
      // Check error types for better messaging
      const isCloudflareError = errorMessage.includes('Cloudflare') || errorMessage.includes('blocking automated');
      const isNoActiveBracket = errorMessage.includes('No active GAC bracket') || 
                                 errorMessage.includes('not be in an active GAC');

      let embed: EmbedBuilder;

      if (isNoActiveBracket) {
        // Provide more helpful message for "no active bracket" errors
        embed = new EmbedBuilder()
          .setTitle('⏳ No Active GAC Bracket')
          .setDescription('Could not find an active GAC bracket. This usually means:')
          .setColor(0xffa500) // Orange - warning, not error
          .addFields({
            name: '🔹 Possible Reasons',
            value: [
              '• You are between GAC rounds (waiting for next event)',
              '• The current round hasn\'t started matchmaking yet',
              '• swgoh.gg hasn\'t updated bracket data yet',
            ].join('\n'),
            inline: false
          });

        // Try to get GAC status from Comlink for more context
        try {
          const allyCode = await playerService.getAllyCode(interaction.user.id);
          if (allyCode) {
            const gacStatus = await gacService.getGacStatus(allyCode);
            if (gacStatus.isEnrolled) {
              embed.addFields({
                name: '📊 Your Current Season Status',
                value: gacService.getGacStatusDescription(gacStatus),
                inline: false
              });
            }
            embed.addFields({
              name: '💡 What to try',
              value: [
                '• Wait for the next GAC round to begin',
                `• Check your bracket manually: [swgoh.gg/p/${allyCode}/gac-bracket](https://swgoh.gg/p/${allyCode}/gac-bracket/)`,
                '• Use `/gac opponent allycode:123456789` to compare with a specific player'
              ].join('\n'),
              inline: false
            });
          }
        } catch {
          // Ignore errors when getting status for error message
        }
      } else {
        embed = new EmbedBuilder()
          .setTitle('❌ Error')
          .setDescription(errorMessage)
          .setColor(0xff0000);

        if (isCloudflareError) {
          try {
            const allyCode = await playerService.getAllyCode(interaction.user.id);
            if (allyCode) {
              embed.addFields({
                name: '💡 Workaround',
                value: `You can access your GAC bracket directly at: https://swgoh.gg/p/${allyCode}/gac-bracket/`,
                inline: false
              });
            }
          } catch {
            // Ignore errors when getting ally code for error message
          }
        }
      }

      // Use editReply if interaction was deferred, otherwise reply
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ embeds: [embed] });
      } else {
        await interaction.reply({ embeds: [embed], ephemeral: true });
      }
    }
  },

  async handleBracketCommand(
    interaction: ChatInputCommandInteraction,
    yourAllyCode: string,
    gacService: GacService
  ): Promise<void> {
    const summary = await gacService.getBracketSummary(yourAllyCode, yourAllyCode);

    const dataSourceIndicator = summary.isRealTime ? '🟢 Real-time' : '🟡 Cached';
    
    const embed = new EmbedBuilder()
      .setTitle('🏆 GAC Bracket')
      .setDescription(`**${summary.league}** League - Season ${summary.seasonNumber}\n*${dataSourceIndicator} data*`)
      .addFields(
        {
          name: 'Your Status',
          value: summary.yourRank
            ? `Rank: ${summary.yourRank}/${summary.playerCount}\nScore: ${summary.yourScore}`
            : 'Not found in bracket',
          inline: true
        },
        {
          name: 'Round Info',
          value: `Round: ${summary.currentRound}/3\nBracket ID: ${summary.bracketId}`,
          inline: true
        }
      )
      .setColor(0x0099ff)
      .setTimestamp(new Date(summary.startTime));

    // Add current opponent if detected
    if (summary.currentOpponent) {
      embed.addFields({
        name: `⚔️ Current Opponent (Round ${summary.currentRound})`,
        value: `**${summary.currentOpponent.name}**\n` +
          `${summary.currentOpponent.galacticPower.toLocaleString()} GP • Score: ${summary.currentOpponent.score}\n` +
          `Guild: ${summary.currentOpponent.guildName}`,
        inline: false
      });
    }

    // Add opponents (limit to top 8 to avoid embed field limits)
    const topOpponents = summary.opponents.slice(0, 8);
    if (topOpponents.length > 0) {
      const opponentsList = topOpponents
        .map(opp => {
          const isCurrent = summary.currentOpponent && opp.allyCode === summary.currentOpponent.allyCode;
          const marker = isCurrent ? ' ⚔️' : '';
          return `**${opp.rank}.** ${opp.name}${marker} (${opp.galacticPower.toLocaleString()} GP) - ${opp.score} pts`;
        })
        .join('\n');

      embed.addFields({
        name: 'All Bracket Players',
        value: opponentsList.length > 1024 ? opponentsList.substring(0, 1020) + '...' : opponentsList,
        inline: false
      });
    }

    await interaction.editReply({ embeds: [embed] });
  },

  async handleOpponentCommand(
    interaction: ChatInputCommandInteraction,
    yourAllyCode: string,
    opponentAllyCode: string | null,
    gacService: GacService,
    swgohGgApiClient: GacApiClient
  ): Promise<void> {
    let bracketData: import('../integrations/swgohGgApi').GacBracketData | null = null;
    let opponentBracketPlayer: import('../integrations/swgohGgApi').GacBracketPlayer | null = null;
    let resolvedOpponentAllyCode: string | null = null;
    let detectedOpponentConfidence: 'high' | 'medium' | 'low' = 'low';

    if (opponentAllyCode) {
      // When an explicit opponent allycode is provided, we can skip bracket lookup
      // if it fails (e.g. user not in active GAC). We'll still do the comparison.
      try {
        bracketData = await gacService.getBracketForAllyCode(yourAllyCode);
      } catch (error) {
        // If bracket lookup fails, log a warning but continue with direct comparison
        logger.warn(
          `Could not fetch bracket for ${yourAllyCode}, but proceeding with direct opponent comparison:`,
          error
        );
      }

      // Normalize ally code by removing dashes (users may type "123-456-789" but URLs need "123456789")
      const normalizedAllyCode = opponentAllyCode.replace(/-/g, '');
      
      // Look for specific opponent in bracket (for bracket-selected opponents)
      if (bracketData) {
        const found = gacService.findOpponentInBracket(bracketData, normalizedAllyCode);
        if (found) {
          opponentBracketPlayer = found;
          resolvedOpponentAllyCode = normalizedAllyCode;
        } else {
          // If not in the bracket, still allow comparison by ally code (e.g. a guild member)
          resolvedOpponentAllyCode = normalizedAllyCode;
        }
      } else {
        // No bracket data available, but we can still do direct comparison
        resolvedOpponentAllyCode = normalizedAllyCode;
      }
    } else {
      // Get your bracket first - required when no explicit opponent is provided
      bracketData = await gacService.getBracketForAllyCode(yourAllyCode);
      // Get live bracket data which includes real-time opponent detection
      const liveBracket = await gacService.getLiveBracket(yourAllyCode);
      detectedOpponentConfidence = liveBracket.opponentConfidence;
      
      // This code path should no longer be reached since allycode is now required
      // But keeping it as a fallback in case of edge cases
      if (!liveBracket.currentOpponent) {
        const embed = new EmbedBuilder()
          .setTitle('🎯 Ally Code Required')
          .setDescription(
            'Please provide an opponent ally code when using `/gac opponent`.\n\n' +
            '**How to find your opponent\'s ally code:**\n' +
            '1. Open the game and check your GAC bracket\n' +
            '2. Tap on your opponent\'s profile to view their ally code\n' +
            '3. Use `/gac opponent` with the `allycode` parameter (e.g., `/gac opponent allycode:123-456-789`)'
          )
          .setColor(0xffaa00)
          .addFields({
            name: `📋 Your Bracket (Round ${liveBracket.currentRound})`,
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
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const playerId = (liveBracket.currentOpponent as any).player_id;
          if (playerId) {
            // Fetch ally code via Comlink using player ID
            try {
              const { comlinkClient } = await import('../integrations/comlink/comlinkClient');
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
          'Please verify the opponent by checking their ally code in-game.';
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
  },

  async autocomplete(
    interaction: AutocompleteInteraction,
    playerService: PlayerService,
    gacService: GacService
  ): Promise<void> {
    // DISABLED: bracket_opponent autocomplete is too slow and unreliable
    // Users must provide ally codes directly via the required allycode parameter
    await interaction.respond([]);
    return;
    
    /* Original autocomplete code - disabled due to performance issues
    const subcommand = interaction.options.getSubcommand();
    if (subcommand !== 'opponent' && subcommand !== 'strategy') {
      return;
    }

    const focused = interaction.options.getFocused(true);
    if (focused.name !== 'bracket_opponent') {
      return;
    }

    const discordUserId = interaction.user.id;
    const yourAllyCode = await playerService.getAllyCode(discordUserId);

    if (!yourAllyCode) {
      await interaction.respond([]);
      return;
    }

    try {
      let bracketData: LiveBracketData | null = null;
      try {
        bracketData = await Promise.race([
          gacService.getLiveBracketForAutocomplete(yourAllyCode),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Timeout')), 1500)
          )
        ]);
      } catch (timeoutError) {
        logger.debug(`Autocomplete fetch timed out for ${yourAllyCode}`);
        await interaction.respond([]);
        return;
      }

      if (!bracketData) {
        await interaction.respond([]);
        return;
      }

      const query = (typeof focused.value === 'string' ? focused.value : String(focused.value))
        .replace(/-/g, '')
        .toLowerCase();

      const opponents = bracketData.bracket_players
        .filter((p) => p.ally_code.toString() !== yourAllyCode);

      const choices = opponents
        .filter((p) => {
          if (!query) {
            return true;
          }
          const nameMatch = p.player_name.toLowerCase().includes(query);
          const allyCodeMatch = p.ally_code && p.ally_code > 0 
            ? p.ally_code.toString().includes(query)
            : false;
          return nameMatch || allyCodeMatch;
        })
        .sort((a, b) => a.bracket_rank - b.bracket_rank)
        .slice(0, 25)
        .map((p) => {
          const playerId = (p as any).player_id;
          const allyCodeStr = (p.ally_code && p.ally_code > 0) 
            ? p.ally_code.toString() 
            : (playerId || '0');
          const formattedAllyCode = allyCodeStr.length >= 9
            ? `${allyCodeStr.slice(0, 3)}-${allyCodeStr.slice(3, 6)}-${allyCodeStr.slice(6)}`
            : allyCodeStr;
          return {
            name: `#${p.bracket_rank} ${p.player_name}${formattedAllyCode !== '0' ? ` (${formattedAllyCode})` : ''}`,
            value: allyCodeStr
          };
        });

      await interaction.respond(choices);
    } catch (error) {
      try {
        await interaction.respond([]);
      } catch (respondError) {
        logger.debug('Autocomplete interaction expired or already responded:', respondError);
      }
    }
    */
  },

  async handleStrategyCommand(
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

      // This code path should no longer be reached since allycode is now required
      // But keeping it as a fallback in case of edge cases
      if (!liveBracket.currentOpponent) {
        const embed = new EmbedBuilder()
          .setTitle('🎯 Ally Code Required')
          .setDescription(
            'Please provide an opponent ally code when using `/gac strategy`.\n\n' +
            '**How to find your opponent\'s ally code:**\n' +
            '1. Open the game and check your GAC bracket\n' +
            '2. Tap on your opponent\'s profile to view their ally code\n' +
            '3. Use `/gac strategy` with the `allycode` parameter (e.g., `/gac strategy format:5v5 allycode:123-456-789`)'
          )
          .setColor(0xffaa00)
          .addFields({
            name: `📋 Your Bracket (Round ${liveBracket.currentRound})`,
            value: liveBracket.bracket_players
              .map(p => `• ${p.player_name}${p.ally_code.toString() === yourAllyCode ? ' (You)' : ''}`)
              .join('\n') || 'No players found',
            inline: false
          });

        await interaction.editReply({ embeds: [embed] });
        return;
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

    // If no seasonId from bracket, default to a known season based on format
    if (!seasonId) {
      if (format === '3v3') {
        seasonId = 'CHAMPIONSHIPS_GRAND_ARENA_GA2_EVENT_SEASON_71';
        logger.info('No seasonId from bracket, defaulting to Season 71 for 3v3 format');
      } else {
        // For 5v5, use a recent even-numbered season (e.g., Season 72)
        seasonId = 'CHAMPIONSHIPS_GRAND_ARENA_GA2_EVENT_SEASON_72';
        logger.info('No seasonId from bracket, defaulting to Season 72 for 5v5 format');
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
      logger.info(`[Strategy Command] Sending final reply with ${balancedOffense.length} offense squad(s) and ${balancedDefense.length} defense squad(s)`);
      logger.info(`[Strategy Command] Defense image size: ${defenseImage.length} bytes, Offense image size: ${offenseImage.length} bytes`);
      logger.info(`[Strategy Command] Embeds array: [defenseEmbed, offenseEmbed] (2 embeds total)`);
      logger.info(`[Strategy Command] Files array: [defenseAttachment, offenseAttachment] (2 files total)`);
      
      // Ensure we only send one of each embed and file
      await interaction.editReply({ 
        embeds: [defenseEmbed, offenseEmbed], 
        files: [defenseAttachment, offenseAttachment] 
      });
      logger.info(`[Strategy Command] Final reply sent successfully`);
    } finally {
      await gacStrategyService.closeBrowser();
    }
  },

};

