import { SwgohGgApiClient, GacBracketData, GacBracketPlayer } from '../integrations/swgohGgApi';

export interface GacBracketSummary {
  league: string;
  seasonNumber: number;
  startTime: string;
  bracketId: number;
  playerCount: number;
  yourRank: number | null;
  yourScore: number | null;
  opponents: OpponentSummary[];
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
  data: GacBracketData;
  timestamp: number;
}

export class GacService {
  // Cache bracket data for 5 minutes to support fast autocomplete responses
  private readonly bracketCache: Map<string, CachedBracketData> = new Map();
  private readonly cacheTTL = 5 * 60 * 1000; // 5 minutes in milliseconds

  constructor(private readonly apiClient: SwgohGgApiClient) {}

  async getBracketSummary(allyCode: string, yourAllyCode: string): Promise<GacBracketSummary> {
    // Use getBracketForAllyCode to ensure cache is populated
    const bracketData = await this.getBracketForAllyCode(allyCode);

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

    return {
      league: bracketData.league,
      seasonNumber: bracketData.season_number,
      startTime: bracketData.start_time,
      bracketId: bracketData.bracket_id,
      playerCount: bracketData.bracket_players.length,
      yourRank: yourPlayer?.bracket_rank || null,
      yourScore: yourPlayer?.bracket_score || null,
      opponents
    };
  }

  async getBracketForAllyCode(allyCode: string, useCache: boolean = true): Promise<GacBracketData> {
    // Check cache first if enabled
    if (useCache) {
      const cached = this.bracketCache.get(allyCode);
      if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
        return cached.data;
      }
    }

    // Fetch fresh data
    const bracketData = await this.apiClient.getGacBracket(allyCode);

    // Update cache
    this.bracketCache.set(allyCode, {
      data: bracketData,
      timestamp: Date.now()
    });

    return bracketData;
  }

  /**
   * Get cached bracket data if available, without triggering a fetch.
   * Returns null if no cache or cache is expired.
   */
  getCachedBracket(allyCode: string): GacBracketData | null {
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
}

