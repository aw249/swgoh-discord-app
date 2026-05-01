import { REST, Routes } from 'discord.js';
import { loadEnv } from '../utils/env';
import { logger } from '../utils/logger';
import { registerCommand } from '../commands/register';
import { helpCommand } from '../commands/help';
import { gacCommand } from '../commands/gac';
import { playerCommand } from '../commands/player';

const commands = [
  registerCommand.data,
  helpCommand.data,
  gacCommand.data,
  playerCommand.data
];

export async function registerCommands(): Promise<void> {
  try {
    const env = loadEnv();
    const rest = new REST().setToken(env.DISCORD_BOT_TOKEN);

    logger.info('Started refreshing application (/) commands.');

    // Register commands globally (available in all servers)
    await rest.put(
      Routes.applicationCommands(env.DISCORD_CLIENT_ID),
      { body: commands.map(cmd => cmd.toJSON()) }
    );

    logger.info('Successfully reloaded application (/) commands.');
  } catch (error) {
    logger.error('Error registering commands:', error);
    throw error;
  }
}

// Allow running this file directly to deploy commands
if (require.main === module) {
  registerCommands()
    .then(() => {
      logger.info('Commands deployed successfully.');
      process.exit(0);
    })
    .catch((error) => {
      logger.error('Failed to deploy commands:', error);
      process.exit(1);
    });
}

