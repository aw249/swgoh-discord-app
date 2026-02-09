/**
 * Service for calculating Relic Delta damage modifiers.
 * 
 * Relic Delta is a system where characters with higher relic levels:
 * - Deal increased damage to characters with lower relic levels
 * - Receive reduced damage from characters with lower relic levels
 * 
 * Based on the official Relic Delta table from:
 * https://www.ea.com/en/games/starwars/galaxy-of-heroes/news/title-update-and-10-year-anniversary-announcement
 */

export interface RelicDeltaModifiers {
  /**
   * Damage multiplier for outgoing damage from the attacker.
   * Value > 1.0 means increased damage, < 1.0 means reduced damage.
   * Example: If attacker has +3 relic delta, this is 1.33 (deals +33% damage).
   */
  attackerDamageMultiplier: number;
  
  /**
   * Damage multiplier for incoming damage to the attacker (damage received from defender).
   * This is calculated from the defender's perspective (inverse delta).
   * Value < 1.0 means reduced incoming damage, > 1.0 means increased incoming damage.
   * Example: If attacker has +3 relic delta, defender has -3 delta when attacking back,
   * so this is 0.75 (attacker receives -25% damage, or 75% of normal).
   */
  defenderDamageMultiplier: number;
  
  /**
   * The relic level difference (attacker - defender).
   * Positive = attacker has higher relic, negative = defender has higher relic.
   */
  delta: number;
}

/**
 * Official Relic Delta lookup table for outgoing damage modifiers.
 * Values from the official announcement: https://www.ea.com/en/games/starwars/galaxy-of-heroes/news/title-update-and-10-year-anniversary-announcement
 * 
 * Key: Relic Delta (Attacker Relic - Defender Relic)
 * Value: Outgoing Damage Modifier (as percentage change)
 */
const RELIC_DELTA_LOOKUP: Record<number, number> = {
  [-5]: -60,  // -60% damage
  [-4]: -40,  // -40% damage
  [-3]: -25,  // -25% damage
  [-2]: -10,  // -10% damage
  [-1]: -5,   // -5% damage
  [0]: 0,     // 0% (no change)
  [1]: 5,     // +5% damage
  [2]: 10,    // +10% damage
  [3]: 33,    // +33% damage
  [4]: 70,    // +70% damage
  [5]: 150    // +150% damage
};

/**
 * Get the outgoing damage modifier for a given relic delta.
 * For values outside the lookup table (-5 to +5), extrapolates using the nearest known value.
 */
function getOutgoingDamageModifier(delta: number): number {
  // Clamp to known range first
  if (delta >= -5 && delta <= 5) {
    return RELIC_DELTA_LOOKUP[delta] ?? 0;
  }
  
  // For values outside the table, extrapolate
  // Use the extreme values and scale proportionally
  if (delta < -5) {
    // Extrapolate below -5: use -60% as base and scale more aggressively
    // For each level below -5, add approximately -15% (based on the curve pattern)
    const extraLevels = Math.abs(delta) - 5;
    return -60 - (extraLevels * 15);
  } else {
    // Extrapolate above +5: use +150% as base and scale more aggressively
    // For each level above +5, add approximately +50% (based on the curve pattern)
    const extraLevels = delta - 5;
    return 150 + (extraLevels * 50);
  }
}

/**
 * Calculate Relic Delta modifiers between two relic levels.
 * 
 * @param attackerRelic - Relic level of the attacking character (null = not reliced, treated as -1)
 * @param defenderRelic - Relic level of the defending character (null = not reliced, treated as -1)
 * @returns RelicDeltaModifiers with damage multipliers
 * 
 * Based on the official Relic Delta table. The system works as follows:
 * - Higher relic characters deal increased damage to lower relic characters
 * - Higher relic characters receive reduced damage from lower relic characters
 * - The modifier is symmetric: if attacker has +3 delta (deals +33% damage),
 *   the defender receives that increased damage (1.33x), but the attacker also
 *   receives reduced damage from the defender (0.67x incoming damage).
 */
