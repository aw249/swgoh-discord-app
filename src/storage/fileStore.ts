import { promises as fs } from 'fs';
import { join } from 'path';
import { logger } from '../utils/logger';
import { PlayerStore } from './inMemoryStore';

interface PlayerData {
  [discordUserId: string]: string;
}

class FilePlayerStore implements PlayerStore {
  private readonly filePath: string;
  private data: PlayerData = {};
  private initialized: boolean = false;

  constructor(filePath?: string) {
    // Default to data/players.json in the project root
    this.filePath = filePath || join(process.cwd(), 'data', 'players.json');
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      // Ensure data directory exists
      const dataDir = join(this.filePath, '..');
      await fs.mkdir(dataDir, { recursive: true });

      // Try to read existing data
      try {
        const fileContent = await fs.readFile(this.filePath, 'utf-8');
        this.data = JSON.parse(fileContent);
        logger.info(`Loaded ${Object.keys(this.data).length} player registrations from ${this.filePath}`);
      } catch (error: any) {
        // File doesn't exist yet, start with empty data
        if (error.code === 'ENOENT') {
          logger.info(`No existing player data found, starting fresh`);
          this.data = {};
        } else {
          throw error;
        }
      }

      this.initialized = true;
    } catch (error) {
      logger.error('Error initializing file store:', error);
      throw error;
    }
  }

  private async save(): Promise<void> {
    try {
      await fs.writeFile(this.filePath, JSON.stringify(this.data, null, 2), 'utf-8');
    } catch (error) {
      logger.error('Error saving player data:', error);
      throw error;
    }
  }

  async registerPlayer(discordUserId: string, allyCode: string): Promise<void> {
    await this.ensureInitialized();
    this.data[discordUserId] = allyCode;
    await this.save();
    logger.info(`Registered player: ${discordUserId} -> ${allyCode}`);
  }

  async getAllyCode(discordUserId: string): Promise<string | null> {
    await this.ensureInitialized();
    return this.data[discordUserId] || null;
  }

  async removePlayer(discordUserId: string): Promise<void> {
    await this.ensureInitialized();
    if (this.data[discordUserId]) {
      delete this.data[discordUserId];
      await this.save();
      logger.info(`Removed player registration: ${discordUserId}`);
    }
  }
}

export const filePlayerStore: PlayerStore = new FilePlayerStore();

