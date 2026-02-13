/**
 * Persistent cache for GAC bracket IDs.
 * 
 * Stores the last known bracket ID for each player + league combination.
 * This dramatically speeds up bracket discovery as we can start searching
 * near the last known bracket instead of from 0.
 * 
 * The cache is keyed by `${allyCode}:${league}` and stores:
 * - bracketId: The bracket number (e.g., 753)
 * - eventInstanceId: The event instance when this was discovered
 * - timestamp: When this was cached (for potential expiry)
 */
import { promises as fs } from 'fs';
import { join } from 'path';
import { logger } from '../utils/logger';
import { getProjectPath } from '../utils/pathUtils';

interface BracketCacheEntry {
  bracketId: number;
  eventInstanceId: string;
  timestamp: number;
}

interface BracketCacheData {
  [key: string]: BracketCacheEntry;
}

class BracketCacheStore {
  private readonly filePath: string;
  private data: BracketCacheData = {};
  private initialized: boolean = false;
  private saveTimeout: NodeJS.Timeout | null = null;

  constructor(filePath?: string) {
    this.filePath = filePath || getProjectPath('data/bracket-cache.json');
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      const dataDir = join(this.filePath, '..');
      await fs.mkdir(dataDir, { recursive: true });

      try {
        const fileContent = await fs.readFile(this.filePath, 'utf-8');
        this.data = JSON.parse(fileContent);
        logger.info(`Loaded ${Object.keys(this.data).length} cached bracket IDs`);
      } catch (error: any) {
        if (error.code === 'ENOENT') {
          this.data = {};
        } else {
          throw error;
        }
      }

      this.initialized = true;
    } catch (error) {
      logger.error('Error initializing bracket cache:', error);
      this.initialized = true; // Don't block on cache errors
      this.data = {};
    }
  }

  private async save(): Promise<void> {
    try {
      await fs.writeFile(this.filePath, JSON.stringify(this.data, null, 2), 'utf-8');
    } catch (error) {
      logger.error('Error saving bracket cache:', error);
    }
  }

  /**
   * Debounced save - only writes to disk after 1 second of no changes.
   * Prevents excessive disk writes when updating multiple entries.
   */
  private debouncedSave(): void {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }
    this.saveTimeout = setTimeout(() => {
      this.save();
      this.saveTimeout = null;
    }, 1000);
  }

  /**
   * Get the cached bracket ID for a player + league combination.
   * 
   * @param allyCode - The player's ally code
   * @param league - The player's league (e.g., "AURODIUM")
   * @returns The cached bracket ID, or undefined if not cached
   */
  async getBracketId(allyCode: string, league: string): Promise<number | undefined> {
    await this.ensureInitialized();
    const key = `${allyCode}:${league}`;
    const entry = this.data[key];
    
    if (entry) {
      // Cache entries are valid indefinitely - brackets typically stay consistent
      // within a league during a season
      return entry.bracketId;
    }
    
    return undefined;
  }

  /**
   * Cache a bracket ID for a player + league combination.
   * 
   * @param allyCode - The player's ally code
   * @param league - The player's league
   * @param bracketId - The bracket ID to cache
   * @param eventInstanceId - The event instance when this was discovered
   */
  async setBracketId(
    allyCode: string, 
    league: string, 
    bracketId: number,
    eventInstanceId: string
  ): Promise<void> {
    await this.ensureInitialized();
    const key = `${allyCode}:${league}`;
    
    this.data[key] = {
      bracketId,
      eventInstanceId,
      timestamp: Date.now(),
    };
    
    this.debouncedSave();
  }

  /**
   * Get all cached bracket IDs (useful for debugging/stats).
   */
  async getAll(): Promise<BracketCacheData> {
    await this.ensureInitialized();
    return { ...this.data };
  }

  /**
   * Clear all cached bracket IDs (e.g., at start of new season).
   */
  async clear(): Promise<void> {
    await this.ensureInitialized();
    this.data = {};
    await this.save();
    logger.info('Cleared bracket cache');
  }
}

export const bracketCache = new BracketCacheStore();

