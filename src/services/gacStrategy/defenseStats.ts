/**
 * Utility for fetching defense statistics for squads
 */
import { GacTopDefenseSquad } from '../../types/swgohGgTypes';
import { logger } from '../../utils/logger';

interface DefenseClient {
  getTopDefenseSquads(sortBy: 'count' | 'percent', seasonId?: string, format?: string): Promise<GacTopDefenseSquad[]>;
}

interface DefenseStatsCache {
  get(key: string): { holdPercentage: number | null; seenCount: number | null } | undefined;
  set(key: string, value: { holdPercentage: number | null; seenCount: number | null }): void;
  has(key: string): boolean;
}

interface TopDefenseSquadsCache {
  get(key: string): GacTopDefenseSquad[] | undefined;
  set(key: string, value: GacTopDefenseSquad[]): void;
  has(key: string): boolean;
}

export async function getDefenseStatsForSquad(
  leaderBaseId: string,
  seasonId: string | undefined,
  defenseClient: DefenseClient | undefined,
  defenseSquadStatsCache: DefenseStatsCache,
  topDefenseSquadsCache: TopDefenseSquadsCache,
  format?: string
): Promise<{ holdPercentage: number | null; seenCount: number | null }> {
    // Check cache first
    const cacheKey = seasonId ? `${leaderBaseId}_${seasonId}` : leaderBaseId;
    if (defenseSquadStatsCache.has(cacheKey)) {
      return defenseSquadStatsCache.get(cacheKey)!;
    }

    // If no defense client, return null stats
    if (!defenseClient) {
      return { holdPercentage: null, seenCount: null };
    }

    try {
      // Get top defense squads (sorted by hold percentage)
      const cacheKey2 = seasonId ? `topDefense_${seasonId}` : 'topDefense';
      let topDefenseSquads = topDefenseSquadsCache.get(cacheKey2);
      
      if (!topDefenseSquads) {
        topDefenseSquads = await defenseClient.getTopDefenseSquads('percent', seasonId, format);
        topDefenseSquadsCache.set(cacheKey2, topDefenseSquads);
      }

      // Find matching squad by leader baseId
      const matchingSquad = topDefenseSquads.find(squad => squad.leader.baseId === leaderBaseId);
      
      const stats = matchingSquad 
        ? { holdPercentage: matchingSquad.holdPercentage, seenCount: matchingSquad.seenCount }
        : { holdPercentage: null, seenCount: null };
      
      // Cache the result
      defenseSquadStatsCache.set(cacheKey, stats);
      return stats;
    } catch (error) {
      logger.warn(`Failed to get defense stats for ${leaderBaseId}:`, error);
      return { holdPercentage: null, seenCount: null };
    }
  }
