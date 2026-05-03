import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  SlashCommandBuilder,
  AutocompleteInteraction
} from 'discord.js';
import { PlayerService } from '../services/playerService';
import { GacService } from '../services/gacService';
import { GacStrategyService } from '../services/gacStrategyService';
import { DatacronSnapshotStore } from '../storage/datacronSnapshotStore';

// Module-level snapshot store — single instance shared across all /gac strategy
// invocations so the in-memory cache is consistent and the on-disk file isn't
// racing between concurrent calls.
const datacronSnapshotStore = new DatacronSnapshotStore('app/data/datacronSnapshots.json');
import { logger } from '../utils/logger';
import { RequestQueue } from '../utils/requestQueue';
import { normaliseAllyCode } from '../utils/allyCodeUtils';
import { GacApiClient, safeEditStatusMessage, handleGacError } from './gac/commandUtils';
import { handleBracketCommand } from './gac/bracketHandler';
import { handleOpponentCommand } from './gac/opponentHandler';
import { handleStrategyCommand } from './gac/strategyHandler';

// Separate queues for API-only commands (bracket, opponent) and
// strategy commands (which use Puppeteer). This allows lightweight
// bracket lookups to proceed while a strategy render is in progress.
const apiOnlyQueue = new RequestQueue({ maxConcurrency: 2 });
const strategyQueue = new RequestQueue({ maxConcurrency: 1 });

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

      // Pick the right queue: strategy uses Puppeteer (heavy), bracket/opponent are API-only (light).
      const queue = subcommand === 'strategy' ? strategyQueue : apiOnlyQueue;

      // Determine current queue position before enqueuing this request.
      const position = queue.getSize() + 1;

      // Initial status message that we will update as the job progresses.
      statusMessage = await interaction.followUp({
        content:
          position === 1
            ? 'I am processing your request now...'
            : `Your request is in a queue and will be processed soon.\nYou are **#${position}** in line.`,
        ephemeral: true,
        fetchReply: true
      });

      // Capture statusMessage in a non-null variable for the closure
      const capturedStatusMessage = statusMessage;

      // Helper that wraps the standalone safeEditStatusMessage with the captured status message
      const updateStatus = async (content: string): Promise<void> => {
        await safeEditStatusMessage(interaction, capturedStatusMessage, content);
      };

      // Enqueue the heavy work so that only one GAC request is processed
      // at a time. We also update the status message when this job starts
      // running and when it completes.
      const { promise } = queue.addWithPosition(
        async () => {
          if (subcommand === 'bracket') {
            await handleBracketCommand(interaction, yourAllyCode, gacService);
          } else if (subcommand === 'opponent') {
            const directAllyCode = interaction.options.getString('allycode');
            const normalizedDirectAllyCode = directAllyCode ? normaliseAllyCode(directAllyCode) : null;
            const rawBracketOpponent = interaction.options.getString('bracket_opponent');
            const bracketOpponentAllyCode = rawBracketOpponent
              ? normaliseAllyCode(rawBracketOpponent.replace(/\D/g, ''))
              : null;
            // Explicit ally code always wins; otherwise fall back to selected bracket opponent
            const opponentAllyCode = normalizedDirectAllyCode ?? bracketOpponentAllyCode;
            await handleOpponentCommand(
              interaction,
              yourAllyCode,
              opponentAllyCode,
              gacService,
              swgohGgApiClient
            );
          } else if (subcommand === 'strategy') {
            const directAllyCode = interaction.options.getString('allycode');
            const normalizedDirectAllyCode = directAllyCode ? normaliseAllyCode(directAllyCode) : null;
            const rawBracketOpponent = interaction.options.getString('bracket_opponent');
            const bracketOpponentAllyCode = rawBracketOpponent
              ? normaliseAllyCode(rawBracketOpponent.replace(/\D/g, ''))
              : null;
            // Explicit ally code always wins; otherwise fall back to selected bracket opponent
            const opponentAllyCode = normalizedDirectAllyCode ?? bracketOpponentAllyCode;
            const format = interaction.options.getString('format');
            if (!format) {
              throw new Error('Format is required. Please select either 5v5 or 3v3.');
            }
            const strategyPreference = (interaction.options.getString('strategy') || 'balanced') as 'defensive' | 'balanced' | 'offensive';
            const strategyService = new GacStrategyService({
              historyClient: swgohGgApiClient,
              counterClient: swgohGgApiClient,
              defenseClient: swgohGgApiClient,
              playerClient: swgohGgApiClient,
              snapshotStore: datacronSnapshotStore,
            });
            // For strategy command, also update the main reply with status
            const updateMainReply = async (content: string): Promise<void> => {
              try {
                await interaction.editReply({ content });
              } catch (error) {
                logger.warn('Could not update main reply:', error);
              }
            };
            await handleStrategyCommand(
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
                  updateStatus(content),
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
              updateStatus(
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
            updateStatus(completionMessage);
          }
        }
      );

      await promise;
    } catch (error) {
      await handleGacError(error, interaction, playerService, gacService, statusMessage);
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
            gacService.getLiveBracket(yourAllyCode),
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

      if (!bracketData) {
        await interaction.respond([]);
        return;
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

};
