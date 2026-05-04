import { Client, Events } from 'discord.js';
import { loadEnv } from '../utils/env';
import { logger } from '../utils/logger';
import { DISCORD_INTENTS } from '../config/discordConfig';
import { registerCommands } from './commandRegistry';
import { registerCommand } from '../commands/register';
import { helpCommand } from '../commands/help';
import { gacCommand } from '../commands/gac';
import { playerCommand } from '../commands/player';
import { guildCommand } from '../commands/guild';
import { twCommand } from '../commands/tw';
import { PlayerService } from '../services/playerService';
import { GacService } from '../services/gacService';
import { PlayerInsightsService } from '../services/playerInsightsService';
import { GuildService } from '../services/guildService';
import { GuildImageService } from '../services/guildImages';
import { GuildRosterCache } from '../services/guildRosterCache';
import { TwImageService } from '../services/twImages';
import { BracketCacheWarmer } from '../services/bracketCacheWarmer';
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
    const playerInsightsService = new PlayerInsightsService(combinedClient);
    const guildRosterCache = new GuildRosterCache();
    const guildService = new GuildService(combinedClient, guildRosterCache);
    const guildImageService = new GuildImageService();
    const twImageService = new TwImageService();

    // Wait for Comlink to be ready (it may be starting up concurrently)
    // Comlink needs time to: discover public IP, generate guest accounts, start server
    const waitForComlink = async (maxAttempts = 20, delayMs = 1000): Promise<boolean> => {
      logger.info('⏳ Waiting for Comlink to be ready...');
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const ready = await combinedClient.getComlinkClient().isReady().catch(() => false);
        if (ready) return true;
        if (attempt < maxAttempts) {
          if (attempt % 5 === 0) {
            logger.debug(`Still waiting for Comlink (attempt ${attempt}/${maxAttempts})...`);
          }
          await new Promise(resolve => setTimeout(resolve, delayMs));
        }
      }
      return false;
    };

    // Initialize caches (fast — disk read only)
    await initCharacterPortraits();

    // Create Discord client
    const client = new Client({
      intents: DISCORD_INTENTS
    });

    // Register commands on startup
    await registerCommands();

    // Game data from Comlink can take 40s+ on a Raspberry Pi. If we await it before
    // client.login(), Discord has no connected session and slash commands time out
    // with "The application did not respond". Run this in the background instead.
    void (async () => {
      const comlinkReady = await waitForComlink();
      if (comlinkReady) {
        logger.info('✅ Comlink is available - using real-time CG game data');
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
    })();

    // Handle interactions
    client.on(Events.InteractionCreate, async (interaction) => {
      // Autocomplete interactions (e.g. GAC opponent bracket selection)
      if (interaction.isAutocomplete()) {
        const { commandName } = interaction;

        try {
          if (commandName === 'gac') {
            await gacCommand.autocomplete(interaction, playerService, gacService);
          } else if (commandName === 'player') {
            await playerCommand.autocomplete(interaction);
          } else if (commandName === 'guild') {
            await guildCommand.autocomplete(interaction);
          }
        } catch (error) {
          logger.error(`Error handling autocomplete for command ${commandName}:`, error);
        }

        return;
      }

      if (interaction.isButton()) {
        try {
          if (interaction.customId.startsWith('gac:')) {
            await gacCommand.handleButton(interaction, playerService, gacService, combinedClient);
          }
        } catch (error) {
          logger.error(`Error handling button ${interaction.customId}:`, error);
          if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: 'Something went wrong. Please try the command again.', ephemeral: true })
              .catch(() => undefined);
          }
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
        } else if (commandName === 'player') {
          await playerCommand.execute(interaction, playerService, playerInsightsService);
        } else if (commandName === 'guild') {
          await guildCommand.execute(interaction, playerService, guildService, guildImageService);
        } else if (commandName === 'tw') {
          await twCommand.execute(interaction, guildService, twImageService);
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

    // Background bracket cache warmer — keeps autocomplete fast
    const bracketWarmer = new BracketCacheWarmer(gacService, playerStore);

    // Handle ready event
    client.once(Events.ClientReady, async (readyClient) => {
      logger.info(`Bot logged in as ${readyClient.user.tag}`);
      bracketWarmer.start();
    });

    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      logger.info('Shutting down gracefully...');
      bracketWarmer.stop();
      await flushCharacterPortraits();
      await guildImageService.close();
      await twImageService.close();
      await combinedClient.close();
      await client.destroy();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      logger.info('Shutting down gracefully...');
      bracketWarmer.stop();
      await flushCharacterPortraits();
      await guildImageService.close();
      await twImageService.close();
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
