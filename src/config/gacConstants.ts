export const GALACTIC_LEGEND_IDS = [
  'GLREY', 'SUPREMELEADERKYLOREN', 'GRANDMASTERLUKE', 'SITHPALPATINE',
  'JEDIMASTERKENOBI', 'LORDVADER', 'JABBATHEHUTT', 'GLLEIA',
  'GLAHSOKATANO', 'GLHONDO'
] as const;

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

export function isGalacticLegend(baseId: string): boolean {
  return GALACTIC_LEGEND_IDS.includes(baseId as typeof GALACTIC_LEGEND_IDS[number]);
}

export function getMaxSquadsForLeague(league: string | null | undefined, format: string = '5v5'): number {
  if (!league) return format === '3v3' ? 15 : 11;
  const normalizedLeague = league.charAt(0).toUpperCase() + league.slice(1).toLowerCase();
  const leagueData = MAX_DEFENSIVE_SQUADS_BY_LEAGUE[normalizedLeague];
  if (!leagueData) return format === '3v3' ? 15 : 11;
  return leagueData[format as '5v5' | '3v3'] ?? (format === '3v3' ? 15 : 11);
}

/**
 * Ideal teammates for each GL, ordered by priority.
 * These are the characters that have the best synergy with each GL.
 * Used when forcing a GL onto offense/defense and no swgoh.gg data is available.
 */
export const GL_IDEAL_TEAMMATES: Record<string, string[]> = {
  // Rey - Resistance heroes
  'GLREY': [
    'BENSOLO', 'REYJEDITRAINING', 'FINN', 'BB8', 'RESISTANCETROOPER',
    'POE', 'HOLDO', 'ROSETICO', 'YOURPRINCESS', 'YOURGENERAL'
  ],
  // Supreme Leader Kylo Ren - First Order
  'SUPREMELEADERKYLOREN': [
    'FIRSTORDEROFFICERMALE', 'KYLORENUNMASKED', 'KYLOREN', 'GENERALHUX',
    'FIRSTORDERSTORMTROOPER', 'FIRSTORDEREXECUTIONER', 'FIRSTORDERSPECIALFORCESPILOT',
    'FOTP', 'FOSFTIEECHIM', 'SITHTROOPER'
  ],
  // Jedi Master Luke - Jedi heroes
  'GRANDMASTERLUKE': [
    'HERMITYODA', 'JEDIKNIGHTLUKE', 'OLDBENKENOBI', 'GRANDMASTERYODA',
    'JEDIKNIGHTCAL', 'JOLEEBINDO', 'BASTILASHAN', 'GENERALKENOBI',
    'EZRABRIDGERS3', 'YOUNGCHEWBACCA'
  ],
  // Sith Eternal Emperor - Sith/Empire
  'SITHPALPATINE': [
    'VADER', 'DARTHREVAN', 'DARTHMALAK', 'BASTILASHANDARK', 'SITHTROOPER',
    'DARTHNIHILUS', 'DARTHTRAYA', 'SITHMARAUDER', 'SITHASSASSIN', 'WATTAMBOR'
  ],
  // Jedi Master Kenobi - Galactic Republic
  'JEDIMASTERKENOBI': [
    'COMMANDERAHSOKA', 'GENERALKENOBI', 'GRANDMASTERYODA', 'ANAKINKNIGHT',
    'PADMEAMIDALA', 'SHAAKTI', 'AHSOKATANO', 'MACEWINDU', 'KITFISTO', 'PLOKOON'
  ],
  // Lord Vader - Empire/501st
  'LORDVADER': [
    'MARAJADE', 'ADMIRALPIETT', 'THRAWN', 'IMPERIALPROBEDROID',
    'ROYALGUARD', 'STORMTROOPER', 'DIRECTORKRENNIC', 'TARKINADMIRAL',
    'TIEFIGHTERPILOT', 'DEATHTROOPER'
  ],
  // Jabba the Hutt - Smugglers/Bounty Hunters
  'JABBATHEHUTT': [
    'KRRSANTAN', 'BOUSHH', 'EMILANBLETHE', 'SKIFFGUARD', 'BOBAFETT',
    'BOSSK', 'DENGAR', 'CADBANE', 'GREEDO', 'IG88'
  ],
  // Leia Organa - Rebels
  'GLLEIA': [
    'CAPTAINDROGAN', 'R2D2_LEGENDARY', 'YOURPRINCESS', 'YOURGENERAL',
    'HANSOLO', 'CHEWBACCALEGENDARY', 'ADMIRALRADDUS', 'K2SO', 'CASSIANANDOR', 'JYNERSO'
  ],
  // Ahsoka Tano - New Republic/Mandalorians
  'GLAHSOKATANO': [
    'SABINEWRENS3', 'HERASYNDULLAS3', 'EZRABRIDGERS3', 'CHOPPERS3',
    'ZEBS3', 'MANDALORBOKATAN', 'THEMANDALORIAN', 'GROGU', 'PAZVIZSLA', 'IG12'
  ],
  // Hondo Ohnaka - Smugglers/Scoundrels
  'GLHONDO': [
    'YOUNGCHEWBACCA', 'YOUNGLANDO', 'AURRA_SING', 'EMILANBLETHE',
    'DASHRENDAR', 'VANDOR_CHEWBACCA', 'QI-RA', 'L3_37', 'ENFYSNEST', 'NEST'
  ]
};

/**
 * Get ideal teammates for a GL, filtered by what's available in the roster.
 * @param glBaseId - The GL's base ID
 * @param availableCharacters - Set of available character base IDs
 * @param count - Number of teammates needed
 * @returns Array of teammate base IDs
 */
export function getIdealTeammatesForGL(
  glBaseId: string,
  availableCharacters: Set<string>,
  count: number
): string[] {
  const idealTeammates = GL_IDEAL_TEAMMATES[glBaseId] || [];
  
  // Filter to only available characters and take the first 'count'
  const available = idealTeammates.filter(id => availableCharacters.has(id));
  
  return available.slice(0, count);
}
