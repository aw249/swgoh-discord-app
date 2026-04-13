import { SwgohGgFullPlayerResponse } from '../../../integrations/swgohGgApi';
import { isGalacticLegend } from '../../../config/gacConstants';
import { STAT_IDS } from '../../../config/imageConstants';
import { getDisplayRelicLevel, getUnitLevelDisplay } from '../../../utils/unitLevelUtils';

export interface CharacterStatEntry {
  speed: number;
  health: number;
  protection: number;
  relic: number | null;
  gearLevel: number;
  levelLabel: string;
}

/**
 * Build a map of character stats from a full player roster.
 * Used by image generation functions to avoid duplicated iteration logic.
 */
export function buildCharacterStatsMap(
  roster: SwgohGgFullPlayerResponse
): Map<string, CharacterStatEntry> {
  const map = new Map<string, CharacterStatEntry>();
  for (const unit of roster.units || []) {
    if (unit.data?.base_id && unit.data.combat_type === 1) {
      const stats = unit.data.stats || {};
      const speed = Math.round(stats[STAT_IDS.SPEED] || 0);
      const health = (stats[STAT_IDS.HEALTH] || 0) / 1000;
      const protection = (stats[STAT_IDS.PROTECTION] || 0) / 1000;
      const relic = getDisplayRelicLevel(unit.data.gear_level, unit.data.relic_tier);
      const levelDisplay = getUnitLevelDisplay(unit.data);
      map.set(unit.data.base_id, {
        speed,
        health,
        protection,
        relic,
        gearLevel: unit.data.gear_level,
        levelLabel: levelDisplay.label,
      });
    }
  }
  return map;
}

/**
 * Get all characters from roster (no longer limited to top 80).
 * Previously filtered to top 80 by GP for GAC matchmaking, but this caused issues
 * with missing characters in strategy suggestions.
 * 
 * @deprecated Use full roster directly instead. This function is kept for backward compatibility.
 */
export function getTop80CharactersRoster(roster: SwgohGgFullPlayerResponse): SwgohGgFullPlayerResponse {
  // Return all characters, sorted by power (no longer limited to 80)
  const characters = (roster.units || [])
    .filter(unit => unit.data.combat_type === 1)
    .sort((a, b) => (b.data.power || 0) - (a.data.power || 0));
  return { ...roster, units: characters };
}

/**
 * Get all Galactic Legends from the full roster.
 */
export function getGalacticLegendsFromRoster(roster: SwgohGgFullPlayerResponse): Set<string> {
  const gls = new Set<string>();
  // Use full roster to find all GLs (our list OR API flag)
  for (const unit of roster.units || []) {
    if (unit.data?.base_id && (isGalacticLegend(unit.data.base_id) || unit.data.is_galactic_legend)) {
      gls.add(unit.data.base_id);
    }
  }
  return gls;
}

/**
 * Create character name and stats maps from the full roster.
 */
export function createCharacterMaps(roster: SwgohGgFullPlayerResponse): {
  nameMap: Map<string, string>;
  statsMap: Map<string, { speed: number; health: number; protection: number }>;
} {
  const nameMap = new Map<string, string>();
  const statsMap = new Map<string, { speed: number; health: number; protection: number }>();
  // Use full roster for all characters
  for (const unit of roster.units || []) {
    if (unit.data?.base_id && unit.data.combat_type === 1) {
      if (unit.data.name) nameMap.set(unit.data.base_id, unit.data.name);
      const stats = unit.data.stats || {};
      const speed = Math.round(stats[STAT_IDS.SPEED] || 0);
      const health = (stats[STAT_IDS.HEALTH] || 0) / 1000;
      const protection = (stats[STAT_IDS.PROTECTION] || 0) / 1000;
      statsMap.set(unit.data.base_id, { speed, health, protection });
    }
  }
  return { nameMap, statsMap };
}
