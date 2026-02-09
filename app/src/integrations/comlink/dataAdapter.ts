/**
 * Adapters to convert Comlink API responses to the existing swgoh.gg types.
 * This allows a seamless transition from swgoh.gg to Comlink without
 * changing all the downstream services.
 * 
 * Uses GameDataService for accurate unit classification (GL detection, combat type, names).
 */
import {
  SwgohGgPlayerData,
  SwgohGgFullPlayerResponse,
  SwgohGgUnit,
  SwgohGgMod,
} from '../../types/swgohGgTypes';
import {
  ComlinkPlayerData,
  ComlinkRosterUnit,
  ComlinkMod,
} from './comlinkClient';
import { gameDataService } from '../../services/gameDataService';
import { logger } from '../../utils/logger';

// League ID to name mapping
const LEAGUE_ID_TO_NAME: Record<number, string> = {
  20: 'Carbonite',
  40: 'Bronzium',
  60: 'Chromium',
  80: 'Aurodium',
  100: 'Kyber',
};

// Mod slot mapping (Comlink uses different slot IDs)
const MOD_SET_ID_TO_NAME: Record<string, string> = {
  '1': 'health',
  '2': 'offense',
  '3': 'defense',
  '4': 'speed',
  '5': 'critchance',
  '6': 'critdamage',
  '7': 'potency',
  '8': 'tenacity',
};

/**
 * Extract the base ID from a Comlink definition ID
 * e.g., "MAGMATROOPER:SEVEN_STAR" → "MAGMATROOPER"
 */
function extractBaseId(definitionId: string): string {
  const colonIndex = definitionId.indexOf(':');
  return colonIndex > 0 ? definitionId.substring(0, colonIndex) : definitionId;
}

/**
 * Determine if a unit is a character (1) or ship (2)
 * Uses GameDataService for accurate detection from CG's game data.
 * Falls back to heuristics if GameDataService is not initialized.
 */
function determineCombatType(baseId: string): number {
  // Use GameDataService if available
  if (gameDataService.isReady()) {
    return gameDataService.isShip(baseId) ? 2 : 1;
  }

  // Fallback heuristics for when GameDataService is not ready
  const upperBaseId = baseId.toUpperCase();
  if (
    upperBaseId.includes('SHIP') ||
    upperBaseId.includes('CAPITAL') ||
    upperBaseId.startsWith('TIE') ||
    upperBaseId.endsWith('STARFIGHTER') ||
    upperBaseId.includes('FALCON') ||
    upperBaseId.includes('FIGHTER') ||
    upperBaseId.includes('BOMBER')
  ) {
    return 2; // Ship
  }

  return 1; // Character
}

/**
 * Determine if a unit is a Galactic Legend
 * Uses GameDataService for accurate detection from CG's game data.
 */
function isGalacticLegend(baseId: string): boolean {
  if (gameDataService.isReady()) {
    return gameDataService.isGalacticLegend(baseId);
  }
  
  // Fallback to known GLs if service not ready
  const knownGLs = new Set([
    'GLREY', 'SUPREMELEADERKYLOREN', 'GRANDMASTERLUKE', 'SITHPALPATINE',
    'JEDIMASTERKENOBI', 'LORDVADER', 'JABBATHEHUTT', 'GLLEIA',
    'GLAHSOKATANO', 'GLHONDO'
  ]);
  return knownGLs.has(baseId);
}

/**
 * Get the display name for a unit
 * Uses GameDataService for proper localized names.
 */
function getUnitDisplayName(baseId: string): string {
  if (gameDataService.isReady()) {
    return gameDataService.getUnitName(baseId);
  }
  return baseId;
}

/**
 * Extract a profile stat value from Comlink profileStat array
 */
function getProfileStatValue(
  profileStats: Array<{ nameKey: string; value: string }>,
  nameKey: string
): number {
  const stat = profileStats.find((s) => s.nameKey === nameKey);
  return stat ? parseInt(stat.value, 10) : 0;
}

/**
 * Convert a Comlink mod to swgoh.gg mod format
 */
function adaptMod(mod: ComlinkMod, characterBaseId: string): SwgohGgMod {
  // Mod definition ID format: "1" to "8" for set, slot is determined by shape
  // Comlink stores set in the first digit of definitionId
  const setId = mod.definitionId?.charAt(0) || '1';

  // Parse slot from second digit (1-6 for different slots)
  const slotId = mod.definitionId?.charAt(1) || '1';
  const slot = parseInt(slotId, 10);

  return {
    id: mod.id,
    level: mod.level,
    tier: mod.tier,
    rarity: 5, // Comlink doesn't provide rarity directly, assume 5-dot
    set: MOD_SET_ID_TO_NAME[setId] || 'health',
    slot: slot,
    primary_stat: mod.primaryStat
      ? {
          name: '', // Would need localization
          stat_id: mod.primaryStat.stat.unitStatId,
          value: parseInt(mod.primaryStat.stat.statValueDecimal, 10) / 10000,
          display_value: '',
        }
      : undefined,
    secondary_stats: mod.secondaryStat?.map((s) => ({
      name: '',
      stat_id: s.stat.unitStatId,
      value: parseInt(s.stat.statValueDecimal, 10) / 10000,
      display_value: '',
      roll: s.statRolls,
    })),
    character: characterBaseId,
  };
}

/**
 * Convert a Comlink roster unit to swgoh.gg unit format
 */
