/**
 * Client for interacting with SWGoH Comlink service.
 * Provides direct access to CG game APIs for real-time data.
 * 
 * @see https://github.com/swgoh-utils/swgoh-comlink
 */
import { logger } from '../../utils/logger';

export interface ComlinkConfig {
  url: string;
  accessKey?: string;
  secretKey?: string;
}

export interface ComlinkPlayerData {
  allyCode: string;
  playerId: string;
  name: string;
  level: number;
  guildId?: string;
  guildName?: string;
  profileStat: ProfileStat[];
  rosterUnit: ComlinkRosterUnit[];
  datacron?: unknown[];
  pvpProfile?: unknown[];
  seasonStatus?: unknown[];
}

export interface ProfileStat {
  nameKey: string;
  value: string;
  index: number;
}

export interface ComlinkRosterUnit {
  id: string;
  definitionId: string;
  currentRarity: number;
  currentLevel: number;
  currentXp: number;
  currentTier: number;
  relic?: {
    currentTier: number;
  };
  skill: ComlinkSkill[];
  equipment: unknown[];
  equippedStatMod: ComlinkMod[];
  purchasedAbilityId: string[];
}

export interface ComlinkSkill {
  id: string;
  tier: number;
  isZeta?: boolean;
  isOmicron?: boolean;
}

export interface ComlinkMod {
  id: string;
  definitionId: string;
  level: number;
  tier: number;
  primaryStat: ComlinkModStat;
  secondaryStat: ComlinkModStat[];
}

export interface ComlinkModStat {
  stat: {
    unitStatId: number;
    statValueDecimal: string;
    unscaledDecimalValue: string;
  };
  statRolls: number;
}

export interface ComlinkGuildData {
  guild: {
    profile: {
      id: string;
      name: string;
      memberCount: number;
      guildGalacticPower: string;
    };
    member: ComlinkGuildMember[];
  };
}

export interface ComlinkGuildMember {
  playerId: string;
  playerName: string;
  memberLevel: number;
  galacticPower: number;
  guildJoinTime: string;
}

export interface ComlinkGacEvent {
  id: string;
  type: number;
  status: number;
  nameKey: string;
  seasonDefId: string;
  territoryMapId: string;
  instance: ComlinkGacEventInstance[];
}

export interface ComlinkGacEventInstance {
  id: string;
  startTime: string;
  endTime: string;
  displayStartTime: string;
  displayEndTime: string;
  timeLimited: boolean;
  joined: boolean;
}

export interface ComlinkLeaderboardPlayer {
  id: string;
  name: string;
  level: number;
  guild?: {
    id: string;
    name: string;
  };
  isFake: boolean;
  power: number;
  portrait?: unknown;
  seasonsLifetimeScore: number;
  seasonLeagueId: number;
  playerRating: {
    playerSkillRating: {
      skillRating: number;
    };
    playerRankStatus: {
      leagueId: number;
      divisionId: number;
    };
  };
  tier: number;
  squadUnit?: unknown[];
  pvpStatus?: unknown[];
  title?: unknown;
}

export interface ComlinkLeaderboardEntry {
  player: ComlinkLeaderboardPlayer[];
  id: string;
  playerStatus: unknown[];
}

export interface ComlinkLeaderboardResponse {
  player: unknown[];
  leaderboard: ComlinkLeaderboardEntry[];
}

/**
 * Comlink bracket player data from getLeaderboard type 4
 * Note: Comlink returns 'id' (player ID) not ally code for bracket data
 */
export interface ComlinkBracketPlayer {
  id: string;  // Player ID (not ally code - Comlink doesn't provide ally codes in bracket data)
  name: string;
  level: number;
  guild?: {
    id: string;
    name: string;
  };
  isFake: boolean;
  power: number;
  pvpStatus?: {
    rank: number;
    score: number;
  };
}

/**
 * Comlink bracket response from getLeaderboard type 4
 */
