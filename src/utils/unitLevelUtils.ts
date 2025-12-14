/**
 * Utility functions for working with unit gear and relic levels.
 * 
 * Both swgoh.gg API and Comlink return relic_tier in RAW format:
 * - Raw 0/null/undefined: No relic data
 * - Raw 1: Pre-relic state (G1-G12, not yet unlocked)
 * - Raw 3: R1 (first actual relic level, requires G13)
 * - Raw 4: R2
 * - Raw 5: R3
 * - ...
 * - Raw 12: R10 (max)
 * 
 * To get display relic: display = raw - 2 (when gear >= 13 and raw >= 3)
 */

/**
 * Unit data interface matching swgoh.gg format
 */
export interface UnitLevelData {
  gear_level: number;
  relic_tier: number | null;
}

/**
 * Result of getting a unit's level for display
 */
export interface UnitLevelDisplay {
  /** Display string like "R8" or "G12" */
  label: string;
  /** True if this is a relic level (G13+), false if gear level */
  isRelic: boolean;
  /** The numeric value (relic level 0-10 or gear level 1-13) */
  value: number;
  /** Raw relic tier from API (for calculations) */
  rawRelicTier: number | null;
}

/**
 * Convert raw relic_tier to display relic level (0-10)
 * Returns null if not G13 or no valid relic data
 * 
 * @param gearLevel - The unit's gear level (1-13)
 * @param rawRelicTier - The raw relic_tier from API
 * @returns Display relic level (0-10) or null if not applicable
 */
export function getDisplayRelicLevel(gearLevel: number, rawRelicTier: number | null): number | null {
  if (gearLevel < 13) {
    return null; // Not G13, no relic possible
  }
  
  if (rawRelicTier === null || rawRelicTier === undefined) {
    return null; // No relic data
  }
  
  if (rawRelicTier < 1) {
    return null; // Invalid relic data
  }
  
  if (rawRelicTier < 3) {
    return 0; // G13 but R0 (relic not yet applied)
  }
  
  // Raw 3 = R1, Raw 4 = R2, etc.
  return Math.min(10, rawRelicTier - 2);
}

/**
 * Get unit level display info for UI rendering
 * Returns relic level for G13+ units, gear level for others
 * 
 * @param unit - Unit data with gear_level and relic_tier
 * @returns Display info including label and numeric value
 */
export function getUnitLevelDisplay(unit: UnitLevelData): UnitLevelDisplay {
  const relicLevel = getDisplayRelicLevel(unit.gear_level, unit.relic_tier);
  
  if (relicLevel !== null) {
    return {
      label: `R${relicLevel}`,
      isRelic: true,
      value: relicLevel,
      rawRelicTier: unit.relic_tier,
    };
  }
  
  return {
    label: `G${unit.gear_level}`,
    isRelic: false,
    value: unit.gear_level,
    rawRelicTier: null,
  };
}

/**
 * Get the effective "power level" for comparison purposes
 * G13 R0 = 13, G13 R1 = 14, G13 R5 = 18, etc.
 * Non-reliced units use gear level (1-12)
 * 
 * @param unit - Unit data with gear_level and relic_tier
 * @returns Numeric power level for sorting/comparison (1-23)
 */
export function getEffectivePowerLevel(unit: UnitLevelData): number {
  if (unit.gear_level < 13) {
    return unit.gear_level; // 1-12
  }
  
  const relicLevel = getDisplayRelicLevel(unit.gear_level, unit.relic_tier);
  if (relicLevel === null || relicLevel === 0) {
    return 13; // G13 R0
  }
  
  return 13 + relicLevel; // G13 R1 = 14, R10 = 23
}

/**
 * Compare two units by their effective power level
 * Returns positive if unit1 > unit2, negative if unit1 < unit2, 0 if equal
 */
export function compareUnitPowerLevels(unit1: UnitLevelData, unit2: UnitLevelData): number {
  return getEffectivePowerLevel(unit1) - getEffectivePowerLevel(unit2);
}

/**
 * Get CSS colour class based on level comparison
 * Returns 'green' if better, 'red' if worse, '' if equal
 * 
 * @param yourLevel - Your unit's effective power level
 * @param theirLevel - Opponent's unit's effective power level
 * @param isPlayer1 - True if you are player 1 (left side)
 * @returns CSS class name
 */
export function getLevelComparisonColour(
  yourLevel: number,
  theirLevel: number | null,
  isPlayer1: boolean
): string {
  if (theirLevel === null) {
    return isPlayer1 ? 'green' : 'red'; // You have it, they don't
  }
  
  if (yourLevel > theirLevel) {
    return isPlayer1 ? 'green' : 'red';
  }
  
  if (yourLevel < theirLevel) {
    return ''; // They're better - no highlight
  }
  
  return ''; // Equal
}

