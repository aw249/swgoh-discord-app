/**
 * Balance offense and defense squads to ensure no character reuse.
 * Takes offense counters and defense suggestions and finds the optimal balance.
 */
import { SwgohGgFullPlayerResponse } from '../../integrations/swgohGgApi';
import { UniqueDefensiveSquad, MatchedCounterSquad } from '../../types/gacStrategyTypes';
import { logger } from '../../utils/logger';
import { isGalacticLegend } from '../../config/gacConstants';
import { getDefenseStatsForSquad } from './defenseStats';

interface DefenseClient {
  getTopDefenseSquads(sortBy: 'count' | 'percent', seasonId?: string, format?: string): Promise<any[]>;
}

interface DefenseStatsCache {
  get(key: string): { holdPercentage: number | null; seenCount: number | null } | undefined;
  set(key: string, value: { holdPercentage: number | null; seenCount: number | null }): void;
  has(key: string): boolean;
}

interface TopDefenseSquadsCache {
  get(key: string): any[] | undefined;
  set(key: string, value: any[]): void;
  has(key: string): boolean;
}


/**
 * Check if a squad is better suited for defense vs offense.
 */
function isBetterOnDefense(
  leaderBaseId: string,
  defenseHoldPercentage: number | null,
  defenseSeenCount: number | null,
  offenseWinPercentage: number | null,
  offenseSeenCount: number | null,
  bestHoldPercentage: number | null,
  maxDefenseSeenCount: number,
  maxOffenseSeenCount: number
): boolean {
  // If we don't have defense data, can't make a decision
  if (defenseHoldPercentage === null) {
    return false;
  }
  
  // Calculate relative defense score (compared to best hold % for season)
  let defenseScore = 0;
  if (bestHoldPercentage !== null && bestHoldPercentage > 0) {
    const relativeHold = (defenseHoldPercentage / bestHoldPercentage) * 100;
    defenseScore = relativeHold * 0.6;
    
    if (defenseSeenCount !== null && defenseSeenCount > 0 && maxDefenseSeenCount > 0) {
      const logSeen = Math.log10(defenseSeenCount + 1);
      const logMax = Math.log10(maxDefenseSeenCount + 1);
      const normalizedSeen = (logSeen / logMax) * 100;
      defenseScore += normalizedSeen * 0.4;
    }
  } else {
    defenseScore = defenseHoldPercentage;
  }
  
  // Calculate offense score
  let offenseScore = 0;
  if (offenseWinPercentage !== null) {
    offenseScore = offenseWinPercentage * 0.6;
    
    if (offenseSeenCount !== null && offenseSeenCount > 0 && maxOffenseSeenCount > 0) {
      const logSeen = Math.log10(offenseSeenCount + 1);
      const logMax = Math.log10(maxOffenseSeenCount + 1);
      const normalizedSeen = (logSeen / logMax) * 100;
      offenseScore += normalizedSeen * 0.4;
    }
  }
  
  return defenseScore > offenseScore;
}

/**
 * Check if a squad leader should be avoided on defense based on hold percentage data.
 */
function shouldAvoidOnDefense(leaderBaseId: string, holdPercentage: number | null): boolean {
  // No minimum threshold - all squads are considered
  return false;
}

