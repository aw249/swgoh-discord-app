/**
 * Logic for matching counter squads against user roster with relic delta calculations
 */
import { GacDefensiveSquad, GacCounterSquad } from '../../../types/swgohGgTypes';
import { UniqueDefensiveSquad, MatchedCounterSquad } from '../../../types/gacStrategyTypes';
import { SwgohGgFullPlayerResponse } from '../../../integrations/swgohGgApi';
import {
  calculateSquadRelicDelta,
  calculateWorstCaseRelicDelta,
  calculateBestCaseRelicDelta,
  calculateKeyMatchups,
  transformWinRateForRelicDelta
} from '../../../utils/relicDeltaService';
import { logger } from '../../../utils/logger';
import { isGalacticLegend } from '../../../config/gacConstants';
import { getTop80CharactersRoster } from '../utils/rosterUtils';
import { getAllUnitIds } from "../utils/squadUtils";;

interface CounterClient {
  getCounterSquads(defensiveLeaderBaseId: string, seasonId?: string): Promise<GacCounterSquad[]>;
}

export async function matchCountersAgainstRoster(
  counterClient: CounterClient,
  
    defensiveSquads: UniqueDefensiveSquad[],
    userRoster: SwgohGgFullPlayerResponse,
    seasonId?: string,
    format: string = '5v5',
    strategyPreference: 'defensive' | 'balanced' | 'offensive' = 'balanced'
  ): Promise<MatchedCounterSquad[]> {
    if (!counterClient) {
      logger.warn('Counter client not available, cannot match counters');
      return [];
    }

    // Use full roster for counter matching - we want to find counters from all available characters
    // This ensures we can find counters even if they use characters outside the top 80 by GP
    const filteredRoster = userRoster;
    logger.info(
      `Using full roster for counter matching: ${filteredRoster.units?.filter(u => u.data.combat_type === 1).length || 0} characters ` +
      `(from ${userRoster.units?.length || 0} total units)`
    );

    // Create a map of unit base IDs to their relic levels from the user's roster
    // Relic level calculation: if gear_level >= 13 and relic_tier exists, then relic_level = relic_tier - 2
    // Note: If gear_level <= 12, relic_tier may still be 1, but the unit is not reliced
    const userUnitMap = new Map<string, number | null>();
    for (const unit of filteredRoster.units || []) {
      // Only include units that are at least 7 stars (rarity >= 7)
      if (unit.data.rarity >= 7) {
        let relicLevel: number | null = null;
        // Only calculate relic level if gear_level is 13 or higher (unit is reliced)
        // If gear_level <= 12, even if relic_tier exists (often equals 1), the unit is not reliced
        if (unit.data.gear_level >= 13 && unit.data.relic_tier !== null && unit.data.relic_tier !== undefined) {
          // Actual relic level is relic_tier - 2
          relicLevel = Math.max(0, unit.data.relic_tier - 2);
        }
        userUnitMap.set(unit.data.base_id, relicLevel);
      }
    }

    const matchedCounters: MatchedCounterSquad[] = [];
    const usedOffenseSquads = new Set<string>(); // Track used offense squads by leader base ID
    // NOTE: usedCharacters tracks USER's characters that have been used in previous offense counters
    // This prevents reusing the same USER character in multiple offense counters
    // OPPONENT characters (defensiveSquad.leader.baseId) should NEVER be added to this set
    const usedCharacters = new Set<string>(); // Track all used USER characters (leader + members) to prevent duplicates

    // Determine expected counter squad size based on format
    const expectedCounterSize = format === '3v3' ? 3 : 5;

    logger.info(`Starting counter matching for ${defensiveSquads.length} defensive squad(s) (format: ${format})`);

    for (const defensiveSquad of defensiveSquads) {
      try {
        // Get counter squads for this defensive squad leader
        const counterSquads = await counterClient.getCounterSquads(
          defensiveSquad.leader.baseId,
          seasonId
        );

        // Filter counter squads by format (3v3 = 3 units, 5v5 = 5 units)
        const filteredCounterSquads = counterSquads.filter(counter => {
          const allUnits = [counter.leader, ...counter.members];
          return allUnits.length === expectedCounterSize;
        });

        // Add logging to debug format filtering
        if (filteredCounterSquads.length === 0 && counterSquads.length > 0) {
          logger.warn(
            `No ${format} format counters found for ${defensiveSquad.leader.baseId}. ` +
            `Found ${counterSquads.length} total counter(s), but none match ${expectedCounterSize} units. ` +
            `Sample sizes: ${counterSquads.slice(0, 5).map(c => [c.leader, ...c.members].length).join(', ')} ` +
            `(seasonId: ${seasonId || 'none'})`
          );
        } else if (filteredCounterSquads.length > 0) {
          logger.info(
            `Filtered ${counterSquads.length} counter(s) to ${filteredCounterSquads.length} ${format} format counter(s) for ${defensiveSquad.leader.baseId}`
          );
        }

        // Find the best matching counter that:
        // 1. User has all units in their roster
        // 2. Hasn't been used yet (leader not in usedOffenseSquads)
        // 3. No characters have been used in previous counters (GAC rule: each character can only be used once per round)
        // 4. Prioritizes non-GL counters over GL counters (to conserve GLs for defense)
        // 5. Considers both win percentage and relic delta advantage
        
        // Evaluate ALL counters together (GL + non-GL) based on viability
        // We'll score them all based on seen count + win % + relic level, then apply non-GL bonus as modifier
        const allAvailableCounters: GacCounterSquad[] = [];

        for (const counter of filteredCounterSquads) {
          // Check if this counter squad has already been used
          if (usedOffenseSquads.has(counter.leader.baseId)) {
            continue;
          }

          // Check if user has all units in this counter squad
          const allUnits = [counter.leader, ...counter.members];
          const hasAllUnits = allUnits.every(unit => userUnitMap.has(unit.baseId));

          if (!hasAllUnits) {
            continue;
          }

          // Check relic levels - filter out counters where user's units are too weak
          // For defensive strategy, be more lenient since we want to find more counters
          const offenseRelics = allUnits.map(unit => userUnitMap.get(unit.baseId) ?? null);
          const defenseRelics = [
            defensiveSquad.leader.relicLevel,
            ...defensiveSquad.members.map(m => m.relicLevel)
          ];
          
          // Check if any offense unit is G12 or lower (relic null) while defense has high relics
          // For defensive strategy, only filter out if defense is R7+ and offense is G12 (more lenient)
          // For balanced/offensive, filter out if defense is R5+ and offense is G12 (stricter)
          const hasInsufficientRelics = offenseRelics.some((offRelic, idx) => {
            const defRelic = defenseRelics[idx];
            if (offRelic === null && defRelic !== null) {
              if (strategyPreference === 'defensive') {
                // For defensive strategy, only filter if defense is R7+ (very high)
                return defRelic >= 7;
              } else {
                // For balanced/offensive, filter if defense is R5+ (moderate)
                return defRelic >= 5;
              }
            }
            return false;
          });
          
          if (hasInsufficientRelics) {
            const maxDefRelic = Math.max(...defenseRelics.filter(r => r !== null) as number[]);
            logger.debug(
              `Skipping counter ${counter.leader.baseId} - insufficient relic levels (G12 vs R${maxDefRelic})`
            );
            continue;
          }

          // Check if any character in this counter has already been used
          // NOTE: usedCharacters only tracks USER's characters, not opponent's characters
          // The opponent's defense leader (defensiveSquad.leader.baseId) should NOT be in usedCharacters
          const allUnitIds = allUnits.map(unit => unit.baseId);
          const conflictingUserChars = allUnitIds.filter(unitId => usedCharacters.has(unitId));
          const hasUsedCharacters = conflictingUserChars.length > 0;
          
          if (hasUsedCharacters) {
            logger.debug(
              `Counter ${counter.leader.baseId} vs opponent ${defensiveSquad.leader.baseId}: ` +
              `User characters already used: ${conflictingUserChars.join(', ')} (from ${allUnitIds.join(', ')})`
            );
          }
          
          if (hasUsedCharacters) {
            continue;
          }
          
          // Add to all available counters (both GL and non-GL)
          allAvailableCounters.push(counter);
        }
        
        // Check if the defensive squad is a GL
        const isDefensiveSquadGL = isGalacticLegend(defensiveSquad.leader.baseId);
        
        // Count GL vs non-GL for logging
        const glCount = allAvailableCounters.filter(c => isGalacticLegend(c.leader.baseId)).length;
        const nonGlCount = allAvailableCounters.length - glCount;
        
            logger.info(
          `Counter analysis for ${defensiveSquad.leader.baseId}${isDefensiveSquadGL ? ' (GL)' : ''}: ` +
          `${allAvailableCounters.length} total counter(s) available (${nonGlCount} non-GL, ${glCount} GL) - evaluating all together`
        );
        
        // Find max seen count across ALL counters for normalization
        let maxSeenCount = 0;
        for (const counter of allAvailableCounters) {
          if (counter.seenCount !== null && counter.seenCount > maxSeenCount) {
            maxSeenCount = counter.seenCount;
          }
        }
        
        // Store ALL available counters (sorted by score) as alternatives
        // This ensures we have maximum options when primary counters conflict with defense
        // Some opponent defenses (like QUEENAMIDALA) have very limited non-GL options, so we need all of them
        const topCounters: Array<{ counter: GacCounterSquad; score: number }> = [];
        const MAX_ALTERNATIVES = allAvailableCounters.length; // Store ALL available counters as alternatives

        // Evaluate ALL counters together (GL and non-GL)
        for (const counter of allAvailableCounters) {
          // All checks already passed above, just evaluate score
          const allUnits = [counter.leader, ...counter.members];
          const allUnitIds = allUnits.map(unit => unit.baseId);
          
          // Get relic levels for this counter squad
          const offenseRelics = allUnits.map(unit => userUnitMap.get(unit.baseId) ?? null);
          const defenseRelics = [
            defensiveSquad.leader.relicLevel,
            ...defensiveSquad.members.map(m => m.relicLevel)
          ];

          // Calculate key matchups and transform win rate
          const keyMatchups = calculateKeyMatchups(offenseRelics, defenseRelics);
          const adjustedWinRate = transformWinRateForRelicDelta(counter.winPercentage, keyMatchups);
          
          // Get defense stats for the counter squad (if it's also used on defense)
          const counterDefenseStats = await (async () => { /* TODO: Extract getDefenseStatsForSquad */ return { holdPercentage: null, seenCount: null }; })() // getDefenseStatsForSquad(counter.leader.baseId, seasonId);
          
          // Get defense stats for the defensive squad we're countering
          const opponentDefenseStats = await (async () => { /* TODO: Extract getDefenseStatsForSquad */ return { holdPercentage: null, seenCount: null }; })() // getDefenseStatsForSquad(defensiveSquad.leader.baseId, seasonId);
          
          // Calculate viability score based on win % and seen count
          // This prioritizes counters that are both proven (high seen count) and effective (high win %)
          // Example: 95% win with 34,000 seen should beat 87% win with 3,881 seen
          const baseWinRate = adjustedWinRate ?? counter.winPercentage ?? 50;
          
          // Normalize seen count to 0-100 scale (using logarithmic scaling to handle large ranges)
          // This prevents one very high seen count from dominating, while still rewarding higher counts
          let normalizedSeenScore = 0;
          if (counter.seenCount !== null && maxSeenCount > 0) {
            // Use logarithmic scaling: log(seenCount + 1) / log(maxSeenCount + 1) * 100
            const logSeen = Math.log10(counter.seenCount + 1);
            const logMax = Math.log10(maxSeenCount + 1);
            normalizedSeenScore = (logSeen / logMax) * 100;
          } else if (counter.seenCount === null) {
            // If no seen count data, use a neutral score (50) to not penalize too heavily
            normalizedSeenScore = 50;
          }
          
          // Combined viability score: 60% win rate, 40% seen count (proven usage)
          // This ensures counters with both high win % AND high usage are prioritized
          const viabilityScore = (baseWinRate * 0.6) + (normalizedSeenScore * 0.4);
          
          // Score counter based on:
          // 1. Viability score (win % + seen count, weighted 50%)
          // 2. Relic delta advantage (positive delta = advantage, weighted 20%)
          // 3. Defense consideration: if counter is good on defense, small penalty (weighted 10%)
          // 4. Opponent defense strength: if opponent squad is strong on defense, bonus (weighted 10%)
          // 5. Heavy penalty for trap counters (punching up 3+ tiers)
          // 6. BONUS for non-GL counters (to conserve GLs for defense, weighted 10%)
          // Win rate should be the PRIMARY factor - weight at 70%
          const viabilityScoreWeighted = viabilityScore * 0.7;
          
          // Relic delta score: use team average delta
          const relicDelta = calculateSquadRelicDelta(offenseRelics, defenseRelics);
          const relicDeltaScore = Math.max(-50, Math.min(50, relicDelta.delta * 5)) * 0.2;
          
          // Defense consideration: if the counter squad is also good on defense (hold % > 20%),
          // apply a small penalty since we might want to save it for defense
          let defensePenalty = 0;
          if (counterDefenseStats.holdPercentage !== null && counterDefenseStats.holdPercentage > 20) {
            // Penalty increases with hold percentage (max -10 points for 50%+ hold)
            defensePenalty = -Math.min(10, (counterDefenseStats.holdPercentage - 20) * 0.33) * 0.1;
          }
          
          // Opponent defense bonus: if the defensive squad is strong on defense (hold % > 25%),
          // prioritize having a good counter for it
          let opponentDefenseBonus = 0;
          if (opponentDefenseStats.holdPercentage !== null && opponentDefenseStats.holdPercentage > 25) {
            // Bonus increases with hold percentage (max +5 points for 50%+ hold)
            opponentDefenseBonus = Math.min(5, (opponentDefenseStats.holdPercentage - 25) * 0.2) * 0.1;
          }
          
          // Trap penalty: heavily penalise counters where we're punching up 3+ tiers
          let trapPenalty = 0;
          if (keyMatchups.isTrap) {
            trapPenalty = -30; // Significant penalty for trap counters
          }
          
          // Non-GL bonus: apply as modifier to viability score, not as separate category
          // Strategy preference affects GL vs non-GL prioritization
          const isCounterGL = isGalacticLegend(counter.leader.baseId);
          let nonGlBonus = 0;
          
          if (strategyPreference === 'defensive') {
            // Defensive strategy: COMPLETELY BLOCK GL counters - GLs must be on defense only
            if (!isCounterGL) {
              nonGlBonus = 50; // Large bonus for non-GL counters
              if (isDefensiveSquadGL) {
                nonGlBonus += 25; // Extra bonus for countering GL with non-GL
                logger.info(
                  `[Defensive Strategy] Non-GL counter ${counter.leader.baseId} vs GL ${defensiveSquad.leader.baseId} - applying bonus to conserve GL for defense`
                );
              }
            } else {
              // For defensive strategy, allow GL counters ONLY if there are no non-GL alternatives
              // Check if there are any non-GL alternatives in the available counters
              const hasNonGlAlternatives = allAvailableCounters.some(c => 
                !isGalacticLegend(c.leader.baseId) && c.leader.baseId !== counter.leader.baseId
              );
              if (hasNonGlAlternatives) {
                // Block GL counter if non-GL alternatives exist
                nonGlBonus = -1000; // Massive penalty to block GLs when alternatives exist
                logger.info(
                  `[Defensive Strategy] BLOCKING GL counter ${counter.leader.baseId} - non-GL alternatives exist for ${defensiveSquad.leader.baseId}`
                );
              } else {
                // Allow GL counter if no non-GL alternatives exist (but with lower priority)
                nonGlBonus = -50; // Smaller penalty - allow but deprioritize
                logger.info(
                  `[Defensive Strategy] ALLOWING GL counter ${counter.leader.baseId} vs ${defensiveSquad.leader.baseId} - no non-GL alternatives available`
                );
              }
            }
          } else if (strategyPreference === 'offensive') {
            // Offensive strategy: Prioritize ALL GLs on offense for 100% wins
            // GL counters should be heavily prioritized, especially those with high win rates
            if (!isCounterGL) {
              // Penalize non-GL counters - we want GLs on offense
              nonGlBonus = -50; // Large penalty to deprioritize non-GL counters
              if (isDefensiveSquadGL) {
                // Even more penalty if countering a GL with non-GL (we should use GLs for GL defenses)
                nonGlBonus -= 25; // Additional penalty
                logger.info(
                  `[Offensive Strategy] Non-GL counter ${counter.leader.baseId} vs GL ${defensiveSquad.leader.baseId} - deprioritizing to save GLs for offense`
                );
              }
            } else {
              // GL counters are highly valuable on offense - give large bonus
              // Bonus increases with win rate (especially 100% wins)
              const winRate = adjustedWinRate ?? counter.winPercentage ?? 0;
              if (winRate === 100) {
                nonGlBonus = 100; // Maximum bonus for 100% win rate GL counters
              } else if (winRate >= 95) {
                nonGlBonus = 75; // Large bonus for 95%+ win rate GL counters
              } else if (winRate >= 90) {
                nonGlBonus = 50; // Good bonus for 90%+ win rate GL counters
              } else {
                nonGlBonus = 25; // Still bonus for GL counters, but less for lower win rates
              }
              
              // Extra bonus if countering a GL defense with a GL counter (GL vs GL)
              if (isDefensiveSquadGL) {
                nonGlBonus += 25; // Additional bonus for GL vs GL matchups
                logger.info(
                  `[Offensive Strategy] GL counter ${counter.leader.baseId} vs GL ${defensiveSquad.leader.baseId} - ` +
                  `prioritizing (Win: ${winRate.toFixed(1)}%)`
                );
              }
            }
          } else {
            // Balanced strategy: Current behavior
            if (!isCounterGL) {
              // Reduced bonus for using non-GL counter (8 points) - win rate should dominate
              nonGlBonus = 8;
              
              // Extra bonus if countering a GL with a non-GL squad (5 additional points)
              if (isDefensiveSquadGL) {
                nonGlBonus += 5;
                logger.info(
                  `Non-GL counter ${counter.leader.baseId} vs GL ${defensiveSquad.leader.baseId} - applying bonus to conserve GL for defense`
                );
              }
            } else {
              // For balanced strategy, GL counters are acceptable
              // We'll prioritize unused GLs in the sorting phase, not here
              // Don't penalize GL counters too heavily - let the sorting logic handle prioritization
              const hasNonGlAlternatives = allAvailableCounters.some(c => 
                !isGalacticLegend(c.leader.baseId) && c.leader.baseId !== counter.leader.baseId
              );
              if (hasNonGlAlternatives) {
                nonGlBonus = -5; // Minimal penalty for GL counter when non-GL alternatives exist
              } else {
                nonGlBonus = 10; // Bonus if GL is the only option
              }
            }
          }
          
          const totalScore = viabilityScoreWeighted + relicDeltaScore + defensePenalty + opponentDefenseBonus + trapPenalty + nonGlBonus;

          // For defensive strategy, include GL counters in alternatives even if non-GL alternatives exist
          // They will be tried last during balancing if all non-GL alternatives conflict
          // Don't skip them here - let the balancing phase decide based on conflicts

          // Store this counter with its score
          topCounters.push({ counter, score: totalScore });
        }

        // Sort by score descending and take top MAX_ALTERNATIVES
        topCounters.sort((a, b) => b.score - a.score);
        const selectedCounters = topCounters.slice(0, MAX_ALTERNATIVES);

        // For defensive strategy, include GL counters in alternatives even if non-GL alternatives exist
        // The balancing phase will try non-GL first (they have higher scores), then GL if all non-GL conflict
        // Don't filter them out here - let the balancing phase decide based on conflicts
        const filteredCounters = selectedCounters;

        if (filteredCounters.length === 0) {
          // No valid counters found
          logger.warn(
            `No matching counter found for defensive squad with leader ${defensiveSquad.leader.baseId}`
          );
          matchedCounters.push({
            offense: {
              leader: { baseId: '', relicLevel: null, portraitUrl: null },
              members: []
            },
            defense: defensiveSquad,
            winPercentage: null,
            adjustedWinPercentage: null,
            seenCount: null,
            avgBanners: null,
            relicDelta: null,
            worstCaseRelicDelta: null,
            bestCaseRelicDelta: null,
            keyMatchups: null
          });
          continue;
        }

        // Use the best counter as primary, store others as alternatives
        const bestMatch = filteredCounters[0].counter;
        const alternatives: MatchedCounterSquad[] = [];

        // Create MatchedCounterSquad for the primary counter
        const createMatchedCounter = (counter: GacCounterSquad): MatchedCounterSquad => {
          const allUnits = [counter.leader, ...counter.members];
          const offenseRelics = allUnits.map(unit => userUnitMap.get(unit.baseId) ?? null);
          const defenseRelics = [
            defensiveSquad.leader.relicLevel,
            ...defensiveSquad.members.map(m => m.relicLevel)
          ];

          const offenseSquad: UniqueDefensiveSquad = {
            leader: {
              baseId: counter.leader.baseId,
              relicLevel: userUnitMap.get(counter.leader.baseId) ?? null,
              portraitUrl: counter.leader.portraitUrl
            },
            members: counter.members.map(m => ({
              baseId: m.baseId,
              relicLevel: userUnitMap.get(m.baseId) ?? null,
              portraitUrl: m.portraitUrl
            }))
          };

          const keyMatchups = calculateKeyMatchups(offenseRelics, defenseRelics);
          const adjustedWinRate = transformWinRateForRelicDelta(counter.winPercentage, keyMatchups);
          const relicDelta = calculateSquadRelicDelta(offenseRelics, defenseRelics);
          const worstCaseRelicDelta = calculateWorstCaseRelicDelta(offenseRelics, defenseRelics);
          const bestCaseRelicDelta = calculateBestCaseRelicDelta(offenseRelics, defenseRelics);

          return {
            offense: offenseSquad,
            defense: defensiveSquad,
            winPercentage: counter.winPercentage,
            adjustedWinPercentage: adjustedWinRate,
            seenCount: counter.seenCount,
            avgBanners: counter.avgBanners,
            relicDelta,
            worstCaseRelicDelta,
            bestCaseRelicDelta,
            keyMatchups
          };
        };

        // Create alternatives from remaining top counters
        for (let i = 1; i < filteredCounters.length; i++) {
          alternatives.push(createMatchedCounter(filteredCounters[i].counter));
        }

        // Mark this offense squad as used
        usedOffenseSquads.add(bestMatch.leader.baseId);
        
        // Mark all characters in this counter as used (GAC rule: each character can only be used once per round)
        const allBestMatchUnits = [bestMatch.leader, ...bestMatch.members];
        const characterIds = allBestMatchUnits.map(u => u.baseId);
        for (const unit of allBestMatchUnits) {
          usedCharacters.add(unit.baseId);
        }
        
        logger.info(
          `Matched counter for ${defensiveSquad.leader.baseId}: ${bestMatch.leader.baseId} ` +
          `(win rate: ${bestMatch.winPercentage ?? 'N/A'}%, characters: ${characterIds.join(', ')})` +
          (alternatives.length > 0 ? ` [${alternatives.length} alternative(s) available]` : '')
        );

        // Create primary matched counter
        const primaryCounter = createMatchedCounter(bestMatch);
        
        // Store alternatives if any
        if (alternatives.length > 0) {
          primaryCounter.alternatives = alternatives;
        }

        matchedCounters.push(primaryCounter);
      } catch (error) {
        logger.error(`Error matching counters for ${defensiveSquad.leader.baseId}:`, error);
        // Continue with next squad even if this one fails
        matchedCounters.push({
          offense: {
            leader: { baseId: '', relicLevel: null, portraitUrl: null },
            members: []
          },
          defense: defensiveSquad,
          winPercentage: null,
          adjustedWinPercentage: null,
          seenCount: null,
          avgBanners: null,
          relicDelta: null,
          worstCaseRelicDelta: null,
          bestCaseRelicDelta: null,
          keyMatchups: null
        });
      }
    }

    // Log GL vs non-GL counter usage summary
    const glCountersUsed = matchedCounters.filter(m => 
      m.offense.leader.baseId && isGalacticLegend(m.offense.leader.baseId)
    ).length;
    const nonGlCountersUsed = matchedCounters.filter(m => 
      m.offense.leader.baseId && !isGalacticLegend(m.offense.leader.baseId)
    ).length;
    const glDefensesCountered = defensiveSquads.filter(d => 
      isGalacticLegend(d.leader.baseId)
    ).length;

    logger.info(
      `Counter matching complete: ${matchedCounters.filter(m => m.offense.leader.baseId).length} counter(s) matched, ` +
      `${usedCharacters.size} unique character(s) used. ` +
      `GL usage: ${glCountersUsed} GL counter(s) used, ${nonGlCountersUsed} non-GL counter(s) used. ` +
      `${glDefensesCountered} GL defense(s) encountered. ` +
      `GL conservation: ${glDefensesCountered - glCountersUsed} GL(s) potentially saved for defense`
    );

    return matchedCounters;
  }
