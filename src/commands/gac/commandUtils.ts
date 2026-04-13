import { ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { SwgohGgFullPlayerResponse, GacDefensiveSquad, GacCounterSquad, GacTopDefenseSquad } from '../../integrations/swgohGgApi';
import { PlayerService } from '../../services/playerService';
import { GacService } from '../../services/gacService';
import { logger } from '../../utils/logger';
import { CloudflareBlockError, NoActiveBracketError } from '../../errors/swgohErrors';

/**
 * API client interface that works with both SwgohGgApiClient and CombinedApiClient
 */
export interface GacApiClient {
  getFullPlayer(allyCode: string): Promise<SwgohGgFullPlayerResponse>;
  getFullPlayerWithStats?(allyCode: string): Promise<SwgohGgFullPlayerResponse>;
  getPlayerRecentGacDefensiveSquads(allyCode: string, format: string, maxRounds?: number): Promise<GacDefensiveSquad[]>;
  getCounterSquads(defensiveLeaderBaseId: string, seasonId?: string): Promise<GacCounterSquad[]>;
  getTopDefenseSquads(sortBy?: 'percent' | 'count' | 'banners', seasonId?: string, format?: string): Promise<GacTopDefenseSquad[]>;
}

/**
 * Safely edits an ephemeral status follow-up message via the interaction webhook.
 * Falls back to direct message edit and channel message fetch if needed.
 * Non-critical: logs warnings on failure but never throws.
 */
export async function safeEditStatusMessage(
  interaction: ChatInputCommandInteraction,
  statusMessage: import('discord.js').Message,
  content: string
): Promise<void> {
  try {
    // Use webhook.editMessage() for ephemeral follow-up messages
    await interaction.webhook.editMessage(statusMessage.id, { content });
  } catch (error) {
    logger.warn(`Failed to update status message via webhook:`, error);
    // Fallback: try editing the message directly if webhook method fails
    try {
      await statusMessage.edit(content);
    } catch (editError) {
      // If the channel is not cached, try to fetch the message from the channel
      if (editError instanceof Error && 'code' in editError && editError.code === 'ChannelNotCached') {
        try {
          const channel = interaction.channel;
          if (channel && 'messages' in channel) {
            const fetchedMessage = await channel.messages.fetch(statusMessage.id);
            await fetchedMessage.edit(content);
          }
        } catch (fetchError) {
          // If fetching also fails, log but don't throw - status update is non-critical
          logger.warn('Could not update status message after all fallbacks:', fetchError);
        }
      } else {
        // For other errors, log but don't throw - status update is non-critical
        logger.warn('Error updating status message:', editError);
      }
    }
  }
}

/**
 * Handles error classification and response for GAC command errors.
 * Sends an appropriate embed reply back to the user.
 */
export async function handleGacError(
  error: unknown,
  interaction: ChatInputCommandInteraction,
  playerService: PlayerService,
  gacService: GacService,
  statusMessage: import('discord.js').Message | null
): Promise<void> {
  // Generate a short error reference ID for correlating user reports with server logs
  const errorRef = `ERR-${Date.now().toString(36).slice(-4)}${Math.random().toString(36).slice(2, 4)}`;

  logger.error(`[${errorRef}] Error in GAC command:`, error);

  // Update the status message on error to indicate an error occurred
  if (statusMessage) {
    try {
      await interaction.webhook.editMessage(statusMessage.id, {
        content: `An error occurred while processing your request. (ref: ${errorRef})`
      });
    } catch (editError) {
      // Non-critical - log but don't throw
      logger.warn('Could not update status message on error:', editError);
    }
  }

  const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred.';

  // Check error types for better messaging
  const isCloudflareError = error instanceof CloudflareBlockError || errorMessage.includes('Cloudflare');
  const isNoActiveBracket = error instanceof NoActiveBracketError || errorMessage.includes('No active GAC bracket');

  let embed: EmbedBuilder;

  if (isNoActiveBracket) {
    // Provide more helpful message for "no active bracket" errors
    embed = new EmbedBuilder()
      .setTitle('⏳ No Active GAC Bracket')
      .setDescription('Could not find an active GAC bracket. This usually means:')
      .setColor(0xffa500) // Orange - warning, not error
      .addFields({
        name: '🔹 Possible Reasons',
        value: [
          '• You are between GAC rounds (waiting for next event)',
          '• The current round hasn\'t started matchmaking yet',
          '• swgoh.gg hasn\'t updated bracket data yet',
        ].join('\n'),
        inline: false
      });

    // Try to get GAC status from Comlink for more context
    try {
      const allyCode = await playerService.getAllyCode(interaction.user.id);
      if (allyCode) {
        const gacStatus = await gacService.getGacStatus(allyCode);
        if (gacStatus.isEnrolled) {
          embed.addFields({
            name: '📊 Your Current Season Status',
            value: gacService.getGacStatusDescription(gacStatus),
            inline: false
          });
        }
        embed.addFields({
          name: '💡 What to try',
          value: [
            '• Wait for the next GAC round to begin',
            `• Check your bracket manually: [swgoh.gg/p/${allyCode}/gac-bracket](https://swgoh.gg/p/${allyCode}/gac-bracket/)`,
            '• Use `/gac opponent allycode:123456789` to compare with a specific player'
          ].join('\n'),
          inline: false
        });
      }
    } catch {
      // Ignore errors when getting status for error message
    }
  } else {
    embed = new EmbedBuilder()
      .setTitle('❌ Error')
      .setDescription(`${errorMessage}\n\n_If this persists, report reference: \`${errorRef}\`_`)
      .setColor(0xff0000);

    if (isCloudflareError) {
      try {
        const allyCode = await playerService.getAllyCode(interaction.user.id);
        if (allyCode) {
          embed.addFields({
            name: '💡 Workaround',
            value: `You can access your GAC bracket directly at: https://swgoh.gg/p/${allyCode}/gac-bracket/`,
            inline: false
          });
        }
      } catch {
        // Ignore errors when getting ally code for error message
      }
    }
  }

  // Use editReply if interaction was deferred, otherwise reply
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply({ embeds: [embed] });
  } else {
    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
}
