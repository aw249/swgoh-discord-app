import { promises as fs } from 'fs';
import { join } from 'path';
import { logger } from '../utils/logger';
import { GacCounterSquad } from '../integrations/swgohGgApi';

class CounterCache {
  private readonly baseDir: string;

  constructor(baseDir?: string) {
    this.baseDir = baseDir || join(process.cwd(), 'data', 'counters');
  }

  private getCachePath(seasonId: string, defensiveLeaderBaseId: string): string {
    // Extract season number for folder structure
    // e.g., "CHAMPIONSHIPS_GRAND_ARENA_GA2_EVENT_SEASON_72" -> "season_72"
    const seasonMatch = seasonId.match(/SEASON_(\d+)/);
    const seasonNumber = seasonMatch ? seasonMatch[1] : seasonId.replace(/[^a-zA-Z0-9]/g, '_');
    const seasonDir = join(this.baseDir, `season_${seasonNumber}`);
    return join(seasonDir, `${defensiveLeaderBaseId}.json`);
  }

  /**
   * Get cached counter squads for a given season and defensive leader.
   * Returns null if cache miss or error.
   */
  async getCachedCounters(
    seasonId: string,
    defensiveLeaderBaseId: string
  ): Promise<GacCounterSquad[] | null> {
    try {
      const cachePath = this.getCachePath(seasonId, defensiveLeaderBaseId);
      const fileContent = await fs.readFile(cachePath, 'utf-8');
      const counters = JSON.parse(fileContent) as GacCounterSquad[];
      logger.info(
        `Cache hit: Found ${counters.length} cached counter(s) for ${defensiveLeaderBaseId} (season: ${seasonId})`
      );
      return counters;
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        logger.debug(`Cache miss: No cached counters for ${defensiveLeaderBaseId} (season: ${seasonId})`);
        return null;
      }
      logger.warn(`Error reading counter cache for ${defensiveLeaderBaseId}:`, error);
      return null;
    }
  }

  /**
   * Save counter squads to cache for a given season and defensive leader.
   * Non-blocking - errors are logged but don't throw.
   */
  async saveCounters(
    seasonId: string,
    defensiveLeaderBaseId: string,
    counters: GacCounterSquad[]
  ): Promise<void> {
    try {
      const cachePath = this.getCachePath(seasonId, defensiveLeaderBaseId);
      const seasonDir = join(cachePath, '..');
      
      // Ensure directory exists
      await fs.mkdir(seasonDir, { recursive: true });
      
      // Save counters to file
      await fs.writeFile(cachePath, JSON.stringify(counters, null, 2), 'utf-8');
      logger.info(
        `Cached ${counters.length} counter(s) for ${defensiveLeaderBaseId} (season: ${seasonId})`
      );
    } catch (error) {
      logger.error(`Error saving counter cache for ${defensiveLeaderBaseId}:`, error);
      // Don't throw - caching is non-critical
    }
  }
}

export const counterCache = new CounterCache();

