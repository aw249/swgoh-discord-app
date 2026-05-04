/**
 * Per-counter scoring helper extracted from matchCountersAgainstRoster.
 * Computes a numeric score for a single counter squad against a single defensive squad.
 */
import { GacCounterSquad } from '../../../types/swgohGgTypes';
import { UniqueDefensiveSquad } from '../../../types/gacStrategyTypes';
import {
  calculateSquadRelicDelta,
  calculateKeyMatchups,
  transformWinRateForRelicDelta
} from '../../../utils/relicDeltaService';
import { logger } from '../../../utils/logger';
import { isGalacticLegend } from '../../../config/gacConstants';
import {
  getArchetypeValidator,
  createRosterAdapter,
  filterWarningsForSquad,
  RosterAdapter
} from '../../archetypeValidation/archetypeValidator';
import { ArchetypeValidationInfo } from '../../../types/gacStrategyTypes';
import { ArchetypeConfig, LeaderArchetypeMapping } from '../../../types/archetypeTypes';
import archetypesConfig from '../../../config/archetypes/archetypes.json';
import leaderMappingsConfig from '../../../config/archetypes/leaderMappings.json';

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
 * Validate a counter squad against archetype requirements.
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
    const result = validator.validateCounterByLeader(rosterAdapter, leaderBaseId, mode as any);

    const squadMemberSet = actualSquadMembers ? new Set(actualSquadMembers) : null;

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

    if (squadMemberSet) {
      missingRequired = missingRequired?.filter(r => squadMemberSet.has(r.unitBaseId));
      missingOptional = missingOptional?.filter(r => squadMemberSet.has(r.unitBaseId));
    }

    const viable = !missingRequired || missingRequired.length === 0;

    let warnings: string[] | undefined;
    if (result.archetypeId) {
      const archetype = validator.getArchetype(result.archetypeId);
      if (archetype?.warnings) {
        warnings = filterWarningsForSquad(archetype.warnings, actualSquadMembers);
      }
    }

    return {
      viable,
      confidence: result.confidence / 100,
      missingRequired: missingRequired && missingRequired.length > 0 ? missingRequired : undefined,
      missingOptional: missingOptional && missingOptional.length > 0 ? missingOptional : undefined,
      warnings: warnings && warnings.length > 0 ? warnings : undefined,
      archetypeId: result.archetypeId,
    };
  } catch (error) {
    logger.debug(`No archetype validation for ${leaderBaseId}: ${error}`);
    return {
      viable: true,
      confidence: 1.0,
      warnings: ['No archetype defined - zeta/omicron requirements not validated'],
    };
  }
}

export interface CounterScoringContext {
  userUnitMap: Map<string, number | null>;
  format: string;
  strategyPreference: 'defensive' | 'balanced' | 'offensive';
  userDatacronLeveragedChars?: Set<string>;
  metaDatacronActivatedChars?: Set<string>;
  /** All available counters for this defence (needed for GL/non-GL alternative check) */
  allAvailableCounters: GacCounterSquad[];
  /** Max seen count across all available counters (for normalisation) */
  maxSeenCount: number;
  /** Pre-built roster adapter for archetype validation */
  rosterAdapter: RosterAdapter;
  /** Whether the defensive squad leader is a Galactic Legend */
  isDefensiveSquadGL: boolean;
  /** Expected counter size based on format */
  expectedCounterSize: number;
}

export interface CounterScoreResult {
  score: number;
  viable: boolean;
}

/**
 * Score a single counter squad against a single defensive squad.
 * Body is a literal extraction from matchCountersAgainstRoster's inner loop —
 * same numbers in, same numbers out.
 */
