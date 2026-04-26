import { promises as fs } from 'fs';
import { join } from 'path';
import { logger } from '../utils/logger';
import { GacTopDefenseSquad } from '../integrations/swgohGgApi';

class DefenseSquadCache {
  private readonly baseDir: string;

  constructor(baseDir?: string) {
    this.baseDir = baseDir || join(process.cwd(), 'data', 'defense-squads');
  }

  private getCachePath(
    seasonId: string | undefined,
    format: string | undefined,
    sortBy: 'percent' | 'count' | 'banners'
  ): string {
    // Create a cache key from season, format, and sortBy
    const seasonKey = seasonId 
      ? seasonId.match(/SEASON_(\d+)/)?.[1] || seasonId.replace(/[^a-zA-Z0-9]/g, '_')
      : 'current';
    const formatKey = format || 'unknown';
    const cacheKey = `${seasonKey}_${formatKey}_${sortBy}`;
    return join(this.baseDir, `${cacheKey}.json`);
  }

  /**
   * Get cached top defense squads for a given season, format, and sort order.
   * Returns null if cache miss or error.
   */
  async getCachedDefenseSquads(
    seasonId: string | undefined,
    format: string | undefined,
    sortBy: 'percent' | 'count' | 'banners'
  ): Promise<GacTopDefenseSquad[] | null> {
    try {
      const cachePath = this.getCachePath(seasonId, format, sortBy);
      const fileContent = await fs.readFile(cachePath, 'utf-8');
      const data = JSON.parse(fileContent) as { squads: GacTopDefenseSquad[]; cachedAt: string };
      
      // Refresh daily — swgoh.gg defense aggregations evolve through the season
      // as new GAC rounds are played; 7-day staleness was missing meta shifts.
      // Override via DEFENSE_CACHE_TTL_HOURS env var.
      const cachedAt = new Date(data.cachedAt);
      const hoursSinceCache = (Date.now() - cachedAt.getTime()) / (1000 * 60 * 60);
      const maxCacheAgeHours = parseFloat(process.env.DEFENSE_CACHE_TTL_HOURS || '24');

      if (hoursSinceCache > maxCacheAgeHours) {
        logger.info(
          `Cache expired: Defense squads cache is ${hoursSinceCache.toFixed(1)}h old (max: ${maxCacheAgeHours}h)`
        );
        return null;
      }
      const daysSinceCache = hoursSinceCache / 24;

      // Empty cache files usually mean a failed scrape under an old DOM; refetch with current parsers.
      if (!data.squads || data.squads.length === 0) {
        logger.info(
          'Defense squads cache file exists but has 0 squads — ignoring cache and refetching'
        );
        return null;
      }
      
      logger.info(
        `Cache hit: Found ${data.squads.length} cached defense squad(s) ` +
        `(season: ${seasonId || 'current'}, format: ${format || 'unknown'}, sort: ${sortBy}, ` +
        `cached: ${daysSinceCache.toFixed(1)} days ago)`
      );
      return data.squads;
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        logger.debug(
          `Cache miss: No cached defense squads for season ${seasonId || 'current'}, ` +
          `format ${format || 'unknown'}, sort ${sortBy}`
        );
        return null;
      }
      logger.warn(`Error reading defense squad cache:`, error);
      return null;
    }
  }

  /**
   * Save top defense squads to cache.
   * Non-blocking - errors are logged but don't throw.
   */
  async saveDefenseSquads(
    seasonId: string | undefined,
    format: string | undefined,
    sortBy: 'percent' | 'count' | 'banners',
    squads: GacTopDefenseSquad[]
  ): Promise<void> {
    try {
      const cachePath = this.getCachePath(seasonId, format, sortBy);
      const cacheDir = join(cachePath, '..');
      
      // Ensure directory exists
      await fs.mkdir(cacheDir, { recursive: true });
      
      // Save with metadata
      const data = {
        squads,
        cachedAt: new Date().toISOString(),
        seasonId: seasonId || null,
        format: format || null,
        sortBy
      };
      
      await fs.writeFile(cachePath, JSON.stringify(data, null, 2), 'utf-8');
      logger.info(
        `Cached ${squads.length} defense squad(s) ` +
        `(season: ${seasonId || 'current'}, format: ${format || 'unknown'}, sort: ${sortBy})`
      );
    } catch (error) {
      logger.error(`Error saving defense squad cache:`, error);
      // Don't throw - caching is non-critical
    }
  }
}

export const defenseSquadCache = new DefenseSquadCache();

