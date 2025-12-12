import { SwgohGgApiClient, GacBracketData, GacBracketPlayer, SwgohGgFullPlayerResponse } from '../integrations/swgohGgApi';
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

  /**
   * Find the best opponent match using Swiss-system matchmaking logic:
   * 1. Filter opponents by same bracket_score (Swiss-system requirement)
   * 2. Sort by closest Top 80 Character GP
   * 3. Return the closest match
   * 
   * This accurately matches GAC's opponent pairing for Rounds 2+.
   * For Round 1 (all 0 points), this provides a best-guess based on GP similarity.
   * 
   * @param bracketData - The GAC bracket data
   * @param yourAllyCode - Your ally code
   * @param yourRosterData - Your full roster data (for Top 80 GP calculation)
   * @returns The best opponent match, or null if none found
   */
  async findBestOpponent(
    bracketData: GacBracketData,
    yourAllyCode: string,
    yourRosterData: SwgohGgFullPlayerResponse
  ): Promise<{ opponent: GacBracketPlayer; top80GP: number } | null> {
    // Find yourself in the bracket
    const yourPlayer = bracketData.bracket_players.find(
      p => p.ally_code.toString() === yourAllyCode
    );

    if (!yourPlayer) {
      logger.warn(`Player ${yourAllyCode} not found in bracket`);
      return null;
    }

    // Calculate your Top 80 GP
    const yourTop80GP = this.calculateTop80CharacterGP(yourRosterData);
    logger.info(`Your Top 80 GP: ${yourTop80GP.toLocaleString()}`);

    // Get all opponents (everyone except you)
    const allOpponents = bracketData.bracket_players.filter(
      p => p.ally_code.toString() !== yourAllyCode
    );

    // Step 1: Filter by same score (Swiss-system requirement)
    const sameScoreOpponents = allOpponents.filter(
      p => p.bracket_score === yourPlayer.bracket_score
    );

    logger.info(
      `Swiss-system matching: Your score is ${yourPlayer.bracket_score}, ` +
      `found ${sameScoreOpponents.length} opponent(s) with same score`
    );

    // If no same-score opponents, fall back to all opponents
    const candidateOpponents = sameScoreOpponents.length > 0 
      ? sameScoreOpponents 
      : allOpponents;

    if (candidateOpponents.length === 0) {
      logger.warn('No opponent candidates found');
      return null;
    }

    // Step 2: Fetch Top 80 GP for each candidate and find closest match
    const opponentGPData: Array<{
      opponent: GacBracketPlayer;
      top80GP: number;
      gpDifference: number;
    }> = [];

    for (const opponent of candidateOpponents) {
      try {
        const opponentRoster = await this.apiClient.getFullPlayer(opponent.ally_code.toString());
        const opponentTop80GP = this.calculateTop80CharacterGP(opponentRoster);
        const gpDifference = Math.abs(opponentTop80GP - yourTop80GP);

        opponentGPData.push({
          opponent,
          top80GP: opponentTop80GP,
          gpDifference
        });

        logger.debug(
          `Opponent ${opponent.player_name}: Top 80 GP = ${opponentTop80GP.toLocaleString()}, ` +
          `difference = ${gpDifference.toLocaleString()}`
        );
      } catch (error) {
        logger.warn(`Failed to fetch roster for opponent ${opponent.player_name}:`, error);
        // Use total GP as fallback
        const fallbackDifference = Math.abs(opponent.player_gp - yourRosterData.data.galactic_power);
        opponentGPData.push({
          opponent,
          top80GP: 0, // Unknown
          gpDifference: fallbackDifference
        });
      }
    }

    // Sort by closest GP difference
    opponentGPData.sort((a, b) => a.gpDifference - b.gpDifference);

    const bestMatch = opponentGPData[0];
    logger.info(
      `Best opponent match: ${bestMatch.opponent.player_name} ` +
      `(Top 80 GP: ${bestMatch.top80GP.toLocaleString()}, ` +
      `difference: ${bestMatch.gpDifference.toLocaleString()})`
    );

    return {
      opponent: bestMatch.opponent,
      top80GP: bestMatch.top80GP
    };
  }
}

