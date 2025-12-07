import { ChatInputCommandInteraction, EmbedBuilder, SlashCommandBuilder } from 'discord.js';

export const helpCommand = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('List available commands and their usage'),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const embed = new EmbedBuilder()
      .setTitle('🤖 SWGOH Discord Bot - Commands')
      .setDescription('Available commands for managing your SWGOH account:')
      .addFields(
        {
          name: '/register',
          value: 'Link your Discord account to your SWGOH ally code. Usage: `/register allycode:123456789`',
          inline: false
        },
        {
          name: '/roster',
          value: 'View your roster summary including Galactic Power, Galactic Legends, and key squads.',
          inline: false
        },
        {
          name: '/gac bracket',
          value: 'View your current GAC bracket with all opponents, ranks, and scores.',
          inline: false
        },
        {
          name: '/gac opponent',
          value: 'View details about a specific opponent in your bracket. Usage: `/gac opponent` or `/gac opponent allycode:123456789`',
          inline: false
        },
        {
          name: '/help',
          value: 'Display this help message.',
          inline: false
        }
      )
      .setColor(0x0099ff)
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  }
};

