/**
 * Client for interacting with SWGoH Comlink service.
 * Provides direct access to CG game APIs for real-time data.
 * 
 * @see https://github.com/swgoh-utils/swgoh-comlink
 */
import { logger } from '../../utils/logger';
import { API_ENDPOINTS } from '../../config/apiEndpoints';

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
  datacron?: ComlinkDatacron[];
  pvpProfile?: unknown[];
  seasonStatus?: unknown[];
}

export interface ProfileStat {
  nameKey: string;
  value: string;
  index: number;
}

/**
 * Datacron grid entry for a player. The tags array carries semantic hints
 * (e.g. "maulhatefueled", "vaderduelsend") that identify the buff theme.
 * Only `focused` datacrons have committed level-9 abilities — base ones are
 * just stat sticks waiting to be focused.
 */
export interface ComlinkDatacron {
  id: string;
  setId: number;
  templateId: string;
  tag: string[];
  affix: unknown[];
  rerollOption: unknown[];
  rerollIndex: number;
  rerollCount: number;
  locked: boolean;
  focused: boolean;
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
    profile: ComlinkGuildProfile;
    member: ComlinkGuildMember[];
    /** Present when includeRecentActivity=true. Empty if no TWs run. */
    recentTerritoryWarResult?: ComlinkRecentTw[];
    /** Present when includeRecentActivity=true. */
    recentRaidResult?: ComlinkRecentRaid[];
  };
}

export interface ComlinkGuildProfile {
  id: string;
  name: string;
  memberCount: number;
  memberMax: number;
  level: number;
  /** Decimal string */
  guildGalacticPower: string;
  bannerColorId?: string;
  bannerLogoId?: string;
  externalMessageKey?: string;
  enrollmentStatus?: number;
}

/**
 * Without HMAC auth, these per-member fields come back blank/zero except for
 * `playerId` and `memberLevel`. Use `getPlayerById(playerId)` for real per-member data.
 */
export interface ComlinkGuildMember {
  playerId: string;
  playerName: string;
  /** In-game player level (blank without HMAC) */
  playerLevel: number;
  /** Guild role: 2 = member, 3 = officer, 4 = leader (populated even without HMAC) */
  memberLevel: number;
  /** Decimal string; "0" without HMAC */
  galacticPower: string;
  /** Decimal string */
  characterGalacticPower: string;
  shipGalacticPower: string;
  guildJoinTime: string;
  lastActivityTime: string;
}

export interface ComlinkRecentTw {
  territoryWarId: string;
  /** Our score, decimal string */
  score: string;
  /** Their score, decimal string */
  opponentScore: string;
  /** Total guild GP at the time, number */
  power: number;
  /** Unix timestamp in seconds, decimal string */
  endTimeSeconds: string;
  startTime: string;
  opponentGuildProfile: {
    id: string;
    name: string;
    guildGalacticPower: string;
    bannerColorId?: string;
    bannerLogoId?: string;
  };
}