export interface ComlinkBracketResponse {
  player: unknown[];
  leaderboard: Array<{
    player: ComlinkBracketPlayer[];
    id: string;
    playerStatus: unknown[];
  }>;
  playerStatus?: unknown[];
}

export interface ComlinkPlayerArenaProfile {
  pvpProfile: {
    tab: number;
    rank: number;
    squad: {
      cell: ComlinkSquadCell[];
      datacron?: unknown;
    };
  }[];
}

export interface ComlinkSquadCell {
  unitId: string;
  unitDefId: string;
  cellIndex: number;
  squadUnitType: number;
}

// Enum constants for GAC
export const GacLeague = {
  CARBONITE: 20,
  BRONZIUM: 40,
  CHROMIUM: 60,
  AURODIUM: 80,
  KYBER: 100,
} as const;

export const GacDivision = {
  DIVISION_5: 5,
  DIVISION_4: 10,
  DIVISION_3: 15,
  DIVISION_2: 20,
  DIVISION_1: 25,
} as const;

export class ComlinkClient {
  private readonly url: string;
  private readonly accessKey: string;
  private readonly secretKey: string;

  constructor(config?: Partial<ComlinkConfig>) {
    this.url = config?.url ?? process.env.COMLINK_URL ?? 'http://localhost:3200';
    this.accessKey = config?.accessKey ?? process.env.COMLINK_ACCESS_KEY ?? '';
    this.secretKey = config?.secretKey ?? process.env.COMLINK_SECRET_KEY ?? '';
  }

