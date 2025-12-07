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
import { SwgohGgApiClient } from '../integrations/swgohGgApi';
import { GacStrategyService } from '../services/gacStrategyService';
import { logger } from '../utils/logger';
import { RequestQueue } from '../utils/requestQueue';

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
            .setDescription('Opponent ally code (e.g. a guild member, does not need to be in your bracket)')
            .setRequired(false)
        )
        .addStringOption((option) =>
          option
            .setName('bracket_opponent')
            .setDescription('Select an opponent from your current GAC bracket')
            .setAutocomplete(true)
            .setRequired(false)
        )
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
          .setDescription('Opponent ally code (optional, defaults to your next bracket opponent)')
            .setRequired(false)
        )
      .addStringOption((option) =>
        option
          .setName('bracket_opponent')
          .setDescription('Select an opponent from your current GAC bracket')
          .setAutocomplete(true)
          .setRequired(false)
        )
      .addStringOption((option) =>
        option
          .setName('strategy')
          .setDescription('Strategy: Defensive (prioritize defense), Balanced, or Offensive (prioritize offense)')
          .setRequired(false)
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
    swgohGgApiClient: SwgohGgApiClient
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
            ? 'I am processing your GAC request now. This may take a little while.'
            : `Your GAC request is in a queue and will be processed soon.\nYou are **#${position}** in line.`,
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
            const directAllyCode = interaction.options.getString('allycode');
            const bracketOpponentAllyCode = interaction.options.getString('bracket_opponent');
            // Explicit ally code always wins; otherwise fall back to selected bracket opponent
            const opponentAllyCode = directAllyCode ?? bracketOpponentAllyCode;
            await this.handleOpponentCommand(
              interaction,
              yourAllyCode,
              opponentAllyCode,
              gacService,
              swgohGgApiClient
            );
          } else if (subcommand === 'strategy') {
            const directAllyCode = interaction.options.getString('allycode');
            const bracketOpponentAllyCode = interaction.options.getString('bracket_opponent');
            // Explicit ally code always wins; otherwise fall back to selected bracket opponent
            const opponentAllyCode = directAllyCode ?? bracketOpponentAllyCode;
            const format = interaction.options.getString('format');
            if (!format) {
              throw new Error('Format is required. Please select either 5v5 or 3v3.');
            }
            const strategyPreference = (interaction.options.getString('strategy') || 'balanced') as 'defensive' | 'balanced' | 'offensive';
            const strategyService = new GacStrategyService(swgohGgApiClient, swgohGgApiClient, swgohGgApiClient);
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
              strategyPreference,
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
      
      // Check if it's a Cloudflare error
      const isCloudflareError = errorMessage.includes('Cloudflare') || errorMessage.includes('blocking automated');

      const embed = new EmbedBuilder()
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

    const embed = new EmbedBuilder()
      .setTitle('🏆 GAC Bracket')
      .setDescription(`**${summary.league}** League - Season ${summary.seasonNumber}`)
      .addFields(
        {
          name: 'Your Status',
          value: summary.yourRank
            ? `Rank: ${summary.yourRank}/${summary.playerCount}\nScore: ${summary.yourScore}`
            : 'Not found in bracket',
          inline: true
        },
        {
          name: 'Bracket Info',
          value: `Bracket ID: ${summary.bracketId}\nPlayers: ${summary.playerCount}`,
          inline: true
        }
      )
      .setColor(0x0099ff)
      .setTimestamp(new Date(summary.startTime));

    // Add opponents (limit to top 8 to avoid embed field limits)
    const topOpponents = summary.opponents.slice(0, 8);
    if (topOpponents.length > 0) {
      const opponentsList = topOpponents
        .map(opp => `**${opp.rank}.** ${opp.name} (${opp.galacticPower.toLocaleString()} GP) - ${opp.score} pts`)
        .join('\n');

      embed.addFields({
        name: 'Opponents',
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
    swgohGgApiClient: SwgohGgApiClient
  ): Promise<void> {
    // Get your bracket first
    const bracketData = await gacService.getBracketForAllyCode(yourAllyCode);

    let opponentBracketPlayer: import('../integrations/swgohGgApi').GacBracketPlayer | null = null;
    let resolvedOpponentAllyCode: string | null = null;

    if (opponentAllyCode) {
      // Look for specific opponent in bracket (for bracket-selected opponents)
      const found = gacService.findOpponentInBracket(bracketData, opponentAllyCode);
      if (found) {
        opponentBracketPlayer = found;
        resolvedOpponentAllyCode = opponentAllyCode;
      } else {
        // If not in the bracket, still allow comparison by ally code (e.g. a guild member)
        resolvedOpponentAllyCode = opponentAllyCode;
      }
    } else {
      // Show next opponent (lowest rank above you, or highest rank below you)
      const yourPlayer = bracketData.bracket_players.find(p => p.ally_code.toString() === yourAllyCode);
      if (!yourPlayer) {
        throw new Error('You are not found in this bracket.');
      }

      // Find next opponent by rank
      const nextOpponent = bracketData.bracket_players
        .filter(p => p.ally_code.toString() !== yourAllyCode)
        .sort((a, b) => a.bracket_rank - b.bracket_rank)
        .find(p => p.bracket_rank > yourPlayer.bracket_rank) ||
        bracketData.bracket_players
          .filter(p => p.ally_code.toString() !== yourAllyCode)
          .sort((a, b) => b.bracket_rank - a.bracket_rank)
          .find(p => p.bracket_rank < yourPlayer.bracket_rank);

      if (nextOpponent) {
        opponentBracketPlayer = nextOpponent;
        resolvedOpponentAllyCode = nextOpponent.ally_code.toString();
      }
    }

    if (!resolvedOpponentAllyCode) {
      const embed = new EmbedBuilder()
        .setTitle('❌ No Opponent Found')
        .setDescription('Could not find an opponent to display.')
        .setColor(0xff0000);

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    // Fetch full player data for both players
    const [yourPlayerData, opponentPlayerData] = await Promise.all([
      swgohGgApiClient.getFullPlayer(yourAllyCode),
      swgohGgApiClient.getFullPlayer(resolvedOpponentAllyCode)
    ]);

    // Generate comparison image
    const comparisonService = new PlayerComparisonService();
    try {
      const imageBuffer = await comparisonService.generateComparisonImage(yourPlayerData, opponentPlayerData);

      // Create attachment
      const attachment = new AttachmentBuilder(imageBuffer, { name: 'comparison.png' });

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

      const embed = new EmbedBuilder()
        .setTitle(`👤 ${opponentName}`)
        .setDescription(`Ally Code: ${resolvedOpponentAllyCode}`)
        .addFields(embedFields)
        .setImage('attachment://comparison.png')
        .setColor(0x0099ff)
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
      // User is not registered yet – return no suggestions
      await interaction.respond([]);
      return;
    }

    try {
      // Try to get cached bracket data first (fast path)
      let bracketData = gacService.getCachedBracket(yourAllyCode);

      // If no cache, try to fetch with a timeout (max 2 seconds to leave buffer for Discord's 3s limit)
      if (!bracketData) {
        try {
          bracketData = await Promise.race([
            gacService.getBracketForAllyCode(yourAllyCode),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('Timeout')), 2000)
            )
          ]);
        } catch (timeoutError) {
          // If fetch times out or fails, return empty array to avoid Discord timeout error
          // The user can still type the ally code manually
          await interaction.respond([]);
          return;
        }
      }

      const query = (typeof focused.value === 'string' ? focused.value : String(focused.value))
        .replace(/-/g, '')
        .toLowerCase();

      const opponents = bracketData.bracket_players
        .filter(p => p.ally_code.toString() !== yourAllyCode);

      const choices = opponents
        .filter(p => {
          if (!query) {
            return true;
          }
          const nameMatch = p.player_name.toLowerCase().includes(query);
          const allyCodeMatch = p.ally_code.toString().includes(query);
          return nameMatch || allyCodeMatch;
        })
        .sort((a, b) => a.bracket_rank - b.bracket_rank)
        .slice(0, 25)
        .map(p => {
          const allyCodeStr = p.ally_code.toString();
          const formattedAllyCode = `${allyCodeStr.slice(0, 3)}-${allyCodeStr.slice(3, 6)}-${allyCodeStr.slice(6)}`;
          return {
            name: `#${p.bracket_rank} ${p.player_name} (${formattedAllyCode})`,
            value: p.ally_code.toString()
          };
        });

      await interaction.respond(choices);
    } catch (error) {
      // On any error, fail silently and return no suggestions – we do not want to spam logs for autocomplete
      // This includes the case where interaction.respond() itself fails (e.g., interaction expired)
      try {
        await interaction.respond([]);
      } catch (respondError) {
        // Interaction may have already expired - log but don't throw
        logger.debug('Autocomplete interaction expired or already responded:', respondError);
      }
    }
  },

  async handleStrategyCommand(
    interaction: ChatInputCommandInteraction,
    yourAllyCode: string,
    opponentAllyCode: string | null,
    format: string,
    strategyPreference: 'defensive' | 'balanced' | 'offensive',
    gacService: GacService,
    gacStrategyService: GacStrategyService,
    swgohGgApiClient: SwgohGgApiClient,
    updateStatus?: (content: string) => Promise<void>
  ): Promise<void> {
    // Determine which opponent to analyse – either explicit ally code or your next bracket opponent
    let targetAllyCode: string | null = null;
    let targetName: string | null = null;
    let opponentLeague: string | null = null;

    if (updateStatus) {
      await updateStatus('🔍 Analysing your opponent...');
    }

    if (opponentAllyCode) {
      targetAllyCode = opponentAllyCode;
      // Fetch player data to get the player's name
      try {
        const opponentPlayerData = await swgohGgApiClient.getFullPlayer(opponentAllyCode);
        targetName = opponentPlayerData.data.name;
      } catch (error) {
        // If we can't fetch player data, fall back to ally code
        logger.warn(`Could not fetch player name for ally code ${opponentAllyCode}:`, error);
        targetName = null;
      }
      // League is optional - will use default max if unavailable
      opponentLeague = null;
    } else {
      const bracketData = await gacService.getBracketForAllyCode(yourAllyCode);
      const yourPlayer = bracketData.bracket_players.find(
        p => p.ally_code.toString() === yourAllyCode
      );

      if (!yourPlayer) {
        throw new Error('You are not found in this GAC bracket.');
      }

      // Use the bracket's league (all players in a bracket are in the same league)
      opponentLeague = bracketData.league;

      const nextOpponent = bracketData.bracket_players
        .filter(p => p.ally_code.toString() !== yourAllyCode)
        .sort((a, b) => a.bracket_rank - b.bracket_rank)
        .find(p => p.bracket_rank > yourPlayer.bracket_rank) ||
        bracketData.bracket_players
          .filter(p => p.ally_code.toString() !== yourAllyCode)
          .sort((a, b) => b.bracket_rank - a.bracket_rank)
          .find(p => p.bracket_rank < yourPlayer.bracket_rank);

      if (!nextOpponent) {
        throw new Error('Could not determine your next GAC opponent.');
      }

      targetAllyCode = nextOpponent.ally_code.toString();
      targetName = nextOpponent.player_name;
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

    // Get user's roster to match counters
    const userRoster = await swgohGgApiClient.getFullPlayer(yourAllyCode);

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
    let maxDefenseSquads = format === '3v3' ? 15 : 11; // Default to Kyber for the format
    try {
      const bracketData = await gacService.getBracketForAllyCode(yourAllyCode);
      league = bracketData.league;
      const leagueMaxMap: Record<string, { '5v5': number; '3v3': number }> = {
        'Kyber': { '5v5': 11, '3v3': 15 },
        'Aurodium': { '5v5': 9, '3v3': 13 },
        'Chromium': { '5v5': 7, '3v3': 10 },
        'Bronzium': { '5v5': 5, '3v3': 7 },
        'Carbonite': { '5v5': 3, '3v3': 3 }
      };
      // Normalize league name to handle case differences (API may return "AURODIUM" vs "Aurodium")
      const normalizedLeague = league.charAt(0).toUpperCase() + league.slice(1).toLowerCase();
      const leagueData = leagueMaxMap[normalizedLeague];
      if (leagueData) {
        maxDefenseSquads = leagueData[format as '5v5' | '3v3'] ?? (format === '3v3' ? 15 : 11);
      } else {
        maxDefenseSquads = format === '3v3' ? 15 : 11; // Default to Kyber max for the format
      }
      logger.info(`League detected: ${league} (normalized: ${normalizedLeague}), max defense squads: ${maxDefenseSquads} (${format} format)`);
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
      await updateStatus('🎨 Generating strategy image...');
    }

    // Use opponent's name if available, otherwise fall back to ally code
    const opponentName = targetName || targetAllyCode;

    // Step 4: Generate image with three columns: my-defense || my offense vs opponents defence
    const imageBuffer = await gacStrategyService.generateBalancedStrategyImage(
      opponentName,
      balancedOffense,
      balancedDefense,
      squads,
      format,
      maxDefenseSquads,
      userRoster,
      strategyPreference
    );

    const attachment = new AttachmentBuilder(imageBuffer, { name: 'gac-strategy.png' });

    const offenseCount = balancedOffense.filter(m => m.offense.leader.baseId).length;
    const defenseCount = balancedDefense.length;
    const strategyLabel = strategyPreference === 'defensive' ? 'Defensive' : strategyPreference === 'offensive' ? 'Offensive' : 'Balanced';
    const embed = new EmbedBuilder()
      .setTitle('🛡 GAC Strategy')
      .setDescription(
        `${strategyLabel} strategy vs **${opponentName}**.\n` +
        `**Offense:** ${offenseCount} squad${offenseCount !== 1 ? 's' : ''} | **Defense:** ${defenseCount} squad${defenseCount !== 1 ? 's' : ''}\n` +
        'Squads are balanced to avoid character reuse, ensuring GAC rules are followed.'
      )
      .setImage('attachment://gac-strategy.png')
      .setColor(0x0099ff)
      .setFooter({ text: `League: ${league || 'Unknown'} | Format: ${format} | Strategy: ${strategyLabel}` });

    try {
      await interaction.editReply({ embeds: [embed], files: [attachment] });
    } finally {
      await gacStrategyService.closeBrowser();
    }
  },

};

