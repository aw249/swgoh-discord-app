/**
 * Combined API client that uses Comlink as the primary data source
 * and falls back to swgoh.gg if Comlink is unavailable.
 * 
 * This provides a seamless transition path from swgoh.gg to Comlink.
 */
import { SwgohGgApiClient, SwgohGgFullPlayerResponse, SwgohGgPlayerData, GacDefensiveSquad, GacCounterSquad, GacTopDefenseSquad, GacBracketData, GacBracketPlayer } from '../swgohGgApi';
import { ComlinkClient, ComlinkBracketPlayer } from './comlinkClient';
import { adaptComlinkPlayerToSwgohGg, adaptComlinkPlayerDataOnly } from './dataAdapter';
import { logger } from '../../utils/logger';

/**
 * Enhanced bracket data with real-time information and current opponent
 */
export interface LiveBracketData extends GacBracketData {
  /** Current round number (1-3) */
  currentRound: number;
  /** Your current opponent for this round, if determinable */
  currentOpponent: GacBracketPlayer | null;
  /** Whether the data is from Comlink (real-time) or swgoh.gg (cached) */
  isRealTime: boolean;
}

export interface CombinedClientConfig {
  /** Prefer Comlink over swgoh.gg (default: true) */
  preferComlink?: boolean;
  /** Comlink server URL */
  comlinkUrl?: string;
  /** Fall back to swgoh.gg on Comlink errors (default: true) */
  fallbackToSwgohGg?: boolean;
}

export class CombinedApiClient {
  private readonly comlinkClient: ComlinkClient;
  private readonly swgohGgClient: SwgohGgApiClient;
  private readonly preferComlink: boolean;
  private readonly fallbackToSwgohGg: boolean;
  private comlinkAvailable: boolean = true;
  private lastComlinkCheck: number = 0;
  private readonly comlinkCheckInterval = 60000; // Check every 60 seconds

  constructor(
    swgohGgClient: SwgohGgApiClient,
    config: CombinedClientConfig = {}
  ) {
    this.swgohGgClient = swgohGgClient;
    this.comlinkClient = new ComlinkClient({
      url: config.comlinkUrl ?? process.env.COMLINK_URL ?? 'http://localhost:3200',
    });
    this.preferComlink = config.preferComlink ?? true;
    this.fallbackToSwgohGg = config.fallbackToSwgohGg ?? true;
  }

  /**
   * Check if Comlink is available (with caching to avoid too many checks)
   */
  private async isComlinkAvailable(): Promise<boolean> {
    const now = Date.now();
    if (now - this.lastComlinkCheck < this.comlinkCheckInterval) {
      return this.comlinkAvailable;
    }

    this.lastComlinkCheck = now;
    try {
      this.comlinkAvailable = await this.comlinkClient.isReady();
      if (!this.comlinkAvailable) {
        logger.warn('Comlink service is not available, will use swgoh.gg fallback');
      }
    } catch (error) {
      this.comlinkAvailable = false;
      logger.warn('Failed to check Comlink availability:', error);
    }

    return this.comlinkAvailable;
  }

  /**
   * Get full player data (roster, mods, etc.)
   * Tries Comlink first, falls back to swgoh.gg if unavailable.
   * 
   * NOTE: Comlink data does NOT include calculated stats (Health, Speed, Protection, etc.)
   * For operations that need stats, use getFullPlayerWithStats() instead.
   */
  async getFullPlayer(allyCode: string): Promise<SwgohGgFullPlayerResponse> {
    const normalizedAllyCode = allyCode.replace(/-/g, '');

    // Try Comlink first if preferred and available
    if (this.preferComlink && await this.isComlinkAvailable()) {
      try {
        logger.debug(`Fetching player ${normalizedAllyCode} from Comlink...`);
        const comlinkData = await this.comlinkClient.getPlayer(normalizedAllyCode);
        const adapted = adaptComlinkPlayerToSwgohGg(comlinkData);
        logger.info(
          `Got player ${adapted.data.name} from Comlink: ${adapted.units.length} units, GP: ${adapted.data.galactic_power.toLocaleString()}`
        );
        return adapted;
      } catch (error) {
        logger.warn(`Comlink failed for player ${normalizedAllyCode}:`, error);
        if (!this.fallbackToSwgohGg) {
          throw error;
        }
        logger.info('Falling back to swgoh.gg...');
      }
    }

    // Fall back to swgoh.gg
    logger.debug(`Fetching player ${normalizedAllyCode} from swgoh.gg...`);
    return this.swgohGgClient.getFullPlayer(normalizedAllyCode);
  }