export function scoreCounterAgainstDefence(
  counter: GacCounterSquad,
  defensiveSquad: UniqueDefensiveSquad,
  ctx: CounterScoringContext,
): CounterScoreResult {
  const {
    userUnitMap,
    format,
    strategyPreference,
    userDatacronLeveragedChars,
    allAvailableCounters,
    maxSeenCount,
    rosterAdapter,
    isDefensiveSquadGL,
    expectedCounterSize,
  } = ctx;

  const gameMode: GameModeValue = format === '3v3' ? GameModeValues.GAC_3v3 : GameModeValues.GAC_5v5;

  const allUnits = [counter.leader, ...counter.members];

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
  // Defence stats for counter squads not yet implemented — always returns null.
  // See IMPROVEMENTS.md section 10.4 for design notes on getDefenseStatsForSquad.
  const counterDefenseStats = { holdPercentage: null, seenCount: null };

  // Get defense stats for the defensive squad we're countering
  // Defence stats for opponent squads not yet implemented — always returns null.
  const opponentDefenseStats = { holdPercentage: null, seenCount: null };

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

  // Combined viability score: 75% win rate, 25% seen count.
  // Win rate is the dominant signal — user feedback: prefer counters
  // that give confidence, not just well-trodden weak ones. Seen count
  // still matters as a confirmation signal but no longer dilutes a
  // strong win rate.
  let viabilityScore = (baseWinRate * 0.75) + (normalizedSeenScore * 0.25);

  // Confidence-tier bonus: when BOTH win rate and seen count are high,
  // the counter is provably strong and should be promoted past anything
  // with merely-decent stats. The thresholds below are tuned to make
  // 95%+/5k+ counters jump ahead of borderline 80%/2k options.
  if (baseWinRate >= 95 && normalizedSeenScore >= 60) {
    viabilityScore += 30;
  } else if (baseWinRate >= 90 && normalizedSeenScore >= 50) {
    viabilityScore += 15;
  } else if (baseWinRate >= 80 && normalizedSeenScore >= 40) {
    viabilityScore += 5;
  }

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
          `prioritizing (Win: ${(adjustedWinRate ?? counter.winPercentage ?? 0).toFixed(1)}%)`
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

  // Archetype validation: check if user has required zetas/omicrons for this counter
  // Pass actual squad members to only validate abilities for characters in this squad
  const actualSquadMembers = [counter.leader.baseId, ...counter.members.map(m => m.baseId)];
  const archetypeValidation = validateCounterArchetype(
    counter.leader.baseId,
    rosterAdapter,
    gameMode,
    actualSquadMembers
  );

  // Apply archetype penalties/bonuses
  let archetypePenalty = 0;
  if (!archetypeValidation.viable) {
    // Missing required abilities - heavy penalty but don't completely exclude
    // This allows the counter to appear as an alternative with a warning
    archetypePenalty = -50;
    logger.debug(
      `Counter ${counter.leader.baseId} missing required abilities: ${archetypeValidation.missingRequired?.map(r => r.shortDescription || r.reason).join(', ')} - applying penalty`
    );
  } else if (archetypeValidation.confidence < 1.0) {
    // Missing optional abilities - small penalty based on confidence
    archetypePenalty = -((1 - archetypeValidation.confidence) * 15);
    logger.debug(
      `Counter ${counter.leader.baseId} missing optional abilities (confidence: ${(archetypeValidation.confidence * 100).toFixed(0)}%)`
    );
  }

  // Undersized-vs-high-tier bonus: when a counter has fewer units than
  // the format expects (Bane solo, Bane+Dooku duo, Wampa solo, SEE+Wat
  // duo, etc.) and beats a high-tier opponent, prefer it. Reasons:
  //   1. Slot efficiency — uses fewer roster characters, freeing them
  //      for defense or other offense slots.
  //   2. The user's stated preference: "Bane should be used against
  //      A-tier squads".
  // High-tier proxy: opponent is a GL. (Once getDefenseStatsForSquad
  // is implemented per IMPROVEMENTS.md 10.4, expand this to also
  // include high-hold non-GL opponents like Third Sister, Baylan, etc.)
  // Bonus only applies when the counter's win rate is at least decent
  // (>= 70%) — we don't promote losing undersized matches.
  const counterUnitCount = 1 + counter.members.length;
  const isUndersized = counterUnitCount < expectedCounterSize;
  let undersizedBonus = 0;
  if (isUndersized && baseWinRate >= 70 && isDefensiveSquadGL) {
    // Slot-efficiency bonus scales with how undersized the counter is.
    // 5v5 with 1-unit counter (Bane solo) gets +20; 2-unit duo gets +12.
    const missingSlots = expectedCounterSize - counterUnitCount;
    undersizedBonus = missingSlots * 5;
    logger.info(
      `[Undersized bonus] ${counter.leader.baseId} (${counterUnitCount}u) vs GL ${defensiveSquad.leader.baseId}: ` +
      `+${undersizedBonus} (${missingSlots} slot${missingSlots !== 1 ? 's' : ''} freed for defense)`
    );
  }

  const totalScore = viabilityScoreWeighted + relicDeltaScore + defensePenalty + opponentDefenseBonus + trapPenalty + nonGlBonus + archetypePenalty + undersizedBonus;

  return { score: totalScore, viable: archetypeValidation.viable };
}
