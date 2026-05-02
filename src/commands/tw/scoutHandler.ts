import { ChatInputCommandInteraction, AttachmentBuilder, EmbedBuilder } from 'discord.js';
import { GuildService } from '../../services/guildService';
import { TwImageService } from '../../services/twImages';
import { buildScoutSnapshot } from '../../services/twInsights';

export async function handleScoutCommand(
  interaction: ChatInputCommandInteraction,
  query: string,
  service: GuildService,
  imageService: TwImageService
): Promise<void> {
  const lookup = await service.lookup(query);

  if (lookup.kind === 'empty') {
    const embed = new EmbedBuilder()
      .setTitle('🔎 No matches')
      .setDescription(`No guilds matched **${query}**. Comlink may also be unavailable.`)
      .setColor(0xff8800);
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  if (lookup.kind === 'list') {
    const lines = (lookup.candidates ?? []).map(
      c => `**${c.name}** — ${c.memberCount} members • ${c.guildGalacticPower.toLocaleString('en-GB')} GP\n\`${c.id}\``
    );
    const embed = new EmbedBuilder()
      .setTitle(`🔎 ${lines.length} match(es) — re-run with the ID`)
      .setDescription(lines.join('\n\n').slice(0, 4000))
      .setColor(0x0099ff);
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  // Need recentActivity for the TW pattern → includeRecentActivity=true
  const guild = await service.getGuild(lookup.profile!.id, true);
  if (!guild) {
    await interaction.editReply({ content: 'Guild data unavailable. Try again shortly.' });
    return;
  }

  const roster = await service.getGuildRoster(guild);
  const snapshot = buildScoutSnapshot(guild, roster);
  const png = await imageService.renderScout(snapshot);
  const file = new AttachmentBuilder(png, { name: 'tw-scout.png' });

  await interaction.editReply({ content: `Scout: **${snapshot.guild.name}**`, files: [file] });
}
