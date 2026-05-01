import { ChatInputCommandInteraction, AttachmentBuilder } from 'discord.js';
import { GuildService } from '../../services/guildService';
import { GuildImageService } from '../../services/guildImages';
import { buildReadyCheckRows } from '../../services/guildInsights';
import { GameDataService } from '../../services/gameDataService';

export async function handleReadyCheckCommand(
  interaction: ChatInputCommandInteraction,
  guildId: string,
  unitBaseId: string,
  minRelic: number,
  service: GuildService,
  imageService: GuildImageService
): Promise<void> {
  const guild = await service.getGuild(guildId);
  if (!guild) {
    await interaction.editReply({ content: 'Guild data unavailable. Try again shortly.' });
    return;
  }

  const roster = await service.getGuildRoster(guild);
  const rows = buildReadyCheckRows(roster, unitBaseId, minRelic, { includeMissing: true });
  const svc = GameDataService.getInstance();
  const unitName = svc.isReady() ? svc.getUnitName(unitBaseId) : unitBaseId;
  const png = await imageService.renderReadyCheck(rows, guild.guild.profile.name, unitName, minRelic);
  const file = new AttachmentBuilder(png, { name: 'guild-ready-check.png' });

  await interaction.editReply({
    content: `**${guild.guild.profile.name}** — ${unitName} R${minRelic}+`,
    files: [file],
  });
}