export function calculateRelicDelta(
  attackerRelic: number | null,
  defenderRelic: number | null
): RelicDeltaModifiers {
  // Treat non-reliced units as -1 (below R0)
  const attackerLevel = attackerRelic ?? -1;
  const defenderLevel = defenderRelic ?? -1;
  
  const delta = attackerLevel - defenderLevel;
  
  // Get the outgoing damage modifier from the lookup table
  const outgoingDamageModifierPercent = getOutgoingDamageModifier(delta);
  
  // Convert percentage to multiplier (e.g., +33% = 1.33x, -25% = 0.75x)
  const attackerDamageMultiplier = 1.0 + (outgoingDamageModifierPercent / 100);
  
  // The defenderDamageMultiplier represents how much damage the higher relic character receives.
  // If attacker has +3 delta (higher relic), they receive less damage from the defender.
  // This is the inverse of what the defender would deal if roles were reversed.
  // So if attacker has +3 delta (deals +33%), the attacker receives -33% damage (0.67x)
  const defenderIncomingModifierPercent = getOutgoingDamageModifier(-delta);
  const defenderDamageMultiplier = 1.0 + (defenderIncomingModifierPercent / 100);
  
  return {
    attackerDamageMultiplier,
    defenderDamageMultiplier,
    delta
  };
}

/**
 * Calculate average Relic Delta for a squad vs squad matchup.
 * 
 * @param offenseSquad - Array of relic levels for the offense squad
 * @param defenseSquad - Array of relic levels for the defense squad
 * @returns Average RelicDeltaModifiers across all unit matchups
 */
export function calculateSquadRelicDelta(
  offenseSquad: (number | null)[],
  defenseSquad: (number | null)[]
): RelicDeltaModifiers {
  if (offenseSquad.length === 0 || defenseSquad.length === 0) {
    return {
      attackerDamageMultiplier: 1.0,
      defenderDamageMultiplier: 1.0,
      delta: 0
    };
  }
  
  // Calculate delta for each possible matchup
  const allDeltas: RelicDeltaModifiers[] = [];
  
  for (const offenseRelic of offenseSquad) {
    for (const defenseRelic of defenseSquad) {
      allDeltas.push(calculateRelicDelta(offenseRelic, defenseRelic));
    }
  }
  
  // Average the multipliers
  const avgAttackerMultiplier = allDeltas.reduce((sum, d) => sum + d.attackerDamageMultiplier, 0) / allDeltas.length;
  const avgDefenderMultiplier = allDeltas.reduce((sum, d) => sum + d.defenderDamageMultiplier, 0) / allDeltas.length;
  const avgDelta = allDeltas.reduce((sum, d) => sum + d.delta, 0) / allDeltas.length;
  
  return {
    attackerDamageMultiplier: avgAttackerMultiplier,
    defenderDamageMultiplier: avgDefenderMultiplier,
    delta: avgDelta
  };
}

/**
 * Get a human-readable description of the Relic Delta impact.
 */
export function getRelicDeltaDescription(modifiers: RelicDeltaModifiers): string {
  if (modifiers.delta === 0) {
    return 'No relic delta (equal levels)';
  }
  
  const attackerPercentNum = (modifiers.attackerDamageMultiplier - 1.0) * 100;
  const defenderPercentNum = (1.0 - modifiers.defenderDamageMultiplier) * 100;
  const attackerPercent = attackerPercentNum.toFixed(0);
  const defenderPercent = defenderPercentNum.toFixed(0);
  
  if (modifiers.delta > 0) {
    return `Offense advantage: +${attackerPercent}% damage, -${defenderPercent}% incoming`;
  } else {
    return `Defense advantage: -${Math.abs(attackerPercentNum).toFixed(0)}% damage, +${defenderPercent}% incoming`;
  }
}

/**
 * Calculate the worst-case Relic Delta for a counter (most disadvantaged matchup).
 * Useful for identifying counters that might struggle due to relic level differences.
 */
