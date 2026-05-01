import { ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { PlayerInsightsService } from '../../services/playerInsightsService';

export async function handleJourneyReadyCommand(
  interaction: ChatInputCommandInteraction,
  allyCode: string,
  unitBaseId: string,
  service: PlayerInsightsService
): Promise<void> {
  const state = await service.getUnitReady(allyCode, unitBaseId);

  if (!state.found) {
    const embed = new EmbedBuilder()
      .setTitle(`🔍 ${unitBaseId}`)
      .setDescription(state.nextStepHint)
      .setColor(0xe74c3c);
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  const stars = '★'.repeat(state.rarity) + '☆'.repeat(7 - state.rarity);

  const embed = new EmbedBuilder()
    .setTitle(`🔍 ${state.name}`)
    .setDescription(
      `${stars} • Lv ${state.level}\n` +
      `Gear **G${state.gearLevel}** • Relic **R${state.relicTier}**\n` +
      `Zetas: **${state.zetaCount}** • Omicrons: **${state.omicronCount}**`
    )
    .addFields({ name: 'Next step', value: state.nextStepHint, inline: false })
    .setColor(0x2ecc71);

  await interaction.editReply({ embeds: [embed] });
}
