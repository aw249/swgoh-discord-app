import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
} from 'discord.js';
import { GuildService } from '../services/guildService';
import { TwImageService } from '../services/twImages';
import { RequestQueue } from '../utils/requestQueue';
import {
  safeEditStatusMessage,
  handleTwError,
} from './tw/commandUtils';
import { handleScoutCommand } from './tw/scoutHandler';

const imageQueue = new RequestQueue({ maxConcurrency: 1 });

export const twCommand = {
  data: new SlashCommandBuilder()
    .setName('tw')
    .setDescription('Territory War utilities')
    .addSubcommand(s =>
      s.setName('scout')
        .setDescription('Snapshot of an opposing guild — GP, GLs, top members, recent TW pattern')
        .addStringOption(o => o.setName('guild').setDescription('Guild ID or name').setRequired(true))
    ),

  async execute(
    interaction: ChatInputCommandInteraction,
    guildService: GuildService,
    imageService: TwImageService
  ): Promise<void> {
    let statusMessage: import('discord.js').Message | null = null;

    try {
      const subcommand = interaction.options.getSubcommand();
      if (subcommand !== 'scout') return;

      await interaction.deferReply();

      const position = imageQueue.getSize() + 1;
      statusMessage = await interaction.followUp({
        content: position === 1 ? 'Working on your /tw request now…' : `Queued — you are **#${position}**.`,
        ephemeral: true,
        fetchReply: true,
      });

      const captured = statusMessage;
      const updateStatus = (c: string) => safeEditStatusMessage(interaction, captured, c);

      const { promise } = imageQueue.addWithPosition(
        async () => {
          await handleScoutCommand(
            interaction,
            interaction.options.getString('guild', true),
            guildService,
            imageService
          );
        },
        {
          onStart: () => {
            if (position > 1) {
              // eslint-disable-next-line @typescript-eslint/no-floating-promises
              updateStatus('Working on your /tw request now…');
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
      await handleTwError(error, interaction, statusMessage);
    }
  },
};
