import { ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { logger } from '../../utils/logger';

export async function safeEditStatusMessage(
  interaction: ChatInputCommandInteraction,
  statusMessage: import('discord.js').Message,
  content: string
): Promise<void> {
  try { await interaction.webhook.editMessage(statusMessage.id, { content }); }
  catch (e) {
    logger.warn('Failed to update /guild status message:', e);
    try { await statusMessage.edit(content); } catch (ee) { logger.warn('Fallback edit failed:', ee); }
  }
}

export async function handleGuildError(
  error: unknown,
  interaction: ChatInputCommandInteraction,
  statusMessage: import('discord.js').Message | null
): Promise<void> {
  const errorRef = `ERR-${Date.now().toString(36).slice(-4)}${Math.random().toString(36).slice(2, 4)}`;
  logger.error(`[${errorRef}] /guild error:`, error);

  if (statusMessage) {
    try {
      await interaction.webhook.editMessage(statusMessage.id, {
        content: `An error occurred while processing your request. (ref: ${errorRef})`,
      });
    } catch (e) { logger.warn('Could not update status message on error:', e); }
  }

  const embed = new EmbedBuilder()
    .setTitle('⚠️ Something went wrong')
    .setDescription(`Couldn't complete your request. Reference: \`${errorRef}\`.`)
    .setColor(0xff0000);

  if (interaction.deferred || interaction.replied) await interaction.editReply({ embeds: [embed] });
  else await interaction.reply({ embeds: [embed], ephemeral: true });
}

export function notRegisteredEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle('⚠️ Not Registered')
    .setDescription('You need to register your ally code first. Use `/register` to link your account.')
    .setColor(0xffaa00);
}

export function noGuildEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle('⚠️ No Guild')
    .setDescription('You\'re not in a guild — pass an explicit `guild_id` argument.')
    .setColor(0xffaa00);
}