export async function balanceOffenseAndDefense(
  offenseCounters: MatchedCounterSquad[],
  defenseSuggestions: Array<{
    squad: UniqueDefensiveSquad;
    holdPercentage: number | null;
    seenCount: number | null;
    avgBanners: number | null;
    score: number;
    reason: string;
  }>,
  maxDefenseSquads: number,
  seasonId: string | undefined,
  strategyPreference: 'defensive' | 'balanced' | 'offensive',
  userRoster: SwgohGgFullPlayerResponse | undefined,
  format: string,
  defenseClient: DefenseClient | undefined,
  defenseSquadStatsCache: DefenseStatsCache,
  topDefenseSquadsCache: TopDefenseSquadsCache
): Promise<{
  balancedOffense: MatchedCounterSquad[];
  balancedDefense: Array<{
    squad: UniqueDefensiveSquad;
    holdPercentage: number | null;
    seenCount: number | null;
    avgBanners: number | null;
    score: number;
    reason: string;
  }>;
}> {
    // Track all used characters across both offense and defense
    const usedCharacters = new Set<string>();
    const usedLeaders = new Set<string>();
    
    // CRITICAL: Ensure ALL GLs are used (either offense or defense)
    // GLs are the strongest characters in the game and should NEVER be left unused
    const allUserGLsForPlacement = new Set<string>();
    if (userRoster) {
      for (const unit of userRoster.units || []) {
        // Use our authoritative GL list OR the API flag (some newer GLs may not have the flag yet)
        if (unit.data.combat_type === 1 && (isGalacticLegend(unit.data.base_id) || unit.data.is_galactic_legend)) {
          allUserGLsForPlacement.add(unit.data.base_id);
        }
      }
    }
    
    // Calculate data-driven statistics from actual SWGOH.GG data
    // 1. Calculate max seen counts from defense suggestions (actual data from SWGOH.GG)
    const defenseSeenCounts = defenseSuggestions
      .map(d => d.seenCount)
      .filter((s): s is number => s !== null);
    const maxDefenseSeenCount = defenseSeenCounts.length > 0 
      ? Math.max(...defenseSeenCounts) 
      : 100000; // Fallback if no data available
    
    // 2. Calculate max seen counts from offense counters (actual data from SWGOH.GG)
    const offenseSeenCounts = offenseCounters
      .map(c => c.seenCount)
      .filter((s): s is number => s !== null);
    const maxOffenseSeenCount = offenseSeenCounts.length > 0 
      ? Math.max(...offenseSeenCounts) 
      : 100000; // Fallback if no data available
    
    // 3. Calculate best hold % from defense suggestions for relative comparison
    const bestHoldPercentage = defenseSuggestions
      .map(d => d.holdPercentage)
      .filter((h): h is number => h !== null)
      .reduce((max, h) => Math.max(max, h), 0) || null;
    
    // 4. Calculate median hold % for additional context
    const holdPercentages = defenseSuggestions
      .map(d => d.holdPercentage)
      .filter((h): h is number => h !== null)
      .sort((a, b) => a - b);
    const medianHoldPercentage = holdPercentages.length > 0
      ? holdPercentages[Math.floor(holdPercentages.length / 2)]
      : null;
    
    // 5. Calculate median win % from offense counters for additional context
    const winPercentages = offenseCounters
      .map(c => c.adjustedWinPercentage ?? c.winPercentage)
      .filter((w): w is number => w !== null)
      .sort((a, b) => a - b);
    const medianWinPercentage = winPercentages.length > 0
      ? winPercentages[Math.floor(winPercentages.length / 2)]
      : null;
    
    logger.info(
      `Data-driven statistics from SWGOH.GG: ` +
      `Best hold %: ${bestHoldPercentage?.toFixed(1) ?? 'N/A'}%, ` +
      `Median hold %: ${medianHoldPercentage?.toFixed(1) ?? 'N/A'}%, ` +
      `Max defense seen: ${maxDefenseSeenCount.toLocaleString()}, ` +
      `Max offense seen: ${maxOffenseSeenCount.toLocaleString()}, ` +
      `Median win %: ${medianWinPercentage?.toFixed(1) ?? 'N/A'}%`
    );
    
    // Pre-fetch defense stats (including seen count) for offense counter leaders to make data-driven decisions
    const offenseDefenseStats = new Map<string, { holdPercentage: number | null; seenCount: number | null }>();
    const offenseCounterLeaders = offenseCounters.filter(c => c.offense.leader.baseId);
    logger.info(`Pre-fetching defense stats for ${offenseCounterLeaders.length} offense counter leaders to make data-driven placement decisions`);
    
    for (const counter of offenseCounterLeaders) {
      const stats = await getDefenseStatsForSquad(counter.offense.leader.baseId, seasonId, defenseClient, defenseSquadStatsCache, topDefenseSquadsCache);
      offenseDefenseStats.set(counter.offense.leader.baseId, stats);
    }
    
    // Also collect defense seen counts from offenseDefenseStats to get complete picture
    // This includes defense stats for squads that might be used on offense
    const allDefenseSeenCounts = [
      ...defenseSeenCounts,
      ...Array.from(offenseDefenseStats.values())
        .map(s => s.seenCount)
        .filter((s): s is number => s !== null)
    ];
    const maxAllDefenseSeenCount = allDefenseSeenCounts.length > 0
      ? Math.max(...allDefenseSeenCounts)
      : maxDefenseSeenCount; // Fallback to defense suggestions max
    
    // Sort offense counters by priority, but penalize squads that are better on defense
    // Compare defense viability (hold % + seen count) vs offense viability (win % + seen count)
    const sortedOffense = [...offenseCounters].sort((a, b) => {
      // Prioritize opponent GL defenses that only have GL counters
      // This ensures we use available GLs for these defenses before they get used elsewhere
      const aIsOpponentGL = isGalacticLegend(a.defense.leader.baseId);
      const bIsOpponentGL = isGalacticLegend(b.defense.leader.baseId);
      const aHasOnlyGlCounters = aIsOpponentGL && (!a.offense.leader.baseId || isGalacticLegend(a.offense.leader.baseId) || (a.alternatives && a.alternatives.every(alt => !alt.offense.leader.baseId || isGalacticLegend(alt.offense.leader.baseId))));
      const bHasOnlyGlCounters = bIsOpponentGL && (!b.offense.leader.baseId || isGalacticLegend(b.offense.leader.baseId) || (b.alternatives && b.alternatives.every(alt => !alt.offense.leader.baseId || isGalacticLegend(alt.offense.leader.baseId))));
      
      if (aHasOnlyGlCounters && !bHasOnlyGlCounters) {
        return -1; // a comes first
      }
      if (!aHasOnlyGlCounters && bHasOnlyGlCounters) {
        return 1; // b comes first
      }
      
      // Get defense stats for offense counter leaders
      const aDefStats = offenseDefenseStats.get(a.offense.leader.baseId);
      const bDefStats = offenseDefenseStats.get(b.offense.leader.baseId);
      
      // Compare defense vs offense viability for each counter using data-driven normalization
      const aIsBetterOnDef = isBetterOnDefense(
        a.offense.leader.baseId,
        aDefStats?.holdPercentage ?? null,
        aDefStats?.seenCount ?? null,
        a.adjustedWinPercentage ?? a.winPercentage ?? null,
        a.seenCount ?? null,
        bestHoldPercentage,
        maxAllDefenseSeenCount, // Use actual max from SWGOH.GG data
        maxOffenseSeenCount     // Use actual max from SWGOH.GG data
      );
      
      const bIsBetterOnDef = isBetterOnDefense(
        b.offense.leader.baseId,
        bDefStats?.holdPercentage ?? null,
        bDefStats?.seenCount ?? null,
        b.adjustedWinPercentage ?? b.winPercentage ?? null,
        b.seenCount ?? null,
        bestHoldPercentage,
        maxAllDefenseSeenCount, // Use actual max from SWGOH.GG data
        maxOffenseSeenCount     // Use actual max from SWGOH.GG data
      );
      
      // Strategy-specific adjustments
      if (strategyPreference === 'defensive') {
        // Defensive: Heavily penalize offense squads that are better on defense
        if (aIsBetterOnDef && !bIsBetterOnDef) {
          return 1; // a should come after b
        }
        if (!aIsBetterOnDef && bIsBetterOnDef) {
          return -1; // a should come before b
        }
        // Also penalize GL squads on offense for defensive strategy
        const aIsGL = isGalacticLegend(a.offense.leader.baseId);
        const bIsGL = isGalacticLegend(b.offense.leader.baseId);
        if (aIsGL && !bIsGL) {
          return 1; // Prefer non-GL on offense
        }
        if (!aIsGL && bIsGL) {
          return -1;
        }
      } else if (strategyPreference === 'offensive') {
        // Offensive: Prioritize GL counters with highest win rates (aim for 100% wins)
        // First, prioritize GL counters over non-GL
        const aIsGL = isGalacticLegend(a.offense.leader.baseId);
        const bIsGL = isGalacticLegend(b.offense.leader.baseId);
        
        if (aIsGL && !bIsGL) {
          return -1; // GL comes first
        }
        if (!aIsGL && bIsGL) {
          return 1; // GL comes first
        }
        
        // Both are same type (both GL or both non-GL), prioritize by win rate
        const aWinRate = a.adjustedWinPercentage ?? a.winPercentage ?? 0;
        const bWinRate = b.adjustedWinPercentage ?? b.winPercentage ?? 0;
        
        // Prioritize 100% win rates first
        if (aWinRate === 100 && bWinRate !== 100) {
          return -1; // a comes first
        }
        if (aWinRate !== 100 && bWinRate === 100) {
          return 1; // b comes first
        }
        
        // Then sort by win rate descending
        if (Math.abs(aWinRate - bWinRate) > 1) {
          return bWinRate - aWinRate; // Higher win rate first
        }
        
        // If win rates are very close, prefer more seen counters (more reliable)
        const aSeen = a.seenCount ?? 0;
        const bSeen = b.seenCount ?? 0;
        return bSeen - aSeen;
      } else {
        // Balanced: Prioritize unused GLs on offense (GLs not in defense suggestions)
        // Check which GLs are in the defense suggestions (likely to be placed on defense)
        const defenseGlLeaders = new Set<string>();
        if (defenseSuggestions) {
          for (const def of defenseSuggestions) {
            if (isGalacticLegend(def.squad.leader.baseId)) {
              defenseGlLeaders.add(def.squad.leader.baseId);
            }
          }
        }
        
        const aIsGL = isGalacticLegend(a.offense.leader.baseId);
        const bIsGL = isGalacticLegend(b.offense.leader.baseId);
        const aIsGlInDefenseSuggestions = aIsGL && defenseGlLeaders.has(a.offense.leader.baseId);
        const bIsGlInDefenseSuggestions = bIsGL && defenseGlLeaders.has(b.offense.leader.baseId);
        
        // Prioritize unused GLs on offense (they're not in defense suggestions, so they should be used on offense)
        if (aIsGL && !aIsGlInDefenseSuggestions && (!bIsGL || bIsGlInDefenseSuggestions)) {
          return -1; // a (unused GL) should come before b (non-GL or GL in defense suggestions)
        }
        if (bIsGL && !bIsGlInDefenseSuggestions && (!aIsGL || aIsGlInDefenseSuggestions)) {
          return 1; // b (unused GL) should come before a (non-GL or GL in defense suggestions)
        }
        
        // If one is better on defense and the other isn't, prefer the one that isn't
        if (aIsBetterOnDef && !bIsBetterOnDef) {
          logger.info(
            `Offense sorting: ${a.offense.leader.baseId} better on defense ` +
            `(def: ${aDefStats?.holdPercentage?.toFixed(1) ?? 'N/A'}% hold, ${aDefStats?.seenCount?.toLocaleString() ?? 'N/A'} seen) ` +
            `vs (off: ${(a.adjustedWinPercentage ?? a.winPercentage)?.toFixed(1) ?? 'N/A'}% win, ${a.seenCount?.toLocaleString() ?? 'N/A'} seen) - deprioritizing for offense`
          );
          return 1; // a should come after b
        }
        if (!aIsBetterOnDef && bIsBetterOnDef) {
          logger.info(
            `Offense sorting: ${b.offense.leader.baseId} better on defense ` +
            `(def: ${bDefStats?.holdPercentage?.toFixed(1) ?? 'N/A'}% hold, ${bDefStats?.seenCount?.toLocaleString() ?? 'N/A'} seen) ` +
            `vs (off: ${(b.adjustedWinPercentage ?? b.winPercentage)?.toFixed(1) ?? 'N/A'}% win, ${b.seenCount?.toLocaleString() ?? 'N/A'} seen) - deprioritizing for offense`
          );
          return -1; // a should come before b
        }
      }
      
      // Both are similar in defense preference, sort by win rate
      const aWinRate = a.adjustedWinPercentage ?? a.winPercentage ?? 0;
      const bWinRate = b.adjustedWinPercentage ?? b.winPercentage ?? 0;
      if (Math.abs(aWinRate - bWinRate) > 5) {
        return bWinRate - aWinRate; // Higher win rate first
      }
      // If win rates are close, prefer more seen counters (more reliable)
      const aSeen = a.seenCount ?? 0;
      const bSeen = b.seenCount ?? 0;
      return bSeen - aSeen;
    });
    
    // Sort defense suggestions by score, but boost squads that are relatively better on defense
    // and penalize squads that should be avoided on defense (using data-driven thresholds)
    // For offensive strategy, we need to know which GLs were used on offense to prioritize unused GLs on defense
    const offenseGlLeaders = new Set<string>();
    if (strategyPreference === 'offensive' && offenseCounters) {
      for (const counter of offenseCounters) {
        if (counter.offense.leader.baseId && isGalacticLegend(counter.offense.leader.baseId)) {
          offenseGlLeaders.add(counter.offense.leader.baseId);
        }
      }
    }
    
    const sortedDefense = [...defenseSuggestions].sort((a, b) => {
      const aLeader = a.squad.leader.baseId;
      const bLeader = b.squad.leader.baseId;
      const aShouldAvoid = shouldAvoidOnDefense(aLeader, a.holdPercentage);
      const bShouldAvoid = shouldAvoidOnDefense(bLeader, b.holdPercentage);
      
      // No longer avoiding squads based on hold % threshold
      // All squads are considered, with lower hold % squads naturally scoring lower
      
      // Strategy-specific: For offensive, prioritize unused GLs on defense
      const aIsGL = userRoster ? isGalacticLegend(a.squad.leader.baseId) : false;
      const bIsGL = userRoster ? isGalacticLegend(b.squad.leader.baseId) : false;
      
      if (strategyPreference === 'offensive') {
        // Offensive: Prioritize unused GLs on defense (they weren't needed on offense)
        const aIsGlUsedOnOffense = aIsGL && offenseGlLeaders.has(aLeader);
        const bIsGlUsedOnOffense = bIsGL && offenseGlLeaders.has(bLeader);
        
        // Unused GLs should come first (they're valuable and weren't needed on offense)
        if (aIsGL && !aIsGlUsedOnOffense && (!bIsGL || bIsGlUsedOnOffense)) {
          return -1; // a (unused GL) should come before b (non-GL or used GL)
        }
        if (bIsGL && !bIsGlUsedOnOffense && (!aIsGL || aIsGlUsedOnOffense)) {
          return 1; // b (unused GL) should come before a (non-GL or used GL)
        }
        
        // Used GLs should come last (they're already on offense)
        if (aIsGlUsedOnOffense && !bIsGlUsedOnOffense) {
          return 1; // a (used GL) should come after b (non-GL or unused GL)
        }
        if (bIsGlUsedOnOffense && !aIsGlUsedOnOffense) {
          return -1; // b (used GL) should come after a (non-GL or unused GL)
        }
      }
      
      if (strategyPreference === 'defensive') {
        // Defensive: Prioritize GLs first, then by strength (relic level), then hold %
        // GLs should always come before non-GLs for defensive strategy
        if (aIsGL && !bIsGL) {
          return -1; // GL always comes first
        }
        if (!aIsGL && bIsGL) {
          return 1; // Non-GL comes after GL
        }
        
        // Both are GL or both are non-GL - sort by strength
        // For GLs, prioritize by hold % and seen count (reliability)
        // For non-GLs, prioritize by hold % and seen count, but also consider relic level
        
        // Get relic levels for strength comparison
        const getSquadRelicLevel = (squad: UniqueDefensiveSquad): number => {
          const allUnits = [squad.leader, ...squad.members];
          const relics = allUnits
            .map(u => {
              // Try to get relic level from user roster
              if (userRoster) {
                const unit = userRoster.units?.find(ur => ur.data.base_id === u.baseId);
                if (unit && unit.data.gear_level >= 13 && unit.data.relic_tier !== null) {
                  return Math.max(0, unit.data.relic_tier - 2);
                }
              }
              return u.relicLevel ?? 0;
            })
            .filter(r => r > 0);
          return relics.length > 0 ? relics.reduce((sum, r) => sum + r, 0) / relics.length : 0;
        };
        
        const aRelic = getSquadRelicLevel(a.squad);
        const bRelic = getSquadRelicLevel(b.squad);
        
        // For GLs, prioritize by hold % first (they're all strong), then seen count
        if (aIsGL && bIsGL) {
        const aHold = a.holdPercentage ?? 0;
        const bHold = b.holdPercentage ?? 0;
          const aSeen = a.seenCount ?? 0;
          const bSeen = b.seenCount ?? 0;
          
          // Penalize 100% hold rates with very low seen counts (likely unreliable)
          const aReliableHold = (aHold === 100 && aSeen < 10) ? 50 : aHold;
          const bReliableHold = (bHold === 100 && bSeen < 10) ? 50 : bHold;
          
          if (Math.abs(aReliableHold - bReliableHold) > 5) {
            return bReliableHold - aReliableHold; // Higher reliable hold % first
          }
          
          // If hold % is similar, prioritize seen count (more reliable data)
          if (aSeen !== bSeen) {
            return bSeen - aSeen; // Higher seen count first
          }
          
          // Final tiebreaker: relic level (higher is better)
          if (Math.abs(aRelic - bRelic) >= 1) {
            return bRelic - aRelic;
          }
          
          return b.score - a.score;
        }
        
        // For non-GLs, prioritize by relic level first (strength), then hold %
        if (Math.abs(aRelic - bRelic) >= 2) {
          return bRelic - aRelic; // Higher relic first
        }
        
        // If relics are similar, prioritize hold % but filter out low-sample-size 100% holds
        const aHold = a.holdPercentage ?? 0;
        const bHold = b.holdPercentage ?? 0;
        const aSeen = a.seenCount ?? 0;
        const bSeen = b.seenCount ?? 0;
        
        // Penalize 100% hold rates with very low seen counts (likely unreliable)
        const aReliableHold = (aHold === 100 && aSeen < 10) ? 50 : aHold; // Penalize low-sample 100%
        const bReliableHold = (bHold === 100 && bSeen < 10) ? 50 : bHold;
        
        if (Math.abs(aReliableHold - bReliableHold) > 5) {
          return bReliableHold - aReliableHold; // Higher reliable hold % first
        }
        
        // If hold % is similar, prioritize seen count (more reliable data)
        if (aSeen !== bSeen) {
          return bSeen - aSeen; // Higher seen count first
        }
        
        // Final tiebreaker: score
        return b.score - a.score;
      } else if (strategyPreference === 'offensive') {
        // Offensive: Slight penalty for GL squads on defense
        if (aIsGL && !bIsGL) {
          const adjustedScoreA = a.score - 20; // Penalty
          if (adjustedScoreA < b.score) {
            return 1;
          }
        }
        if (!aIsGL && bIsGL) {
          const adjustedScoreB = b.score - 20; // Penalty
          if (adjustedScoreB < a.score) {
            return -1;
          }
        }
      }
      // Balanced: Continue with existing logic
      
      // Calculate relative scores (compared to best hold % for season)
      const aRelativeScore = bestHoldPercentage !== null && a.holdPercentage !== null && bestHoldPercentage > 0
        ? (a.holdPercentage / bestHoldPercentage) * 100
        : a.holdPercentage ?? 0;
      
      const bRelativeScore = bestHoldPercentage !== null && b.holdPercentage !== null && bestHoldPercentage > 0
        ? (b.holdPercentage / bestHoldPercentage) * 100
        : b.holdPercentage ?? 0;
      
      // Boost squads that are relatively better on defense (e.g., > 80% of best hold %)
      // This means they're in the top tier of defense squads for this season
      const aIsRelativelyGood = aRelativeScore >= 80; // Top 20% relative to best
      const bIsRelativelyGood = bRelativeScore >= 80;
      
      if (aIsRelativelyGood && !bIsRelativelyGood) {
        // Boost a's score by 30 points for being relatively good on defense
        const adjustedScoreA = a.score + 30;
        logger.info(
          `Defense sorting: ${aLeader} relatively good on defense ` +
          `(${a.holdPercentage?.toFixed(1) ?? 'N/A'}% = ${aRelativeScore.toFixed(1)}% of best ${bestHoldPercentage?.toFixed(1) ?? 'N/A'}%, ` +
          `${a.seenCount?.toLocaleString() ?? 'N/A'} seen) - boosting score ${a.score.toFixed(1)} -> ${adjustedScoreA.toFixed(1)}`
        );
        if (adjustedScoreA > b.score) {
          return -1; // a should come before b
        }
      }
      if (!aIsRelativelyGood && bIsRelativelyGood) {
        // Boost b's score by 30 points for being relatively good on defense
        const adjustedScoreB = b.score + 30;
        logger.info(
          `Defense sorting: ${bLeader} relatively good on defense ` +
          `(${b.holdPercentage?.toFixed(1) ?? 'N/A'}% = ${bRelativeScore.toFixed(1)}% of best ${bestHoldPercentage?.toFixed(1) ?? 'N/A'}%, ` +
          `${b.seenCount?.toLocaleString() ?? 'N/A'} seen) - boosting score ${b.score.toFixed(1)} -> ${adjustedScoreB.toFixed(1)}`
        );
        if (adjustedScoreB > a.score) {
          return 1; // a should come after b
        }
      }
      
      // Otherwise sort by score
      return b.score - a.score;
    });
    
    const balancedOffense: MatchedCounterSquad[] = [];
    const balancedDefense: Array<{
      squad: UniqueDefensiveSquad;
      holdPercentage: number | null;
      seenCount: number | null;
      avgBanners: number | null;
      score: number;
      reason: string;
    }> = [];
    
    // For defensive strategy, prioritize defense first, then add offense
    // For balanced/offensive, prioritize offense first, then add defense
    if (strategyPreference === 'defensive') {
      // DEFENSIVE STRATEGY: Add defense first, then offense
      // For defensive strategy, be more lenient about character conflicts within defense
      // Allow defense squads even if they share 1-2 characters, as long as leaders are unique
      // First pass: Add defense squads up to maxDefenseSquads
      for (const defenseSuggestion of sortedDefense) {
        if (balancedDefense.length >= maxDefenseSquads) {
          break; // Reached max defense squads
        }
        
        const defenseUnits = [
          defenseSuggestion.squad.leader.baseId,
          ...defenseSuggestion.squad.members.map(m => m.baseId)
        ];
        
        // Check if leader is already used (this is strict - no duplicate leaders)
        if (usedLeaders.has(defenseSuggestion.squad.leader.baseId)) {
          logger.debug(
            `Skipping defense squad ${defenseSuggestion.squad.leader.baseId} - leader already used`
          );
          continue; // Skip - leader already used
        }
        
        // Check for character conflicts - be lenient for defensive strategy
        // BUT: If a character is needed for offense counters (especially for opponent GLs that only have GL counters),
        // we should avoid using it in defense
        const conflictingUnits = defenseUnits.filter(unitId => usedCharacters.has(unitId));
        const conflictCount = conflictingUnits.length;
        const squadSize = defenseUnits.length;
        
        // Check if any conflicting character is needed for offense counters
        // For defensive strategy, if we have opponent GLs that only have GL counters, we need to reserve GLs for offense
        // Also check if any character is a critical offense counter leader
        const criticalOffenseCharacters = new Set<string>();
        for (const counter of sortedOffense) {
          if (!counter.offense.leader.baseId) continue;
          const isOpponentGL = isGalacticLegend(counter.defense.leader.baseId);
          const hasOnlyGlCounters = isOpponentGL && (
            isGalacticLegend(counter.offense.leader.baseId) || 
            (counter.alternatives && counter.alternatives.every(alt => !alt.offense.leader.baseId || isGalacticLegend(alt.offense.leader.baseId)))
          );
          if (hasOnlyGlCounters) {
            // This opponent GL only has GL counters - reserve the GL for offense
            if (isGalacticLegend(counter.offense.leader.baseId)) {
              criticalOffenseCharacters.add(counter.offense.leader.baseId);
            }
          }
          // Also check if JEDIMASTERKENOBI is needed for SUPREMELEADERKYLOREN (user's specific case)
          if (counter.defense.leader.baseId === 'SUPREMELEADERKYLOREN' && counter.offense.leader.baseId === 'JEDIMASTERKENOBI') {
            criticalOffenseCharacters.add('JEDIMASTERKENOBI');
          }
        }
        
        // Check if any conflicting character is critical for offense
        const criticalConflicts = conflictingUnits.filter(unitId => criticalOffenseCharacters.has(unitId));
        if (criticalConflicts.length > 0) {
          logger.info(
            `Skipping defense squad ${defenseSuggestion.squad.leader.baseId} - ` +
            `critical offense character(s) needed: ${criticalConflicts.join(', ')}`
          );
          continue; // Skip - these characters are needed for offense
        }
        
        // For defensive strategy, only skip if there are MANY conflicts (>= 50% of squad)
        // This allows GL squads and other strong defense squads even if they share 1-2 characters
        if (conflictCount > 0) {
          const conflictRatio = conflictCount / squadSize;
          // Skip only if >= 50% of the squad conflicts AND we have other options
          if (conflictRatio >= 0.5 && sortedDefense.length - balancedDefense.length > (maxDefenseSquads - balancedDefense.length) * 2) {
            logger.debug(
              `Skipping defense squad ${defenseSuggestion.squad.leader.baseId} - ` +
              `${conflictCount}/${squadSize} character(s) already used (${(conflictRatio * 100).toFixed(0)}%): ${conflictingUnits.join(', ')}`
            );
            continue; // Skip this defense squad - too many conflicts
          } else {
            // Allow this squad despite minor conflicts
            logger.debug(
              `Allowing defense squad ${defenseSuggestion.squad.leader.baseId} despite ` +
              `${conflictCount} minor character conflict(s): ${conflictingUnits.join(', ')}`
            );
          }
        }
        
        // Add this defense squad
        logger.debug(
          `Adding defense squad ${defenseSuggestion.squad.leader.baseId} ` +
          `(Hold: ${defenseSuggestion.holdPercentage?.toFixed(1) ?? 'N/A'}%, ` +
          `Score: ${defenseSuggestion.score.toFixed(1)}, ` +
          `Conflicts: ${conflictCount}/${squadSize})`
        );
        balancedDefense.push(defenseSuggestion);
        
        // Mark characters as used, but only mark non-conflicting ones if we're being lenient
        // This allows other defense squads to still be considered
        if (conflictCount > 0 && conflictCount < squadSize * 0.5) {
          // Only mark non-conflicting characters
          for (const unitId of defenseUnits) {
            if (!conflictingUnits.includes(unitId)) {
              usedCharacters.add(unitId);
            }
          }
        } else {
          // Mark all characters as used
          for (const unitId of defenseUnits) {
            usedCharacters.add(unitId);
          }
        }
        usedLeaders.add(defenseSuggestion.squad.leader.baseId);
      }
      
      // Second pass: Add offense counters that don't conflict with defense
      // For defensive strategy, we need to ensure we get enough offense teams (up to maxDefenseSquads)
      const maxOffenseNeeded = maxDefenseSquads; // Need one offense team per opponent defense slot
      
      for (const counter of sortedOffense) {
        // For defensive strategy, stop when we have enough offense teams
        if (strategyPreference === 'defensive' && balancedOffense.length >= maxOffenseNeeded) {
          break;
        }
        
        if (!counter.offense.leader.baseId) {
          continue; // Skip empty offense squads
        }
        
        // Try primary counter first, then alternatives if it conflicts
        // For defensive strategy, try non-GL alternatives first, then GL alternatives if all non-GL conflict
        const countersToTry = [counter, ...(counter.alternatives || [])];
        let addedCounter = false;
        
        // For defensive strategy, separate non-GL and GL counters
        // Try non-GL first, then GL if all non-GL conflict
        let nonGlCounters: MatchedCounterSquad[] = [];
        let glCounters: MatchedCounterSquad[] = [];
        if (strategyPreference === 'defensive') {
          for (const c of countersToTry) {
            if (!c.offense.leader.baseId) continue;
            if (isGalacticLegend(c.offense.leader.baseId)) {
              glCounters.push(c);
            } else {
              nonGlCounters.push(c);
            }
          }
          // Try non-GL counters first, then GL counters
          countersToTry.length = 0;
          countersToTry.push(...nonGlCounters, ...glCounters);
        }
        
        for (const counterToTry of countersToTry) {
          logger.debug(
            `Trying counter: ${counterToTry.offense.leader.baseId} vs ${counterToTry.defense.leader.baseId} ` +
            `(primary: ${counterToTry === counter}, isGL: ${isGalacticLegend(counterToTry.offense.leader.baseId)})`
          );
          
          // For defensive strategy, allow GL counters ONLY if:
          // 1. We've already tried all non-GL alternatives and they all conflicted (we're now in the GL counters section)
          // 2. The GL is not already used on defense
          const isCounterGL = isGalacticLegend(counterToTry.offense.leader.baseId);
          if (strategyPreference === 'defensive' && isCounterGL) {
            // Check if GL is already used on defense
            if (usedLeaders.has(counterToTry.offense.leader.baseId)) {
              logger.info(
                `Skipping GL offense counter ${counterToTry.offense.leader.baseId} - already used on defense`
              );
              continue; // Skip - GL already on defense
            }
            
            // If we're trying a GL counter, it means all non-GL alternatives have been tried and conflicted
            // (because we sorted countersToTry to put non-GL first, then GL)
            logger.info(
              `Allowing GL offense counter ${counterToTry.offense.leader.baseId} vs ${counterToTry.defense.leader.baseId} - all non-GL alternatives conflicted and GL not on defense`
            );
          }
          
          const offenseUnits = [
            counterToTry.offense.leader.baseId,
            ...counterToTry.offense.members.map(m => m.baseId)
          ];
          
          // Check if leader is already used (strict - no duplicate leaders)
          if (usedLeaders.has(counterToTry.offense.leader.baseId)) {
            logger.debug(
              `Skipping offense counter ${counterToTry.offense.leader.baseId} - leader already used`
            );
            continue; // Skip - leader already used
          }
          
          // Check if any USER character from this offense counter is already used in defense
          // NOTE: usedCharacters tracks USER's characters used in defense (or previous offense counters)
          // OPPONENT characters (counterToTry.defense.leader.baseId) should NEVER be in usedCharacters
          // offenseUnits contains only USER's characters (counterToTry.offense.leader + counterToTry.offense.members)
          const conflictingUnits = offenseUnits.filter(unitId => usedCharacters.has(unitId));
          const conflictCount = conflictingUnits.length;
          const squadSize = offenseUnits.length;
          
          if (conflictCount > 0) {
            logger.info(
              `[CONFLICT CHECK] Offense counter ${counterToTry.offense.leader.baseId} vs opponent ${counterToTry.defense.leader.baseId}: ` +
              `${conflictCount}/${squadSize} USER characters conflict: ${conflictingUnits.join(', ')} ` +
              `(offense squad: ${offenseUnits.join(', ')})` +
              (counterToTry !== counter ? ' [ALTERNATIVE]' : '')
            );
          }
          
          // GAC rule: Each character can only be used once per round
          // Any character conflict should block the counter - no leniency
          if (conflictCount > 0) {
            logger.info(
              `[SKIP] Offense counter ${counterToTry.offense.leader.baseId} vs ${counterToTry.defense.leader.baseId} - ` +
              `${conflictCount}/${squadSize} USER character(s) already used: ${conflictingUnits.join(', ')} ` +
              `(offense squad: ${offenseUnits.join(', ')})` +
              (counterToTry !== counter ? ' [trying next alternative...]' : '')
            );
            continue; // Skip - character conflict, try next alternative
          }
          
          // Add this offense counter (primary or alternative)
          logger.info(
            `Adding offense counter ${counterToTry.offense.leader.baseId} vs ${counterToTry.defense.leader.baseId} ` +
            `(Win: ${counterToTry.winPercentage?.toFixed(1) ?? 'N/A'}%)` +
            (counterToTry !== counter ? ' [ALTERNATIVE]' : '')
          );
          balancedOffense.push(counterToTry);
          addedCounter = true;
          
          // Mark all characters as used (GAC rule: each character can only be used once)
          for (const unitId of offenseUnits) {
            usedCharacters.add(unitId);
          }
          usedLeaders.add(counterToTry.offense.leader.baseId);
          break; // Successfully added a counter, move to next opponent defense
        }
        
        if (!addedCounter) {
          logger.warn(
            `No valid counter found for opponent ${counter.defense.leader.baseId} - ` +
            `tried ${countersToTry.length} counter(s) (primary + ${countersToTry.length - 1} alternative(s))`
          );
        }
      }
      
      // For defensive strategy, if we don't have enough offense teams, log which opponent defenses need manual counters
      // We don't generate random fallback teams - they lack synergy and are not useful
      if (strategyPreference === 'defensive' && balancedOffense.length < maxOffenseNeeded) {
        const needed = maxOffenseNeeded - balancedOffense.length;
        const unmatchedDefenses = offenseCounters
          .filter(c => !c.offense.leader.baseId)
          .map(c => c.defense.leader.baseId);
        
        logger.warn(
          `Only generated ${balancedOffense.length} offense team(s) but need ${maxOffenseNeeded}. ` +
          `${needed} opponent defense(s) have no non-GL counters available and require manual counter selection: ` +
          `${unmatchedDefenses.join(', ')}`
        );
        
        // Add empty offense entries for unmatched defenses so the user knows which ones need manual counters
        const alreadyMatchedDefenses = new Set(balancedOffense.map(c => c.defense.leader.baseId));
        for (const counter of offenseCounters) {
          if (!counter.offense.leader.baseId && !alreadyMatchedDefenses.has(counter.defense.leader.baseId)) {
            balancedOffense.push(counter); // Add the empty counter entry so it shows in the output
          }
        }
      }
    } else {
      // BALANCED/OFFENSIVE STRATEGY: Add offense first, then defense
    // First pass: Add offense counters that don't conflict with each other
    // Try primary counter first, then alternatives if it conflicts
    for (const counter of sortedOffense) {
      if (!counter.offense.leader.baseId) {
        continue; // Skip empty offense squads
      }
      
      // Try primary counter first, then alternatives if it conflicts
      const countersToTry = [counter, ...(counter.alternatives || [])];
      let addedCounter = false;
      
      for (const counterToTry of countersToTry) {
        if (!counterToTry.offense.leader.baseId) {
          continue; // Skip empty alternatives
        }
        
        const offenseUnits = [
          counterToTry.offense.leader.baseId,
          ...counterToTry.offense.members.map(m => m.baseId)
        ];
        
        // Check if leader is already used (strict - no duplicate leaders)
        if (usedLeaders.has(counterToTry.offense.leader.baseId)) {
          logger.debug(
            `Skipping offense counter ${counterToTry.offense.leader.baseId} - leader already used` +
            (counterToTry !== counter ? ' [trying next alternative...]' : '')
          );
          continue; // Skip - leader already used, try next alternative
        }
        
        // Check if any character is already used
        const conflictingUnits = offenseUnits.filter(unitId => usedCharacters.has(unitId));
        const conflictCount = conflictingUnits.length;
        
        if (conflictCount > 0) {
          logger.debug(
            `Skipping offense counter ${counterToTry.offense.leader.baseId} vs opponent ${counterToTry.defense.leader.baseId} - ` +
            `${conflictCount} character(s) already used: ${conflictingUnits.join(', ')}` +
            (counterToTry !== counter ? ' [trying next alternative...]' : '')
          );
          continue; // Skip - conflicts, try next alternative
        }
        
        // Add this offense counter (primary or alternative)
        logger.debug(
          `Adding offense counter ${counterToTry.offense.leader.baseId} vs ${counterToTry.defense.leader.baseId} ` +
          `(Win: ${counterToTry.winPercentage?.toFixed(1) ?? 'N/A'}%)` +
          (counterToTry !== counter ? ' [ALTERNATIVE]' : '')
        );
        balancedOffense.push(counterToTry);
        addedCounter = true;
        
        // Mark characters as used
        for (const unitId of offenseUnits) {
          usedCharacters.add(unitId);
        }
        usedLeaders.add(counterToTry.offense.leader.baseId);
        break; // Successfully added a counter, move to next opponent defense
      }
      
        if (!addedCounter) {
          logger.debug(
            `No valid counter found for opponent ${counter.defense.leader.baseId} - ` +
            `tried ${countersToTry.length} counter(s) (primary + ${countersToTry.length - 1} alternative(s))`
          );
        }
      }
    
    const usedGLsForPlacement = new Set<string>();
    for (const offenseCounter of balancedOffense) {
      if (offenseCounter.offense.leader.baseId && isGalacticLegend(offenseCounter.offense.leader.baseId)) {
        usedGLsForPlacement.add(offenseCounter.offense.leader.baseId);
      }
    }
    for (const defenseSquad of balancedDefense) {
      if (isGalacticLegend(defenseSquad.squad.leader.baseId)) {
        usedGLsForPlacement.add(defenseSquad.squad.leader.baseId);
      }
    }
    
    const unusedGLsForPlacement = Array.from(allUserGLsForPlacement).filter(gl => !usedGLsForPlacement.has(gl));
    if (unusedGLsForPlacement.length > 0) {
      logger.warn(
        `CRITICAL: ${unusedGLsForPlacement.length} GL(s) are UNUSED and must be placed: ${unusedGLsForPlacement.join(', ')}. ` +
        `GLs are the strongest characters in the game and should NEVER be left out.`
      );
      
      // For balanced strategy, aim for roughly 50/50 split of GLs between offense and defense
      const glsOnOffense = Array.from(usedGLsForPlacement).filter(gl => 
        balancedOffense.some(c => c.offense.leader.baseId === gl)
      ).length;
      const glsOnDefense = Array.from(usedGLsForPlacement).filter(gl => 
        balancedDefense.some(d => d.squad.leader.baseId === gl)
      ).length;
      const totalGLsUsed = glsOnOffense + glsOnDefense;
      const targetGLsOnOffense = Math.ceil(allUserGLsForPlacement.size / 2);
      const targetGLsOnDefense = Math.floor(allUserGLsForPlacement.size / 2);
      
      logger.info(
        `[Balanced Strategy] GL distribution: ${glsOnOffense} on offense, ${glsOnDefense} on defense, ` +
        `${unusedGLsForPlacement.length} unused. Target: ~${targetGLsOnOffense} offense, ~${targetGLsOnDefense} defense`
      );
      
      // Try to place unused GLs on offense first (they're better on offense for balanced strategy)
      // For balanced strategy, prioritize offense if we're below target
      // Look for opponent defenses that could use these GLs as counters
      for (const unusedGL of unusedGLsForPlacement) {
        let glPlaced = false;
        
        // For balanced strategy, only try offense if we're below target
        const shouldTryOffense = strategyPreference !== 'balanced' || glsOnOffense < targetGLsOnOffense;
        
        if (shouldTryOffense) {
          // First, try to place on offense by replacing ANY non-GL counter (GLs are always better)
          for (const offenseCounter of offenseCounters) {
            if (offenseCounter.offense.leader.baseId === unusedGL) {
            // This GL is available as a counter for this opponent defense
            const existingCounterIndex = balancedOffense.findIndex(c => 
              c.defense.leader.baseId === offenseCounter.defense.leader.baseId
            );
            
            if (existingCounterIndex >= 0) {
              const existingCounter = balancedOffense[existingCounterIndex];
              const existingIsGL = existingCounter.offense.leader.baseId && 
                isGalacticLegend(existingCounter.offense.leader.baseId);
              
              // Replace if existing is non-GL (GLs are always better than non-GLs)
              // OR if GL has better or equal win rate
              const existingWinRate = existingCounter.adjustedWinPercentage ?? existingCounter.winPercentage ?? 0;
              const glWinRate = offenseCounter.adjustedWinPercentage ?? offenseCounter.winPercentage ?? 0;
              
              if (!existingIsGL || glWinRate >= existingWinRate) {
                // Check if GL counter doesn't conflict
                const glOffenseUnits = [
                  offenseCounter.offense.leader.baseId,
                  ...offenseCounter.offense.members.map(m => m.baseId)
                ];
                const hasConflict = glOffenseUnits.some(unitId => usedCharacters.has(unitId));
                
                if (!hasConflict && !usedLeaders.has(unusedGL)) {
                  logger.info(
                    `Placing unused GL ${unusedGL} on offense vs ${offenseCounter.defense.leader.baseId} ` +
                    `(replacing ${existingCounter.offense.leader.baseId}, win rate: ${glWinRate.toFixed(1)}%)`
                  );
                  
                  // Remove old counter
                  const oldOffenseUnits = [
                    existingCounter.offense.leader.baseId,
                    ...existingCounter.offense.members.map(m => m.baseId)
                  ];
                  for (const unitId of oldOffenseUnits) {
                    usedCharacters.delete(unitId);
                  }
                  usedLeaders.delete(existingCounter.offense.leader.baseId);
                  
                  // Add GL counter
                  balancedOffense[existingCounterIndex] = offenseCounter;
                  for (const unitId of glOffenseUnits) {
                    usedCharacters.add(unitId);
                  }
                  usedLeaders.add(unusedGL);
                  glPlaced = true;
                  break; // GL placed, move to next unused GL
                }
              }
            } else {
              // No counter exists for this opponent defense, add GL counter if it doesn't conflict
              const glOffenseUnits = [
                offenseCounter.offense.leader.baseId,
                ...offenseCounter.offense.members.map(m => m.baseId)
              ];
              const hasConflict = glOffenseUnits.some(unitId => usedCharacters.has(unitId));
              
              if (!hasConflict && !usedLeaders.has(unusedGL)) {
                logger.info(
                  `Placing unused GL ${unusedGL} on offense vs ${offenseCounter.defense.leader.baseId} ` +
                  `(win rate: ${(offenseCounter.adjustedWinPercentage ?? offenseCounter.winPercentage ?? 0).toFixed(1)}%)`
                );
                balancedOffense.push(offenseCounter);
                for (const unitId of glOffenseUnits) {
                  usedCharacters.add(unitId);
                }
                usedLeaders.add(unusedGL);
                glPlaced = true;
                break; // GL placed, move to next unused GL
              }
            }
          }
        }
        }
        
        // If still unused after trying offense, try to place on defense
        // For balanced strategy, only place on defense if we don't already have too many GLs on defense
        if (!glPlaced && !usedGLsForPlacement.has(unusedGL) && !usedLeaders.has(unusedGL)) {
          // Recalculate GL counts
          const currentGLsOnDefense = balancedDefense.filter(d => 
            isGalacticLegend(d.squad.leader.baseId)
          ).length;
          
          // For balanced strategy, only place on defense if we're below target
          const shouldPlaceOnDefense = strategyPreference !== 'balanced' || 
            currentGLsOnDefense < targetGLsOnDefense;
          
          if (shouldPlaceOnDefense) {
            // Look for this GL in defense suggestions
            for (const defenseSuggestion of sortedDefense) {
              if (defenseSuggestion.squad.leader.baseId === unusedGL) {
                const defenseUnits = [
                  defenseSuggestion.squad.leader.baseId,
                  ...defenseSuggestion.squad.members.map(m => m.baseId)
                ];
                
                // Check if it conflicts with offense
                const hasConflict = defenseUnits.some(unitId => usedCharacters.has(unitId));
                
                if (!hasConflict && balancedDefense.length < maxDefenseSquads) {
                  logger.info(
                    `Placing unused GL ${unusedGL} on defense (Hold: ${defenseSuggestion.holdPercentage?.toFixed(1) ?? 'N/A'}%)`
                  );
                  balancedDefense.push(defenseSuggestion);
                  for (const unitId of defenseUnits) {
                    usedCharacters.add(unitId);
                  }
                  usedLeaders.add(unusedGL);
                  usedGLsForPlacement.add(unusedGL); // Update tracking
                  glPlaced = true;
                  break; // GL placed
                }
              }
            }
          } else {
            logger.info(
              `Skipping defense placement for unused GL ${unusedGL} - already have ${currentGLsOnDefense} GL(s) on defense ` +
              `(target: ${targetGLsOnDefense} for balanced strategy)`
            );
          }
        }
        
        // If STILL unused, try to replace ANY defense squad with this GL (GLs are always better)
        // But for balanced strategy, only if we're below target GLs on defense
        if (!glPlaced && !usedGLsForPlacement.has(unusedGL) && !usedLeaders.has(unusedGL)) {
          // Recalculate GL counts
          const currentGLsOnDefense = balancedDefense.filter(d => 
            isGalacticLegend(d.squad.leader.baseId)
          ).length;
          
          // For balanced strategy, only replace if we're below target
          const shouldReplaceOnDefense = strategyPreference !== 'balanced' || 
            currentGLsOnDefense < targetGLsOnDefense;
          
          if (shouldReplaceOnDefense) {
            // Find a defense squad with this GL as leader
            for (const defenseSuggestion of sortedDefense) {
              if (defenseSuggestion.squad.leader.baseId === unusedGL) {
                // Try to find a non-GL defense squad to replace
                for (let i = 0; i < balancedDefense.length; i++) {
                  const existingDefense = balancedDefense[i];
                  const existingIsGL = isGalacticLegend(existingDefense.squad.leader.baseId);
                  
                  // Replace non-GL defense with GL defense
                  if (!existingIsGL) {
                    const existingDefenseUnits = [
                      existingDefense.squad.leader.baseId,
                      ...existingDefense.squad.members.map(m => m.baseId)
                    ];
                    
                    // Remove existing defense
                    for (const unitId of existingDefenseUnits) {
                      usedCharacters.delete(unitId);
                    }
                    usedLeaders.delete(existingDefense.squad.leader.baseId);
                    
                    // Add GL defense
                    const glDefenseUnits = [
                      defenseSuggestion.squad.leader.baseId,
                      ...defenseSuggestion.squad.members.map(m => m.baseId)
                    ];
                    
                    // Check if GL defense conflicts with offense
                    const hasConflict = glDefenseUnits.some(unitId => usedCharacters.has(unitId));
                    
                    if (!hasConflict) {
                      logger.info(
                        `Replacing non-GL defense ${existingDefense.squad.leader.baseId} with unused GL ${unusedGL} on defense ` +
                        `(Hold: ${defenseSuggestion.holdPercentage?.toFixed(1) ?? 'N/A'}%)`
                      );
                      balancedDefense[i] = defenseSuggestion;
                      for (const unitId of glDefenseUnits) {
                        usedCharacters.add(unitId);
                      }
                      usedLeaders.add(unusedGL);
                      usedGLsForPlacement.add(unusedGL);
                      glPlaced = true;
                      break;
                    } else {
                      // Restore existing defense if GL conflicts
                      for (const unitId of existingDefenseUnits) {
                        usedCharacters.add(unitId);
                      }
                      usedLeaders.add(existingDefense.squad.leader.baseId);
                    }
                  }
                }
              }
              
              if (glPlaced) break;
            }
          } else {
            logger.info(
              `Skipping defense replacement for unused GL ${unusedGL} - already have ${currentGLsOnDefense} GL(s) on defense ` +
              `(target: ${targetGLsOnDefense} for balanced strategy)`
            );
          }
        }
        
        // If STILL unused and not in defense suggestions, create a basic defense squad for this GL
        // But for balanced strategy, only if we're below target GLs on defense
        if (!glPlaced && !usedGLsForPlacement.has(unusedGL) && !usedLeaders.has(unusedGL) && userRoster) {
          // Recalculate GL counts
          const currentGLsOnDefense = balancedDefense.filter(d => 
            isGalacticLegend(d.squad.leader.baseId)
          ).length;
          
          // For balanced strategy, only create defense squad if we're below target
          const shouldCreateDefense = strategyPreference !== 'balanced' || 
            currentGLsOnDefense < targetGLsOnDefense;
          
          if (shouldCreateDefense) {
          // Get available non-GL characters that aren't already used
          const availableNonGLChars: string[] = [];
          for (const unit of userRoster.units || []) {
            if (unit.data.combat_type === 1 && 
                unit.data.rarity >= 7 && 
                !isGalacticLegend(unit.data.base_id) &&
                unit.data.base_id !== unusedGL &&
                !usedCharacters.has(unit.data.base_id)) {
              availableNonGLChars.push(unit.data.base_id);
            }
          }
          
          const squadSize = format === '3v3' ? 3 : 5;
          const membersNeeded = squadSize - 1;
          
          if (availableNonGLChars.length >= membersNeeded) {
            // Get defense stats for this GL
            const stats = await getDefenseStatsForSquad(unusedGL, seasonId, defenseClient, defenseSquadStatsCache, topDefenseSquadsCache);
            
            // Try to find recommended squad members from defense data
            let selectedMembers: string[] = [];
            let foundSquadFromData = false;
            
            // 1. First try to find this GL in defense suggestions (has best matching)
            const glDefenseSuggestion = sortedDefense.find(d => d.squad.leader.baseId === unusedGL);
            if (glDefenseSuggestion) {
              // Use the recommended members if they're available
              for (const member of glDefenseSuggestion.squad.members) {
                if (selectedMembers.length >= membersNeeded) break;
                if (!usedCharacters.has(member.baseId) && availableNonGLChars.includes(member.baseId)) {
                  selectedMembers.push(member.baseId);
                }
              }
              if (selectedMembers.length >= membersNeeded) {
                foundSquadFromData = true;
                logger.info(`Found squad composition for GL ${unusedGL} from defense suggestions`);
              }
            }
            
            // 2. If not found, search the top defense squads cache for this GL
            if (selectedMembers.length < membersNeeded && topDefenseSquadsCache) {
              // Try different cache keys that might contain this GL
              const cacheKeys = [
                seasonId ? `count_${seasonId}_${format}` : `count_unknown_${format}`,
                seasonId ? `percent_${seasonId}_${format}` : `percent_unknown_${format}`,
                seasonId ? `count_${seasonId}_unknown` : `count_unknown_unknown`,
                seasonId ? `percent_${seasonId}_unknown` : `percent_unknown_unknown`,
              ];
              
              for (const cacheKey of cacheKeys) {
                const cachedSquads = topDefenseSquadsCache.get(cacheKey);
                if (cachedSquads && Array.isArray(cachedSquads)) {
                  // Find squads with this GL as leader
                  const glSquads = cachedSquads.filter(s => s.leader?.baseId === unusedGL);
                  // Sort by seen count to get the most popular compositions
                  glSquads.sort((a, b) => (b.seenCount || 0) - (a.seenCount || 0));
                  
                  for (const squad of glSquads) {
                    if (!squad.members) continue;
                    for (const member of squad.members) {
                      if (selectedMembers.length >= membersNeeded) break;
                      if (!usedCharacters.has(member.baseId) && 
                          availableNonGLChars.includes(member.baseId) &&
                          !selectedMembers.includes(member.baseId)) {
                        selectedMembers.push(member.baseId);
                      }
                    }
                    if (selectedMembers.length >= membersNeeded) break;
                  }
                  
                  if (selectedMembers.length >= membersNeeded) {
                    foundSquadFromData = true;
                    logger.info(`Found squad composition for GL ${unusedGL} from top defense cache`);
                    break;
                  }
                }
              }
            }
            
            // 3. If we couldn't find real squad data, DON'T create a random squad
            // Only use data from swgoh.gg top squads - no made-up compositions
            if (selectedMembers.length < membersNeeded) {
              if (!foundSquadFromData) {
                logger.info(
                  `No squad composition data found on swgoh.gg for GL ${unusedGL} - ` +
                  `skipping defense placement (will not create fake squad)`
                );
                continue; // Skip this GL - don't create a random squad
              }
              // If we found partial data, still skip - we need a complete squad
              logger.info(
                `Incomplete squad data for GL ${unusedGL} (only ${selectedMembers.length}/${membersNeeded} members available) - ` +
                `skipping defense placement`
              );
              continue;
            }
            
            // Check if this squad conflicts with offense
            const glDefenseUnits = [unusedGL, ...selectedMembers];
            const hasConflict = glDefenseUnits.some(unitId => usedCharacters.has(unitId));
            
            if (!hasConflict && balancedDefense.length < maxDefenseSquads) {
              // Helper to get relic level from roster
              const getRelicFromRoster = (baseId: string): number | null => {
                const unit = userRoster?.units?.find(u => u.data.base_id === baseId);
                if (unit && unit.data.gear_level >= 13 && unit.data.relic_tier !== null && unit.data.relic_tier !== undefined) {
                  return Math.max(0, unit.data.relic_tier - 2);
                }
                return null;
              };
              
              // Create the defense squad with relic levels from roster
              const glDefenseSquad: UniqueDefensiveSquad = {
                leader: {
                  baseId: unusedGL,
                  relicLevel: getRelicFromRoster(unusedGL),
                  portraitUrl: null
                },
                members: selectedMembers.map(memberId => ({
                  baseId: memberId,
                  relicLevel: getRelicFromRoster(memberId),
                  portraitUrl: null
                }))
              };
              
              const leaderRelic = glDefenseSquad.leader.relicLevel;
              const memberRelics = glDefenseSquad.members.map(m => `${m.baseId}(R${m.relicLevel ?? '?'})`).join(', ');
              logger.info(
                `Creating defense squad for unused GL ${unusedGL}(R${leaderRelic ?? '?'}) on defense ` +
                `(Hold: ${stats.holdPercentage?.toFixed(1) ?? 'N/A'}%, Members: [${memberRelics}])`
              );
              
              balancedDefense.push({
                squad: glDefenseSquad,
                holdPercentage: stats.holdPercentage,
                seenCount: stats.seenCount,
                avgBanners: null,
                score: (stats.holdPercentage ?? 0) * 0.5 + (stats.seenCount ? Math.log10(stats.seenCount + 1) / Math.log10(100000 + 1) * 100 * 0.4 : 0) + 10 + 5, // Basic scoring
                reason: `Created for unused GL (Hold: ${stats.holdPercentage?.toFixed(1) ?? 'N/A'}%)`
              });
              
              for (const unitId of glDefenseUnits) {
                usedCharacters.add(unitId);
              }
              usedLeaders.add(unusedGL);
              usedGLsForPlacement.add(unusedGL);
              glPlaced = true;
            } else if (balancedDefense.length < maxDefenseSquads) {
              // Try to replace a non-GL defense with this GL
              for (let i = 0; i < balancedDefense.length; i++) {
                const existingDefense = balancedDefense[i];
                const existingIsGL = isGalacticLegend(existingDefense.squad.leader.baseId);
                
                if (!existingIsGL) {
                  const existingDefenseUnits = [
                    existingDefense.squad.leader.baseId,
                    ...existingDefense.squad.members.map(m => m.baseId)
                  ];
                  
                  // Remove existing defense
                  for (const unitId of existingDefenseUnits) {
                    usedCharacters.delete(unitId);
                  }
                  usedLeaders.delete(existingDefense.squad.leader.baseId);
                  
                  // Check if GL defense conflicts with offense
                  const glDefenseUnits = [unusedGL, ...selectedMembers];
                  const hasConflict = glDefenseUnits.some(unitId => usedCharacters.has(unitId));
                  
                  if (!hasConflict) {
                    // Helper to get relic level from roster
                    const getRelicFromRosterReplace = (baseId: string): number | null => {
                      const unit = userRoster?.units?.find(u => u.data.base_id === baseId);
                      if (unit && unit.data.gear_level >= 13 && unit.data.relic_tier !== null && unit.data.relic_tier !== undefined) {
                        return Math.max(0, unit.data.relic_tier - 2);
                      }
                      return null;
                    };
                    
                    const glDefenseSquad: UniqueDefensiveSquad = {
                      leader: {
                        baseId: unusedGL,
                        relicLevel: getRelicFromRosterReplace(unusedGL),
                        portraitUrl: null
                      },
                      members: selectedMembers.map(memberId => ({
                        baseId: memberId,
                        relicLevel: getRelicFromRosterReplace(memberId),
                        portraitUrl: null
                      }))
                    };
                    
                    const leaderRelicReplace = glDefenseSquad.leader.relicLevel;
                    const memberRelicsReplace = glDefenseSquad.members.map(m => `${m.baseId}(R${m.relicLevel ?? '?'})`).join(', ');
                    logger.info(
                      `Replacing non-GL defense ${existingDefense.squad.leader.baseId} with unused GL ${unusedGL}(R${leaderRelicReplace ?? '?'}) on defense ` +
                      `(Hold: ${stats.holdPercentage?.toFixed(1) ?? 'N/A'}%, Members: [${memberRelicsReplace}])`
                    );
                    
                    balancedDefense[i] = {
                      squad: glDefenseSquad,
                      holdPercentage: stats.holdPercentage,
                      seenCount: stats.seenCount,
                      avgBanners: null,
                      score: (stats.holdPercentage ?? 0) * 0.5 + (stats.seenCount ? Math.log10(stats.seenCount + 1) / Math.log10(100000 + 1) * 100 * 0.4 : 0) + 10 + 5,
                      reason: `Created for unused GL (Hold: ${stats.holdPercentage?.toFixed(1) ?? 'N/A'}%)`
                    };
                    
                    for (const unitId of glDefenseUnits) {
                      usedCharacters.add(unitId);
                    }
                    usedLeaders.add(unusedGL);
                    usedGLsForPlacement.add(unusedGL);
                    glPlaced = true;
                    break;
                  } else {
                    // Restore existing defense if GL conflicts
                    for (const unitId of existingDefenseUnits) {
                      usedCharacters.add(unitId);
                    }
                    usedLeaders.add(existingDefense.squad.leader.baseId);
                  }
                }
              }
            }
          }
        }
      }
      }
      }
    }
    
    // Post-processing: Replace low win rate counters (< 75%) with better alternatives, especially unused GLs
    // This ensures we use the best available counters, especially if GLs are available
    const MIN_WIN_RATE_THRESHOLD = 75;
    const lowWinRateCounters: Array<{ index: number; counter: MatchedCounterSquad; winRate: number }> = [];
    
    for (let i = 0; i < balancedOffense.length; i++) {
      const offenseCounter = balancedOffense[i];
      if (!offenseCounter.offense.leader.baseId) continue;
      
      const winRate = offenseCounter.adjustedWinPercentage ?? offenseCounter.winPercentage ?? 0;
      if (winRate < MIN_WIN_RATE_THRESHOLD) {
        lowWinRateCounters.push({ index: i, counter: offenseCounter, winRate });
      }
    }
    
    if (lowWinRateCounters.length > 0) {
      logger.info(
        `Found ${lowWinRateCounters.length} offense counter(s) with win rate < ${MIN_WIN_RATE_THRESHOLD}%: ` +
        lowWinRateCounters.map(c => `${c.counter.offense.leader.baseId} vs ${c.counter.defense.leader.baseId} (${c.winRate.toFixed(1)}%)`).join(', ')
      );
      
      // Re-check unused GLs after initial placement (they may have been placed above)
      const usedGLsAfterPlacement = new Set<string>();
      for (const offenseCounter of balancedOffense) {
        if (offenseCounter.offense.leader.baseId && isGalacticLegend(offenseCounter.offense.leader.baseId)) {
          usedGLsAfterPlacement.add(offenseCounter.offense.leader.baseId);
        }
      }
      for (const defenseSquad of balancedDefense) {
        if (isGalacticLegend(defenseSquad.squad.leader.baseId)) {
          usedGLsAfterPlacement.add(defenseSquad.squad.leader.baseId);
        }
      }
      
      const unusedGLsForReplacement = Array.from(allUserGLsForPlacement).filter(gl => !usedGLsAfterPlacement.has(gl));
      logger.info(
        `Unused GLs available for replacement: ${unusedGLsForReplacement.length > 0 ? unusedGLsForReplacement.join(', ') : 'none'}`
      );
      
      // Try to replace low win rate counters with better alternatives
      for (const lowWinCounter of lowWinRateCounters) {
        const opponentDefense = lowWinCounter.counter.defense.leader.baseId;
        const currentWinRate = lowWinCounter.winRate;
        
        // Look for better alternatives in the original counter's alternatives array
        const allAlternatives = [
          lowWinCounter.counter,
          ...(lowWinCounter.counter.alternatives || [])
        ];
        
        // Also check all offense counters for this opponent defense
        const allCountersForOpponent = offenseCounters.filter(c => c.defense.leader.baseId === opponentDefense);
        for (const altCounter of allCountersForOpponent) {
          if (!allAlternatives.some(a => a.offense.leader.baseId === altCounter.offense.leader.baseId)) {
            allAlternatives.push(altCounter);
          }
          if (altCounter.alternatives) {
            for (const alt of altCounter.alternatives) {
              if (!allAlternatives.some(a => a.offense.leader.baseId === alt.offense.leader.baseId)) {
                allAlternatives.push(alt);
              }
            }
          }
        }
        
        // Sort alternatives by win rate (descending), prioritizing GLs
        allAlternatives.sort((a, b) => {
          const aWinRate = a.adjustedWinPercentage ?? a.winPercentage ?? 0;
          const bWinRate = b.adjustedWinPercentage ?? b.winPercentage ?? 0;
          const aIsGL = a.offense.leader.baseId ? isGalacticLegend(a.offense.leader.baseId) : false;
          const bIsGL = b.offense.leader.baseId ? isGalacticLegend(b.offense.leader.baseId) : false;
          const aIsUnusedGL = aIsGL && unusedGLsForReplacement.includes(a.offense.leader.baseId);
          const bIsUnusedGL = bIsGL && unusedGLsForReplacement.includes(b.offense.leader.baseId);
          
          // Prioritize unused GLs
          if (aIsUnusedGL && !bIsUnusedGL) return -1;
          if (!aIsUnusedGL && bIsUnusedGL) return 1;
          
          // Then by win rate
          if (Math.abs(aWinRate - bWinRate) > 1) {
            return bWinRate - aWinRate;
          }
          
          return 0;
        });
        
        // Try to find a better alternative that doesn't conflict
        for (const betterAlternative of allAlternatives) {
          if (!betterAlternative.offense.leader.baseId) continue;
          
          const altWinRate = betterAlternative.adjustedWinPercentage ?? betterAlternative.winPercentage ?? 0;
          if (altWinRate <= currentWinRate) continue; // Not better
          
          const altOffenseUnits = [
            betterAlternative.offense.leader.baseId,
            ...betterAlternative.offense.members.map(m => m.baseId)
          ];
          
          // Check if this alternative conflicts
          const hasConflict = altOffenseUnits.some(unitId => usedCharacters.has(unitId));
          const leaderUsed = usedLeaders.has(betterAlternative.offense.leader.baseId);
          
          if (hasConflict || leaderUsed) {
            continue; // Skip - conflicts
          }
          
          // Found a better alternative! Replace the low win rate counter
          logger.info(
            `Replacing low win rate counter ${lowWinCounter.counter.offense.leader.baseId} vs ${opponentDefense} ` +
            `(${currentWinRate.toFixed(1)}%) with ${betterAlternative.offense.leader.baseId} ` +
            `(${altWinRate.toFixed(1)}%)${isGalacticLegend(betterAlternative.offense.leader.baseId) ? ' [GL]' : ''}`
          );
          
          // Remove old counter's characters from used sets
          const oldOffenseUnits = [
            lowWinCounter.counter.offense.leader.baseId,
            ...lowWinCounter.counter.offense.members.map(m => m.baseId)
          ];
          for (const unitId of oldOffenseUnits) {
            usedCharacters.delete(unitId);
          }
          usedLeaders.delete(lowWinCounter.counter.offense.leader.baseId);
          
          // Add new counter
          balancedOffense[lowWinCounter.index] = betterAlternative;
          
          // Mark new counter's characters as used
          for (const unitId of altOffenseUnits) {
            usedCharacters.add(unitId);
          }
          usedLeaders.add(betterAlternative.offense.leader.baseId);
          
          break; // Found replacement, move to next low win rate counter
        }
      }
    }
    
    // CRITICAL: If there are STILL unused GLs after low win rate replacement, 
    // force them onto offense by replacing the lowest priority non-GL counter
    // GLs are too valuable to leave unused - they should ALWAYS be deployed
    const usedGLsFinal = new Set<string>();
    for (const offenseCounter of balancedOffense) {
      if (offenseCounter.offense.leader.baseId && isGalacticLegend(offenseCounter.offense.leader.baseId)) {
        usedGLsFinal.add(offenseCounter.offense.leader.baseId);
      }
    }
    for (const defenseSquad of balancedDefense) {
      if (isGalacticLegend(defenseSquad.squad.leader.baseId)) {
        usedGLsFinal.add(defenseSquad.squad.leader.baseId);
      }
    }
    
    const stillUnusedGLs = Array.from(allUserGLsForPlacement).filter(gl => !usedGLsFinal.has(gl));
    if (stillUnusedGLs.length > 0) {
      logger.warn(
        `[CRITICAL] ${stillUnusedGLs.length} GL(s) are STILL unused after all placement attempts: ${stillUnusedGLs.join(', ')}. ` +
        `Forcing them onto offense by replacing lowest priority counters.`
      );
      
      // Helper to get relic level from roster
      const getRelicLevelForGL = (baseId: string): number | null => {
        const unit = userRoster?.units?.find(u => u.data.base_id === baseId);
        if (unit && unit.data.gear_level >= 13 && unit.data.relic_tier !== null && unit.data.relic_tier !== undefined) {
          return Math.max(0, unit.data.relic_tier - 2);
        }
        return null;
      };
      
      for (const unusedGL of stillUnusedGLs) {
        // Find the weakest non-GL counter to replace
        // Sort by win rate (lowest first) and prefer non-GL leaders
        const replaceableCandidates = balancedOffense
          .map((counter, index) => ({
            index,
            counter,
            winRate: counter.adjustedWinPercentage ?? counter.winPercentage ?? 0,
            isGL: isGalacticLegend(counter.offense.leader.baseId)
          }))
          .filter(c => !c.isGL) // Only replace non-GL counters
          .sort((a, b) => a.winRate - b.winRate); // Lowest win rate first (most replaceable)
        
        if (replaceableCandidates.length === 0) {
          logger.warn(`No non-GL counter available to replace for unused GL ${unusedGL}`);
          continue;
        }
        
        // Find available members for this GL (non-GL characters not used elsewhere)
        const availableMembers = userRoster?.units
          ?.filter(u => 
            u.data.combat_type === 1 &&
            u.data.rarity >= 7 &&
            u.data.base_id !== unusedGL &&
            !isGalacticLegend(u.data.base_id) &&
            !usedCharacters.has(u.data.base_id)
          )
          .sort((a, b) => (b.data.power || 0) - (a.data.power || 0)) // Sort by power (strongest first)
          .slice(0, format === '3v3' ? 2 : 4)
          .map(u => u.data.base_id) || [];
        
        const membersNeeded = format === '3v3' ? 2 : 4;
        if (availableMembers.length < membersNeeded) {
          logger.warn(
            `Not enough available members for GL ${unusedGL} (${availableMembers.length}/${membersNeeded})`
          );
          continue;
        }
        
        // Try to replace the weakest counter
        const candidate = replaceableCandidates[0];
        
        // Remove old counter's characters from used set
        const oldOffenseUnits = [
          candidate.counter.offense.leader.baseId,
          ...candidate.counter.offense.members.map(m => m.baseId)
        ];
        for (const unitId of oldOffenseUnits) {
          usedCharacters.delete(unitId);
        }
        usedLeaders.delete(candidate.counter.offense.leader.baseId);
        
        // Build the GL offense squad
        const glOffenseUnits = [unusedGL, ...availableMembers];
        
        // Check if new squad has conflicts (it shouldn't since we filtered available members)
        const hasConflict = glOffenseUnits.some(unitId => usedCharacters.has(unitId));
        
        if (!hasConflict) {
          // Replace the counter with the GL
          logger.info(
            `Forcing unused GL ${unusedGL} onto offense: replacing ${candidate.counter.offense.leader.baseId} vs ${candidate.counter.defense.leader.baseId} ` +
            `(${candidate.winRate.toFixed(1)}%) with ${unusedGL} + [${availableMembers.join(', ')}]`
          );
          
          const matchedCounter: MatchedCounterSquad = {
            offense: {
              leader: {
                baseId: unusedGL,
                relicLevel: getRelicLevelForGL(unusedGL),
                portraitUrl: null
              },
              members: availableMembers.map(memberId => ({
                baseId: memberId,
                relicLevel: getRelicLevelForGL(memberId),
                portraitUrl: null
              }))
            },
            defense: candidate.counter.defense,
            winPercentage: 85, // Assume good win rate for GL
            adjustedWinPercentage: 85,
            seenCount: null,
            avgBanners: null,
            relicDelta: null,
            worstCaseRelicDelta: null,
            bestCaseRelicDelta: null,
            keyMatchups: null
          };
          
          balancedOffense[candidate.index] = matchedCounter;
          
          // Mark new counter's characters as used
          for (const unitId of glOffenseUnits) {
            usedCharacters.add(unitId);
          }
          usedLeaders.add(unusedGL);
          usedGLsFinal.add(unusedGL);
        } else {
          // Restore old counter's characters if new one has conflicts
          for (const unitId of oldOffenseUnits) {
            usedCharacters.add(unitId);
          }
          usedLeaders.add(candidate.counter.offense.leader.baseId);
          
          logger.error(
            `[CRITICAL] Unable to place GL ${unusedGL} - character conflicts exist. ` +
            `This GL will be UNUSED which is a significant strategic disadvantage!`
          );
        }
      }
    }
    
    // Second pass: Add defense squads that don't conflict with offense
    // For offensive strategy, be lenient with conflicts - allow defense squads even if they share 1-2 characters with offense
    // For offensive strategy, allow GLs on defense ONLY if they weren't used on offense (remaining unused GLs)
    // Continue until we reach maxDefenseSquads or run out of suggestions
    for (const defenseSuggestion of sortedDefense) {
      if (balancedDefense.length >= maxDefenseSquads) {
        break; // Reached max defense squads
      }
      
      const defenseUnits = [
        defenseSuggestion.squad.leader.baseId,
        ...defenseSuggestion.squad.members.map(m => m.baseId)
      ];
      
      // For offensive strategy, check if this GL was already used on offense
      if (strategyPreference === 'offensive' && isGalacticLegend(defenseSuggestion.squad.leader.baseId)) {
        // Check if this GL leader was used in any offense counter
        const isGlUsedOnOffense = balancedOffense.some(counter => 
          counter.offense.leader.baseId === defenseSuggestion.squad.leader.baseId
        );
        if (isGlUsedOnOffense) {
          logger.debug(
            `Skipping GL defense squad ${defenseSuggestion.squad.leader.baseId} - already used on offense (offensive strategy)`
          );
          continue; // Skip - GL already used on offense
        } else {
          logger.debug(
            `Allowing GL defense squad ${defenseSuggestion.squad.leader.baseId} - not used on offense, placing on defense (offensive strategy)`
          );
        }
      }
      
      // Check if leader is already used (strict - no duplicate leaders)
      if (usedLeaders.has(defenseSuggestion.squad.leader.baseId)) {
        logger.debug(
          `Skipping defense squad ${defenseSuggestion.squad.leader.baseId} - leader already used`
        );
        continue; // Skip - leader already used
      }
      
      // Check for character conflicts with offense
      const conflictingUnits = defenseUnits.filter(unitId => usedCharacters.has(unitId));
      const conflictCount = conflictingUnits.length;
      const squadSize = defenseUnits.length;
      
      // For offensive strategy, be lenient: only skip if >= 50% of the squad conflicts
      // This allows defense squads even if they share 1-2 characters with offense
      if (conflictCount > 0) {
        const conflictRatio = conflictCount / squadSize;
        // Skip only if >= 50% of the squad conflicts AND we have other options
        if (conflictRatio >= 0.5 && sortedDefense.length - balancedDefense.length > (maxDefenseSquads - balancedDefense.length) * 2) {
          logger.debug(
            `Skipping defense squad ${defenseSuggestion.squad.leader.baseId} - ` +
            `${conflictCount}/${squadSize} character(s) already used in offense (${(conflictRatio * 100).toFixed(0)}%): ${conflictingUnits.join(', ')}`
          );
          continue; // Skip this defense squad - too many conflicts
        } else {
          // Allow this squad despite minor conflicts
          logger.debug(
            `Allowing defense squad ${defenseSuggestion.squad.leader.baseId} despite ` +
            `${conflictCount} minor character conflict(s) with offense: ${conflictingUnits.join(', ')}`
          );
        }
      }
      
      // Add this defense squad
      logger.debug(
        `Adding defense squad ${defenseSuggestion.squad.leader.baseId} ` +
        `(Hold: ${defenseSuggestion.holdPercentage?.toFixed(1) ?? 'N/A'}%, ` +
        `Score: ${defenseSuggestion.score.toFixed(1)}, ` +
        `Conflicts: ${conflictCount}/${squadSize})`
      );
      balancedDefense.push(defenseSuggestion);
      
      // Mark characters as used, but only mark non-conflicting ones if we're being lenient
      // This allows other defense squads to still be considered
      if (conflictCount > 0 && conflictCount < squadSize * 0.5) {
        // Only mark non-conflicting characters
        for (const unitId of defenseUnits) {
          if (!conflictingUnits.includes(unitId)) {
            usedCharacters.add(unitId);
          }
        }
      } else {
        // Mark all characters as used
        for (const unitId of defenseUnits) {
          usedCharacters.add(unitId);
        }
      }
      usedLeaders.add(defenseSuggestion.squad.leader.baseId);
    }
    
    // Log if we couldn't fill all defense slots
    if (balancedDefense.length < maxDefenseSquads) {
      const skippedCount = defenseSuggestions.length - balancedDefense.length;
      logger.warn(
        `Could only fill ${balancedDefense.length} of ${maxDefenseSquads} defense squad slots. ` +
        `Skipped ${skippedCount} defense suggestion(s) due to conflicts. ` +
        `Defense suggestions available: ${defenseSuggestions.length}, ` +
        `Offense counters: ${offenseCounters.filter(c => c.offense.leader.baseId).length}`
      );
      
      // Log which defense squads were skipped
      const placedLeaders = new Set(balancedDefense.map(d => d.squad.leader.baseId));
      const skippedDefense = defenseSuggestions.filter(d => !placedLeaders.has(d.squad.leader.baseId));
      if (skippedDefense.length > 0) {
        logger.info(
          `Skipped defense squads (${skippedDefense.length}): ` +
          skippedDefense.slice(0, 10).map(d => 
            `${d.squad.leader.baseId} (Hold: ${d.holdPercentage?.toFixed(1) ?? 'N/A'}%)`
          ).join(', ') +
          (skippedDefense.length > 10 ? ` ... and ${skippedDefense.length - 10} more` : '')
        );
      }
    } else {
      logger.info(
        `Successfully filled all ${maxDefenseSquads} defense squad slots`
      );
    }
    
    // Log data-driven decision summary
    // Count defense squads that are relatively good (>= 80% of best hold %)
    const defenseWithHighHold = balancedDefense.filter(d => {
      if (d.holdPercentage === null || bestHoldPercentage === null || bestHoldPercentage === 0) return false;
      const relativeScore = (d.holdPercentage / bestHoldPercentage) * 100;
      return relativeScore >= 80; // Top 20% relative to best
    }).length;
    
    // Count offense squads that are better on defense (using defense vs offense comparison)
    const offenseWithHighHold = balancedOffense.filter(c => {
      if (!c.offense.leader.baseId) return false;
      const defStats = offenseDefenseStats.get(c.offense.leader.baseId);
      return isBetterOnDefense(
        c.offense.leader.baseId,
        defStats?.holdPercentage ?? null,
        defStats?.seenCount ?? null,
        c.adjustedWinPercentage ?? c.winPercentage ?? null,
        c.seenCount ?? null,
        bestHoldPercentage,
        maxAllDefenseSeenCount, // Use actual max from SWGOH.GG data
        maxOffenseSeenCount     // Use actual max from SWGOH.GG data
      );
    }).length;
    
    logger.info(
      `Balanced offense and defense: ${balancedOffense.length} offense squad(s), ` +
      `${balancedDefense.length} defense squad(s), ${usedCharacters.size} unique character(s) used. ` +
      `Data-driven placement: ${defenseWithHighHold} defense squad(s) relatively good (>= 80% of best ${bestHoldPercentage?.toFixed(1) ?? 'N/A'}%), ` +
      `${offenseWithHighHold} offense squad(s) using leaders that are better on defense (defense viability > offense viability)`
    );
    
    // FINAL VALIDATION: Detect and resolve any character conflicts between offense and defense
    // This is a safety net to ensure GAC rules are followed (each character used only once)
    logger.info(`[SQUAD AUDIT] ===== FINAL VALIDATION & CONFLICT RESOLUTION =====`);
    
    // Build set of ALL offense characters (these take priority)
    const allOffenseCharacters = new Set<string>();
    for (const counter of balancedOffense) {
      if (counter.offense.leader.baseId) {
        allOffenseCharacters.add(counter.offense.leader.baseId);
        for (const member of counter.offense.members) {
          if (member.baseId) allOffenseCharacters.add(member.baseId);
        }
      }
    }
    
    // Remove any defense squads whose LEADERS conflict with offense characters
    // This can happen when a character is used as a leader on defense but also as a member on offense
    const defensesToRemove: number[] = [];
    for (let i = 0; i < balancedDefense.length; i++) {
      const def = balancedDefense[i];
      if (allOffenseCharacters.has(def.squad.leader.baseId)) {
        logger.warn(
          `[SQUAD AUDIT] Removing Defense ${i + 1} (${def.squad.leader.baseId}): ` +
          `leader is used in offense - entire squad removed`
        );
        defensesToRemove.push(i);
      }
    }
    
    // Remove conflicting defense squads (in reverse order to preserve indices)
    for (const idx of defensesToRemove.reverse()) {
      balancedDefense.splice(idx, 1);
    }
    
    if (defensesToRemove.length > 0) {
      logger.info(`[SQUAD AUDIT] Removed ${defensesToRemove.length} defense squad(s) due to leader conflicts`);
    }
    
    // Handle defense squads that have member conflicts with offense
    // Try to find alternative compositions from swgoh.gg before removing
    const memberConflictSquadsToRemove: number[] = [];
    const squadSize = format === '3v3' ? 3 : 5;
    const membersNeeded = squadSize - 1;
    
    // Build set of all used characters (offense + defense)
    const usedInDefense = new Set<string>();
    for (const d of balancedDefense) {
      usedInDefense.add(d.squad.leader.baseId);
      for (const m of d.squad.members) {
        if (m.baseId) usedInDefense.add(m.baseId);
      }
    }
    
    for (let i = 0; i < balancedDefense.length; i++) {
      const def = balancedDefense[i];
      const conflictingMembers = def.squad.members.filter(m => allOffenseCharacters.has(m.baseId));
      
      if (conflictingMembers.length > 0) {
        const leaderBaseId = def.squad.leader.baseId;
        const remainingMembers = def.squad.members.filter(m => !allOffenseCharacters.has(m.baseId));
        
        if (remainingMembers.length < membersNeeded) {
          // Not enough members - try to find an alternative composition from swgoh.gg
          logger.info(
            `[SQUAD AUDIT] Defense ${i + 1} (${leaderBaseId}): ` +
            `member(s) ${conflictingMembers.map(m => m.baseId).join(', ')} used in offense, ` +
            `searching for alternative composition...`
          );
          
          let foundAlternative = false;
          
          // Search the top defense squads cache for alternative compositions
          if (topDefenseSquadsCache) {
            const cacheKeys = [
              seasonId ? `count_${seasonId}_${format}` : `count_unknown_${format}`,
              seasonId ? `percent_${seasonId}_${format}` : `percent_unknown_${format}`,
              seasonId ? `count_${seasonId}_unknown` : `count_unknown_unknown`,
              seasonId ? `percent_${seasonId}_unknown` : `percent_unknown_unknown`,
            ];
            
            for (const cacheKey of cacheKeys) {
              if (foundAlternative) break;
              const cachedSquads = topDefenseSquadsCache.get(cacheKey);
              if (cachedSquads && Array.isArray(cachedSquads)) {
                // Find all squads with this leader
                const alternativeSquads = cachedSquads
                  .filter(s => s.leader?.baseId === leaderBaseId)
                  .sort((a, b) => (b.seenCount || 0) - (a.seenCount || 0));
                
                for (const altSquad of alternativeSquads) {
                  if (!altSquad.members) continue;
                  
                  // Check if this alternative has no conflicts
                  const altMembers: string[] = altSquad.members.map((m: { baseId: string }) => m.baseId);
                  const hasConflict = altMembers.some((m: string) => 
                    allOffenseCharacters.has(m) || usedInDefense.has(m)
                  );
                  
                  // Check if user has all these characters
                  const userHasAll = altMembers.every((m: string) => {
                    if (!userRoster) return false;
                    return userRoster.units?.some(u => u.data.base_id === m && u.data.rarity >= 7);
                  });
                  
                  if (!hasConflict && userHasAll && altMembers.length >= membersNeeded) {
                    // Found a valid alternative - use it
                    const getRelicFromRoster = (baseId: string): number | null => {
                      const unit = userRoster?.units?.find(u => u.data.base_id === baseId);
                      if (unit && unit.data.gear_level >= 13 && unit.data.relic_tier !== null && unit.data.relic_tier !== undefined) {
                        return Math.max(0, unit.data.relic_tier - 2);
                      }
                      return null;
                    };
                    
                    def.squad.members = altMembers.slice(0, membersNeeded).map((memberId: string) => ({
                      baseId: memberId,
                      relicLevel: getRelicFromRoster(memberId),
                      portraitUrl: null
                    }));
                    
                    // Update used characters
                    for (const m of def.squad.members) {
                      usedInDefense.add(m.baseId);
                    }
                    
                    // Update hold percentage if available
                    if (altSquad.holdPercentage !== null && altSquad.holdPercentage !== undefined) {
                      def.holdPercentage = altSquad.holdPercentage;
                    }
                    
                    logger.info(
                      `[SQUAD AUDIT] Found alternative composition for ${leaderBaseId}: ` +
                      `[${def.squad.members.map(m => m.baseId).join(', ')}] (Hold: ${altSquad.holdPercentage?.toFixed(0) ?? 'N/A'}%)`
                    );
                    foundAlternative = true;
                    break;
                  }
                }
              }
            }
          }
          
          if (!foundAlternative) {
            // No alternative found - remove this squad
            logger.warn(
              `[SQUAD AUDIT] Removing Defense ${i + 1} (${leaderBaseId}): ` +
              `no alternative composition found on swgoh.gg without conflicts`
            );
            memberConflictSquadsToRemove.push(i);
          }
        } else {
          // We have enough members, just remove the conflicting ones
          logger.info(
            `[SQUAD AUDIT] Trimming Defense ${i + 1} (${leaderBaseId}): ` +
            `removing ${conflictingMembers.map(m => m.baseId).join(', ')} (used in offense), ` +
            `keeping ${remainingMembers.map(m => m.baseId).join(', ')}`
          );
          def.squad.members = remainingMembers;
        }
      }
    }
    
    // Remove squads with member conflicts (in reverse order to preserve indices)
    for (const idx of memberConflictSquadsToRemove.reverse()) {
      balancedDefense.splice(idx, 1);
    }
    
    if (memberConflictSquadsToRemove.length > 0) {
      logger.info(`[SQUAD AUDIT] Removed ${memberConflictSquadsToRemove.length} defense squad(s) due to member conflicts (no alternatives found)`);
    }
    
    // COMPREHENSIVE LOGGING: Output full squad compositions for debugging
    logger.info(`[SQUAD AUDIT] ===== FINAL SQUAD COMPOSITIONS =====`);
    
    // Track all characters used in each role for conflict detection
    const offenseCharacters = new Set<string>();
    const defenseCharacters = new Set<string>();
    
    logger.info(`[SQUAD AUDIT] ----- OFFENSE SQUADS (${balancedOffense.length}) -----`);
    balancedOffense.forEach((counter, idx) => {
      const leader = counter.offense.leader.baseId;
      const members = counter.offense.members.map(m => m.baseId);
      const allChars = [leader, ...members].filter(Boolean);
      allChars.forEach(c => offenseCharacters.add(c));
      const vsDefense = counter.defense.leader.baseId;
      const winRate = counter.adjustedWinPercentage ?? counter.winPercentage;
      logger.info(
        `[SQUAD AUDIT] Offense ${idx + 1}: ${leader} + [${members.join(', ')}] vs ${vsDefense} (Win: ${winRate?.toFixed(0) ?? 'N/A'}%)`
      );
    });
    
    logger.info(`[SQUAD AUDIT] ----- DEFENSE SQUADS (${balancedDefense.length}) -----`);
    balancedDefense.forEach((def, idx) => {
      const leader = def.squad.leader.baseId;
      const members = def.squad.members.map(m => m.baseId);
      const allChars = [leader, ...members].filter(Boolean);
      allChars.forEach(c => defenseCharacters.add(c));
      logger.info(
        `[SQUAD AUDIT] Defense ${idx + 1}: ${leader} + [${members.join(', ')}] (Hold: ${def.holdPercentage?.toFixed(0) ?? 'N/A'}%)`
      );
    });
    
    // Check for character reuse between offense and defense (should be zero after fix)
    const reusedCharacters = [...offenseCharacters].filter(c => defenseCharacters.has(c));
    if (reusedCharacters.length > 0) {
      logger.error(
        `[SQUAD AUDIT] ❌ CRITICAL: ${reusedCharacters.length} character(s) STILL appear in BOTH offense AND defense: ` +
        reusedCharacters.join(', ')
      );
    } else {
      logger.info(`[SQUAD AUDIT] ✅ No character reuse between offense and defense`);
    }
    
    logger.info(`[SQUAD AUDIT] Total unique offense chars: ${offenseCharacters.size}, defense chars: ${defenseCharacters.size}`);
    logger.info(`[SQUAD AUDIT] ===== END SQUAD AUDIT =====`);
    
    return {
      balancedOffense,
      balancedDefense
    };
}
