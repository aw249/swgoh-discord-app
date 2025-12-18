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
import { bracketCache } from '../../storage/bracketCache';

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
  /** 
   * Confidence level for opponent prediction:
   * - 'high': Only one candidate with same score (rounds 2-3)
   * - 'medium': Multiple candidates, matched by skill rating/GP
   * - 'low': Round 1 where all 8 have score 0, or no good match found
   */
  opponentConfidence: 'high' | 'medium' | 'low';
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
   * 1. Tries swgoh.gg for bracket metadata (bracketId)
   * 2. If swgoh.gg fails and Comlink is available, searches for bracket via Comlink
   * 3. Refreshes with Comlink for real-time standings
   * 4. Determines current opponent based on round matchups
   * 
   * @param allyCode - Your ally code
   * @returns Live bracket data with current opponent
   */
  async getLiveBracketWithOpponent(allyCode: string): Promise<LiveBracketData> {
    const normalizedAllyCode = allyCode.replace(/-/g, '');

    let bracketMeta: GacBracketData | null = null;
    let swgohGgFailed = false;

    // Step 1: Try to get bracket metadata from swgoh.gg
    try {
    logger.info(`Fetching bracket metadata from swgoh.gg for ${normalizedAllyCode}...`);
      bracketMeta = await this.swgohGgClient.getGacBracket(normalizedAllyCode);
    } catch (error) {
      swgohGgFailed = true;
      logger.warn('swgoh.gg bracket fetch failed, will try Comlink:', error);
    }

    // Step 2: If swgoh.gg failed, try Comlink bracket discovery
    if (swgohGgFailed && await this.isComlinkAvailable()) {
      bracketMeta = await this.discoverBracketViaComlink(normalizedAllyCode);
    }

    if (!bracketMeta) {
      throw new Error('No active GAC bracket found - player may not be in an active GAC event');
    }

    // Step 3: Try to refresh with Comlink for real-time data
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

    // Step 4: Calculate Top 80 Character GP for Round 1 matchmaking (if not already present)
    const currentRound = this.calculateCurrentRound(bracketMeta.start_time);
    if (currentRound === 1 && await this.isComlinkAvailable()) {
      // Check if any player is missing Top 80 GP
      const missingTop80 = players.some(p => !p.top80_character_gp || p.top80_character_gp === 0);
      if (missingTop80) {
        logger.info('Calculating Top 80 Character GP for Round 1 matchmaking...');
        const enrichedPlayers = await this.enrichPlayersWithTop80GP(players);
        players = enrichedPlayers;
      }
    }
    
    // Step 5: Determine current opponent
    const { opponent: currentOpponent, confidence: opponentConfidence } = 
      this.findCurrentOpponent(players, normalizedAllyCode, currentRound);

    return {
      ...bracketMeta,
      bracket_players: players,
      currentRound,
      currentOpponent,
      isRealTime,
      opponentConfidence,
    };
  }
  
  /**
   * Enrich players with Top 80 Character GP.
   * This fetches each player's roster to calculate their Top 80 GP.
   */
  private async enrichPlayersWithTop80GP(
    players: GacBracketPlayer[]
  ): Promise<GacBracketPlayer[]> {
    const enrichedPlayers: GacBracketPlayer[] = [];
    
    // Process players in parallel
    const enrichPromises = players.map(async (player) => {
      // Skip if already has Top 80 GP
      if (player.top80_character_gp && player.top80_character_gp > 0) {
        return player;
      }
      
      // Need an ally code to fetch roster
      if (!player.ally_code || player.ally_code === 0) {
        return player;
      }
      
      try {
        // Fetch full player data with roster
        const fullPlayerData = await this.getFullPlayer(player.ally_code.toString());
        
        // Calculate Top 80 Character GP
        const characters = fullPlayerData.units
          .filter(u => u.data.combat_type === 1)
          .map(u => u.data.power || 0)
          .sort((a, b) => b - a);
        const top80GP = characters.slice(0, 80).reduce((sum, gp) => sum + gp, 0);
        
        return {
          ...player,
          top80_character_gp: top80GP,
        };
      } catch (error) {
        logger.debug(`Could not calculate Top 80 GP for ${player.player_name}: ${error}`);
        return player;
      }
    });
    
    const results = await Promise.all(enrichPromises);
    enrichedPlayers.push(...results);
    
    const top80Count = enrichedPlayers.filter(p => p.top80_character_gp && p.top80_character_gp > 0).length;
    logger.info(`Calculated Top 80 GP for ${top80Count}/${enrichedPlayers.length} players`);
    
    return enrichedPlayers;
  }

  /**
   * Discover a player's GAC bracket using Comlink when swgoh.gg is unavailable.
   * This searches through Comlink brackets to find the player.
   * Uses cached bracket IDs as hints to speed up repeated lookups.
   */
  private async discoverBracketViaComlink(allyCode: string): Promise<GacBracketData | null> {
    try {
      // Get player data to find their ID, name, and league
      const playerData = await this.comlinkClient.getPlayer(allyCode);
      
      // Get current GAC instance
      const currentInstance = await this.comlinkClient.getCurrentGacInstance();
      if (!currentInstance) {
        logger.warn('No active GAC instance found in Comlink');
        return null;
      }

      // Get player's league from their season status
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const seasonStatuses = (playerData as any).seasonStatus || [];
      const latestSeason = seasonStatuses.reduce((latest: any, current: any) => {
        const latestEnd = parseInt(latest?.endTime || '0', 10);
        const currentEnd = parseInt(current?.endTime || '0', 10);
        return currentEnd > latestEnd ? current : latest;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }, null) as any;

      if (!latestSeason?.league) {
        logger.warn('Could not determine player league from Comlink');
        return null;
      }

      // Check for cached bracket ID as a hint (persisted across bot restarts)
      const hintBracketId = await bracketCache.getBracketId(allyCode, latestSeason.league);
      
      if (hintBracketId !== undefined) {
        logger.info(`Searching for player bracket via Comlink (${latestSeason.league}) with cached hint bracket ${hintBracketId}...`);
      } else {
        logger.info(`Searching for player bracket via Comlink (${latestSeason.league}) - no cached hint, full scan...`);
      }
      
      // Search for the player's bracket with optional hint
      const bracketResult = await this.comlinkClient.findPlayerBracket(
        playerData.playerId,
        playerData.name,
        currentInstance.eventInstanceId,
        latestSeason.league,
        {
          maxBrackets: 10000, // Search up to 10000 brackets (covers 80000 players)
          hintBracketId,
          hintRange: 200, // Search 200 brackets around the hint first
        }
      );

      if (!bracketResult) {
        logger.warn('Could not find player bracket in Comlink search');
        return null;
      }

      // Cache the bracket ID for faster lookups next time (persisted to disk)
      await bracketCache.setBracketId(
        allyCode, 
        latestSeason.league, 
        bracketResult.bracketId,
        currentInstance.eventInstanceId
      );
      logger.info(`Found player in Comlink bracket ${bracketResult.bracketId} (cached for future lookups)`);

      // Extract season number from event ID
      const seasonMatch = currentInstance.eventId.match(/SEASON_(\d+)/);
      const seasonNumber = seasonMatch ? parseInt(seasonMatch[1], 10) : 0;

      // Convert Comlink bracket data to GacBracketData format
      // Note: Comlink doesn't provide ally codes, so we use player IDs
      const bracketPlayers: GacBracketPlayer[] = await this.enrichBracketPlayersWithAllyCodes(
        bracketResult.players
      );

      return {
        season_id: currentInstance.eventId,
        season_number: seasonNumber,
        event_id: currentInstance.instanceId,
        league: latestSeason.league,
        bracket_id: bracketResult.bracketId,
        start_time: new Date(currentInstance.startTime).toISOString(),
        bracket_players: bracketPlayers,
      };
    } catch (error) {
      logger.warn('Failed to discover bracket via Comlink:', error);
      return null;
    }
  }

  /**
   * Enrich Comlink bracket players with ally codes and Top 80 Character GP.
   * This is necessary because Comlink bracket data only contains player IDs.
   * Top 80 Character GP is used for Round 1 matchmaking predictions.
   */
  private async enrichBracketPlayersWithAllyCodes(
    comlinkPlayers: import('./comlinkClient').ComlinkBracketPlayer[]
  ): Promise<GacBracketPlayer[]> {
    const enrichedPlayers: GacBracketPlayer[] = [];

    logger.info(`Fetching ally codes and Top 80 GP for ${comlinkPlayers.length} bracket players...`);

    // Fetch player data in parallel to get ally codes and calculate Top 80 GP
    const playerPromises = comlinkPlayers.map(async (cp) => {
      try {
        // Fetch full player data using player ID to get the ally code
        const playerData = await this.comlinkClient.getPlayerById(cp.id);
        const allyCode = playerData.allyCode;
        
        // Get skill rating from player data if available
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const skillRating = (playerData as any).playerRating?.playerSkillRating?.skillRating || null;
        
        // Calculate Top 80 Character GP by fetching full player with adapted data
        // This uses the dataAdapter which calculates power per unit
        let top80GP = 0;
        try {
          const fullPlayerData = await this.getFullPlayer(allyCode);
          // Filter to characters only (combat_type 1), sort by power descending, sum top 80
          const characters = fullPlayerData.units
            .filter(u => u.data.combat_type === 1)
            .map(u => u.data.power || 0)
            .sort((a, b) => b - a);
          top80GP = characters.slice(0, 80).reduce((sum, gp) => sum + gp, 0);
        } catch (err) {
          logger.debug(`Could not calculate Top 80 GP for ${cp.name}: ${err}`);
        }
        
        return {
          ally_code: parseInt(allyCode, 10) || 0,
          player_id: cp.id,
          player_name: cp.name,
          player_level: cp.level || playerData.level || 85,
          player_skill_rating: skillRating,
          player_gp: cp.power,
          top80_character_gp: top80GP > 0 ? top80GP : undefined,
          guild_id: cp.guild?.id || playerData.guildId || '',
          guild_name: cp.guild?.name || playerData.guildName || '',
          bracket_rank: cp.pvpStatus?.rank || 0,
          bracket_score: cp.pvpStatus?.score || 0,
        };
      } catch (error) {
        logger.warn(`Failed to fetch data for player ${cp.name} (${cp.id}):`, error);
        // Return with ally_code 0 and no Top 80 GP as fallback
        return {
          ally_code: 0,
          player_id: cp.id,
          player_name: cp.name,
          player_level: cp.level || 85,
          player_skill_rating: null,
          player_gp: cp.power,
          top80_character_gp: undefined,
          guild_id: cp.guild?.id || '',
          guild_name: cp.guild?.name || '',
          bracket_rank: cp.pvpStatus?.rank || 0,
          bracket_score: cp.pvpStatus?.score || 0,
        };
      }
    });

    const results = await Promise.all(playerPromises);
    for (const result of results) {
      if (result) {
        enrichedPlayers.push(result);
      }
    }

    const successCount = enrichedPlayers.filter(p => p.ally_code !== 0).length;
    const top80Count = enrichedPlayers.filter(p => p.top80_character_gp && p.top80_character_gp > 0).length;
    logger.info(`Got ally codes for ${successCount}/${enrichedPlayers.length} bracket players, Top 80 GP for ${top80Count}`);

    return enrichedPlayers.sort((a, b) => a.bracket_rank - b.bracket_rank);
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
  ): { opponent: GacBracketPlayer | null; confidence: 'high' | 'medium' | 'low' } {
    // Find the requesting player - try ally code first
    const you = players.find(p => 
      p.ally_code !== 0 && p.ally_code.toString() === yourAllyCode
    );
    
    if (!you) {
      logger.warn(`Player ${yourAllyCode} not found in bracket by ally code`);
      // Log available players for debugging
      logger.debug(`Available players: ${players.map(p => `${p.player_name}(${p.ally_code})`).join(', ')}`);
      return { opponent: null, confidence: 'low' };
    }

    // Get all other players (exclude by player_id if available, otherwise by ally_code)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const youId = (you as any).player_id;
    const opponents = players.filter(p => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pId = (p as any).player_id;
      if (youId && pId) {
        return pId !== youId;
      }
      return p.ally_code !== you.ally_code;
    });

    // GAC uses Swiss-style matchmaking based on score (and skill rating for tiebreakers)
    // For all rounds, we find opponents with the same score, then use skill rating proximity
    const sameScoreOpponents = opponents.filter(p => p.bracket_score === you.bracket_score);

    if (sameScoreOpponents.length === 1) {
      // Only one possible opponent with same score - this is definitely our match
      logger.info(`Round ${currentRound}: Matched with ${sameScoreOpponents[0].player_name} (same score: ${you.bracket_score})`);
      return { opponent: sameScoreOpponents[0], confidence: 'high' };
    }

    if (sameScoreOpponents.length > 1) {
      // Multiple candidates with same score
      // For Round 1: Use Top 80 Character GP proximity (discovered matchmaking criteria)
      // For Rounds 2-3: Use skill rating/GP proximity
      
      if (currentRound === 1) {
        // Round 1: Sort by closest Top 80 Character GP
        const yourTop80 = you.top80_character_gp || 0;
        const hasTop80Data = yourTop80 > 0 && sameScoreOpponents.some(p => p.top80_character_gp && p.top80_character_gp > 0);
        
        if (hasTop80Data) {
          sameScoreOpponents.sort((a, b) => {
            const aTop80 = a.top80_character_gp || 0;
            const bTop80 = b.top80_character_gp || 0;
            const diffA = Math.abs(aTop80 - yourTop80);
            const diffB = Math.abs(bTop80 - yourTop80);
            return diffA - diffB;
          });
          
          const closestTop80 = sameScoreOpponents[0];
          const top80Diff = Math.abs((closestTop80.top80_character_gp || 0) - yourTop80);
          logger.info(
            `Round 1: Matched with ${closestTop80.player_name} by Top 80 Character GP proximity. ` +
            `Your Top80: ${(yourTop80 / 1e6).toFixed(2)}M, Theirs: ${((closestTop80.top80_character_gp || 0) / 1e6).toFixed(2)}M, ` +
            `Diff: ${(top80Diff / 1e6).toFixed(3)}M`
          );
          // Use 'medium' confidence - we have strong data but can't be 100% certain
          return { opponent: closestTop80, confidence: 'medium' };
        } else {
          // Fallback to GP proximity if we don't have Top 80 data
      sameScoreOpponents.sort((a, b) => {
        const diffA = Math.abs(a.player_gp - you.player_gp);
        const diffB = Math.abs(b.player_gp - you.player_gp);
        return diffA - diffB;
      });
          logger.info(
            `Round 1: ${sameScoreOpponents.length} candidates with score 0. ` +
            `Best guess by total GP: ${sameScoreOpponents[0].player_name} (Top 80 GP data unavailable).`
          );
          return { opponent: sameScoreOpponents[0], confidence: 'low' };
        }
      } else {
        // Rounds 2-3: Use consecutive bracket rank pairing
        // Based on observed data: Rank 1 vs 2, Rank 3 vs 4 (not Swiss-style)
        
        // Include yourself in the score group
        const allSameScore = [you, ...sameScoreOpponents];
        
        // Sort by bracket_rank (ascending) - this determines the pairing
        const sortedByRank = [...allSameScore].sort((a, b) => a.bracket_rank - b.bracket_rank);
        
        // Log for debugging
        logger.info(`[MATCHMAKING] Round ${currentRound}: ${allSameScore.length} players with score ${you.bracket_score}`);
        for (let i = 0; i < sortedByRank.length; i++) {
          const p = sortedByRank[i];
          const isYou = p.ally_code.toString() === yourAllyCode;
          logger.info(
            `[MATCHMAKING] Rank ${p.bracket_rank}: ${isYou ? '>>> ' : ''}${p.player_name} ` +
            `(GP: ${(p.player_gp / 1e6).toFixed(2)}M)`
          );
        }
        
        // Find your position in the sorted list
        const yourIndex = sortedByRank.findIndex(p => 
          p.ally_code.toString() === yourAllyCode
        );
        
        // Consecutive pairing: 0 vs 1, 2 vs 3, etc.
        // If your index is even (0, 2, 4...), opponent is index + 1
        // If your index is odd (1, 3, 5...), opponent is index - 1
        const opponentIndex = yourIndex % 2 === 0 ? yourIndex + 1 : yourIndex - 1;
        
        // Safety check
        if (opponentIndex < 0 || opponentIndex >= sortedByRank.length) {
          logger.warn(`[MATCHMAKING] Invalid opponent index ${opponentIndex} for your index ${yourIndex}`);
          return { opponent: sortedByRank[0], confidence: 'low' };
        }
        
        const opponent = sortedByRank[opponentIndex];
        
        logger.info(
          `[MATCHMAKING] Consecutive rank pairing: ` +
          `You (Rank ${you.bracket_rank}, #${yourIndex + 1}) vs ` +
          `${opponent.player_name} (Rank ${opponent.bracket_rank}, #${opponentIndex + 1})`
        );
        
        return { opponent, confidence: 'medium' };
      }
    }

    // No same-score opponents - shouldn't happen in normal play
    // This could occur if scores haven't updated yet or there's a bye
    logger.warn(`No opponent found with score ${you.bracket_score} in round ${currentRound}`);
    return { opponent: opponents[0] ?? null, confidence: 'low' };
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

