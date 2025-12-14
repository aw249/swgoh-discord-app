import { ChatInputCommandInteraction, EmbedBuilder, SlashCommandBuilder } from 'discord.js';

export const helpCommand = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('List available commands and their usage'),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const embed = new EmbedBuilder()
      .setTitle('🤖 SWGOH Discord Bot - Commands')
      .setDescription('Available commands for GAC analysis and strategy:')
      .addFields(
        {
          name: '/register',
          value: 'Link your Discord account to your SWGOH ally code.\nUsage: `/register allycode:123456789`',
          inline: false
        },
        {
          name: '/gac bracket',
          value: 'View your current GAC bracket with all opponents, ranks, and scores.',
          inline: false
        },
        {
          name: '/gac opponent',
          value: 'Compare your roster against an opponent with a visual comparison image.\nUsage: `/gac opponent` or `/gac opponent allycode:123456789`',
          inline: false
        },
        {
          name: '/gac strategy',
          value: 'Get personalised offense and defense recommendations based on opponent\'s recent defensive history.\nUsage: `/gac strategy format:5v5` or `/gac strategy format:3v3`\nOptional: `strategy:defensive`, `strategy:balanced`, or `strategy:offensive`',
          inline: false
        },
        {
          name: '/help',
          value: 'Display this help message.',
          inline: false
        }
      )
      .setColor(0x0099ff)
      .setFooter({ text: 'Tip: Use /register first to link your ally code' })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  }
};
