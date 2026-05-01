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
          name: '/player journey-ready',
          value: 'Show your readiness for a specific unit — stars, gear, relic, zetas/omicrons, plus a one-line "next step" hint.\nUsage: `/player journey-ready unit:<name>` or add `allycode:123456789` to check another player.',
          inline: false
        },
        {
          name: '/guild compare',
          value: 'Side-by-side image comparing two guilds: GP, member count, GL count + top GLs, top 10 members.\nUsage: `/guild compare guild_a:<name-or-id> guild_b:<name-or-id>`',
          inline: false
        },
        {
          name: '/guild ready-check',
          value: 'Image table of guild members with a unit at relic ≥ N (defaults to 5).\nUsage: `/guild ready-check unit:<name>` (autocomplete) — defaults to your own guild.',
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
