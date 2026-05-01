import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  AutocompleteInteraction,
} from 'discord.js';
import { PlayerService } from '../services/playerService';
import { GuildService } from '../services/guildService';
import { GuildImageService } from '../services/guildImages';
import { searchUnits } from '../services/unitAutocomplete';
import { logger } from '../utils/logger';
import { RequestQueue } from '../utils/requestQueue';
import {
  safeEditStatusMessage,
  handleGuildError,
  notRegisteredEmbed,
  noGuildEmbed,
} from './guild/commandUtils';
import { handleCompareCommand } from './guild/compareHandler';
import { handleReadyCheckCommand } from './guild/readyCheckHandler';

const imageQueue = new RequestQueue({ maxConcurrency: 1 });

export const guildCommand = {
  data: new SlashCommandBuilder()
    .setName('guild')
    .setDescription('Guild compare and readiness checks')
    .addSubcommand(s =>
      s.setName('compare')
        .setDescription('Side-by-side guild compare with GL counts (image)')
        .addStringOption(o => o.setName('guild_a').setDescription('First guild ID or name').setRequired(true))
        .addStringOption(o => o.setName('guild_b').setDescription('Second guild ID or name').setRequired(true))
    )
    .addSubcommand(s =>
      s.setName('ready-check')
        .setDescription('Find members who have a unit at relic ≥ N')
        .addStringOption(o => o.setName('unit').setDescription('Unit name').setAutocomplete(true).setRequired(true))
        .addStringOption(o => o.setName('guild_id').setDescription('Defaults to your guild').setRequired(false))
        .addIntegerOption(o => o.setName('min_relic').setDescription('Minimum relic tier (default 5)').setRequired(false))
    ),

  async execute(
    interaction: ChatInputCommandInteraction,
    playerService: PlayerService,
    guildService: GuildService,
    imageService: GuildImageService
  ): Promise<void> {
    let statusMessage: import('discord.js').Message | null = null;

    try {
      const subcommand = interaction.options.getSubcommand();

      let resolvedGuildId: string | null = null;
      if (subcommand === 'ready-check') {
        const explicit = interaction.options.getString('guild_id');
        if (explicit) {
          resolvedGuildId = explicit;
        } else {
          const allyCode = await playerService.getAllyCode(interaction.user.id);
          if (!allyCode) {
            await interaction.reply({ embeds: [notRegisteredEmbed()], ephemeral: true });
            return;
          }
          resolvedGuildId = await guildService.resolveCallerGuildId(allyCode);
          if (!resolvedGuildId) {
            await interaction.reply({ embeds: [noGuildEmbed()], ephemeral: true });
            return;
          }
        }
      }

      await interaction.deferReply();

      const queue = imageQueue;
      const position = queue.getSize() + 1;

      statusMessage = await interaction.followUp({
        content: position === 1 ? 'Working on your /guild request now…' : `Queued — you are **#${position}**.`,
        ephemeral: true,
        fetchReply: true,
      });

      const captured = statusMessage;
      const updateStatus = (c: string) => safeEditStatusMessage(interaction, captured, c);

      const { promise } = queue.addWithPosition(
        async () => {
          if (subcommand === 'compare') {
            await handleCompareCommand(
              interaction,
              interaction.options.getString('guild_a', true),
              interaction.options.getString('guild_b', true),
              guildService, imageService
            );
          } else if (subcommand === 'ready-check') {
            const unit = interaction.options.getString('unit', true);
            const minRelic = interaction.options.getInteger('min_relic') ?? 5;
            await handleReadyCheckCommand(interaction, resolvedGuildId!, unit, minRelic, guildService, imageService);
          }
        },
        {
          onStart: () => {
            if (position > 1) {
              // eslint-disable-next-line @typescript-eslint/no-floating-promises
              updateStatus('Working on your /guild request now…');
            }
          },
          onComplete: () => {
            // eslint-disable-next-line @typescript-eslint/no-floating-promises
            updateStatus('Done — see the result below.');
          },
        }
      );

      await promise;
    } catch (error) {
      await handleGuildError(error, interaction, statusMessage);
    }
  },

  async autocomplete(interaction: AutocompleteInteraction): Promise<void> {
    if (interaction.options.getSubcommand() !== 'ready-check') return;
    const focused = interaction.options.getFocused(true);
    if (focused.name !== 'unit') return;

    try {
      const choices = searchUnits(String(focused.value ?? ''), { combatType: 'characters' });
      await interaction.respond(choices);
    } catch (e) {
      logger.debug('guild autocomplete failed:', e);
      try { await interaction.respond([]); } catch {/* swallow */}
    }
  },
};
