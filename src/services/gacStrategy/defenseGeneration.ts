/**
 * Generate defense squads directly from user's roster
 */
import { GacTopDefenseSquad } from '../../types/swgohGgTypes';
import { SwgohGgFullPlayerResponse } from '../../integrations/swgohGgApi';
import { UniqueDefensiveSquad } from '../../types/gacStrategyTypes';
import { logger } from '../../utils/logger';
import { isGalacticLegend } from '../../config/gacConstants';
import { generateCombinations } from './utils/combinations';
import { getDefenseStatsForSquad } from './defenseStats';

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

export async function generateDefenseSquadsFromRoster(
  userRoster: SwgohGgFullPlayerResponse,
  seasonId: string | undefined,
  format: string,
  topDefenseSquads: GacTopDefenseSquad[],
  defenseClient: DefenseClient | undefined,
  defenseSquadStatsCache: DefenseStatsCache,
  topDefenseSquadsCache: TopDefenseSquadsCache
): Promise<Array<{
  squad: UniqueDefensiveSquad;
  holdPercentage: number | null;
  seenCount: number | null;
  avgBanners: number | null;
  score: number;
  isGL: boolean;
  reason: string;
}>> {
    const squadSize = format === '3v3' ? 3 : 5;
    const candidates: Array<{
      squad: UniqueDefensiveSquad;
      holdPercentage: number | null;
      seenCount: number | null;
      avgBanners: number | null;
      score: number;
      isGL: boolean;
      reason: string;
    }> = [];

    // Build user unit map (rarity >= 7, with relic levels)
    // Portrait URLs will be constructed from baseId when needed
    // Use full roster (not just top 80) to get all available characters
    const userUnitMap = new Map<string, { relicLevel: number | null }>();
    for (const unit of userRoster.units || []) {
      // Only include characters (not ships) with rarity >= 7
      if (unit.data.combat_type === 1 && unit.data.rarity >= 7) {
        let relicLevel: number | null = null;
        if (unit.data.gear_level >= 13 && unit.data.relic_tier !== null && unit.data.relic_tier !== undefined) {
          relicLevel = Math.max(0, unit.data.relic_tier - 2);
        }
        userUnitMap.set(unit.data.base_id, {
          relicLevel
        });
      }
    }

    const availableCharacters = Array.from(userUnitMap.keys());
    
    if (availableCharacters.length < squadSize) {
      logger.warn(`Not enough characters (${availableCharacters.length}) to generate ${squadSize}-character squads`);
      return [];
    }
    
    // Get potential leaders - prioritize characters that appear as leaders in top defense squads
    const leaderFrequency = new Map<string, number>();
    for (const squad of topDefenseSquads) {
      const count = leaderFrequency.get(squad.leader.baseId) || 0;
      leaderFrequency.set(squad.leader.baseId, count + 1);
    }
    
    // Sort potential leaders by frequency in top squads, then by whether they're GLs
    const potentialLeaders = availableCharacters
      .sort((a, b) => {
        const aFreq = leaderFrequency.get(a) || 0;
        const bFreq = leaderFrequency.get(b) || 0;
        if (aFreq !== bFreq) return bFreq - aFreq; // Higher frequency first
        
        // If same frequency, prioritize GLs
        const aIsGL = isGalacticLegend(a);
        const bIsGL = isGalacticLegend(b);
        if (aIsGL && !bIsGL) return -1;
        if (!aIsGL && bIsGL) return 1;
        return 0;
      })
      .slice(0, 50); // Limit to top 50 potential leaders to avoid performance issues

    logger.info(
      `Generating defense squads from roster: ${availableCharacters.length} available characters, ` +
      `${potentialLeaders.length} potential leaders`
    );

    // Generate squads for each potential leader
    for (const leaderId of potentialLeaders) {
      if (candidates.length >= 100) break; // Limit total candidates
      
      // Filter out the leader and ALL GLs from remaining characters
      // GLs should only be leaders, never members of other squads
      const remainingChars = availableCharacters.filter(id => 
        id !== leaderId && !isGalacticLegend(id)
      );
      
      // Generate combinations of members (squadSize - 1 members needed)
      const memberCombinations = generateCombinations(remainingChars, squadSize - 1, 10); // Limit to 10 combinations per leader
      
      for (const members of memberCombinations) {
        // Check if this exact squad exists in top defense squads (to avoid duplicates)
        const squadExists = topDefenseSquads.some(squad => {
          if (squad.leader.baseId !== leaderId || squad.members.length !== members.length) {
            return false;
          }
          const squadMemberIds = squad.members.map(m => m.baseId).sort();
          const memberIds = [...members].sort();
          return squadMemberIds.every((id, i) => id === memberIds[i]);
        });
        
        if (squadExists) continue; // Skip - will be handled by existing matching logic
        
        // Try to find defense stats for this leader
        const stats = await getDefenseStatsForSquad(leaderId, seasonId, defenseClient, defenseSquadStatsCache, topDefenseSquadsCache, format);
        
        // Build the squad
        // Portrait URLs will be constructed from baseId when rendering (similar to existing logic)
        const squad: UniqueDefensiveSquad = {
          leader: {
            baseId: leaderId,
            relicLevel: userUnitMap.get(leaderId)?.relicLevel ?? null,
            portraitUrl: null // Will be constructed from baseId when needed
          },
          members: members.map(memberId => ({
            baseId: memberId,
            relicLevel: userUnitMap.get(memberId)?.relicLevel ?? null,
            portraitUrl: null // Will be constructed from baseId when needed
          }))
        };
        
        // Calculate score
        const isGL = isGalacticLegend(leaderId);
        const holdScore = (stats.holdPercentage ?? 0) * 0.5;
        
        // Normalize seen count (similar to existing logic)
        let normalizedSeenScore = 0;
        if (stats.seenCount !== null && stats.seenCount > 0) {
          // Use a reasonable max for normalization (100k seen count)
          const logSeen = Math.log10(stats.seenCount + 1);
          const logMax = Math.log10(100000 + 1);
          normalizedSeenScore = (logSeen / logMax) * 100;
        }
        const seenScore = normalizedSeenScore * 0.4;
        
        const relicScore = 10; // Assume decent relics (already filtered to 7*)
        const glBonus = isGL ? 5 : 0;
        const leaderFreqBonus = (leaderFrequency.get(leaderId) || 0) * 2; // Bonus for common leaders
        
        const totalScore = holdScore + seenScore + relicScore + glBonus + leaderFreqBonus;
        
        candidates.push({
          squad,
          holdPercentage: stats.holdPercentage,
          seenCount: stats.seenCount,
          avgBanners: null,
          score: totalScore,
          isGL,
          reason: stats.holdPercentage !== null 
            ? `Generated from roster (Hold: ${stats.holdPercentage.toFixed(1)}%, Seen: ${stats.seenCount?.toLocaleString() ?? 'N/A'})`
            : `Generated from roster (no stats available)`
        });
      }
    }

    logger.info(`Generated ${candidates.length} defense squad(s) from roster`);
    return candidates;
}
