import { promises as fs } from 'fs';
import { join } from 'path';
import { logger } from '../utils/logger';
import { PlayerStore, PlayerRegistration } from './inMemoryStore';

type PlayerData = Record<string, PlayerRegistration>;

export class FilePlayerStore implements PlayerStore {
  private readonly filePath: string;
  private readonly now: () => Date;
  private data: PlayerData = {};
  private initialized: boolean = false;

  constructor(filePath?: string, now: () => Date = () => new Date()) {
    // Default to data/players.json relative to cwd (exec cwd is /opt/discord-bot/app)
    this.filePath = filePath || join(process.cwd(), 'data', 'players.json');
    this.now = now;
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
        const parsed: Record<string, string | PlayerRegistration> = JSON.parse(fileContent);

        let migratedAny = false;
        for (const [k, v] of Object.entries(parsed)) {
          if (typeof v === 'string') {
            migratedAny = true;
            this.data[k] = { allyCode: v, registeredAt: this.now().toISOString(), legacy: true };
          } else {
            this.data[k] = v as PlayerRegistration;
          }
        }

        if (migratedAny) {
          await this.save();
          logger.info(
            `Migrated ${Object.keys(this.data).length} legacy player registrations to new schema with registeredAt + legacy=true`
          );
        } else {
          logger.info(`Loaded ${Object.keys(this.data).length} player registrations from ${this.filePath}`);
        }
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
      const tmp = `${this.filePath}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(this.data, null, 2), 'utf-8');
      await fs.rename(tmp, this.filePath);
    } catch (error) {
      logger.error('Error saving player data:', error);
      throw error;
    }
  }

  async registerPlayer(discordUserId: string, allyCode: string): Promise<void> {
    await this.ensureInitialized();
    const existing = this.data[discordUserId];
    if (existing) {
      // Preserve original registeredAt and legacy flag; only update allyCode
      this.data[discordUserId] = { ...existing, allyCode };
    } else {
      // Early-adopter window is open: keep flagging new registrations as
      // legacy=true until the paid tier launches. When that gate goes live,
      // remove the `legacy: true` line below so post-cutoff registrations
      // are distinguishable in playerService.getRegistration(...).
      this.data[discordUserId] = { allyCode, registeredAt: this.now().toISOString(), legacy: true };
    }
    await this.save();
    logger.info(`Registered player: ${discordUserId} -> ${allyCode}`);
  }

  async getAllyCode(discordUserId: string): Promise<string | null> {
    await this.ensureInitialized();
    return this.data[discordUserId]?.allyCode ?? null;
  }

  async removePlayer(discordUserId: string): Promise<void> {
    await this.ensureInitialized();
    if (this.data[discordUserId]) {
      delete this.data[discordUserId];
      await this.save();
      logger.info(`Removed player registration: ${discordUserId}`);
    }
  }

  /**
   * Get all registered ally codes for pre-warming caches.
   * Returns an array of ally codes.
   */
  async getAllAllyCodes(): Promise<string[]> {
    await this.ensureInitialized();
    return Object.values(this.data).map(r => r.allyCode);
  }

  /**
   * Get the full registration record for a player, or null if not registered.
   */
  async getRegistration(discordUserId: string): Promise<PlayerRegistration | null> {
    await this.ensureInitialized();
    return this.data[discordUserId] ?? null;
  }
}

export const filePlayerStore: PlayerStore = new FilePlayerStore();