  /**
   * Get full player data WITH calculated stats (Health, Speed, Protection, etc.)
   * Always uses swgoh.gg since Comlink doesn't provide calculated stats.
   * 
   * Use this for:
   * - Player comparisons
   * - Mod analysis
   * - Any feature that needs actual stat values
   */
  async getFullPlayerWithStats(allyCode: string): Promise<SwgohGgFullPlayerResponse> {
    const normalizedAllyCode = allyCode.replace(/-/g, '');
    logger.debug(`Fetching player ${normalizedAllyCode} from swgoh.gg (with stats)...`);
    return this.swgohGgClient.getFullPlayer(normalizedAllyCode);
  }

  /**
   * Get basic player data (without full roster)
   */
  async getPlayer(allyCode: string): Promise<SwgohGgPlayerData> {
    const normalizedAllyCode = allyCode.replace(/-/g, '');

    if (this.preferComlink && await this.isComlinkAvailable()) {
      try {
        const comlinkData = await this.comlinkClient.getPlayer(normalizedAllyCode);
        return adaptComlinkPlayerDataOnly(comlinkData);
      } catch (error) {
        logger.warn(`Comlink failed for player ${normalizedAllyCode}:`, error);
        if (!this.fallbackToSwgohGg) {
          throw error;
        }
      }
    }

    const response = await this.swgohGgClient.getFullPlayer(normalizedAllyCode);
    return response.data;
  }

  /**
   * Get GAC bracket data from swgoh.gg (for bracket discovery)
   */
  async getGacBracket(allyCode: string): Promise<GacBracketData> {
    return this.swgohGgClient.getGacBracket(allyCode);
  }

  /**
   * Get live GAC bracket data with real-time standings and current opponent.
   * 
   * This hybrid approach:
   * 1. Gets bracket metadata from swgoh.gg (seasonId, eventId, leagueId, bracketId)
   * 2. Refreshes with Comlink for real-time standings
   * 3. Determines current opponent based on round matchups
   * 
   * @param allyCode - Your ally code
   * @returns Live bracket data with current opponent
   */
  async getLiveBracketWithOpponent(allyCode: string): Promise<LiveBracketData> {
    const normalizedAllyCode = allyCode.replace(/-/g, '');

    // Step 1: Get bracket metadata from swgoh.gg
    logger.info(`Fetching bracket metadata from swgoh.gg for ${normalizedAllyCode}...`);
    const bracketMeta = await this.swgohGgClient.getGacBracket(normalizedAllyCode);

    // Step 2: Try to refresh with Comlink for real-time data
    let players = bracketMeta.bracket_players;
    let isRealTime = false;

    if (this.preferComlink && await this.isComlinkAvailable()) {
      try {
        logger.info(`Refreshing bracket with Comlink (${bracketMeta.season_id}:${bracketMeta.event_id})...`);
        const liveData = await this.comlinkClient.getLiveBracketData(
          bracketMeta.season_id,
          bracketMeta.event_id,
          bracketMeta.league,
          bracketMeta.bracket_id
        );

        // Update player data with real-time standings
        players = this.mergeComlinkBracketData(bracketMeta.bracket_players, liveData);
        isRealTime = true;
        logger.info(`Got real-time bracket data from Comlink (${players.length} players)`);
      } catch (error) {
        logger.warn('Failed to get real-time bracket from Comlink, using swgoh.gg data:', error);
      }
    }

    // Step 3: Determine current round and opponent
    const currentRound = this.calculateCurrentRound(bracketMeta.start_time);
    const currentOpponent = this.findCurrentOpponent(players, normalizedAllyCode, currentRound);

    return {
      ...bracketMeta,
      bracket_players: players,
      currentRound,
      currentOpponent,
      isRealTime,
    };
  }

