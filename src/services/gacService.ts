import { GacBracketData, GacBracketPlayer, SwgohGgFullPlayerResponse } from '../integrations/swgohGgApi';
import { CombinedApiClient, LiveBracketData } from '../integrations/comlink/combinedClient';
import { logger } from '../utils/logger';

export interface GacBracketSummary {
  league: string;
  seasonNumber: number;
  startTime: string;
  bracketId: number;
  playerCount: number;
  yourRank: number | null;
  yourScore: number | null;
  opponents: OpponentSummary[];
  /** Current round number (1-3) */
  currentRound: number;
  /** Current opponent for this round */
  currentOpponent: OpponentSummary | null;
  /** Whether data is real-time from Comlink */
  isRealTime: boolean;
}

export interface OpponentSummary {
  allyCode: number;
  name: string;
  galacticPower: number;
  rank: number;
  score: number;
  guildName: string;
}

interface CachedBracketData {
  data: LiveBracketData;
  timestamp: number;
}

export class GacService {
  // Cache bracket data for 5 minutes to support fast autocomplete responses
  private readonly bracketCache: Map<string, CachedBracketData> = new Map();
  private readonly cacheTTL = 5 * 60 * 1000; // 5 minutes in milliseconds

  constructor(private readonly apiClient: CombinedApiClient) {}

  /**
   * Get bracket summary with real-time standings and current opponent.
   * Uses the hybrid approach: swgoh.gg for bracket discovery, Comlink for live data.
   */
  async getBracketSummary(allyCode: string, yourAllyCode: string): Promise<GacBracketSummary> {
    // Use getLiveBracket to get real-time data
    const bracketData = await this.getLiveBracket(allyCode);

    const yourPlayer = bracketData.bracket_players.find(
      p => p.ally_code.toString() === yourAllyCode
    );

    const opponents: OpponentSummary[] = bracketData.bracket_players
      .filter(p => p.ally_code.toString() !== yourAllyCode)
      .map(p => ({
        allyCode: p.ally_code,
        name: p.player_name,
        galacticPower: p.player_gp,
        rank: p.bracket_rank,
        score: p.bracket_score,
        guildName: p.guild_name
      }))
      .sort((a, b) => a.rank - b.rank);

    // Convert current opponent to OpponentSummary format
    const currentOpponent = bracketData.currentOpponent ? {
      allyCode: bracketData.currentOpponent.ally_code,
      name: bracketData.currentOpponent.player_name,
      galacticPower: bracketData.currentOpponent.player_gp,
      rank: bracketData.currentOpponent.bracket_rank,
      score: bracketData.currentOpponent.bracket_score,
      guildName: bracketData.currentOpponent.guild_name
    } : null;

    return {
      league: bracketData.league,
      seasonNumber: bracketData.season_number,
      startTime: bracketData.start_time,
      bracketId: bracketData.bracket_id,
      playerCount: bracketData.bracket_players.length,
      yourRank: yourPlayer?.bracket_rank || null,
      yourScore: yourPlayer?.bracket_score || null,
      opponents,
      currentRound: bracketData.currentRound,
      currentOpponent,
      isRealTime: bracketData.isRealTime
    };
  }

  /**
   * Get live bracket data with real-time standings from Comlink.
   * Falls back to swgoh.gg if Comlink is unavailable.
   */
  async getLiveBracket(allyCode: string, useCache: boolean = true): Promise<LiveBracketData> {
    // Check cache first if enabled
    if (useCache) {
      const cached = this.bracketCache.get(allyCode);
      if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
        logger.debug(`Using cached bracket data for ${allyCode}`);
        return cached.data;
      }
    }

    // Fetch fresh data using hybrid approach
    const bracketData = await this.apiClient.getLiveBracketWithOpponent(allyCode);

    // Update cache
    this.bracketCache.set(allyCode, {
      data: bracketData,
      timestamp: Date.now()
    });

    return bracketData;
  }

  /**
   * Legacy method for backward compatibility.
   * @deprecated Use getLiveBracket instead for real-time data
   */
  async getBracketForAllyCode(allyCode: string, useCache: boolean = true): Promise<GacBracketData> {
    return this.getLiveBracket(allyCode, useCache);
  }

  /**
   * Get cached bracket data if available, without triggering a fetch.
   * Returns null if no cache or cache is expired.
   */
  getCachedBracket(allyCode: string): LiveBracketData | null {
    const cached = this.bracketCache.get(allyCode);
    if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
      return cached.data;
    }
    return null;
  }

  findOpponentInBracket(bracketData: GacBracketData, opponentAllyCode: string): GacBracketPlayer | null {
    return bracketData.bracket_players.find(
      p => p.ally_code.toString() === opponentAllyCode
    ) || null;
  }

  /**
   * Get the current opponent directly from live bracket data.
   * This replaces the old swiss-system matching which was unreliable.
   * 
   * @param allyCode - Your ally code
   * @returns Current opponent, or null if not determinable
   */
  async getCurrentOpponent(allyCode: string): Promise<GacBracketPlayer | null> {
    const bracketData = await this.getLiveBracket(allyCode);
    return bracketData.currentOpponent;
  }

  /**
   * Calculate the Top 80 Character GP for a player roster.
   * This is used by GAC matchmaking to pair opponents with similar rosters.
   */
  calculateTop80CharacterGP(playerData: SwgohGgFullPlayerResponse): number {
    // Filter to characters only (combat_type 1 = character, 2 = ship)
    const characters = playerData.units
      .filter(u => u.data && u.data.combat_type === 1)
      .map(u => u.data.power || 0)
      .sort((a, b) => b - a); // Sort descending by power

    // Sum top 80 characters
    const top80 = characters.slice(0, 80);
    return top80.reduce((sum, gp) => sum + gp, 0);
  }
}