export function calculateWorstCaseRelicDelta(
  offenseSquad: (number | null)[],
  defenseSquad: (number | null)[]
): RelicDeltaModifiers {
  if (offenseSquad.length === 0 || defenseSquad.length === 0) {
    return {
      attackerDamageMultiplier: 1.0,
      defenderDamageMultiplier: 1.0,
      delta: 0
    };
  }
  
  let worstDelta: RelicDeltaModifiers | null = null;
  let worstScore = Infinity;
  
  // Find the matchup with the worst delta for the offense
  for (const offenseRelic of offenseSquad) {
    for (const defenseRelic of defenseSquad) {
      const delta = calculateRelicDelta(offenseRelic, defenseRelic);
      // Score: lower attacker multiplier + higher defender multiplier = worse for offense
      const score = delta.attackerDamageMultiplier + (2.0 - delta.defenderDamageMultiplier);
      
      if (score < worstScore) {
        worstScore = score;
        worstDelta = delta;
      }
    }
  }
  
  return worstDelta ?? {
    attackerDamageMultiplier: 1.0,
    defenderDamageMultiplier: 1.0,
    delta: 0
  };
}

/**
 * Calculate the best-case Relic Delta for a counter (most advantaged matchup).
 * Useful for identifying counters that benefit most from relic level differences.
 */
export function calculateBestCaseRelicDelta(
  offenseSquad: (number | null)[],
  defenseSquad: (number | null)[]
): RelicDeltaModifiers {
  if (offenseSquad.length === 0 || defenseSquad.length === 0) {
    return {
      attackerDamageMultiplier: 1.0,
      defenderDamageMultiplier: 1.0,
      delta: 0
    };
  }
  
  let bestDelta: RelicDeltaModifiers | null = null;
  let bestScore = -Infinity;
  
  // Find the matchup with the best delta for the offense
  for (const offenseRelic of offenseSquad) {
    for (const defenseRelic of defenseSquad) {
      const delta = calculateRelicDelta(offenseRelic, defenseRelic);
      // Score: higher attacker multiplier + lower defender multiplier = better for offense
      const score = delta.attackerDamageMultiplier + (2.0 - delta.defenderDamageMultiplier);
      
      if (score > bestScore) {
        bestScore = score;
        bestDelta = delta;
      }
    }
  }
  
  return bestDelta ?? {
    attackerDamageMultiplier: 1.0,
    defenderDamageMultiplier: 1.0,
    delta: 0
  };
}

/**
 * Calculate key unit matchups for a counter analysis.
 * Returns delta for: leader vs leader (carry vs carry), highest offense vs highest defense, and team average.
 */
export interface KeyMatchups {
  /**
   * Leader vs Leader matchup (typically carry vs carry, e.g., JMK vs LV, Malicos vs Rey)
   */
  leaderVsLeader: RelicDeltaModifiers;
  
  /**
   * Highest relic offense unit vs highest relic defense unit (key damage dealer matchup)
   */
  highestOffenseVsHighestDefense: RelicDeltaModifiers;
  
  /**
   * Average team relic delta
   */
  teamAverage: RelicDeltaModifiers;
  
  /**
   * Whether this counter is a "trap" due to punching up too much (delta <= -3)
   */
  isTrap: boolean;
  
  /**
   * Whether this counter has significant advantage (delta >= +2)
   */
  hasAdvantage: boolean;
}

export function calculateKeyMatchups(
  offenseSquad: (number | null)[],
  defenseSquad: (number | null)[],
  offenseLeaderIndex: number = 0,
  defenseLeaderIndex: number = 0
): KeyMatchups {
  if (offenseSquad.length === 0 || defenseSquad.length === 0) {
    const emptyDelta: RelicDeltaModifiers = {
      attackerDamageMultiplier: 1.0,
      defenderDamageMultiplier: 1.0,
      delta: 0
    };
    return {
      leaderVsLeader: emptyDelta,
      highestOffenseVsHighestDefense: emptyDelta,
      teamAverage: emptyDelta,
      isTrap: false,
      hasAdvantage: false
    };
  }
  
  // Leader vs Leader (carry vs carry)
  const offenseLeader = offenseSquad[offenseLeaderIndex] ?? null;
  const defenseLeader = defenseSquad[defenseLeaderIndex] ?? null;
  const leaderVsLeader = calculateRelicDelta(offenseLeader, defenseLeader);
  
  // Highest relic offense vs highest relic defense
  const highestOffense = Math.max(...offenseSquad.filter(r => r !== null).map(r => r as number), -1);
  const highestDefense = Math.max(...defenseSquad.filter(r => r !== null).map(r => r as number), -1);
  const highestOffenseVsHighestDefense = calculateRelicDelta(
    highestOffense >= 0 ? highestOffense : null,
    highestDefense >= 0 ? highestDefense : null
  );
  
  // Team average
  const teamAverage = calculateSquadRelicDelta(offenseSquad, defenseSquad);
  
  // Determine if this is a trap (punching up 3+ tiers) or has advantage (2+ tiers higher)
  const worstDelta = Math.min(
    leaderVsLeader.delta,
    highestOffenseVsHighestDefense.delta,
    teamAverage.delta
  );
  const bestDelta = Math.max(
    leaderVsLeader.delta,
    highestOffenseVsHighestDefense.delta,
    teamAverage.delta
  );
  
  const isTrap = worstDelta <= -3; // Punching up 3+ tiers is dangerous
  const hasAdvantage = bestDelta >= 2; // Being 2+ tiers higher is significant advantage
  
  return {
    leaderVsLeader,
    highestOffenseVsHighestDefense,
    teamAverage,
    isTrap,
    hasAdvantage
  };
}

