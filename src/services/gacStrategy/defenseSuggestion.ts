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
      if (unit.data.combat_type === 1 && // Only characters
          unit.data.is_galactic_legend && 
          isGalacticLegend(unit.data.base_id)) {
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
    // Group by GL leader to ensure we get unique GL leaders, not just unique squad compositions
    const glCandidatesByLeader = new Map<string, typeof glCandidates>();
    for (const candidate of glCandidates) {
      const leaderId = candidate.squad.leader.baseId;
      if (!glCandidatesByLeader.has(leaderId)) {
        glCandidatesByLeader.set(leaderId, []);
      }
      glCandidatesByLeader.get(leaderId)!.push(candidate);
    }
    
    // Sort each leader's candidates by score, then get best candidate per leader
    const bestGlCandidatesPerLeader: typeof glCandidates = [];
    for (const [leaderId, leaderCandidates] of glCandidatesByLeader.entries()) {
      const bestCandidate = leaderCandidates.sort((a, b) => b.score - a.score)[0];
      bestGlCandidatesPerLeader.push(bestCandidate);
    }
    
    // Sort by score to prioritize best GLs first
    const sortedGlCandidates = bestGlCandidatesPerLeader.sort((a, b) => b.score - a.score);
    
    logger.info(
      `GL candidates: ${glCandidates.length} total, ${glCandidatesByLeader.size} unique GL leaders, ` +
      `selecting best candidate per leader`
    );
    
    for (const candidate of sortedGlCandidates) {
      if (glDefenseCount >= targetGLDefense) break;
      
      const allUnits = [candidate.squad.leader, ...candidate.squad.members];
      const allUnitIds = allUnits.map(u => u.baseId);
      
      // Calculate conflicts first (needed for both checking and later use)
      const characterConflicts = allUnitIds.filter(id => usedCharacters.has(id));
      const offenseConflicts = allUnitIds.filter(id => offenseUnits.has(id));
      
      // Check conflicts with detailed logging
      if (usedLeaders.has(candidate.squad.leader.baseId)) {
        glSkippedReasons.alreadyUsed++;
        logger.debug(`Skipping GL ${candidate.squad.leader.baseId} - leader already used`);
        continue;
      }
      
      // For defensive strategy, be more lenient about character conflicts
      // Only skip if there are MANY conflicts (>= 3 characters) - let balance logic handle minor conflicts
      if (characterConflicts.length > 0) {
        if (strategyPreference === 'defensive') {
          // For defensive strategy, only skip if 3+ characters conflict
          if (characterConflicts.length >= 3) {
            glSkippedReasons.characterConflict++;
            logger.debug(`Skipping GL ${candidate.squad.leader.baseId} - ${characterConflicts.length} character conflicts (>= 3): ${characterConflicts.join(', ')}`);
            continue;
          } else {
            // Allow GL squads with 1-2 character conflicts - balance logic will handle it
            logger.debug(`Allowing GL ${candidate.squad.leader.baseId} with ${characterConflicts.length} minor character conflict(s): ${characterConflicts.join(', ')}`);
          }
        } else {
          // For balanced/offensive, skip if any conflicts
          glSkippedReasons.characterConflict++;
          logger.debug(`Skipping GL ${candidate.squad.leader.baseId} - character conflicts: ${characterConflicts.join(', ')}`);
          continue;
        }
      }
      
      // Check offense conflicts - be lenient for defensive strategy
      if (offenseConflicts.length > 0) {
        if (strategyPreference === 'defensive') {
          // For defensive strategy, only skip if 3+ characters conflict with offense
          if (offenseConflicts.length >= 3) {
            glSkippedReasons.offenseConflict++;
            logger.debug(`Skipping GL ${candidate.squad.leader.baseId} - ${offenseConflicts.length} offense conflicts (>= 3): ${offenseConflicts.join(', ')}`);
            continue;
          } else {
            // Allow GL squads with 1-2 offense conflicts - balance logic will handle it
            logger.debug(`Allowing GL ${candidate.squad.leader.baseId} with ${offenseConflicts.length} minor offense conflict(s): ${offenseConflicts.join(', ')}`);
          }
        } else {
          // For balanced/offensive, skip if any conflicts
          glSkippedReasons.offenseConflict++;
          logger.debug(`Skipping GL ${candidate.squad.leader.baseId} - offense conflicts: ${offenseConflicts.join(', ')}`);
          continue;
        }
      }
      
      // Check if user actually has this GL (from FULL roster)
      if (!userGLs.has(candidate.squad.leader.baseId)) {
        glSkippedReasons.notInUserRoster++;
        logger.debug(`Skipping GL ${candidate.squad.leader.baseId} - not in user's roster`);
        continue;
      }
      
      // Add this GL squad
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
      
      usedLeaders.add(candidate.squad.leader.baseId);
      // For defensive strategy, be very lenient with character tracking
      // Don't mark characters as used if we're trying to get all GLs on defense
      // This allows multiple GL squads even if they share some characters
      if (strategyPreference === 'defensive') {
        // For defensive strategy, only mark the leader as used
        // Don't mark members as used - this allows GL squads to share members
        // The balance logic will handle final conflict resolution
        usedCharacters.add(candidate.squad.leader.baseId);
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
      
      logger.info(
        `Added GL squad ${candidate.squad.leader.baseId} (${glDefenseCount}/${targetGLDefense}) ` +
        `- Hold: ${candidate.holdPercentage?.toFixed(1) ?? 'N/A'}%, Score: ${candidate.score.toFixed(1)}`
      );
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
