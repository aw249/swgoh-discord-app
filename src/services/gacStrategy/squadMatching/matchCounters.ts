/**
 * Logic for matching counter squads against user roster with relic delta calculations
 */
import { GacDefensiveSquad, GacCounterSquad } from '../../../types/swgohGgTypes';
import { UniqueDefensiveSquad, MatchedCounterSquad, ArchetypeValidationInfo } from '../../../types/gacStrategyTypes';
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
import { getAllUnitIds } from "../utils/squadUtils";
import { looksDatacronDependent } from '../utils/datacronUtils';
import { ArchetypeConfig, LeaderArchetypeMapping } from '../../../types/archetypeTypes';
import {
  getArchetypeValidator,
  createRosterAdapter,
  filterWarningsForSquad,
  RosterAdapter
} from '../../archetypeValidation/archetypeValidator';
import archetypesConfig from '../../../config/archetypes/archetypes.json';
import leaderMappingsConfig from '../../../config/archetypes/leaderMappings.json';
import { scoreCounterAgainstDefence, CounterScoringContext } from './scoringHelpers';

// GameMode enum values - duplicated here to avoid import issues
const GameModeValues = {
  GAC_3v3: 'GAC_3v3',
  GAC_5v5: 'GAC_5v5',
  TW: 'TW',
} as const;
type GameModeValue = typeof GameModeValues[keyof typeof GameModeValues];

// Flag to track if validator has been initialised
let validatorInitialised = false;

/**
 * Ensure the archetype validator is initialised
 */
function ensureValidatorInitialised(): void {
  if (!validatorInitialised) {
    try {
      const config = archetypesConfig as ArchetypeConfig;
      const mappings = (leaderMappingsConfig as { mappings: LeaderArchetypeMapping[] }).mappings;
      getArchetypeValidator(config, mappings);
      validatorInitialised = true;
      logger.info(`Archetype validator initialised with ${config.archetypes.length} archetypes`);
    } catch (error) {
      logger.warn(`Failed to initialise archetype validator: ${error}`);
    }
  }
}

/**
 * Convert format string to game mode string
 */
function getGameMode(format: string): GameModeValue {
  return format === '3v3' ? GameModeValues.GAC_3v3 : GameModeValues.GAC_5v5;
}

/**
 * Validate a counter squad against archetype requirements.
 * Returns validation info including viability, confidence, and missing abilities.
 * 
 * @param leaderBaseId - The leader's base ID
 * @param rosterAdapter - The player's roster adapter
 * @param mode - The game mode
 * @param actualSquadMembers - Optional array of base IDs for the actual squad members.
 *                              If provided, only checks abilities for these units.
 */