/**
 * Transform community win rate based on Relic Delta impact.
 * 
 * Relic Delta significantly affects counter viability:
 * - Punching up 2 tiers: -10% damage, enemy +10% damage → reduces win rate
 * - Punching up 3 tiers: -25% damage → major reduction
 * - Punching up 4-5 tiers: -40% to -60% damage → often hopeless
 * - Being 3 tiers higher: +33% damage → significant boost
 * 
 * @param baseWinRate - Community win rate (0-100)
 * @param keyMatchups - Key unit matchups from calculateKeyMatchups
 * @returns Adjusted win rate accounting for Relic Delta
 */
export function transformWinRateForRelicDelta(
  baseWinRate: number | null,
  keyMatchups: KeyMatchups
): number | null {
  if (baseWinRate === null) {
    return null;
  }
  
  // If it's a trap (punching up 3+), heavily penalise
  if (keyMatchups.isTrap) {
    // Reduce win rate by 30-50% depending on how bad the delta is
    const worstDelta = Math.min(
      keyMatchups.leaderVsLeader.delta,
      keyMatchups.highestOffenseVsHighestDefense.delta,
      keyMatchups.teamAverage.delta
    );
    
    let penalty = 0;
    if (worstDelta <= -5) {
      penalty = 50; // -5 delta = -60% damage, almost hopeless
    } else if (worstDelta <= -4) {
      penalty = 40; // -4 delta = -40% damage, very difficult
    } else if (worstDelta <= -3) {
      penalty = 30; // -3 delta = -25% damage, significant disadvantage
    }
    
    return Math.max(0, baseWinRate - penalty);
  }
  
  // Calculate adjustment based on average delta impact
  // Use the team average as primary factor, but weight leader matchup heavily
  const avgDelta = keyMatchups.teamAverage.delta;
  const leaderDelta = keyMatchups.leaderVsLeader.delta;
  
  // Weight: 60% team average, 40% leader matchup (carry vs carry is critical)
  const weightedDelta = (avgDelta * 0.6) + (leaderDelta * 0.4);
  
  // Transform delta into win rate adjustment
  // Each delta point affects win rate by approximately 3-5%
  // But the curve is non-linear (matching the damage modifier curve)
  let adjustment = 0;
  
  if (weightedDelta >= 3) {
    // +3 delta = +33% damage → +15% win rate boost
    adjustment = 15;
  } else if (weightedDelta >= 2) {
    // +2 delta = +10% damage → +8% win rate boost
    adjustment = 8;
  } else if (weightedDelta >= 1) {
    // +1 delta = +5% damage → +3% win rate boost
    adjustment = 3;
  } else if (weightedDelta <= -3) {
    // -3 delta = -25% damage → -20% win rate penalty
    adjustment = -20;
  } else if (weightedDelta <= -2) {
    // -2 delta = -10% damage → -10% win rate penalty
    adjustment = -10;
  } else if (weightedDelta <= -1) {
    // -1 delta = -5% damage → -5% win rate penalty
    adjustment = -5;
  }
  
  // Apply adjustment and clamp to 0-100
  return Math.max(0, Math.min(100, baseWinRate + adjustment));
}

