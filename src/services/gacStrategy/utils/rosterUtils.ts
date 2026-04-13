import { SwgohGgFullPlayerResponse } from '../../../integrations/swgohGgApi';
import { isGalacticLegend } from '../../../config/gacConstants';
import { STAT_ID } from '../../../config/imageConstants';
import { getDisplayRelicLevel, getUnitLevelDisplay } from '../../../utils/unitLevelUtils';

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
 * Stats for a single character, used across all image generation.
 */
export interface CharacterStats {
  speed: number;
  health: number;
  protection: number;
  relic: number | null;
  gearLevel: number;
  levelLabel: string;
}

/**
 * Build a map of character base_id to stats from a full player roster.
 * Filters to characters only (combat_type === 1), skips ships.
 * Health and protection are converted to thousands (divided by 1000).
 */
export function buildCharacterStatsMap(roster: SwgohGgFullPlayerResponse): Map<string, CharacterStats> {
  const map = new Map<string, CharacterStats>();
  if (!roster?.units) return map;

  for (const unit of roster.units) {
    if (unit.data?.base_id && unit.data.combat_type === 1) {
      const stats = unit.data.stats || {};
      const speed = Math.round(stats[STAT_ID.SPEED] || 0);
      const health = (stats[STAT_ID.HEALTH] || 0) / 1000;
      const protection = (stats[STAT_ID.PROTECTION] || 0) / 1000;
      const relic = getDisplayRelicLevel(unit.data.gear_level, unit.data.relic_tier);
      const levelDisplay = getUnitLevelDisplay(unit.data);
      map.set(unit.data.base_id, { speed, health, protection, relic, gearLevel: unit.data.gear_level, levelLabel: levelDisplay.label });
    }
  }
  return map;
}

/**
 * Create character name and stats maps from the full roster.
 */
export function createCharacterMaps(roster: SwgohGgFullPlayerResponse): {
  nameMap: Map<string, string>;
  statsMap: Map<string, { speed: number; health: number; protection: number }>;
} {
  const nameMap = new Map<string, string>();
  const fullStatsMap = buildCharacterStatsMap(roster);
  const statsMap = new Map<string, { speed: number; health: number; protection: number }>();

  for (const unit of roster.units || []) {
    if (unit.data?.base_id && unit.data.combat_type === 1) {
      if (unit.data.name) nameMap.set(unit.data.base_id, unit.data.name);
    }
  }
  for (const [key, val] of fullStatsMap) {
    statsMap.set(key, { speed: val.speed, health: val.health, protection: val.protection });
  }
  return { nameMap, statsMap };
}
