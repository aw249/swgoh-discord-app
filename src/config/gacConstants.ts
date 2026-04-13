import { gameDataService } from '../services/gameDataService';

/**
 * @deprecated Use gameDataService.getAllGalacticLegends() instead for dynamic list
 * This static list is kept as a fallback when GameDataService is not initialized.
 */
export const GALACTIC_LEGEND_IDS = [
  'GLREY', 'SUPREMELEADERKYLOREN', 'GRANDMASTERLUKE', 'SITHPALPATINE',
  'JEDIMASTERKENOBI', 'LORDVADER', 'JABBATHEHUTT', 'GLLEIA',
  'GLAHSOKATANO', 'GLHONDO'
] as const;

/**
 * @deprecated Use gameDataService.getUnitName(baseId) instead
 * This static map is kept as a fallback when GameDataService is not initialized.
 */
export const GL_NAMES: Record<string, string> = {
  'GLREY': 'Rey', 'SUPREMELEADERKYLOREN': 'Supreme Leader Kylo Ren',
  'GRANDMASTERLUKE': 'Jedi Master Luke Skywalker',
  'SITHPALPATINE': 'Sith Eternal Emperor',
  'JEDIMASTERKENOBI': 'Jedi Master Kenobi', 'LORDVADER': 'Lord Vader',
  'JABBATHEHUTT': 'Jabba the Hutt', 'GLLEIA': 'Leia Organa',
  'GLAHSOKATANO': 'Ahsoka Tano', 'GLHONDO': 'Hondo Ohnaka'
};

export const MAX_DEFENSIVE_SQUADS_BY_LEAGUE: Record<string, { '5v5': number; '3v3': number }> = {
  'Kyber': { '5v5': 11, '3v3': 15 },
  'Aurodium': { '5v5': 9, '3v3': 13 },
  'Chromium': { '5v5': 7, '3v3': 10 },
  'Bronzium': { '5v5': 5, '3v3': 7 },
  'Carbonite': { '5v5': 3, '3v3': 3 }
};

/**
 * Check if a unit is a Galactic Legend.
 * Uses GameDataService for accurate detection when available.
 */
export function isGalacticLegend(baseId: string): boolean {
  if (gameDataService.isReady()) {
    return gameDataService.isGalacticLegend(baseId);
  }
  // Fallback to static list
  return GALACTIC_LEGEND_IDS.includes(baseId as typeof GALACTIC_LEGEND_IDS[number]);
}

/**
 * Get the display name for a Galactic Legend.
 * Uses GameDataService for accurate names when available.
 */
export function getGLName(baseId: string): string {
  if (gameDataService.isReady()) {
    return gameDataService.getUnitName(baseId);
  }
  // Fallback to static map
  return GL_NAMES[baseId] || baseId;
}

/**
 * Normalise a league name to title case (e.g. 'KYBER' -> 'Kyber').
 */
export function normaliseLeague(league: string): string {
  if (!league) return league;
  return league.charAt(0).toUpperCase() + league.slice(1).toLowerCase();
}

export function getMaxSquadsForLeague(league: string | null | undefined, format: string = '5v5'): number {
  if (!league) return format === '3v3' ? 15 : 11;
  const normalizedLeague = normaliseLeague(league);
  const leagueData = MAX_DEFENSIVE_SQUADS_BY_LEAGUE[normalizedLeague];
  if (!leagueData) return format === '3v3' ? 15 : 11;
  return leagueData[format as '5v5' | '3v3'] ?? (format === '3v3' ? 15 : 11);
}
