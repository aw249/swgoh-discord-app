/**
 * Evaluate user's roster against top defense squads from swgoh.gg
 */
import { GacTopDefenseSquad } from '../../types/swgohGgTypes';
import { SwgohGgFullPlayerResponse } from '../../integrations/swgohGgApi';
import { UniqueDefensiveSquad } from '../../types/gacStrategyTypes';
import { logger } from '../../utils/logger';
import { isGalacticLegend } from '../../config/gacConstants';
import { generateDefenseSquadsFromRoster } from './defenseGeneration';

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

export async function evaluateRosterForDefense(
  userRoster: SwgohGgFullPlayerResponse,
  seasonId: string | undefined,
  format: string,
  strategyPreference: 'defensive' | 'balanced' | 'offensive',
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
    if (!defenseClient) {
      logger.warn('Defense client not available, cannot evaluate roster for defense');
      return [];
    }

    // For defense evaluation, use full roster to get more options
    // GAC matchmaking uses top 80, but for generating defense squads we want all available characters
    // This ensures we can find all GLs and create more diverse defense options
    const filteredRoster = userRoster; // Use full roster instead of top 80
    logger.info(
      `Using full roster for defense evaluation: ${filteredRoster.units?.filter(u => u.data.combat_type === 1).length || 0} characters ` +
      `(from ${userRoster.units?.length || 0} total units)`
    );

    // Fetch top defense squads - prioritize 'count' sorted list (proven usage/synergy)
    // 'count' is a better indicator of squad synergy and defensive quality than 'percent'
    // 'percent' can include rogue teams that only work in lower leagues
    const [topDefenseSquadsByCount, topDefenseSquadsByPercent] = await Promise.all([
      defenseClient.getTopDefenseSquads('count', seasonId, format),
      defenseClient.getTopDefenseSquads('percent', seasonId, format)
    ]);
    
    // Filter out low-seen-count squads from percent list (likely rogue teams from lower leagues)
    // Only include squads with seen count >= 50 to ensure they're proven
    const MIN_SEEN_COUNT_FOR_PERCENT = 50;
    const filteredPercentSquads = topDefenseSquadsByPercent.filter(
      squad => squad.seenCount !== null && squad.seenCount >= MIN_SEEN_COUNT_FOR_PERCENT
    );
    
    // Merge and deduplicate by leader baseId (keep unique squads)
    // Prioritize 'count' sorted list - it's the primary source (proven usage)
    const allTopDefenseSquads = new Map<string, typeof topDefenseSquadsByCount[0]>();
    
    // First, add all squads from 'count' sorted list (primary source)
    for (const squad of topDefenseSquadsByCount) {
      allTopDefenseSquads.set(squad.leader.baseId, squad);
    }
    
    // Then, add squads from 'percent' sorted list only if they:
    // 1. Don't already exist (not in count list)
    // 2. Have sufficient seen count (filtered above)
    for (const squad of filteredPercentSquads) {
      if (!allTopDefenseSquads.has(squad.leader.baseId)) {
        allTopDefenseSquads.set(squad.leader.baseId, squad);
      }
    }
    
    const topDefenseSquads = Array.from(allTopDefenseSquads.values());
    
    logger.info(
      `Evaluating against ${topDefenseSquads.length} unique top defense squad(s) ` +
      `(${topDefenseSquadsByCount.length} from count sort [primary], ` +
      `${filteredPercentSquads.length} from percent sort [filtered: seen >= ${MIN_SEEN_COUNT_FOR_PERCENT}])`
    );
    
    // Build user unit map (only characters, rarity >= 7)
    const userUnitMap = new Map<string, number | null>();
    for (const unit of filteredRoster.units || []) {
      // Only include characters (not ships) with rarity >= 7
      if (unit.data.combat_type === 1 && unit.data.rarity >= 7) {
        let relicLevel: number | null = null;
        if (unit.data.gear_level >= 13 && unit.data.relic_tier !== null && unit.data.relic_tier !== undefined) {
          relicLevel = Math.max(0, unit.data.relic_tier - 2);
        }
        userUnitMap.set(unit.data.base_id, relicLevel);
      }
    }
    
    logger.info(
      `User unit map: ${userUnitMap.size} character(s) with rarity >= 7 available for defense squads`
    );
    
    // Count user's GLs (from full roster, not filtered)
    const userGLs = new Set<string>();
    for (const unit of filteredRoster.units || []) {
      if (unit.data.combat_type === 1 && // Only characters
          unit.data.is_galactic_legend && 
          isGalacticLegend(unit.data.base_id)) {
        userGLs.add(unit.data.base_id);
      }
    }
    
    logger.info(
      `Found ${userGLs.size} GL(s) in roster: ${Array.from(userGLs).join(', ')}`
    );
    
    logger.info(
      `Found ${userGLs.size} GL(s) in roster: ${Array.from(userGLs).join(', ')}`
    );
    
    const candidates: Array<{
      squad: UniqueDefensiveSquad;
      holdPercentage: number | null;
      seenCount: number | null;
      avgBanners: number | null;
      score: number;
      isGL: boolean;
      reason: string;
    }> = [];
    
    // Find max seen count for normalization
    let maxSeenCount = 0;
    for (const defenseSquad of topDefenseSquads) {
      if (defenseSquad.seenCount !== null && defenseSquad.seenCount > maxSeenCount) {
        maxSeenCount = defenseSquad.seenCount;
      }
    }
    
    for (const defenseSquad of topDefenseSquads) {
      const holdPercentage = defenseSquad.holdPercentage;
      
      // No minimum threshold - evaluate all squads the user has
      // Lower hold % squads will be scored lower but still considered
      
      const leaderBaseId = defenseSquad.leader.baseId;
      const allUnits = [defenseSquad.leader, ...defenseSquad.members];
      
      // Check if user has all units
      const hasAllUnits = allUnits.every(unit => userUnitMap.has(unit.baseId));
      if (!hasAllUnits) {
        continue;
      }
      
      // Get relic levels
      const squadRelics = allUnits.map(unit => userUnitMap.get(unit.baseId) ?? null);
      const avgRelic = squadRelics.filter(r => r !== null).length > 0
        ? squadRelics.filter(r => r !== null).reduce((sum, r) => sum + (r ?? 0), 0) / squadRelics.filter(r => r !== null).length
        : 0;
      
      // Check if this is a GL squad
      const isGL = isGalacticLegend(leaderBaseId);
      
      // Score: seen count (60%) + hold % (30%) + relic score (10%)
      // Seen count is the best indicator of squad synergy and proven defensive quality
      // Hold % can be misleading (rogue teams in lower leagues), so it's weighted less
      
      // Normalize seen count (primary factor - 60% weight)
      let normalizedSeenScore = 0;
      if (defenseSquad.seenCount !== null && maxSeenCount > 0) {
        const logSeen = Math.log10(defenseSquad.seenCount + 1);
        const logMax = Math.log10(maxSeenCount + 1);
        normalizedSeenScore = (logSeen / logMax) * 100;
      }
      const seenScore = normalizedSeenScore * 0.6; // Increased from 40% to 60%
      
      // Hold percentage (secondary factor - 30% weight, reduced from 50%)
      const holdScore = (holdPercentage ?? 0) * 0.3;
      
      // Relic score: penalize if relics are too low
      let relicScore = 10;
      if (avgRelic < 5) {
        relicScore = Math.max(0, 10 - (5 - avgRelic) * 2);
      }
      
      // GL bonus: if user has GLs, boost GL squads slightly
      let glBonus = 0;
      if (isGL && userGLs.has(leaderBaseId)) {
        glBonus = 5; // Small bonus to ensure GLs are considered
      }
      
      const totalScore = holdScore + seenScore + relicScore + glBonus;
      
      candidates.push({
        squad: {
          leader: {
            baseId: leaderBaseId,
            relicLevel: userUnitMap.get(leaderBaseId) ?? null,
            portraitUrl: defenseSquad.leader.portraitUrl
          },
          members: defenseSquad.members.map(m => ({
            baseId: m.baseId,
            relicLevel: userUnitMap.get(m.baseId) ?? null,
            portraitUrl: m.portraitUrl
          }))
        },
        holdPercentage,
        seenCount: defenseSquad.seenCount,
        avgBanners: defenseSquad.avgBanners,
        score: totalScore,
        isGL,
        reason: `Hold: ${holdPercentage?.toFixed(1) ?? 'N/A'}%, Seen: ${defenseSquad.seenCount?.toLocaleString() ?? 'N/A'}, Avg Relic: ${avgRelic.toFixed(1)}`
      });
    }
    
    // Step 2: Generate additional squads from roster
    const generatedCandidates = await generateDefenseSquadsFromRoster(
      filteredRoster,
      seasonId,
      format,
      topDefenseSquads
    ,
      defenseClient,
      defenseSquadStatsCache,
      topDefenseSquadsCache);
    
    // Step 3: Combine and deduplicate by leader + members
    const allCandidates = new Map<string, typeof candidates[0]>();
    
    // Add matched candidates first (they have better stats from swgoh.gg)
    for (const candidate of candidates) {
      const memberIds = candidate.squad.members.map(m => m.baseId).sort();
      const key = `${candidate.squad.leader.baseId}_${memberIds.join('_')}`;
      allCandidates.set(key, candidate);
    }
    
    // Add generated candidates (only if not already present)
    for (const candidate of generatedCandidates) {
      const memberIds = candidate.squad.members.map(m => m.baseId).sort();
      const key = `${candidate.squad.leader.baseId}_${memberIds.join('_')}`;
      if (!allCandidates.has(key)) {
        allCandidates.set(key, candidate);
      }
    }
    
    // Sort by score and ensure we have a good mix of GL and non-GL candidates
    const allCandidatesArray = Array.from(allCandidates.values());
    const sortedCandidates = allCandidatesArray.sort((a, b) => b.score - a.score);
    
    // For defensive strategy, we want more GLs, but still need non-GL options
    // Take top candidates but ensure we have at least some non-GL options
    const glCandidates = sortedCandidates.filter(c => c.isGL);
    const nonGlCandidates = sortedCandidates.filter(c => !c.isGL);
    
    // For defensive strategy, prioritize getting ALL unique GL leaders
    // Take top GLs and top non-GLs separately, then combine
    // This ensures we have both types even if GLs score much higher
    let topGlCandidates: typeof glCandidates;
    if (strategyPreference === 'defensive') {
      // For defensive strategy, group GLs by leader and take best of each
      // This ensures we get all unique GL leaders, not just top-scoring squads
      const glByLeader = new Map<string, typeof glCandidates>();
      for (const gl of glCandidates) {
        const leaderId = gl.squad.leader.baseId;
        if (!glByLeader.has(leaderId)) {
          glByLeader.set(leaderId, []);
        }
        glByLeader.get(leaderId)!.push(gl);
      }
      // Get best candidate per GL leader, then sort by score
      const bestGlPerLeader = Array.from(glByLeader.values()).map(gls => 
        gls.sort((a, b) => b.score - a.score)[0]
      );
      topGlCandidates = bestGlPerLeader.sort((a, b) => b.score - a.score);
    logger.info(
        `Defensive strategy: Found ${topGlCandidates.length} unique GL leader(s) in candidates ` +
        `(user has ${userGLs.size} GL(s) total)`
      );
    } else {
      topGlCandidates = glCandidates.slice(0, Math.min(30, glCandidates.length));
    }
    const topNonGlCandidates = nonGlCandidates.slice(0, Math.min(30, nonGlCandidates.length));
    
    // Combine and deduplicate (in case there are duplicates)
    const combinedCandidates = new Map<string, typeof sortedCandidates[0]>();
    for (const candidate of [...topGlCandidates, ...topNonGlCandidates]) {
      const memberIds = candidate.squad.members.map(m => m.baseId).sort();
      const key = `${candidate.squad.leader.baseId}_${memberIds.join('_')}`;
      if (!combinedCandidates.has(key)) {
        combinedCandidates.set(key, candidate);
      }
    }
    
    // Sort by score again and take top 50
    const finalCandidates = Array.from(combinedCandidates.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, 50);
    
    // Log breakdown of GL vs non-GL candidates
    const glCandidatesCount = finalCandidates.filter(c => c.isGL).length;
    const nonGlCandidatesCount = finalCandidates.length - glCandidatesCount;
    
    logger.info(
      `Combined defense candidates: ${candidates.length} matched from top squads, ${generatedCandidates.length} generated from roster, ` +
      `${finalCandidates.length} unique candidates (top ${finalCandidates.length} will be used)`
    );
    logger.info(
      `Candidate breakdown: ${glCandidatesCount} GL candidate(s), ${nonGlCandidatesCount} non-GL candidate(s)`
    );
    
    return finalCandidates;
  }