function adaptUnit(unit: ComlinkRosterUnit): SwgohGgUnit {
  const baseId = extractBaseId(unit.definitionId);
  const combatType = determineCombatType(baseId);
  const gearLevel = unit.currentTier || 1;

  // Keep relic_tier in RAW format to match swgoh.gg API format
  // Both APIs use same encoding: R1 = raw 3, R2 = raw 4, etc.
  // Consuming code converts to display format with: Math.max(0, relic_tier - 2)
  // 
  // Raw values:
  // - 0 or undefined: No relic data
  // - 1: Pre-relic (G1-G12, not unlocked yet)  
  // - 3: R1 (first relic, requires G13)
  // - 4-12: R2-R10
  const rawRelic = unit.relic?.currentTier ?? null;
  
  // Set relic_tier only for G13 units, null otherwise
  // This matches how swgoh.gg API returns data
  let relicTier: number | null = null;
  if (gearLevel === 13 && rawRelic !== null && rawRelic >= 1) {
    relicTier = rawRelic;
  }

  // Count zetas and omicrons from skills
  // The Comlink API provides isZeta and isOmicron boolean flags on each skill
  const zetaAbilities: string[] = [];
  const omicronAbilities: string[] = [];

  for (const skill of unit.skill || []) {
    if (skill.isZeta) {
      zetaAbilities.push(skill.id);
    }
    if (skill.isOmicron) {
      omicronAbilities.push(skill.id);
    }
  }

  // Calculate approximate power based on gear/relic
  // This is a rough estimate - actual power calculation is complex
  let power = 10000; // Base power
  power += gearLevel * 1000; // Gear adds power
  if (relicTier !== null && relicTier > 2) {
    // relicTier > 2 means R1 or higher (raw 3 = R1)
    power += (relicTier - 2) * 3000; // Relics add significant power
  }

  return {
    data: {
      base_id: baseId,
      name: getUnitDisplayName(baseId),
      gear_level: gearLevel,
      level: unit.currentLevel || 1,
      power: power,
      rarity: unit.currentRarity || 1,
      stats: {}, // Stats require separate calculation via swgoh-stats
      relic_tier: relicTier,
      is_galactic_legend: isGalacticLegend(baseId),
      combat_type: combatType,
      mod_set_ids: [], // Would need to parse from equippedStatMod
      zeta_abilities: zetaAbilities,
      omicron_abilities: omicronAbilities,
    },
  };
}

/**
 * Convert a full Comlink player response to swgoh.gg format
 */
export function adaptComlinkPlayerToSwgohGg(
  comlinkPlayer: ComlinkPlayerData
): SwgohGgFullPlayerResponse {
  const profileStats = comlinkPlayer.profileStat || [];

  // Extract league info from playerRating if available
  const leagueId = (comlinkPlayer as any).playerRating?.playerRankStatus?.leagueId || 100;
  const leagueName = LEAGUE_ID_TO_NAME[leagueId] || 'Kyber';

  // Extract skill rating
  const skillRating =
    (comlinkPlayer as any).playerRating?.playerSkillRating?.skillRating || 0;

  // Get GP values from profile stats
  const totalGp = getProfileStatValue(
    profileStats,
    'STAT_GALACTIC_POWER_ACQUIRED_NAME'
  );
  const characterGp = getProfileStatValue(
    profileStats,
    'STAT_CHARACTER_GALACTIC_POWER_ACQUIRED_NAME'
  );
  const shipGp = getProfileStatValue(
    profileStats,
    'STAT_SHIP_GALACTIC_POWER_ACQUIRED_NAME'
  );

  // Get GAC stats
  const seasonFullClears = getProfileStatValue(
    profileStats,
    'STAT_SEASON_FULL_CLEAR_ROUND_WINS_NAME'
  );
  const seasonDefends = getProfileStatValue(
    profileStats,
    'STAT_SEASON_SUCCESSFUL_DEFENDS_NAME'
  );
  const seasonOffenseWins = getProfileStatValue(
    profileStats,
    'STAT_SEASON_OFFENSIVE_BATTLES_WON_NAME'
  );
  const seasonUndersized = getProfileStatValue(
    profileStats,
    'STAT_SEASON_UNDERSIZED_SQUAD_WINS_NAME'
  );

  // Convert player data
  const playerData: SwgohGgPlayerData = {
    ally_code: parseInt(comlinkPlayer.allyCode, 10),
    name: comlinkPlayer.name,
    level: comlinkPlayer.level,
    galactic_power: totalGp,
    character_galactic_power: characterGp,
    ship_galactic_power: shipGp,
    skill_rating: skillRating,
    league_name: leagueName,
    guild_name: comlinkPlayer.guildName || '',
    guild_id: comlinkPlayer.guildId,
    last_updated: new Date().toISOString(),
    season_full_clears: seasonFullClears,
    season_successful_defends: seasonDefends,
    season_offensive_battles_won: seasonOffenseWins,
    season_undersized_squad_wins: seasonUndersized,
  };

  // Convert units
  const units: SwgohGgUnit[] = (comlinkPlayer.rosterUnit || []).map(adaptUnit);

  // Convert mods
  const mods: SwgohGgMod[] = [];
  for (const unit of comlinkPlayer.rosterUnit || []) {
    const baseId = extractBaseId(unit.definitionId);
    for (const mod of unit.equippedStatMod || []) {
      mods.push(adaptMod(mod, baseId));
    }
  }

  logger.debug(
    `Adapted Comlink player ${comlinkPlayer.name}: ${units.length} units, ${mods.length} mods`
  );

  return {
    data: playerData,
    units,
    mods,
  };
}

/**
 * Extract just the basic player data without roster
 */
export function adaptComlinkPlayerDataOnly(
  comlinkPlayer: ComlinkPlayerData
): SwgohGgPlayerData {
  const fullResponse = adaptComlinkPlayerToSwgohGg(comlinkPlayer);
  return fullResponse.data;
}
