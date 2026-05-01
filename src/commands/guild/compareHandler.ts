import { ChatInputCommandInteraction, AttachmentBuilder, EmbedBuilder } from 'discord.js';
import { GuildService } from '../../services/guildService';
import { GuildImageService } from '../../services/guildImages';
import { buildCompareSummary } from '../../services/guildInsights';

export async function handleCompareCommand(
  interaction: ChatInputCommandInteraction,
  queryA: string,
  queryB: string,
  service: GuildService,
  imageService: GuildImageService
): Promise<void> {
  const [aLook, bLook] = await Promise.all([service.lookup(queryA), service.lookup(queryB)]);

  if (aLook.kind !== 'profile' || bLook.kind !== 'profile') {
    const embed = new EmbedBuilder()
      .setTitle('🔎 Need a unique guild for each side')
      .setDescription(
        'One or both of your queries returned multiple matches or none. ' +
        'Re-run with full guild IDs to disambiguate (or check spelling).'
      )
      .setColor(0xff8800);
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  const [a, b] = await Promise.all([
    service.getGuild(aLook.profile!.id),
    service.getGuild(bLook.profile!.id),
  ]);
  if (!a || !b) {
    await interaction.editReply({ content: 'Guild data unavailable. Try again shortly.' });
    return;
  }

  const [rosterA, rosterB] = await Promise.all([
    service.getGuildRoster(a),
    service.getGuildRoster(b),
  ]);

  const summary = buildCompareSummary(a, rosterA, b, rosterB);
  const png = await imageService.renderCompare(summary);
  const file = new AttachmentBuilder(png, { name: 'guild-compare.png' });

  await interaction.editReply({
    content: `**${summary.a.name}** vs **${summary.b.name}**`,
    files: [file],
  });
}
