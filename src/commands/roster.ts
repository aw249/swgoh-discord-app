import { ChatInputCommandInteraction, EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { PlayerService } from '../services/playerService';
import { RosterService } from '../services/rosterService';
import { logger } from '../utils/logger';

export const rosterCommand = {
  data: new SlashCommandBuilder()
    .setName('roster')
    .setDescription('View your roster summary'),

  async execute(
    interaction: ChatInputCommandInteraction,
    playerService: PlayerService,
    rosterService: RosterService
  ): Promise<void> {
    try {
      const discordUserId = interaction.user.id;
      const allyCode = await playerService.getAllyCode(discordUserId);

      if (!allyCode) {
        const embed = new EmbedBuilder()
          .setTitle('⚠️ Not Registered')
          .setDescription('You need to register your ally code first. Use `/register` to link your account.')
          .setColor(0xffaa00);

        await interaction.reply({ embeds: [embed], ephemeral: true });
        return;
      }

      const summary = await rosterService.getRosterSummary(allyCode);

      const embed = new EmbedBuilder()
        .setTitle('📊 Roster Summary')
        .addFields(
          { name: 'Player Name', value: summary.playerName, inline: true },
          { name: 'Ally Code', value: summary.allyCode, inline: true },
          { name: 'Galactic Power', value: summary.galacticPower.toLocaleString(), inline: true },
          { name: 'Galactic Legends', value: summary.galacticLegends.toString(), inline: true },
          { name: 'Key Squads', value: summary.keySquads.length > 0 ? summary.keySquads.join(', ') : 'None', inline: false }
        )
        .setColor(0x0099ff)
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
    } catch (error) {
      logger.error('Error in roster command:', error);

      const embed = new EmbedBuilder()
        .setTitle('❌ Error')
        .setDescription('Failed to retrieve roster information. Please try again later.')
        .setColor(0xff0000);

      await interaction.reply({ embeds: [embed], ephemeral: true });
    }
  }
};