function validateCounterArchetype(
  leaderBaseId: string,
  rosterAdapter: RosterAdapter,
  mode: GameModeValue,
  actualSquadMembers?: string[]
): ArchetypeValidationInfo {
  try {
    ensureValidatorInitialised();
    const validator = getArchetypeValidator();
    // Use validateCounterByLeader which accepts the leader ID and mode
    const result = validator.validateCounterByLeader(rosterAdapter, leaderBaseId, mode as any);
    
    // If we have actual squad members, filter to only check abilities for those units
    // This prevents warnings about characters not in the actual squad
    const squadMemberSet = actualSquadMembers ? new Set(actualSquadMembers) : null;
    
    // Map and filter the result to our info type
    let missingRequired = result.missingRequired?.map(r => ({
      abilityId: r.abilityId,
      unitBaseId: r.unitBaseId,
      reason: r.reason,
    }));
    
    let missingOptional = result.missingOptional?.map(r => ({
      abilityId: r.abilityId,
      unitBaseId: r.unitBaseId,
      reason: r.reason,
    }));
    
    // Filter to only include units that are actually in the squad
    if (squadMemberSet) {
      missingRequired = missingRequired?.filter(r => squadMemberSet.has(r.unitBaseId));
      missingOptional = missingOptional?.filter(r => squadMemberSet.has(r.unitBaseId));
    }
    
    // Determine viability based on filtered missing required
    const viable = !missingRequired || missingRequired.length === 0;
    
    // Filter warnings using the archetype's raw warnings (with relatedUnits info)
    // This uses the structured warnings from archetypes.json which specify which units they apply to
    let warnings: string[] | undefined;
    if (result.archetypeId) {
      const archetype = validator.getArchetype(result.archetypeId);
      if (archetype?.warnings) {
        warnings = filterWarningsForSquad(archetype.warnings, actualSquadMembers);
      }
    }
    
    return {
      viable,
      confidence: result.confidence / 100, // Convert from 0-100 to 0-1
      missingRequired: missingRequired && missingRequired.length > 0 ? missingRequired : undefined,
      missingOptional: missingOptional && missingOptional.length > 0 ? missingOptional : undefined,
      warnings: warnings && warnings.length > 0 ? warnings : undefined,
      archetypeId: result.archetypeId,
    };
  } catch (error) {
    // If validator not initialised or archetype not found, return viable with warning
    logger.debug(`No archetype validation for ${leaderBaseId}: ${error}`);
    return {
      viable: true,
      confidence: 1.0,
      warnings: ['No archetype defined - zeta/omicron requirements not validated'],
    };
  }
}

interface CounterClient {
  getCounterSquads(defensiveLeaderBaseId: string, seasonId?: string): Promise<GacCounterSquad[]>;
}