  /**
   * Merge Comlink real-time data into swgoh.gg bracket format.
   * 
   * Comlink doesn't provide ally codes in bracket data, so we match by player name
   * and use swgoh.gg's ally codes as the canonical reference.
   */
  private mergeComlinkBracketData(
    swgohGgPlayers: GacBracketPlayer[],
    comlinkPlayers: ComlinkBracketPlayer[]
  ): GacBracketPlayer[] {
    // Create a map for fast lookup by normalized name
    const comlinkByName = new Map<string, ComlinkBracketPlayer>();
    for (const cp of comlinkPlayers) {
      comlinkByName.set(cp.name.toLowerCase().trim(), cp);
    }

    // Update swgoh.gg players with real-time data from Comlink
    return swgohGgPlayers.map(sgPlayer => {
      const normalizedName = sgPlayer.player_name.toLowerCase().trim();
      const comlinkPlayer = comlinkByName.get(normalizedName);

      if (comlinkPlayer) {
        // Found matching player - update with real-time standings
        return {
          ...sgPlayer,
          player_gp: comlinkPlayer.power,
          guild_id: comlinkPlayer.guild?.id ?? sgPlayer.guild_id,
          guild_name: comlinkPlayer.guild?.name ?? sgPlayer.guild_name,
          bracket_rank: comlinkPlayer.pvpStatus?.rank ?? sgPlayer.bracket_rank,
          bracket_score: comlinkPlayer.pvpStatus?.score ?? sgPlayer.bracket_score,
        };
      }

      // No Comlink match - keep original swgoh.gg data
      logger.warn(`No Comlink match for player: ${sgPlayer.player_name}`);
      return sgPlayer;
    }).sort((a, b) => a.bracket_rank - b.bracket_rank);
  }

  /**
   * Calculate the current round based on event start time.
   * GAC rounds: Round 1 (day 1-2), Round 2 (day 3-4), Round 3 (day 5-6)
   */
  private calculateCurrentRound(startTime: string): number {
    const start = new Date(startTime);
    const now = new Date();
    const daysSinceStart = Math.floor((now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));

    if (daysSinceStart < 2) return 1;
    if (daysSinceStart < 4) return 2;
    return 3;
  }

