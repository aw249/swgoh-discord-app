/**
 * Suggest defense squads based on top defense squads from swgoh.gg
 */
import { SwgohGgFullPlayerResponse } from '../../integrations/swgohGgApi';
import { UniqueDefensiveSquad } from '../../types/gacStrategyTypes';
import { logger } from '../../utils/logger';
import { isGalacticLegend } from '../../config/gacConstants';
import { evaluateRosterForDefense } from './defenseEvaluation';

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

export async function suggestDefenseSquads(
  userRoster: SwgohGgFullPlayerResponse,
  maxDefenseSquads: number,
  seasonId: string | undefined,
  format: string,
  offenseSquads: UniqueDefensiveSquad[] | undefined,
  defenseCandidates: Array<{
    squad: UniqueDefensiveSquad;
    holdPercentage: number | null;
    seenCount: number | null;
    avgBanners: number | null;
    score: number;
    isGL: boolean;
    reason: string;
  }> | undefined,
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
  reason: string;
}>> {
    // If candidates provided, use them; otherwise evaluate roster
    let candidates: Array<{
      squad: UniqueDefensiveSquad;
      holdPercentage: number | null;
      seenCount: number | null;
      avgBanners: number | null;
      score: number;
      isGL: boolean;
      reason: string;
    }>;
    
    if (defenseCandidates && defenseCandidates.length > 0) {
      candidates = defenseCandidates;
      logger.info(`Using ${candidates.length} pre-evaluated defense candidate(s)`);
    } else {
      // Fallback: evaluate roster if no candidates provided
      candidates = await evaluateRosterForDefense(userRoster, seasonId, format, strategyPreference, defenseClient, defenseSquadStatsCache, topDefenseSquadsCache);
    }

    // Create a set of units already used in offense squads
    const offenseUnits = new Set<string>();
    if (offenseSquads) {
      for (const squad of offenseSquads) {
        offenseUnits.add(squad.leader.baseId);
        for (const member of squad.members) {
          offenseUnits.add(member.baseId);
        }
      }
    }

    // Count user's GLs from FULL roster (not just top 80)
    // For defensive strategy, we want all GLs available, not just those in top 80 by GP
    const userGLs = new Set<string>();
    for (const unit of userRoster.units || []) {
      // Use our authoritative GL list OR the API flag
      if (unit.data.combat_type === 1 && // Only characters
          (isGalacticLegend(unit.data.base_id) || unit.data.is_galactic_legend)) {
        userGLs.add(unit.data.base_id);
      }
    }

    logger.info(
      `User has ${userGLs.size} GL(s) total: ${Array.from(userGLs).join(', ')}`
    );

    // Track which leaders we've already added (GAC rule: one squad per leader)
    const usedLeaders = new Set<string>();
    // Track which characters we've already used (GAC rule: each character can only be used once)
    const usedCharacters = new Set<string>();

    const suggestedSquads: Array<{
      squad: UniqueDefensiveSquad;
      holdPercentage: number | null;
      seenCount: number | null;
      avgBanners: number | null;
      score: number;
      reason: string;
    }> = [];

    // First pass: Select GL squads if user has GLs
    // Strategy preference affects GL targeting on defense
    let targetGLDefense: number;
    if (strategyPreference === 'defensive') {
      // Defensive: Use ALL GLs on defense (they're the strongest squads)
      // Target all available GLs, but cap at maxDefenseSquads
      targetGLDefense = Math.min(userGLs.size, maxDefenseSquads);
    } else if (strategyPreference === 'offensive') {
      // Offensive: Prioritize GLs on offense, but allow remaining unused GLs on defense
      // We'll determine how many GLs are actually used on offense during balancing
      // For now, set a low target (will be adjusted based on actual offense usage)
      targetGLDefense = 0; // Start with 0, but allow unused GLs to be placed on defense
    } else {
      // Balanced: Current behavior (30-40% of defense slots)
      targetGLDefense = userGLs.size > 0 ? Math.max(1, Math.floor(maxDefenseSquads * 0.35)) : 0;
    }
    
    let glDefenseCount = 0;
    
    logger.info(
      `Strategy: ${strategyPreference}, User has ${userGLs.size} GL(s), ` +
      `targeting ${targetGLDefense} GL squad(s) for defense (${maxDefenseSquads} total defense slots)`
    );
    
    const glCandidates = candidates.filter(c => c.isGL);
    const nonGlCandidates = candidates.filter(c => !c.isGL);
    
    // For defensive strategy, ensure ALL user GLs are in candidates
    // If a GL is missing from candidates, create a basic squad entry for it
    if (strategyPreference === 'defensive') {
      for (const glId of userGLs) {
        const hasGlCandidate = glCandidates.some(c => c.squad.leader.baseId === glId);
        if (!hasGlCandidate) {
          // GL is missing from candidates - check if user has this GL
          const glUnit = userRoster.units?.find(u => u.data.base_id === glId);
          if (glUnit && glUnit.data.combat_type === 1) {
            // Create a basic GL squad entry (will need members, but this ensures GL is considered)
            logger.info(
              `GL ${glId} not found in candidates - will attempt to create squad from roster`
            );
            // Note: This GL will be picked up by generateDefenseSquadsFromRoster if it runs
            // For now, we'll rely on that mechanism
          }
        }
      }
    }
    
    logger.info(
      `GL selection pass: ${glCandidates.length} GL candidate(s) available, ${nonGlCandidates.length} non-GL candidate(s) available, ` +
      `targeting ${targetGLDefense} GL squad(s), user has ${userGLs.size} GL(s) total`
    );
    
    let glSkippedReasons = {
      alreadyUsed: 0,
      characterConflict: 0,
      offenseConflict: 0,
      notInUserRoster: 0,
      other: 0
    };
    
    // Sort GL candidates by score to prioritize best GLs first
    // Group by GL leader to enable trying alternative compositions when best has conflicts
    const glCandidatesByLeader = new Map<string, typeof glCandidates>();
    for (const candidate of glCandidates) {
      const leaderId = candidate.squad.leader.baseId;
      if (!glCandidatesByLeader.has(leaderId)) {
        glCandidatesByLeader.set(leaderId, []);
      }
      glCandidatesByLeader.get(leaderId)!.push(candidate);
    }
    
    // Sort each leader's candidates by score (best first)
    for (const [leaderId, leaderCandidates] of glCandidatesByLeader.entries()) {
      leaderCandidates.sort((a, b) => b.score - a.score);
    }
    
    // Get leaders sorted by their best candidate's score
    const sortedGlLeaders = Array.from(glCandidatesByLeader.entries())
      .map(([leaderId, candidates]) => ({ leaderId, candidates, bestScore: candidates[0]?.score ?? 0 }))
      .sort((a, b) => b.bestScore - a.bestScore);
    
    logger.info(
      `GL candidates: ${glCandidates.length} total compositions, ${glCandidatesByLeader.size} unique GL leaders, ` +
      `will try alternative compositions if best has conflicts`
    );
    
    // For each GL leader, try each composition until we find one without conflicts
    for (const { leaderId, candidates } of sortedGlLeaders) {
      if (glDefenseCount >= targetGLDefense) break;
      if (usedLeaders.has(leaderId)) {
        glSkippedReasons.alreadyUsed++;
        continue;
      }
      if (!userGLs.has(leaderId)) {
        glSkippedReasons.notInUserRoster++;
        continue;
      }
      
      let foundValidComposition = false;
      
      // Try each composition for this leader until we find one that works
      for (const candidate of candidates) {
        const allUnits = [candidate.squad.leader, ...candidate.squad.members];
        const allUnitIds = allUnits.map(u => u.baseId);
        
        // Calculate conflicts
        const characterConflicts = allUnitIds.filter(id => usedCharacters.has(id));
        const offenseConflicts = allUnitIds.filter(id => offenseUnits.has(id));
        
        // Check if this composition has too many conflicts
        const hasCharConflict = characterConflicts.length > 0;
        const hasOffenseConflict = offenseConflicts.length > 0;
        
        // For defensive strategy, be more lenient about conflicts
        let shouldSkip = false;
        if (strategyPreference === 'defensive') {
          // Skip if 3+ characters conflict
          if (characterConflicts.length >= 3 || offenseConflicts.length >= 3) {
            shouldSkip = true;
          }
        } else {
          // For balanced/offensive, skip if any conflicts
          if (hasCharConflict || hasOffenseConflict) {
            shouldSkip = true;
          }
        }
        
        if (shouldSkip) {
          // Try next composition for this leader
          logger.debug(
            `GL ${leaderId} composition [${candidate.squad.members.map(m => m.baseId).join(', ')}] has conflicts - trying alternative`
          );
          continue;
        }
        
        // Found a valid composition!
        const hasMinorConflicts = (characterConflicts.length > 0 && characterConflicts.length < 3) || 
                                  (offenseConflicts.length > 0 && offenseConflicts.length < 3);
      
      suggestedSquads.push({
        squad: candidate.squad,
        holdPercentage: candidate.holdPercentage,
        seenCount: candidate.seenCount,
        avgBanners: candidate.avgBanners,
        score: candidate.score,
        reason: hasMinorConflicts 
          ? `${candidate.reason} (GL, ${characterConflicts.length} char conflict(s), ${offenseConflicts.length} offense conflict(s) - balance logic will filter)`
          : candidate.reason + ' (GL)'
      });
        usedLeaders.add(leaderId);
        
        // Mark characters as used
        usedCharacters.add(candidate.squad.leader.baseId);
        if (strategyPreference === 'defensive') {
          // Only mark non-conflicting members if there are no conflicts at all
          if (characterConflicts.length === 0 && offenseConflicts.length === 0) {
            for (const id of allUnitIds) {
              if (id !== candidate.squad.leader.baseId) {
                usedCharacters.add(id);
              }
            }
          }
        } else if (hasMinorConflicts) {
          // For balanced/offensive with minor conflicts, only mark non-conflicting characters
          for (const id of allUnitIds) {
            if (!characterConflicts.includes(id) && !offenseConflicts.includes(id)) {
              usedCharacters.add(id);
            }
          }
        } else {
          // Mark all characters as used (normal behavior for balanced/offensive)
          for (const id of allUnitIds) {
            usedCharacters.add(id);
          }
        }
        glDefenseCount++;
        foundValidComposition = true;
        
        logger.info(
          `Added GL squad ${leaderId} with [${candidate.squad.members.map(m => m.baseId).join(', ')}] ` +
          `(${glDefenseCount}/${targetGLDefense}) - Hold: ${candidate.holdPercentage?.toFixed(1) ?? 'N/A'}%`
        );
        break; // Found valid composition for this leader, move to next leader
      }
      
      if (!foundValidComposition) {
        glSkippedReasons.characterConflict++;
        logger.debug(`GL ${leaderId} - no valid composition found (all have conflicts)`);
      }
    }
    
    logger.info(
      `GL selection complete: ${glDefenseCount} selected, skipped: ` +
      `${glSkippedReasons.alreadyUsed} already used, ${glSkippedReasons.characterConflict} character conflict, ` +
      `${glSkippedReasons.offenseConflict} offense conflict, ${glSkippedReasons.notInUserRoster} not in roster`
    );

    // Second pass: Fill remaining slots with best available squads
    // Continue until we reach maxDefenseSquads (which may be 2x the actual max to account for filtering)
    // Note: We filter out offense conflicts here, but the balance logic will do final filtering
    const remainingNeeded = maxDefenseSquads - suggestedSquads.length;
    const hasLimitedCandidates = candidates.length <= maxDefenseSquads * 2;
    
    const nonGlCandidatesInSecondPass = candidates.filter(c => !c.isGL && !suggestedSquads.some(d => d.squad.leader.baseId === c.squad.leader.baseId));
    logger.info(
      `Second pass: ${candidates.length} total candidates (${nonGlCandidatesInSecondPass.length} non-GL available), ${suggestedSquads.length} already selected, ` +
      `need ${remainingNeeded} more, hasLimitedCandidates: ${hasLimitedCandidates}`
    );
    
    let secondPassSkipped = {
      alreadySelected: 0,
      leaderConflict: 0,
      defenseConflict: 0,
      offenseConflict: 0,
      other: 0
    };
    
    for (const candidate of candidates) {
      if (suggestedSquads.length >= maxDefenseSquads) break;
      
      // Check if this leader is already in suggested squads
      const leaderAlreadySelected = suggestedSquads.some(d => d.squad.leader.baseId === candidate.squad.leader.baseId);
      if (leaderAlreadySelected) {
        secondPassSkipped.alreadySelected++;
        logger.debug(
          `Skipping ${candidate.squad.leader.baseId} in second pass - leader already selected in first pass`
        );
        continue;
      }
      
      const allUnits = [candidate.squad.leader, ...candidate.squad.members];
      const allUnitIds = allUnits.map(u => u.baseId);
      
      // Check conflicts within defense (leader and character reuse)
      // Be more lenient if we have limited candidates - let balance logic handle conflicts
      if (usedLeaders.has(candidate.squad.leader.baseId)) {
        secondPassSkipped.leaderConflict++;
        logger.debug(
          `Skipping ${candidate.squad.leader.baseId} in second pass - leader already used in first pass`
        );
        continue;
      }
      
      // If we have limited candidates, be more lenient about character conflicts within defense
      // Only skip if we have plenty of other options
      const defenseConflicts = allUnitIds.filter(id => usedCharacters.has(id));
      
      // For defensive strategy, be less strict about conflicts
      if (strategyPreference === 'defensive') {
        // For defensive strategy, only skip if there are MANY conflicts (>= 3 characters)
        // and we have plenty of other options
        if (defenseConflicts.length >= 3 && candidates.length - suggestedSquads.length > remainingNeeded * 3) {
          secondPassSkipped.defenseConflict++;
          logger.debug(
            `Skipping ${candidate.squad.leader.baseId} - ${defenseConflicts.length} defense conflicts, ` +
            `but have ${candidates.length - suggestedSquads.length} remaining candidates`
          );
          continue;
        }
      } else {
        // Original logic for balanced/offensive
        if (defenseConflicts.length > 0 && !hasLimitedCandidates && candidates.length - suggestedSquads.length > remainingNeeded * 2) {
          secondPassSkipped.defenseConflict++;
          continue; // Skip if we have plenty of other options
        }
      }
      
      // Check conflicts with offense - but be less strict here
      // If we have many conflicts, we'll still include the squad and let balance logic decide
      const offenseConflicts = allUnitIds.filter(id => offenseUnits.has(id));
      const hasOffenseConflicts = offenseConflicts.length > 0;
      
      // Only skip if there are many conflicts AND we have plenty of other options
      // For defensive strategy, be even more lenient
      const offenseConflictThreshold = strategyPreference === 'defensive' ? 4 : 3;
      if (hasOffenseConflicts && offenseConflicts.length >= offenseConflictThreshold && !hasLimitedCandidates && candidates.length - suggestedSquads.length > remainingNeeded * 2) {
        secondPassSkipped.offenseConflict++;
        logger.debug(
          `Skipping defense squad ${candidate.squad.leader.baseId} - ${offenseConflicts.length} character(s) conflict with offense (${offenseConflicts.join(', ')})`
        );
        continue;
      }
      
      suggestedSquads.push({
        squad: candidate.squad,
        holdPercentage: candidate.holdPercentage,
        seenCount: candidate.seenCount,
        avgBanners: candidate.avgBanners,
        score: candidate.score,
        reason: hasOffenseConflicts || defenseConflicts.length > 0
          ? `${candidate.reason} (${offenseConflicts.length} offense conflict(s), ${defenseConflicts.length} defense conflict(s) - balance logic will filter)`
          : candidate.reason
      });
      
      usedLeaders.add(candidate.squad.leader.baseId);
      // Only add to usedCharacters if we're not being lenient (to avoid blocking too many future squads)
      if (!hasLimitedCandidates || defenseConflicts.length === 0) {
      for (const id of allUnitIds) {
        usedCharacters.add(id);
        }
      }
    }
    
    logger.info(
      `Second pass complete: ${suggestedSquads.length} total, skipped: ` +
      `${secondPassSkipped.alreadySelected} already selected, ${secondPassSkipped.leaderConflict} leader conflict, ` +
      `${secondPassSkipped.defenseConflict} defense conflict, ${secondPassSkipped.offenseConflict} offense conflict`
    );
    
    // If we still don't have enough suggestions, be more aggressive
    // This can happen if there are many character conflicts with offense
    if (suggestedSquads.length < maxDefenseSquads && candidates.length > suggestedSquads.length) {
      logger.info(
        `Only found ${suggestedSquads.length} defense squad(s) without major conflicts, but need ${maxDefenseSquads}. ` +
        `Will attempt to find more from ${candidates.length} total candidates (balance logic will handle final filtering).`
      );
      
      // Reset usedCharacters for this pass (but keep usedLeaders to avoid duplicate leaders)
      const usedCharactersInDefense = new Set<string>();
      for (const squad of suggestedSquads) {
        usedCharactersInDefense.add(squad.squad.leader.baseId);
        for (const member of squad.squad.members) {
          usedCharactersInDefense.add(member.baseId);
        }
      }
      
      let thirdPassAdded = 0;
      // Try to find more squads, only checking for conflicts within defense
      // Let balance logic handle offense conflicts
      for (const candidate of candidates) {
        if (suggestedSquads.length >= maxDefenseSquads) break;
        if (suggestedSquads.some(d => d.squad.leader.baseId === candidate.squad.leader.baseId)) continue;
        
        const allUnits = [candidate.squad.leader, ...candidate.squad.members];
        const allUnitIds = allUnits.map(u => u.baseId);
        
        // Only check for leader conflicts and character conflicts within defense
        // Don't check offense conflicts here - let balance logic handle that
        if (usedLeaders.has(candidate.squad.leader.baseId)) continue;
        if (allUnitIds.some(id => usedCharactersInDefense.has(id))) continue;
        
        suggestedSquads.push({
          squad: candidate.squad,
          holdPercentage: candidate.holdPercentage,
          seenCount: candidate.seenCount,
          avgBanners: candidate.avgBanners,
          score: candidate.score,
          reason: candidate.reason + ' (balance logic will check offense conflicts)'
        });
        
        usedLeaders.add(candidate.squad.leader.baseId);
        for (const id of allUnitIds) {
          usedCharactersInDefense.add(id);
        }
        thirdPassAdded++;
      }
      
      logger.info(
        `Third pass complete: Added ${thirdPassAdded} more squad(s), total: ${suggestedSquads.length}`
      );
    }

    // Sort by score (highest first) - already sorted as we go, but ensure final sort
    suggestedSquads.sort((a, b) => b.score - a.score);
    
    const glCount = suggestedSquads.filter(s => isGalacticLegend(s.squad.leader.baseId)).length;
    logger.info(
      `Defense squad suggestion complete: ${suggestedSquads.length} squad(s) suggested ` +
      `(${usedLeaders.size} unique leaders, ${usedCharacters.size} unique characters used, ${glCount} GL squad(s))`
    );
    
    return suggestedSquads;
}
