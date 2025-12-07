import { ChatInputCommandInteraction, EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { PlayerService } from '../services/playerService';
import { logger } from '../utils/logger';

export const registerCommand = {
  data: new SlashCommandBuilder()
    .setName('register')
    .setDescription('Link your Discord account to your SWGOH ally code')
    .addStringOption(option =>
      option
        .setName('allycode')
        .setDescription('Your 9-digit ally code (e.g., 123456789 or 123-456-789)')
        .setRequired(true)
    ),

  async execute(interaction: ChatInputCommandInteraction, playerService: PlayerService): Promise<void> {
    // Check if interaction has already been replied to
    if (interaction.replied || interaction.deferred) {
      logger.warn('Register command: Interaction already replied/deferred, skipping');
      return;
    }

    try {
      const allyCode = interaction.options.getString('allycode', true);
      const discordUserId = interaction.user.id;

      await playerService.registerPlayer(discordUserId, allyCode);

      const embed = new EmbedBuilder()
        .setTitle('✅ Registration Successful')
        .setDescription(`Your Discord account has been linked to ally code: ${allyCode.replace(/-/g, '')}`)
        .setColor(0x00ff00)
        .setTimestamp();

      try {
        await interaction.reply({ embeds: [embed] });
      } catch (replyError: any) {
        // Check if it's an "Unknown interaction" error (token expired)
        if (replyError?.code === 10062) {
          logger.warn('Register command: Interaction token expired, cannot reply');
          return;
        }
        // Re-throw other reply errors
        throw replyError;
      }
    } catch (error: any) {
      logger.error('Error in register command:', error);

      // Check if it's an "Unknown interaction" error - can't reply at all
      if (error?.code === 10062) {
        logger.warn('Register command: Interaction token expired, cannot send error message');
        return;
      }

      // Check if we can still reply
      if (interaction.replied || interaction.deferred) {
        logger.warn('Register command: Cannot send error message, interaction already replied');
        return;
      }

      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred.';

      const embed = new EmbedBuilder()
        .setTitle('❌ Registration Failed')
        .setDescription(errorMessage)
        .setColor(0xff0000);

      try {
        await interaction.reply({ embeds: [embed], ephemeral: true });
      } catch (replyError: any) {
        logger.error('Error handling command register:', replyError);
        // Don't try followUp if the interaction token expired
        if (replyError?.code === 10062) {
          logger.warn('Register command: Interaction token expired, cannot send error message');
          return;
        }
        // Only try followUp if interaction was successfully replied/deferred
        if (interaction.replied || interaction.deferred) {
          try {
            await interaction.followUp({ embeds: [embed], ephemeral: true });
          } catch (followUpError) {
            logger.error('Error following up on register command:', followUpError);
          }
        }
      }
    }
  }
};