export async function matchCountersAgainstRoster(
  counterClient: CounterClient,

    defensiveSquads: UniqueDefensiveSquad[],
    userRoster: SwgohGgFullPlayerResponse,
    seasonId?: string,
    format: string = '5v5',
    strategyPreference: 'defensive' | 'balanced' | 'offensive' = 'balanced',
    userDatacronLeveragedChars?: Set<string>,
    metaDatacronActivatedChars?: Set<string>
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

    // Create roster adapter for archetype validation
    const rosterAdapter = createRosterAdapter(userRoster);
    const gameMode = getGameMode(format);

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

        // Filter counter squads by format. Allow up to expectedCounterSize units —
        // undersized counters are intentional (Wampa solo, Bane+Dooku duo,
        // Sith Eternal Emperor + Wat Tambor, etc.) and are MORE efficient on
        // offense because they free roster slots for defense.
        // Wrong-format squads (3v3 leaking into 5v5 query) come through with
        // <= expectedCounterSize too; we trust the swgoh.gg format query and
        // reject only over-sized squads (likely scraping errors).
        const filteredCounterSquads = counterSquads.filter(counter => {
          const allUnits = [counter.leader, ...counter.members];
          return allUnits.length >= 1 && allUnits.length <= expectedCounterSize;
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

          // Datacron filter: if this counter's leader (or any member) is a
          // character that focused datacrons in the meta empower, AND the
          // user doesn't have any datacron leveraging that character, drop
          // the counter. The bot shouldn't recommend a counter whose published
          // win rate depends on a cron the user can't run.
          if (metaDatacronActivatedChars && metaDatacronActivatedChars.size > 0) {
            const leaderIsMetaCron = metaDatacronActivatedChars.has(counter.leader.baseId);
            const userHasMatchingCron = !!(userDatacronLeveragedChars && userDatacronLeveragedChars.has(counter.leader.baseId));
            if (leaderIsMetaCron && !userHasMatchingCron) {
              logger.info(
                `[Datacron filter] Dropping counter ${counter.leader.baseId} vs ${defensiveSquad.leader.baseId}: ` +
                `meta has a focused datacron empowering ${counter.leader.baseId}, user does not own it`
              );
              continue;
            }
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
        const topCounters: Array<{ counter: GacCounterSquad; score: number; viable?: boolean }> = [];
        const MAX_ALTERNATIVES = allAvailableCounters.length; // Store ALL available counters as alternatives

        // Build scoring context for the helper
        const scoringCtx: CounterScoringContext = {
          userUnitMap,
          format,
          strategyPreference,
          userDatacronLeveragedChars,
          metaDatacronActivatedChars,
          allAvailableCounters,
          maxSeenCount,
          rosterAdapter,
          isDefensiveSquadGL,
          expectedCounterSize,
        };

        // Evaluate ALL counters together (GL and non-GL)
        for (const counter of allAvailableCounters) {
          // All checks already passed above, just evaluate score
          const { score: totalScore, viable } = scoreCounterAgainstDefence(counter, defensiveSquad, scoringCtx);

          // For defensive strategy, include GL counters in alternatives even if non-GL alternatives exist
          // They will be tried last during balancing if all non-GL alternatives conflict
          // Don't skip them here - let the balancing phase decide based on conflicts

          // Store this counter with its score
          topCounters.push({ counter, score: totalScore, viable });
        }

        // Sort by score descending and take top MAX_ALTERNATIVES
        topCounters.sort((a, b) => b.score - a.score);

        // Prefer viable counters: if best counter is non-viable but a viable alternative exists, use the viable one
        const viableCounters = topCounters.filter(c => c.viable !== false);
        if (viableCounters.length > 0 && topCounters[0]?.viable === false) {
          // Re-sort so viable counters come first, maintaining score order within each group
          topCounters.sort((a, b) => {
            const aViable = a.viable !== false ? 1 : 0;
            const bViable = b.viable !== false ? 1 : 0;
            if (aViable !== bViable) return bViable - aViable;
            return b.score - a.score;
          });
        }

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
          
          // Validate archetype requirements (zetas, omicrons)
          // Pass actual squad members to only validate abilities for characters in this squad
          const counterSquadMembers = [counter.leader.baseId, ...counter.members.map(m => m.baseId)];
          const archetypeValidation = validateCounterArchetype(
            counter.leader.baseId,
            rosterAdapter,
            gameMode,
            counterSquadMembers
          );
          
          // Log warnings if counter has missing abilities
          if (!archetypeValidation.viable) {
            logger.warn(
              `Counter ${counter.leader.baseId} missing required abilities: ${archetypeValidation.missingRequired?.map(r => r.shortDescription || r.reason).join(', ')}`
            );
          } else if (archetypeValidation.warnings && archetypeValidation.warnings.length > 0) {
            logger.info(
              `Counter ${counter.leader.baseId} archetype warnings: ${archetypeValidation.warnings.join(', ')}`
            );
          }

          // Datacron warning: high win rate with low sample size often signals
          // a counter that depends on a specific datacron the broader playerbase
          // doesn't have. If the user's focused datacrons don't appear to leverage
          // this counter's leader, flag it as a soft warning (no filtering — the
          // heuristic can miss).
          let datacronWarning: string | undefined;
          const looksCronDep = looksDatacronDependent(counter.winPercentage, counter.seenCount);
          const userHasLeverage = !!(userDatacronLeveragedChars && userDatacronLeveragedChars.has(counter.leader.baseId));
          if (looksCronDep && !userHasLeverage) {
            datacronWarning = 'May require a datacron not in your grid';
            logger.info(
              `[Datacron warning] ${counter.leader.baseId} vs ${defensiveSquad.leader.baseId}: ` +
              `${counter.winPercentage?.toFixed(0) ?? '?'}% win, ${counter.seenCount?.toLocaleString() ?? 'N/A'} seen — ` +
              `flagging as possibly datacron-dependent`
            );
          } else if (looksCronDep && userHasLeverage) {
            logger.info(
              `[Datacron leveraged] ${counter.leader.baseId} vs ${defensiveSquad.leader.baseId}: ` +
              `user's focused datacrons cover this leader — suppressing warning`
            );
          }

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
            keyMatchups,
            archetypeValidation,
            datacronWarning
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
