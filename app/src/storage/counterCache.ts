import { promises as fs } from 'fs';
import { join } from 'path';
import { logger } from '../utils/logger';
import { getProjectPath } from '../utils/pathUtils';
import { GacCounterSquad } from '../integrations/swgohGgApi';

interface TeammateCount {
  baseId: string;
  count: number;
  weightedCount: number;  // Weighted by seen count of the squads
}

class CounterCache {
  private readonly baseDir: string;
  // Cache for GL teammates, keyed by "seasonId:glBaseId:format"
  private glTeammatesCache: Map<string, string[]> = new Map();

  constructor(baseDir?: string) {
    this.baseDir = baseDir || getProjectPath('data/counters');
  }

  private getCachePath(seasonId: string, defensiveLeaderBaseId: string): string {
    // Extract season number for folder structure
    // e.g., "CHAMPIONSHIPS_GRAND_ARENA_GA2_EVENT_SEASON_72" -> "season_72"
    const seasonMatch = seasonId.match(/SEASON_(\d+)/);
    const seasonNumber = seasonMatch ? seasonMatch[1] : seasonId.replace(/[^a-zA-Z0-9]/g, '_');
    const seasonDir = join(this.baseDir, `season_${seasonNumber}`);
    return join(seasonDir, `${defensiveLeaderBaseId}.json`);
  }

  private getSeasonDir(seasonId: string): string {
    const seasonMatch = seasonId.match(/SEASON_(\d+)/);
    const seasonNumber = seasonMatch ? seasonMatch[1] : seasonId.replace(/[^a-zA-Z0-9]/g, '_');
    return join(this.baseDir, `season_${seasonNumber}`);
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

  /**
   * Find the most commonly used teammates for a GL when used on offense.
   * Scans all cached counter data for the season to find squads where the GL is the offense leader.
   * Returns teammates sorted by weighted popularity (seen count).
   * 
   * @param seasonId - The season ID to search
   * @param glBaseId - The GL's base ID
   * @param format - '3v3' or '5v5' (no longer filters by format - aggregates all)
   * @returns Array of teammate base IDs, sorted by popularity
   */
  async getIdealTeammatesForGL(
    seasonId: string,
    glBaseId: string,
    format: '3v3' | '5v5' = '5v5'
  ): Promise<string[]> {
    // Cache key no longer includes format - we aggregate ALL teammates
    const cacheKey = `${seasonId}:${glBaseId}`;
    
    // Check in-memory cache first
    if (this.glTeammatesCache.has(cacheKey)) {
      const cached = this.glTeammatesCache.get(cacheKey)!;
      logger.debug(`GL teammates cache hit for ${glBaseId}: ${cached.length} teammates`);
      return cached;
    }

    const teammateStats = new Map<string, TeammateCount>();

    try {
      const seasonDir = this.getSeasonDir(seasonId);
      
      // Read all cached counter files for this season
      let files: string[];
      try {
        files = await fs.readdir(seasonDir);
      } catch (error: any) {
        if (error.code === 'ENOENT') {
          logger.debug(`No cached counters found for season ${seasonId}`);
          return [];
        }
        throw error;
      }

      // Scan each counter file for squads where our GL is the offense leader
      // Don't filter by squad size - ideal teammates are the same in 3v3 and 5v5
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        
        try {
          const filePath = join(seasonDir, file);
          const content = await fs.readFile(filePath, 'utf-8');
          const counters = JSON.parse(content) as GacCounterSquad[];
          
          for (const counter of counters) {
            // Check if this counter's offense leader is our GL
            if (counter.leader.baseId !== glBaseId) continue;
            
            // Aggregate teammate usage from ALL squad sizes
            // The ideal teammates are the same in 3v3 and 5v5
            const seenCount = counter.seenCount || 1;
            for (const member of counter.members) {
              const existing = teammateStats.get(member.baseId);
              if (existing) {
                existing.count += 1;
                existing.weightedCount += seenCount;
              } else {
                teammateStats.set(member.baseId, {
                  baseId: member.baseId,
                  count: 1,
                  weightedCount: seenCount
                });
              }
            }
          }
        } catch (error) {
          logger.warn(`Error reading counter file ${file}:`, error);
        }
      }

      // Sort teammates by weighted count (most popular first)
      const sortedTeammates = Array.from(teammateStats.values())
        .sort((a, b) => b.weightedCount - a.weightedCount)
        .map(t => t.baseId);

      // Cache the result
      this.glTeammatesCache.set(cacheKey, sortedTeammates);

      if (sortedTeammates.length > 0) {
        logger.info(
          `Found ${sortedTeammates.length} potential teammates for GL ${glBaseId} ` +
          `from cached counter data: [${sortedTeammates.slice(0, 6).join(', ')}...]`
        );
      } else {
        logger.debug(`No teammate data found for GL ${glBaseId} in cached counters`);
      }

      return sortedTeammates;
    } catch (error) {
      logger.error(`Error scanning counter cache for GL teammates:`, error);
      return [];
    }
  }
}

export const counterCache = new CounterCache();

