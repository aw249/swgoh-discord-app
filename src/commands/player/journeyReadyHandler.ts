import { ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { PlayerInsightsService } from '../../services/playerInsightsService';
import { JourneyPrereqStatus, JourneyReadyResult } from '../../services/playerInsights/types';

const STATUS_GLYPH: Record<JourneyPrereqStatus['status'], string> = {
  ready: '✅',
  short: '⚠️',
  understarred: '⚠️',
  locked: '❌',
};

function describeRequirement(p: JourneyPrereqStatus): string {
  if (p.requirement.kind === 'relic') return `R${p.requirement.value}`;
  return `★${p.requirement.value}`;
}

function describeCurrent(p: JourneyPrereqStatus): string {
  if (!p.current.found) return 'Locked';
  if (p.current.rarity < 7) return `★${p.current.rarity}`;
  if (p.requirement.kind === 'star') return `★${p.current.rarity}`;
  if (p.current.gearLevel < 13) return `G${p.current.gearLevel}`;
  return `R${p.current.relicTier}`;
}

function fieldFor(p: JourneyPrereqStatus): { name: string; value: string; inline: boolean } {
  const glyph = STATUS_GLYPH[p.status];
  const required = describeRequirement(p);
  const current = describeCurrent(p);
  const tail = p.shortBy && p.status !== 'ready' ? ` _(${p.shortBy})_` : '';
  return {
    name: `${glyph} ${p.name}`,
    value: `Need ${required} • You: ${current}${tail}`,
    inline: true,
  };
}

function alreadyUnlockedEmbed(result: JourneyReadyResult): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle(`✅ ${result.glName} — already unlocked`)
    .setDescription(
      `You've unlocked **${result.glName}**. ${result.readyCount}/${result.totalCount} ` +
      `prerequisite units still meet the journey thresholds.`
    )
    .setColor(0x2ecc71);
}

export async function handleJourneyReadyCommand(
  interaction: ChatInputCommandInteraction,
  allyCode: string,
  glBaseId: string,
  service: PlayerInsightsService
): Promise<void> {
  const outcome = await service.getJourneyReady(allyCode, glBaseId);

  if (outcome.kind === 'no-journey-data') {
    await interaction.editReply({
      content: 'Journey data is still loading from Comlink. Try again in a moment.',
    });
    return;
  }

  if (outcome.kind === 'unknown-gl') {
    const embed = new EmbedBuilder()
      .setTitle(`🔍 ${glBaseId}`)
      .setDescription(
        'No journey requirement is available for this Galactic Legend. ' +
        'It may be brand-new (not yet exposed in CG\'s game data) or not a journey-unlock GL.'
      )
      .setColor(0xff8800);
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  const result = outcome.result;

  if (result.alreadyUnlocked) {
    await interaction.editReply({ embeds: [alreadyUnlockedEmbed(result)] });
    return;
  }

  const colour = result.readyCount === result.totalCount ? 0x2ecc71
    : result.readyCount === 0 ? 0xe74c3c
    : 0xf1c40f;

  const fields = result.prerequisites.map(fieldFor);

  const embed = new EmbedBuilder()
    .setTitle(`🔍 ${result.glName} — Journey readiness`)
    .setDescription(`**${result.readyCount}/${result.totalCount}** prerequisites ready`)
    .addFields(fields.slice(0, 25))
    .setColor(colour);

  if (fields.length > 25) {
    embed.setFooter({ text: `Showing first 25 of ${fields.length} requirements` });
  }

  await interaction.editReply({ embeds: [embed] });
}
