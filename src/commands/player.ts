import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  AutocompleteInteraction,
} from 'discord.js';
import { PlayerService } from '../services/playerService';
import { PlayerInsightsService } from '../services/playerInsightsService';
import { GameDataService } from '../services/gameDataService';
import { logger } from '../utils/logger';
import { RequestQueue } from '../utils/requestQueue';
import { normaliseAllyCode } from '../utils/allyCodeUtils';
import {
  safeEditStatusMessage,
  handlePlayerError,
  notRegisteredEmbed,
} from './player/commandUtils';
import { handleJourneyReadyCommand } from './player/journeyReadyHandler';

const apiOnlyQueue = new RequestQueue({ maxConcurrency: 2 });
const MAX_AUTOCOMPLETE = 25;

function searchJourneyGLs(query: string): Array<{ name: string; value: string }> {
  const svc = GameDataService.getInstance();
  if (!svc.isReady()) return [];

  const q = query.toLowerCase().trim();
  return svc.getJourneyReadyGLs()
    .map(id => ({ id, name: svc.getUnitName(id) }))
    .filter(({ id, name }) => !q || id.toLowerCase().includes(q) || name.toLowerCase().includes(q))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, MAX_AUTOCOMPLETE)
    .map(({ id, name }) => ({
      name: name.length > 100 ? name.slice(0, 100) : name,
      value: id,
    }));
}

export const playerCommand = {
  data: new SlashCommandBuilder()
    .setName('player')
    .setDescription('Player roster utilities')
    .addSubcommand(s =>
      s.setName('journey-ready')
        .setDescription('Show your progress towards unlocking a Galactic Legend')
        .addStringOption(o => o.setName('gl').setDescription('Galactic Legend').setAutocomplete(true).setRequired(true))
        .addStringOption(o => o.setName('allycode').setDescription('Ally code (defaults to yours)').setRequired(false))
    ),

  async execute(
    interaction: ChatInputCommandInteraction,
    playerService: PlayerService,
    insightsService: PlayerInsightsService
  ): Promise<void> {
    let statusMessage: import('discord.js').Message | null = null;

    try {
      const subcommand = interaction.options.getSubcommand();
      if (subcommand !== 'journey-ready') return;

      const argAllyCode = interaction.options.getString('allycode');
      const allyCode = argAllyCode
        ? normaliseAllyCode(argAllyCode)
        : await playerService.getAllyCode(interaction.user.id);

      if (!allyCode) {
        await interaction.reply({ embeds: [notRegisteredEmbed()], ephemeral: true });
        return;
      }

      await interaction.deferReply();

      const position = apiOnlyQueue.getSize() + 1;
      statusMessage = await interaction.followUp({
        content: position === 1
          ? 'Working on your /player request now…'
          : `Queued — you are **#${position}** in line.`,
        ephemeral: true,
        fetchReply: true,
      });

      const captured = statusMessage;
      const updateStatus = (c: string) => safeEditStatusMessage(interaction, captured, c);

      const { promise } = apiOnlyQueue.addWithPosition(
        async () => {
          const gl = interaction.options.getString('gl', true);
          await handleJourneyReadyCommand(interaction, allyCode, gl, insightsService);
        },
        {
          onStart: () => {
            if (position > 1) {
              // eslint-disable-next-line @typescript-eslint/no-floating-promises
              updateStatus('Working on your /player request now…');
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
      await handlePlayerError(error, interaction, statusMessage);
    }
  },

  async autocomplete(interaction: AutocompleteInteraction): Promise<void> {
    if (interaction.options.getSubcommand() !== 'journey-ready') return;
    const focused = interaction.options.getFocused(true);
    if (focused.name !== 'gl') return;

    try {
      const choices = searchJourneyGLs(String(focused.value ?? ''));
      await interaction.respond(choices);
    } catch (e) {
      logger.debug('player autocomplete failed:', e);
      try { await interaction.respond([]); } catch {/* swallow */}
    }
  },
};