  /**
   * Make a POST request to the Comlink API
   */
  private async post<T>(endpoint: string, payload: unknown = {}): Promise<T> {
    try {
      const response = await fetch(`${this.url}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Add HMAC auth headers if keys are configured
          ...(this.accessKey && this.secretKey ? this.getAuthHeaders(endpoint, payload) : {}),
        },
        body: JSON.stringify({ payload }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Comlink API error (${response.status}): ${errorText}`);
      }

      return await response.json() as T;
    } catch (error) {
      logger.error(`Comlink API error for ${endpoint}:`, error);
      throw error;
    }
  }

  /**
   * Generate HMAC authentication headers (if access/secret keys configured)
   */
  private getAuthHeaders(endpoint: string, payload: unknown): Record<string, string> {
    // For now, return empty - HMAC implementation can be added if needed
    // The npm package has the implementation if we need it
    return {};
  }

  /**
   * Check if the Comlink service is ready
   */
  async isReady(): Promise<boolean> {
    try {
      const response = await fetch(`${this.url}/readyz`);
      const data = await response.json() as { status: string };
      return data.status === 'ok';
    } catch {
      return false;
    }
  }

  /**
   * Get metadata about the current game state
   */
  async getMetadata(): Promise<unknown> {
    return this.post('/metadata');
  }

  /**
   * Get player data by ally code
   */
  async getPlayer(allyCode: string): Promise<ComlinkPlayerData> {
    return this.post<ComlinkPlayerData>('/player', {
      allyCode: allyCode.replace(/-/g, ''),
    });
  }

  /**
   * Get player arena profile (includes current arena squads)
   */
  async getPlayerArena(allyCode: string): Promise<ComlinkPlayerArenaProfile> {
    return this.post<ComlinkPlayerArenaProfile>('/playerArena', {
      allyCode: allyCode.replace(/-/g, ''),
    });
  }

  /**
   * Get guild data by guild ID
   */
  async getGuild(guildId: string, includeRecentActivity = false): Promise<ComlinkGuildData> {
    return this.post<ComlinkGuildData>('/guild', {
      guildId,
      includeRecentGuildActivityInfo: includeRecentActivity,
    });
  }

  /**
   * Search for guilds by name
   */
  async searchGuilds(name: string, startIndex = 0, count = 10): Promise<unknown> {
    return this.post('/getGuilds', {
      filterType: 4,
      name,
      startIndex,
      count,
    });
  }

  /**
   * Get current game events (includes GAC schedule)
   */
  async getEvents(): Promise<{ gameEvent: ComlinkGacEvent[] }> {
    return this.post('/getEvents');
  }

  /**
   * Get current GAC events specifically
   */
  async getCurrentGacEvents(): Promise<ComlinkGacEvent[]> {
    const events = await this.getEvents();
    return events.gameEvent.filter(
      (e) => e.id.includes('CHAMPIONSHIPS') || e.id.includes('GRAND_ARENA')
    );
  }

  /**
   * Get GAC leaderboard for a specific league and division
   * @param league - League enum (CARBONITE=20, BRONZIUM=40, CHROMIUM=60, AURODIUM=80, KYBER=100)
   * @param division - Division enum (DIV5=5, DIV4=10, DIV3=15, DIV2=20, DIV1=25)
   */
  async getGacLeaderboard(
    league: number,
    division: number
  ): Promise<ComlinkLeaderboardResponse> {
    return this.post<ComlinkLeaderboardResponse>('/getLeaderboard', {
      leaderboardType: 6,
      league,
      division,
    });
  }

  /**
   * Get GAC bracket leaderboard for a specific bracket group
   * @param eventInstanceId - Event instance ID (e.g., "CHAMPIONSHIPS_GRAND_ARENA_GA2_EVENT_SEASON_73:O1765317600000")
   * @param groupId - Group ID including bracket number
   */
  async getGacBracketLeaderboard(
    eventInstanceId: string,
    groupId: string
  ): Promise<ComlinkBracketResponse> {
    return this.post<ComlinkBracketResponse>('/getLeaderboard', {
      leaderboardType: 4,
      eventInstanceId,
      groupId,
    });
  }

  /**
   * Get real-time GAC bracket data using swgoh.gg bracket metadata.
   * Constructs the proper IDs from swgoh.gg bracket info and fetches live data.
   * 
   * Note: Comlink bracket data contains player IDs, not ally codes.
   * The returned data should be merged with swgoh.gg data to get ally codes.
   * 
   * @param seasonId - Season ID (e.g., "CHAMPIONSHIPS_GRAND_ARENA_GA2_EVENT_SEASON_73")
   * @param eventId - Event ID (e.g., "O1765317600000")
   * @param leagueId - League ID (e.g., "AURODIUM")
   * @param bracketId - Bracket number
   */
  async getLiveBracketData(
    seasonId: string,
    eventId: string,
    leagueId: string,
    bracketId: number
  ): Promise<ComlinkBracketPlayer[]> {
    const eventInstanceId = `${seasonId}:${eventId}`;
    const groupId = `${eventInstanceId}:${leagueId}:${bracketId}`;

    logger.debug(`Fetching live bracket data with groupId: ${groupId}`);

    const response = await this.getGacBracketLeaderboard(eventInstanceId, groupId);

    if (!response.leaderboard || response.leaderboard.length === 0) {
      throw new Error('No bracket data returned from Comlink');
    }

    const players = response.leaderboard[0].player;
    if (!players || players.length === 0) {
      throw new Error('No players in bracket data');
    }

    // Sort by rank and return
    return players.sort((a, b) => {
      const rankA = a.pvpStatus?.rank ?? 999;
      const rankB = b.pvpStatus?.rank ?? 999;
      return rankA - rankB;
    });
  }

  /**
   * Get game data (units, abilities, etc.)
   */
  async getGameData(version?: string, includePveUnits = true): Promise<unknown> {
    return this.post('/data', {
      version: version ?? '',
      includePveUnits,
      requestSegment: 0,
    });
  }

  /**
   * Get localization bundle
   */
  async getLocalization(bundleId: string, unzip = true): Promise<unknown> {
    return this.post('/localization', {
      id: bundleId,
      unzip,
    });
  }

  /**
   * Get enum values used in the game data
   */
  async getEnums(): Promise<unknown> {
    const response = await fetch(`${this.url}/enums`);
    return response.json();
  }
}

// Export a default instance
export const comlinkClient = new ComlinkClient();

