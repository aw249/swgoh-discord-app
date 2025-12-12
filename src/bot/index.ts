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

import { SwgohGgApiClient } from '../integrations/swgohGgApi';
import { ensureInitialized as initCharacterPortraits, flushCache as flushCharacterPortraits } from '../storage/characterPortraitCache';

async function main(): Promise<void> {
  try {
    const env = loadEnv();
    logger.info('Environment variables loaded successfully.');

    // Initialise services
    const playerService = new PlayerService(playerStore);
    const swgohGgApiClient = new SwgohGgApiClient();
    const rosterService = new RosterService(swgohGgApiClient);
    const gacService = new GacService(swgohGgApiClient);

    // Initialize caches
    await initCharacterPortraits();

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
    client.once(Events.ClientReady, async (readyClient) => {
      logger.info(`Bot logged in as ${readyClient.user.tag}`);
      
      // Pre-warm browser and GAC bracket cache for registered users (background task)
      // This ensures autocomplete responds quickly on first use
      (async () => {
        try {
          if (playerStore.getAllAllyCodes) {
            const allyCodes = await playerStore.getAllAllyCodes();
            if (allyCodes.length > 0) {
              logger.info(`Pre-warming GAC bracket cache for ${allyCodes.length} registered user(s)...`);
              
              for (const allyCode of allyCodes) {
                try {
                  await gacService.getBracketForAllyCode(allyCode);
                  logger.info(`Pre-warmed GAC bracket cache for ally code ${allyCode}`);
                } catch (error) {
                  // Ignore errors during warmup - user may not be in active GAC
                  logger.debug(`Could not pre-warm cache for ${allyCode}: ${error}`);
                }
              }
              
              logger.info('GAC bracket cache pre-warming complete');
            }
          }
        } catch (error) {
          logger.warn('Failed to pre-warm bracket cache:', error);
        }
      })();
    });

    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      logger.info('Shutting down gracefully...');
      await flushCharacterPortraits();
      await swgohGgApiClient.close();
      await client.destroy();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      logger.info('Shutting down gracefully...');
      await flushCharacterPortraits();
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
