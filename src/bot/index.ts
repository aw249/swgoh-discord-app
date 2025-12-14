import { Client, Events } from 'discord.js';
import { loadEnv } from '../utils/env';
import { logger } from '../utils/logger';
import { DISCORD_INTENTS } from '../config/discordConfig';
import { registerCommands } from './commandRegistry';
import { registerCommand } from '../commands/register';
import { helpCommand } from '../commands/help';
import { gacCommand } from '../commands/gac';
import { PlayerService } from '../services/playerService';
import { GacService } from '../services/gacService';
import { filePlayerStore as playerStore } from '../storage/fileStore';

import { SwgohGgApiClient } from '../integrations/swgohGgApi';
import { CombinedApiClient } from '../integrations/comlink';
import { ensureInitialized as initCharacterPortraits, flushCache as flushCharacterPortraits } from '../storage/characterPortraitCache';
import { initializeGameData, gameDataService } from '../services/gameDataService';

async function main(): Promise<void> {
  try {
    const env = loadEnv();
    logger.info('Environment variables loaded successfully.');

    // Initialise services
    const playerService = new PlayerService(playerStore);
    const swgohGgApiClient = new SwgohGgApiClient();
    
    // Create combined client (Comlink primary, swgoh.gg fallback)
    const combinedClient = new CombinedApiClient(swgohGgApiClient, {
      preferComlink: true,
      fallbackToSwgohGg: true,
    });
    
    // GacService uses combined client for real-time bracket data (Comlink + swgoh.gg hybrid)
    const gacService = new GacService(combinedClient);
    
    // Log Comlink status and initialize game data
    const comlinkReady = await combinedClient.getComlinkClient().isReady().catch(() => false);
    if (comlinkReady) {
      logger.info('✅ Comlink is available - using real-time CG game data');
      
      // Initialize game data from Comlink (unit definitions, localization)
      try {
        await initializeGameData();
        const glCount = gameDataService.getAllGalacticLegends().length;
        logger.info(`✅ GameDataService initialized - ${glCount} GLs detected`);
      } catch (error) {
        logger.warn('⚠️ Failed to initialize GameDataService, using fallback data:', error);
      }
    } else {
      logger.warn('⚠️ Comlink is not available - falling back to swgoh.gg and static game data');
    }

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
        } else if (commandName === 'gac') {
          // Use combined client for player data (Comlink first, swgoh.gg fallback)
          await gacCommand.execute(interaction, playerService, gacService, combinedClient);
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
      await combinedClient.close();
      await client.destroy();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      logger.info('Shutting down gracefully...');
      await flushCharacterPortraits();
      await combinedClient.close();
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