  /**
   * Find the current opponent based on matchup logic.
   * 
   * GAC uses a deterministic matchup system based on bracket position:
   * - Round 1: 1v8, 2v7, 3v6, 4v5 (by seed/starting rank)
   * - Round 2: Winners play winners, losers play losers (based on score + tiebreakers)
   * - Round 3: Final matchups based on standings
   * 
   * For simplicity, we match players with the same score, preferring closest GP.
   */
  private findCurrentOpponent(
    players: GacBracketPlayer[],
    yourAllyCode: string,
    currentRound: number
  ): GacBracketPlayer | null {
    const you = players.find(p => p.ally_code.toString() === yourAllyCode);
    if (!you) {
      logger.warn(`Player ${yourAllyCode} not found in bracket`);
      return null;
    }

    // Get all other players
    const opponents = players.filter(p => p.ally_code.toString() !== yourAllyCode);

    if (currentRound === 1) {
      // Round 1: Match by seed position (1v8, 2v7, 3v6, 4v5)
      // Since everyone has score 0, we use rank to determine seed
      const yourSeed = you.bracket_rank;
      const targetSeed = 9 - yourSeed; // 1↔8, 2↔7, 3↔6, 4↔5

      const opponent = opponents.find(p => p.bracket_rank === targetSeed);
      if (opponent) {
        logger.info(`Round 1 matchup: Seed ${yourSeed} vs Seed ${targetSeed} (${opponent.player_name})`);
        return opponent;
      }
    }

    // For rounds 2-3, match by same score (Swiss-style)
    // When multiple players have same score, find your likely opponent
    const sameScoreOpponents = opponents.filter(p => p.bracket_score === you.bracket_score);

    if (sameScoreOpponents.length === 1) {
      // Only one possible opponent with same score
      logger.info(`Round ${currentRound}: Matched with ${sameScoreOpponents[0].player_name} (same score: ${you.bracket_score})`);
      return sameScoreOpponents[0];
    }

    if (sameScoreOpponents.length > 1) {
      // Multiple possible opponents - match by closest GP
      sameScoreOpponents.sort((a, b) => {
        const diffA = Math.abs(a.player_gp - you.player_gp);
        const diffB = Math.abs(b.player_gp - you.player_gp);
        return diffA - diffB;
      });
      logger.info(
        `Round ${currentRound}: Best match from ${sameScoreOpponents.length} candidates: ` +
        `${sameScoreOpponents[0].player_name} (closest GP, score: ${you.bracket_score})`
      );
      return sameScoreOpponents[0];
    }

    // No same-score opponents (shouldn't happen in normal play)
    logger.warn(`No opponent found with score ${you.bracket_score} in round ${currentRound}`);
    return opponents[0] ?? null;
  }

  /**
   * Get current GAC events from Comlink
   */
  async getCurrentGacEvents() {
    if (await this.isComlinkAvailable()) {
      return this.comlinkClient.getCurrentGacEvents();
    }
    throw new Error('Comlink is not available for GAC events');
  }

  /**
   * Get GAC leaderboard from Comlink
   */
  async getGacLeaderboard(league: number, division: number) {
    if (await this.isComlinkAvailable()) {
      return this.comlinkClient.getGacLeaderboard(league, division);
    }
    throw new Error('Comlink is not available for GAC leaderboard');
  }

  /**
   * Get player arena profile from Comlink
   */
  async getPlayerArena(allyCode: string) {
    const normalizedAllyCode = allyCode.replace(/-/g, '');
    if (await this.isComlinkAvailable()) {
      return this.comlinkClient.getPlayerArena(normalizedAllyCode);
    }
    throw new Error('Comlink is not available for arena profile');
  }

  /**
   * Access the underlying Comlink client for advanced operations
   */
  getComlinkClient(): ComlinkClient {
    return this.comlinkClient;
  }

  /**
   * Access the underlying swgoh.gg client for operations only available there
   */
  getSwgohGgClient(): SwgohGgApiClient {
    return this.swgohGgClient;
  }

  /**
   * Pass-through methods for swgoh.gg specific functionality
   * (counters, defense squads, etc. - data that Comlink doesn't provide)
   */
  async getPlayerRecentGacDefensiveSquads(
    allyCode: string,
    format: string,
    maxRounds = 4
  ): Promise<GacDefensiveSquad[]> {
    return this.swgohGgClient.getPlayerRecentGacDefensiveSquads(allyCode, format, maxRounds);
  }

  async getCounterSquads(
    defensiveLeaderBaseId: string,
    seasonId?: string
  ): Promise<GacCounterSquad[]> {
    return this.swgohGgClient.getCounterSquads(defensiveLeaderBaseId, seasonId);
  }

  async getTopDefenseSquads(
    sortBy: 'percent' | 'count' | 'banners' = 'count',
    seasonId?: string,
    format?: string
  ): Promise<GacTopDefenseSquad[]> {
    return this.swgohGgClient.getTopDefenseSquads(sortBy, seasonId, format);
  }

  /**
   * Close browser resources
   */
  async close(): Promise<void> {
    await this.swgohGgClient.close();
  }
}

