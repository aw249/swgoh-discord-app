import { Client, Events, GatewayIntentBits } from 'discord.js';
import { loadEnv } from '../utils/env';
import { logger } from '../utils/logger';
import { DISCORD_INTENTS } from '../config/discordConfig';
import { registerCommands } from './commandRegistry';
import { registerCommand } from '../commands/register';
import { rosterCommand } from '../commands/roster';
import { helpCommand } from '../commands/help';
import { gacCommand } from '../commands/gac';
import { PlayerService } from '../services/playerService';
import { RosterService } from '../services/rosterService';
import { GacService } from '../services/gacService';
import { filePlayerStore as playerStore } from '../storage/fileStore';
import { SwgohApiClient } from '../integrations/swgohApi';
import { SwgohGgApiClient } from '../integrations/swgohGgApi';

async function main(): Promise<void> {
  try {
    const env = loadEnv();
    logger.info('Environment variables loaded successfully.');

    // Initialise services
    const playerService = new PlayerService(playerStore);
    const swgohApiClient = new SwgohApiClient(env.SWGOH_API_KEY);
    const rosterService = new RosterService(swgohApiClient);
    const swgohGgApiClient = new SwgohGgApiClient();
    const gacService = new GacService(swgohGgApiClient);

    // Create Discord client
    const client = new Client({
      intents: DISCORD_INTENTS
    });

    // Register commands on startup
    await registerCommands();

    // Handle interactions
    client.on(Events.InteractionCreate, async (interaction) => {
      // Autocomplete interactions (e.g. GAC opponent bracket selection)
      if (interaction.isAutocomplete()) {
        const { commandName } = interaction;

        try {
          if (commandName === 'gac') {
            await gacCommand.autocomplete(interaction, playerService, gacService);
          }
        } catch (error) {
          logger.error(`Error handling autocomplete for command ${commandName}:`, error);
        }

        return;
      }

      if (!interaction.isChatInputCommand()) {
        return;
      }

      const { commandName } = interaction;

      try {
        if (commandName === 'register') {
          await registerCommand.execute(interaction, playerService);
        } else if (commandName === 'roster') {
          await rosterCommand.execute(interaction, playerService, rosterService);
        } else if (commandName === 'gac') {
          await gacCommand.execute(interaction, playerService, gacService, swgohGgApiClient);
        } else if (commandName === 'help') {
          await helpCommand.execute(interaction);
        }
      } catch (error) {
        logger.error(`Error handling command ${commandName}:`, error);

        if (interaction.replied || interaction.deferred) {
          await interaction.followUp({
            content: 'There was an error while executing this command!',
            ephemeral: true
          });
        } else {
          await interaction.reply({
            content: 'There was an error while executing this command!',
            ephemeral: true
          });
        }
      }
    });

    // Handle ready event
    client.once(Events.ClientReady, (readyClient) => {
      logger.info(`Bot logged in as ${readyClient.user.tag}`);
    });

    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      logger.info('Shutting down gracefully...');
      await swgohGgApiClient.close();
      await client.destroy();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      logger.info('Shutting down gracefully...');
      await swgohGgApiClient.close();
      await client.destroy();
      process.exit(0);
    });

    // Login to Discord
    await client.login(env.DISCORD_BOT_TOKEN);
  } catch (error) {
    logger.error('Failed to start bot:', error);
    process.exit(1);
  }
}

main().catch((error) => {
  logger.error('Unhandled error in main:', error);
  process.exit(1);
});