export interface ComlinkRecentRaid {
  raidId?: string;
  identifier?: string;
  raidMember: Array<{
    playerId: string;
    memberProgress: string;
    memberRank: number;
    memberAttempt: number;
  }>;
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
    this.url = config?.url ?? API_ENDPOINTS.COMLINK_DEFAULT;
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
   * Get player data by player ID (useful when we don't have the ally code)
   */
  async getPlayerById(playerId: string): Promise<ComlinkPlayerData> {
    return this.post<ComlinkPlayerData>('/player', {
      playerId,
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

  /**
   * Get the current active GAC event instance.
   * Returns the instance ID and event details.
   * 
   * Note: The `joined` flag from the events API doesn't indicate bracket availability.
   * Brackets may be available even when joined=false.
   */
  async getCurrentGacInstance(): Promise<{
    /** Full event ID (e.g., "CHAMPIONSHIPS_GRAND_ARENA_GA2_EVENT_SEASON_73") */
    eventId: string;
    /** Full eventInstanceId for leaderboard queries */
    eventInstanceId: string;
    /** Just the instance part (e.g., "O1765922400000") */
    instanceId: string;
    /** Whether we're within the event time window */
    isActive: boolean;
    startTime: number;
    endTime: number;
  } | null> {
    try {
      const events = await this.getEvents();
      const gacEvent = events.gameEvent.find(e => 
        e.id.includes('CHAMPIONSHIPS_GRAND_ARENA')
      );

      if (!gacEvent || !gacEvent.instance) {
        return null;
      }

      const now = Date.now();
      const activeInstance = gacEvent.instance.find(inst => {
        const start = parseInt(inst.startTime, 10);
        const end = parseInt(inst.endTime, 10);
        return now >= start && now <= end;
      });

      if (!activeInstance) {
        return null;
      }

      // The correct eventInstanceId format for leaderboard queries:
      // CHAMPIONSHIPS_GRAND_ARENA_GA2_EVENT_SEASON_73:O1765922400000
      const eventInstanceId = `${gacEvent.id}:${activeInstance.id}`;

      return {
        eventId: gacEvent.id,
        eventInstanceId,
        instanceId: activeInstance.id,
        isActive: true,
        startTime: parseInt(activeInstance.startTime, 10),
        endTime: parseInt(activeInstance.endTime, 10),
      };
    } catch (error) {
      logger.warn('Failed to get current GAC instance:', error);
      return null;
    }
  }

  /**
   * Find a player's GAC bracket by searching through brackets.
   * This is used when we don't know the bracketId from swgoh.gg.
   * 
   * @param playerId - The player's ID (from Comlink)
   * @param playerName - The player's name (fallback match)
   * @param eventInstanceId - The event instance ID
   * @param league - The player's league (e.g., "AURODIUM")
   * @param options - Search options
   * @returns The bracket data if found, null otherwise
   */
  async findPlayerBracket(
    playerId: string,
    playerName: string,
    eventInstanceId: string,
    league: string,
    options: {
      /** Maximum brackets to search (default: 10000) */
      maxBrackets?: number;
      /** Hint - start searching near this bracket ID first */
      hintBracketId?: number;
      /** Range to search around the hint before expanding (default: 200) */
      hintRange?: number;
    } = {}
  ): Promise<{
    bracketId: number;
    players: ComlinkBracketPlayer[];
    yourData: ComlinkBracketPlayer;
  } | null> {
    const { maxBrackets = 10000, hintBracketId, hintRange = 200 } = options;
    const batchSize = 100;

    // Helper function to search a range of brackets
    const searchRange = async (startBracket: number, endBracket: number): Promise<{
      bracketId: number;
      players: ComlinkBracketPlayer[];
      yourData: ComlinkBracketPlayer;
    } | null> => {
      for (let start = startBracket; start < endBracket; start += batchSize) {
        const promises: Promise<{ bracketId: number; data: ComlinkBracketResponse | null }>[] = [];
        
        for (let i = start; i < start + batchSize && i < endBracket; i++) {
          const groupId = `${eventInstanceId}:${league}:${i}`;
          
          promises.push(
            this.getGacBracketLeaderboard(eventInstanceId, groupId)
              .then(data => ({ bracketId: i, data }))
              .catch(() => ({ bracketId: i, data: null }))
          );
        }

        const results = await Promise.all(promises);
        
        for (const { bracketId, data } of results) {
          if (data?.leaderboard?.[0]?.player) {
            const players = data.leaderboard[0].player;
            
            // Check if our player is in this bracket
            const ourPlayer = players.find(p => 
              p.id === playerId || p.name.toLowerCase() === playerName.toLowerCase()
            );
            
            if (ourPlayer) {
              logger.info(`Found player ${playerName} in Comlink bracket ${bracketId}`);
              return {
                bracketId,
                players: players.sort((a, b) => {
                  const rankA = a.pvpStatus?.rank ?? 999;
                  const rankB = b.pvpStatus?.rank ?? 999;
                  return rankA - rankB;
                }),
                yourData: ourPlayer,
              };
            }
          }
        }
      }
      return null;
    };

    // If we have a hint, search around it first
    if (hintBracketId !== undefined && hintBracketId >= 0) {
      const hintStart = Math.max(0, hintBracketId - hintRange);
      const hintEnd = Math.min(maxBrackets, hintBracketId + hintRange);
      
      logger.info(`Searching near hint bracket ${hintBracketId} (${hintStart}-${hintEnd})...`);
      const result = await searchRange(hintStart, hintEnd);
      if (result) return result;
      
      // Hint didn't work, search the rest (excluding the hint range)
      logger.info(`Hint search failed, searching all brackets...`);
      
      // Search before the hint range
      if (hintStart > 0) {
        const result = await searchRange(0, hintStart);
        if (result) return result;
      }
      
      // Search after the hint range
      if (hintEnd < maxBrackets) {
        const result = await searchRange(hintEnd, maxBrackets);
        if (result) return result;
      }
    } else {
      // No hint, search from the beginning
      for (let start = 0; start < maxBrackets; start += batchSize) {
        const result = await searchRange(start, Math.min(start + batchSize, maxBrackets));
        if (result) return result;

        // Log progress every 500 brackets
        if (start > 0 && start % 500 === 0) {
          logger.debug(`Searched ${start} Comlink brackets, continuing...`);
        }
      }
    }

    return null;
  }
}

// Export a default instance
export const comlinkClient = new ComlinkClient();

