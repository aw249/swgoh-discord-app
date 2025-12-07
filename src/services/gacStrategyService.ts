import puppeteer, { Browser } from 'puppeteer';
import { GacDefensiveSquad, GacDefensiveSquadUnit, GacCounterSquad, GacTopDefenseSquad, SwgohGgFullPlayerResponse, SwgohGgApiClient } from '../integrations/swgohGgApi';
import { logger } from '../utils/logger';
import {
  calculateSquadRelicDelta,
  calculateWorstCaseRelicDelta,
  calculateBestCaseRelicDelta,
  calculateKeyMatchups,
  transformWinRateForRelicDelta,
  RelicDeltaModifiers,
  KeyMatchups
} from '../utils/relicDeltaService';

export interface UniqueDefensiveSquadUnit {
  baseId: string;
  relicLevel: number | null;
  portraitUrl: string | null;
}

export interface UniqueDefensiveSquad {
  leader: UniqueDefensiveSquadUnit;
  members: UniqueDefensiveSquadUnit[];
}

export interface MatchedCounterSquad {
  offense: UniqueDefensiveSquad;
  defense: UniqueDefensiveSquad;
  /**
   * Original community win rate from swgoh.gg
   */
  winPercentage: number | null;
  /**
   * Adjusted win rate accounting for Relic Delta impact.
   * This transforms the community win rate based on actual relic level differences.
   */
  adjustedWinPercentage: number | null;
  seenCount: number | null;
  avgBanners: number | null;
  /**
   * Average Relic Delta modifiers across all unit matchups in this counter.
   * Positive delta = offense has higher relics (advantage), negative = defense has higher relics (disadvantage).
   */
  relicDelta: RelicDeltaModifiers | null;
  /**
   * Worst-case Relic Delta (most disadvantaged matchup for offense).
   * Useful for identifying counters that might struggle due to relic level differences.
   */
  worstCaseRelicDelta: RelicDeltaModifiers | null;
  /**
   * Best-case Relic Delta (most advantaged matchup for offense).
   * Useful for identifying counters that benefit most from relic level differences.
   */
  bestCaseRelicDelta: RelicDeltaModifiers | null;
  /**
   * Key unit matchups (carry vs carry, highest vs highest, team average).
   * Includes flags for trap counters and advantage situations.
   */
  keyMatchups: KeyMatchups | null;
  /**
   * Alternative counters for this opponent defense, sorted by preference (best first).
   * Used when the primary counter conflicts with defense or other offense squads.
   */
  alternatives?: MatchedCounterSquad[];
}

interface GacHistoryClient {
  getPlayerRecentGacDefensiveSquads(allyCode: string, format?: string): Promise<GacDefensiveSquad[]>;
}

interface CounterClient {
  getCounterSquads(defensiveLeaderBaseId: string, seasonId?: string): Promise<GacCounterSquad[]>;
}

interface DefenseClient {
  getTopDefenseSquads(sortBy?: 'percent' | 'count' | 'banners', seasonId?: string, format?: string): Promise<GacTopDefenseSquad[]>;
}

/**
 * Maximum defensive squads per league by format.
 * Based on: https://swgoh.wiki/wiki/Grand_Arena_Championships
 */
const MAX_DEFENSIVE_SQUADS_BY_LEAGUE: Record<string, { '5v5': number; '3v3': number }> = {
  'Kyber': { '5v5': 11, '3v3': 15 },
  'Aurodium': { '5v5': 9, '3v3': 13 },
  'Chromium': { '5v5': 7, '3v3': 10 },
  'Bronzium': { '5v5': 5, '3v3': 7 },
  'Carbonite': { '5v5': 3, '3v3': 3 }
};

export class GacStrategyService {
  private browser: Browser | null = null;
  private topDefenseSquadsCache: Map<string, GacTopDefenseSquad[]> = new Map();
  private defenseSquadStatsCache: Map<string, { holdPercentage: number | null; seenCount: number | null }> = new Map();

  constructor(
    private readonly apiClient: GacHistoryClient,
    private readonly counterClient?: CounterClient,
    private readonly defenseClient?: DefenseClient
  ) {}

  /**
   * Get the maximum number of defensive squads for a given league and format.
   * Defaults to Kyber max for the given format if league is unknown.
   * 
   * @param league - The GAC league (e.g., 'Kyber', 'Aurodium', etc.)
   * @param format - The GAC format ('5v5' or '3v3'), defaults to '5v5'
   */
  private getMaxSquadsForLeague(league: string | null | undefined, format: string = '5v5'): number {
    if (!league) {
      return format === '3v3' ? 15 : 11; // Default to Kyber max for the format
    }
    const normalizedLeague = league.charAt(0).toUpperCase() + league.slice(1).toLowerCase();
    const leagueData = MAX_DEFENSIVE_SQUADS_BY_LEAGUE[normalizedLeague];
    if (!leagueData) {
      return format === '3v3' ? 15 : 11; // Default to Kyber max for the format
    }
    return leagueData[format as '5v5' | '3v3'] ?? (format === '3v3' ? 15 : 11);
  }

  private async getBrowser(): Promise<Browser> {
    if (!this.browser) {
      this.browser = await puppeteer.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage'
        ]
      });
    }
    return this.browser;
  }

  async closeBrowser(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  /**
   * Filters roster to top 80 characters by GP (as used in GAC matchmaking).
   * Only includes characters (combat_type === 1), not ships.
   * 
   * @param roster - Full player roster
   * @returns Filtered roster containing only top 80 characters by GP
   */
  private getTop80CharactersRoster(roster: SwgohGgFullPlayerResponse): SwgohGgFullPlayerResponse {
    // Filter to characters only (combat_type === 1) and sort by power (GP) descending
    const characters = (roster.units || [])
      .filter(unit => unit.data.combat_type === 1) // Only characters, not ships
      .sort((a, b) => (b.data.power || 0) - (a.data.power || 0))
      .slice(0, 80); // Take top 80
    
    // Return a new roster object with filtered units
    return {
      ...roster,
      units: characters
    };
  }

  /**
   * Get all unique recent defensive squads for an opponent, based on their latest GAC event.
   * Returns only the first (most recent) occurrence of each unique squad leader.
   * Limited to the maximum number of squads allowed for the opponent's league.
   * 
   * @param allyCode - The opponent's ally code
   * @param league - The opponent's GAC league (e.g., 'Kyber', 'Aurodium', etc.). If not provided, defaults to Kyber max (11).
   */
  async getOpponentDefensiveSquads(
    allyCode: string,
    league?: string | null,
    format: string = '5v5'
  ): Promise<UniqueDefensiveSquad[]> {
    const squads = await this.apiClient.getPlayerRecentGacDefensiveSquads(allyCode, format);
    const maxSquads = this.getMaxSquadsForLeague(league, format);

    logger.info(
      `getOpponentDefensiveSquads: Received ${squads.length} raw defensive squad(s) from API ` +
      `for ally code ${allyCode} (format: ${format}, max: ${maxSquads})`
    );

    const seenLeaders = new Set<string>();
    const uniqueSquads: UniqueDefensiveSquad[] = [];

    // Determine expected squad size based on format
    const expectedSquadSize = format === '3v3' ? 3 : 5;

    for (const squad of squads) {
      // Stop if we've reached the maximum for this league
      if (uniqueSquads.length >= maxSquads) {
        break;
      }

      const allUnits: GacDefensiveSquadUnit[] = [
        squad.leader,
        ...squad.members
      ];

      const ids: string[] = allUnits
        .map(u => u.baseId)
        .filter(Boolean);

      // Filter squads based on format - 3v3 should have 3 units, 5v5 should have 5 units
      if (ids.length === 0 || ids.length !== expectedSquadSize) {
        logger.debug(
          `Skipping squad with leader ${squad.leader.baseId} - ` +
          `expected ${expectedSquadSize} units but found ${ids.length}`
        );
        continue;
      }

      const leaderBaseId = ids[0];

      // Only keep the first occurrence of each unique leader
      if (seenLeaders.has(leaderBaseId)) {
        logger.debug(
          `Skipping duplicate leader ${leaderBaseId} - already seen`
        );
        continue;
      }

      seenLeaders.add(leaderBaseId);

      const toUniqueUnit = (u: GacDefensiveSquadUnit): UniqueDefensiveSquadUnit => ({
        baseId: u.baseId,
        relicLevel: u.relicLevel,
        portraitUrl: u.portraitUrl
      });

      const leaderUnit = allUnits[0];
      const memberUnits = allUnits.slice(1);

      uniqueSquads.push({
        leader: toUniqueUnit(leaderUnit),
        members: memberUnits.map(toUniqueUnit)
      });

      logger.debug(
        `Added opponent defensive squad: ${leaderBaseId} with members: ${memberUnits.map(m => m.baseId).join(', ')}`
      );
    }

    logger.info(
      `getOpponentDefensiveSquads: Returning ${uniqueSquads.length} unique defensive squad(s) ` +
      `(filtered from ${squads.length} raw squad(s))`
    );

    return uniqueSquads;
  }

  /**
   * Get defense stats for a squad by its leader baseId.
   * Uses cache to avoid repeated API calls.
   */
  private async getDefenseStatsForSquad(leaderBaseId: string, seasonId?: string): Promise<{ holdPercentage: number | null; seenCount: number | null }> {
    // Check cache first
    const cacheKey = seasonId ? `${leaderBaseId}_${seasonId}` : leaderBaseId;
    if (this.defenseSquadStatsCache.has(cacheKey)) {
      return this.defenseSquadStatsCache.get(cacheKey)!;
    }

    // If no defense client, return null stats
    if (!this.defenseClient) {
      return { holdPercentage: null, seenCount: null };
    }

    try {
      // Get top defense squads (sorted by hold percentage)
      const cacheKey2 = seasonId ? `topDefense_${seasonId}` : 'topDefense';
      let topDefenseSquads = this.topDefenseSquadsCache.get(cacheKey2);
      
      if (!topDefenseSquads) {
        topDefenseSquads = await this.defenseClient.getTopDefenseSquads('percent', seasonId);
        this.topDefenseSquadsCache.set(cacheKey2, topDefenseSquads);
      }

      // Find matching squad by leader baseId
      const matchingSquad = topDefenseSquads.find(squad => squad.leader.baseId === leaderBaseId);
      
      const stats = matchingSquad 
        ? { holdPercentage: matchingSquad.holdPercentage, seenCount: matchingSquad.seenCount }
        : { holdPercentage: null, seenCount: null };
      
      // Cache the result
      this.defenseSquadStatsCache.set(cacheKey, stats);
      return stats;
    } catch (error) {
      logger.warn(`Failed to get defense stats for ${leaderBaseId}:`, error);
      return { holdPercentage: null, seenCount: null };
    }
  }

  /**
   * Check if a leader base ID is a Galactic Legend.
   * GLs are valuable resources and should be conserved when possible.
   */
  private isGalacticLegend(leaderBaseId: string): boolean {
    const GALACTIC_LEGEND_IDS = [
      'GLREY',
      'SUPREMELEADERKYLOREN',
      'GRANDMASTERLUKE',
      'SITHPALPATINE',
      'JEDIMASTERKENOBI',
      'LORDVADER',
      'JABBATHEHUTT',
      'GLLEIA',
      'GLAHSOKATANO',
      'GLHONDO'
    ];
    return GALACTIC_LEGEND_IDS.includes(leaderBaseId);
  }

  /**
   * Check if a squad is better suited for defense vs offense.
   * Compares defense viability (hold % + seen count) against offense viability (win % + seen count).
   * Uses relative comparison against the best hold % for the season.
   * Uses data-driven normalization based on actual max seen counts from SWGOH.GG data.
   * 
   * @param leaderBaseId - The leader's base ID
   * @param defenseHoldPercentage - Hold percentage when used on defense
   * @param defenseSeenCount - Seen count when used on defense
   * @param offenseWinPercentage - Win percentage when used on offense (against opponent)
   * @param offenseSeenCount - Seen count when used on offense (against opponent)
   * @param bestHoldPercentage - Best hold % from all defense suggestions for this season (for relative comparison)
   * @param maxDefenseSeenCount - Data-driven max seen count from actual defense data (from SWGOH.GG)
   * @param maxOffenseSeenCount - Data-driven max seen count from actual offense counter data (from SWGOH.GG)
   * @returns true if the squad should be prioritized for defense
   */
  private isBetterOnDefense(
    leaderBaseId: string,
    defenseHoldPercentage: number | null,
    defenseSeenCount: number | null,
    offenseWinPercentage: number | null,
    offenseSeenCount: number | null,
    bestHoldPercentage: number | null,
    maxDefenseSeenCount: number,
    maxOffenseSeenCount: number
  ): boolean {
    // If we don't have defense data, can't make a decision
    if (defenseHoldPercentage === null) {
      return false;
    }
    
    // Calculate relative defense score (compared to best hold % for season)
    let defenseScore = 0;
    if (bestHoldPercentage !== null && bestHoldPercentage > 0) {
      // Normalize hold % relative to best (e.g., if best is 30%, then 25% = 83% of best)
      const relativeHold = (defenseHoldPercentage / bestHoldPercentage) * 100;
      defenseScore = relativeHold * 0.6; // 60% weight for hold %
      
      // Add seen count component (40% weight) - normalize using actual max from SWGOH.GG data
      if (defenseSeenCount !== null && defenseSeenCount > 0 && maxDefenseSeenCount > 0) {
        // Use log scale to handle large ranges, normalized to actual max from data
        const logSeen = Math.log10(defenseSeenCount + 1);
        const logMax = Math.log10(maxDefenseSeenCount + 1);
        const normalizedSeen = (logSeen / logMax) * 100;
        defenseScore += normalizedSeen * 0.4;
      }
    } else {
      // Fallback: use absolute hold % if no best available
      defenseScore = defenseHoldPercentage;
    }
    
    // Calculate offense score (win % + seen count) using data-driven normalization
    let offenseScore = 0;
    if (offenseWinPercentage !== null) {
      offenseScore = offenseWinPercentage * 0.6; // 60% weight for win %
      
      // Add seen count component (40% weight) using actual max from SWGOH.GG data
      if (offenseSeenCount !== null && offenseSeenCount > 0 && maxOffenseSeenCount > 0) {
        const logSeen = Math.log10(offenseSeenCount + 1);
        const logMax = Math.log10(maxOffenseSeenCount + 1);
        const normalizedSeen = (logSeen / logMax) * 100;
        offenseScore += normalizedSeen * 0.4;
      }
    }
    
    // Squad is better on defense if defense score > offense score
    // This means: (hold % relative to best + defense seen count) > (win % + offense seen count)
    const isBetter = defenseScore > offenseScore;
    
    if (isBetter) {
      logger.debug(
        `isBetterOnDefense(${leaderBaseId}): DEFENSE preferred ` +
        `(def: ${defenseHoldPercentage.toFixed(1)}% hold, ${defenseSeenCount?.toLocaleString() ?? 'N/A'} seen, score: ${defenseScore.toFixed(1)}, max: ${maxDefenseSeenCount.toLocaleString()}) ` +
        `vs (off: ${offenseWinPercentage?.toFixed(1) ?? 'N/A'}% win, ${offenseSeenCount?.toLocaleString() ?? 'N/A'} seen, score: ${offenseScore.toFixed(1)}, max: ${maxOffenseSeenCount.toLocaleString()})`
      );
    }
    
    return isBetter;
  }

  /**
   * Check if a squad leader should be avoided on defense based on hold percentage data.
   * Uses actual hold percentage from swgoh.gg to identify squads that are easily countered.
   * 
   * @param leaderBaseId - The leader's base ID
   * @param holdPercentage - The hold percentage for this squad (from defense stats)
   * @returns true if the squad should be avoided on defense
   */
  private shouldAvoidOnDefense(leaderBaseId: string, holdPercentage: number | null): boolean {
    // No minimum threshold - all squads are considered
    // Lower hold % squads will be scored lower in sorting but not excluded
    return false;
  }

  /**
   * Balance offense and defense squads to ensure no character reuse.
   * This method takes offense counters and defense suggestions and finds the optimal balance
   * by prioritizing high-value squads while ensuring GAC rules (no character reuse).
   * 
   * Data-driven logic:
   * - Prioritizes squads with high hold % (>= 40%) for defense
   * - Avoids squads with low hold % (< 20%) on defense
   * - Considers whether a squad is better used on offense or defense based on actual data
   * 
   * @param offenseCounters - Matched offense counters against opponent's defense
   * @param defenseSuggestions - Suggested defense squads from top defense data
   * @param maxDefenseSquads - Maximum number of defense squads (based on league)
   * @param seasonId - Optional season ID for fetching defense stats for offense counters
   * @returns Balanced offense and defense squads with no character overlap
   */
  async balanceOffenseAndDefense(
    offenseCounters: MatchedCounterSquad[],
    defenseSuggestions: Array<{
      squad: UniqueDefensiveSquad;
      holdPercentage: number | null;
      seenCount: number | null;
      avgBanners: number | null;
      score: number;
      reason: string;
    }>,
    maxDefenseSquads: number,
    seasonId?: string,
    strategyPreference: 'defensive' | 'balanced' | 'offensive' = 'balanced',
    userRoster?: SwgohGgFullPlayerResponse,
    format: string = '5v5'
  ): Promise<{
    balancedOffense: MatchedCounterSquad[];
    balancedDefense: Array<{
      squad: UniqueDefensiveSquad;
      holdPercentage: number | null;
      seenCount: number | null;
      avgBanners: number | null;
      score: number;
      reason: string;
    }>;
  }> {
    // Track all used characters across both offense and defense
    const usedCharacters = new Set<string>();
    const usedLeaders = new Set<string>();
    
    // Calculate data-driven statistics from actual SWGOH.GG data
    // 1. Calculate max seen counts from defense suggestions (actual data from SWGOH.GG)
    const defenseSeenCounts = defenseSuggestions
      .map(d => d.seenCount)
      .filter((s): s is number => s !== null);
    const maxDefenseSeenCount = defenseSeenCounts.length > 0 
      ? Math.max(...defenseSeenCounts) 
      : 100000; // Fallback if no data available
    
    // 2. Calculate max seen counts from offense counters (actual data from SWGOH.GG)
    const offenseSeenCounts = offenseCounters
      .map(c => c.seenCount)
      .filter((s): s is number => s !== null);
    const maxOffenseSeenCount = offenseSeenCounts.length > 0 
      ? Math.max(...offenseSeenCounts) 
      : 100000; // Fallback if no data available
    
    // 3. Calculate best hold % from defense suggestions for relative comparison
    const bestHoldPercentage = defenseSuggestions
      .map(d => d.holdPercentage)
      .filter((h): h is number => h !== null)
      .reduce((max, h) => Math.max(max, h), 0) || null;
    
    // 4. Calculate median hold % for additional context
    const holdPercentages = defenseSuggestions
      .map(d => d.holdPercentage)
      .filter((h): h is number => h !== null)
      .sort((a, b) => a - b);
    const medianHoldPercentage = holdPercentages.length > 0
      ? holdPercentages[Math.floor(holdPercentages.length / 2)]
      : null;
    
    // 5. Calculate median win % from offense counters for additional context
    const winPercentages = offenseCounters
      .map(c => c.adjustedWinPercentage ?? c.winPercentage)
      .filter((w): w is number => w !== null)
      .sort((a, b) => a - b);
    const medianWinPercentage = winPercentages.length > 0
      ? winPercentages[Math.floor(winPercentages.length / 2)]
      : null;
    
    logger.info(
      `Data-driven statistics from SWGOH.GG: ` +
      `Best hold %: ${bestHoldPercentage?.toFixed(1) ?? 'N/A'}%, ` +
      `Median hold %: ${medianHoldPercentage?.toFixed(1) ?? 'N/A'}%, ` +
      `Max defense seen: ${maxDefenseSeenCount.toLocaleString()}, ` +
      `Max offense seen: ${maxOffenseSeenCount.toLocaleString()}, ` +
      `Median win %: ${medianWinPercentage?.toFixed(1) ?? 'N/A'}%`
    );
    
    // Pre-fetch defense stats (including seen count) for offense counter leaders to make data-driven decisions
    const offenseDefenseStats = new Map<string, { holdPercentage: number | null; seenCount: number | null }>();
    const offenseCounterLeaders = offenseCounters.filter(c => c.offense.leader.baseId);
    logger.info(`Pre-fetching defense stats for ${offenseCounterLeaders.length} offense counter leaders to make data-driven placement decisions`);
    
    for (const counter of offenseCounterLeaders) {
      const stats = await this.getDefenseStatsForSquad(counter.offense.leader.baseId, seasonId);
      offenseDefenseStats.set(counter.offense.leader.baseId, stats);
    }
    
    // Also collect defense seen counts from offenseDefenseStats to get complete picture
    // This includes defense stats for squads that might be used on offense
    const allDefenseSeenCounts = [
      ...defenseSeenCounts,
      ...Array.from(offenseDefenseStats.values())
        .map(s => s.seenCount)
        .filter((s): s is number => s !== null)
    ];
    const maxAllDefenseSeenCount = allDefenseSeenCounts.length > 0
      ? Math.max(...allDefenseSeenCounts)
      : maxDefenseSeenCount; // Fallback to defense suggestions max
    
    // Sort offense counters by priority, but penalize squads that are better on defense
    // Compare defense viability (hold % + seen count) vs offense viability (win % + seen count)
    const sortedOffense = [...offenseCounters].sort((a, b) => {
      // Prioritize opponent GL defenses that only have GL counters
      // This ensures we use available GLs for these defenses before they get used elsewhere
      const aIsOpponentGL = this.isGalacticLegend(a.defense.leader.baseId);
      const bIsOpponentGL = this.isGalacticLegend(b.defense.leader.baseId);
      const aHasOnlyGlCounters = aIsOpponentGL && (!a.offense.leader.baseId || this.isGalacticLegend(a.offense.leader.baseId) || (a.alternatives && a.alternatives.every(alt => !alt.offense.leader.baseId || this.isGalacticLegend(alt.offense.leader.baseId))));
      const bHasOnlyGlCounters = bIsOpponentGL && (!b.offense.leader.baseId || this.isGalacticLegend(b.offense.leader.baseId) || (b.alternatives && b.alternatives.every(alt => !alt.offense.leader.baseId || this.isGalacticLegend(alt.offense.leader.baseId))));
      
      if (aHasOnlyGlCounters && !bHasOnlyGlCounters) {
        return -1; // a comes first
      }
      if (!aHasOnlyGlCounters && bHasOnlyGlCounters) {
        return 1; // b comes first
      }
      
      // Get defense stats for offense counter leaders
      const aDefStats = offenseDefenseStats.get(a.offense.leader.baseId);
      const bDefStats = offenseDefenseStats.get(b.offense.leader.baseId);
      
      // Compare defense vs offense viability for each counter using data-driven normalization
      const aIsBetterOnDef = this.isBetterOnDefense(
        a.offense.leader.baseId,
        aDefStats?.holdPercentage ?? null,
        aDefStats?.seenCount ?? null,
        a.adjustedWinPercentage ?? a.winPercentage ?? null,
        a.seenCount ?? null,
        bestHoldPercentage,
        maxAllDefenseSeenCount, // Use actual max from SWGOH.GG data
        maxOffenseSeenCount     // Use actual max from SWGOH.GG data
      );
      
      const bIsBetterOnDef = this.isBetterOnDefense(
        b.offense.leader.baseId,
        bDefStats?.holdPercentage ?? null,
        bDefStats?.seenCount ?? null,
        b.adjustedWinPercentage ?? b.winPercentage ?? null,
        b.seenCount ?? null,
        bestHoldPercentage,
        maxAllDefenseSeenCount, // Use actual max from SWGOH.GG data
        maxOffenseSeenCount     // Use actual max from SWGOH.GG data
      );
      
      // Strategy-specific adjustments
      if (strategyPreference === 'defensive') {
        // Defensive: Heavily penalize offense squads that are better on defense
        if (aIsBetterOnDef && !bIsBetterOnDef) {
          return 1; // a should come after b
        }
        if (!aIsBetterOnDef && bIsBetterOnDef) {
          return -1; // a should come before b
        }
        // Also penalize GL squads on offense for defensive strategy
        const aIsGL = this.isGalacticLegend(a.offense.leader.baseId);
        const bIsGL = this.isGalacticLegend(b.offense.leader.baseId);
        if (aIsGL && !bIsGL) {
          return 1; // Prefer non-GL on offense
        }
        if (!aIsGL && bIsGL) {
          return -1;
        }
      } else if (strategyPreference === 'offensive') {
        // Offensive: Prioritize GL counters with highest win rates (aim for 100% wins)
        // First, prioritize GL counters over non-GL
        const aIsGL = this.isGalacticLegend(a.offense.leader.baseId);
        const bIsGL = this.isGalacticLegend(b.offense.leader.baseId);
        
        if (aIsGL && !bIsGL) {
          return -1; // GL comes first
        }
        if (!aIsGL && bIsGL) {
          return 1; // GL comes first
        }
        
        // Both are same type (both GL or both non-GL), prioritize by win rate
        const aWinRate = a.adjustedWinPercentage ?? a.winPercentage ?? 0;
        const bWinRate = b.adjustedWinPercentage ?? b.winPercentage ?? 0;
        
        // Prioritize 100% win rates first
        if (aWinRate === 100 && bWinRate !== 100) {
          return -1; // a comes first
        }
        if (aWinRate !== 100 && bWinRate === 100) {
          return 1; // b comes first
        }
        
        // Then sort by win rate descending
        if (Math.abs(aWinRate - bWinRate) > 1) {
          return bWinRate - aWinRate; // Higher win rate first
        }
        
        // If win rates are very close, prefer more seen counters (more reliable)
        const aSeen = a.seenCount ?? 0;
        const bSeen = b.seenCount ?? 0;
        return bSeen - aSeen;
      } else {
        // Balanced: Prioritize unused GLs on offense (GLs not in defense suggestions)
        // Check which GLs are in the defense suggestions (likely to be placed on defense)
        const defenseGlLeaders = new Set<string>();
        if (defenseSuggestions) {
          for (const def of defenseSuggestions) {
            if (this.isGalacticLegend(def.squad.leader.baseId)) {
              defenseGlLeaders.add(def.squad.leader.baseId);
            }
          }
        }
        
        const aIsGL = this.isGalacticLegend(a.offense.leader.baseId);
        const bIsGL = this.isGalacticLegend(b.offense.leader.baseId);
        const aIsGlInDefenseSuggestions = aIsGL && defenseGlLeaders.has(a.offense.leader.baseId);
        const bIsGlInDefenseSuggestions = bIsGL && defenseGlLeaders.has(b.offense.leader.baseId);
        
        // Prioritize unused GLs on offense (they're not in defense suggestions, so they should be used on offense)
        if (aIsGL && !aIsGlInDefenseSuggestions && (!bIsGL || bIsGlInDefenseSuggestions)) {
          return -1; // a (unused GL) should come before b (non-GL or GL in defense suggestions)
        }
        if (bIsGL && !bIsGlInDefenseSuggestions && (!aIsGL || aIsGlInDefenseSuggestions)) {
          return 1; // b (unused GL) should come before a (non-GL or GL in defense suggestions)
        }
        
        // If one is better on defense and the other isn't, prefer the one that isn't
        if (aIsBetterOnDef && !bIsBetterOnDef) {
          logger.info(
            `Offense sorting: ${a.offense.leader.baseId} better on defense ` +
            `(def: ${aDefStats?.holdPercentage?.toFixed(1) ?? 'N/A'}% hold, ${aDefStats?.seenCount?.toLocaleString() ?? 'N/A'} seen) ` +
            `vs (off: ${(a.adjustedWinPercentage ?? a.winPercentage)?.toFixed(1) ?? 'N/A'}% win, ${a.seenCount?.toLocaleString() ?? 'N/A'} seen) - deprioritizing for offense`
          );
          return 1; // a should come after b
        }
        if (!aIsBetterOnDef && bIsBetterOnDef) {
          logger.info(
            `Offense sorting: ${b.offense.leader.baseId} better on defense ` +
            `(def: ${bDefStats?.holdPercentage?.toFixed(1) ?? 'N/A'}% hold, ${bDefStats?.seenCount?.toLocaleString() ?? 'N/A'} seen) ` +
            `vs (off: ${(b.adjustedWinPercentage ?? b.winPercentage)?.toFixed(1) ?? 'N/A'}% win, ${b.seenCount?.toLocaleString() ?? 'N/A'} seen) - deprioritizing for offense`
          );
          return -1; // a should come before b
        }
      }
      
      // Both are similar in defense preference, sort by win rate
      const aWinRate = a.adjustedWinPercentage ?? a.winPercentage ?? 0;
      const bWinRate = b.adjustedWinPercentage ?? b.winPercentage ?? 0;
      if (Math.abs(aWinRate - bWinRate) > 5) {
        return bWinRate - aWinRate; // Higher win rate first
      }
      // If win rates are close, prefer more seen counters (more reliable)
      const aSeen = a.seenCount ?? 0;
      const bSeen = b.seenCount ?? 0;
      return bSeen - aSeen;
    });
    
    // Sort defense suggestions by score, but boost squads that are relatively better on defense
    // and penalize squads that should be avoided on defense (using data-driven thresholds)
    // For offensive strategy, we need to know which GLs were used on offense to prioritize unused GLs on defense
    const offenseGlLeaders = new Set<string>();
    if (strategyPreference === 'offensive' && offenseCounters) {
      for (const counter of offenseCounters) {
        if (counter.offense.leader.baseId && this.isGalacticLegend(counter.offense.leader.baseId)) {
          offenseGlLeaders.add(counter.offense.leader.baseId);
        }
      }
    }
    
    const sortedDefense = [...defenseSuggestions].sort((a, b) => {
      const aLeader = a.squad.leader.baseId;
      const bLeader = b.squad.leader.baseId;
      const aShouldAvoid = this.shouldAvoidOnDefense(aLeader, a.holdPercentage);
      const bShouldAvoid = this.shouldAvoidOnDefense(bLeader, b.holdPercentage);
      
      // No longer avoiding squads based on hold % threshold
      // All squads are considered, with lower hold % squads naturally scoring lower
      
      // Strategy-specific: For offensive, prioritize unused GLs on defense
      const aIsGL = userRoster ? this.isGalacticLegend(a.squad.leader.baseId) : false;
      const bIsGL = userRoster ? this.isGalacticLegend(b.squad.leader.baseId) : false;
      
      if (strategyPreference === 'offensive') {
        // Offensive: Prioritize unused GLs on defense (they weren't needed on offense)
        const aIsGlUsedOnOffense = aIsGL && offenseGlLeaders.has(aLeader);
        const bIsGlUsedOnOffense = bIsGL && offenseGlLeaders.has(bLeader);
        
        // Unused GLs should come first (they're valuable and weren't needed on offense)
        if (aIsGL && !aIsGlUsedOnOffense && (!bIsGL || bIsGlUsedOnOffense)) {
          return -1; // a (unused GL) should come before b (non-GL or used GL)
        }
        if (bIsGL && !bIsGlUsedOnOffense && (!aIsGL || aIsGlUsedOnOffense)) {
          return 1; // b (unused GL) should come before a (non-GL or used GL)
        }
        
        // Used GLs should come last (they're already on offense)
        if (aIsGlUsedOnOffense && !bIsGlUsedOnOffense) {
          return 1; // a (used GL) should come after b (non-GL or unused GL)
        }
        if (bIsGlUsedOnOffense && !aIsGlUsedOnOffense) {
          return -1; // b (used GL) should come after a (non-GL or unused GL)
        }
      }
      
      if (strategyPreference === 'defensive') {
        // Defensive: Prioritize GLs first, then by strength (relic level), then hold %
        // GLs should always come before non-GLs for defensive strategy
        if (aIsGL && !bIsGL) {
          return -1; // GL always comes first
        }
        if (!aIsGL && bIsGL) {
          return 1; // Non-GL comes after GL
        }
        
        // Both are GL or both are non-GL - sort by strength
        // For GLs, prioritize by hold % and seen count (reliability)
        // For non-GLs, prioritize by hold % and seen count, but also consider relic level
        
        // Get relic levels for strength comparison
        const getSquadRelicLevel = (squad: UniqueDefensiveSquad): number => {
          const allUnits = [squad.leader, ...squad.members];
          const relics = allUnits
            .map(u => {
              // Try to get relic level from user roster
              if (userRoster) {
                const unit = userRoster.units?.find(ur => ur.data.base_id === u.baseId);
                if (unit && unit.data.gear_level >= 13 && unit.data.relic_tier !== null) {
                  return Math.max(0, unit.data.relic_tier - 2);
                }
              }
              return u.relicLevel ?? 0;
            })
            .filter(r => r > 0);
          return relics.length > 0 ? relics.reduce((sum, r) => sum + r, 0) / relics.length : 0;
        };
        
        const aRelic = getSquadRelicLevel(a.squad);
        const bRelic = getSquadRelicLevel(b.squad);
        
        // For GLs, prioritize by hold % first (they're all strong), then seen count
        if (aIsGL && bIsGL) {
        const aHold = a.holdPercentage ?? 0;
        const bHold = b.holdPercentage ?? 0;
          const aSeen = a.seenCount ?? 0;
          const bSeen = b.seenCount ?? 0;
          
          // Penalize 100% hold rates with very low seen counts (likely unreliable)
          const aReliableHold = (aHold === 100 && aSeen < 10) ? 50 : aHold;
          const bReliableHold = (bHold === 100 && bSeen < 10) ? 50 : bHold;
          
          if (Math.abs(aReliableHold - bReliableHold) > 5) {
            return bReliableHold - aReliableHold; // Higher reliable hold % first
          }
          
          // If hold % is similar, prioritize seen count (more reliable data)
          if (aSeen !== bSeen) {
            return bSeen - aSeen; // Higher seen count first
          }
          
          // Final tiebreaker: relic level (higher is better)
          if (Math.abs(aRelic - bRelic) >= 1) {
            return bRelic - aRelic;
          }
          
          return b.score - a.score;
        }
        
        // For non-GLs, prioritize by relic level first (strength), then hold %
        if (Math.abs(aRelic - bRelic) >= 2) {
          return bRelic - aRelic; // Higher relic first
        }
        
        // If relics are similar, prioritize hold % but filter out low-sample-size 100% holds
        const aHold = a.holdPercentage ?? 0;
        const bHold = b.holdPercentage ?? 0;
        const aSeen = a.seenCount ?? 0;
        const bSeen = b.seenCount ?? 0;
        
        // Penalize 100% hold rates with very low seen counts (likely unreliable)
        const aReliableHold = (aHold === 100 && aSeen < 10) ? 50 : aHold; // Penalize low-sample 100%
        const bReliableHold = (bHold === 100 && bSeen < 10) ? 50 : bHold;
        
        if (Math.abs(aReliableHold - bReliableHold) > 5) {
          return bReliableHold - aReliableHold; // Higher reliable hold % first
        }
        
        // If hold % is similar, prioritize seen count (more reliable data)
        if (aSeen !== bSeen) {
          return bSeen - aSeen; // Higher seen count first
        }
        
        // Final tiebreaker: score
        return b.score - a.score;
      } else if (strategyPreference === 'offensive') {
        // Offensive: Slight penalty for GL squads on defense
        if (aIsGL && !bIsGL) {
          const adjustedScoreA = a.score - 20; // Penalty
          if (adjustedScoreA < b.score) {
            return 1;
          }
        }
        if (!aIsGL && bIsGL) {
          const adjustedScoreB = b.score - 20; // Penalty
          if (adjustedScoreB < a.score) {
            return -1;
          }
        }
      }
      // Balanced: Continue with existing logic
      
      // Calculate relative scores (compared to best hold % for season)
      const aRelativeScore = bestHoldPercentage !== null && a.holdPercentage !== null && bestHoldPercentage > 0
        ? (a.holdPercentage / bestHoldPercentage) * 100
        : a.holdPercentage ?? 0;
      
      const bRelativeScore = bestHoldPercentage !== null && b.holdPercentage !== null && bestHoldPercentage > 0
        ? (b.holdPercentage / bestHoldPercentage) * 100
        : b.holdPercentage ?? 0;
      
      // Boost squads that are relatively better on defense (e.g., > 80% of best hold %)
      // This means they're in the top tier of defense squads for this season
      const aIsRelativelyGood = aRelativeScore >= 80; // Top 20% relative to best
      const bIsRelativelyGood = bRelativeScore >= 80;
      
      if (aIsRelativelyGood && !bIsRelativelyGood) {
        // Boost a's score by 30 points for being relatively good on defense
        const adjustedScoreA = a.score + 30;
        logger.info(
          `Defense sorting: ${aLeader} relatively good on defense ` +
          `(${a.holdPercentage?.toFixed(1) ?? 'N/A'}% = ${aRelativeScore.toFixed(1)}% of best ${bestHoldPercentage?.toFixed(1) ?? 'N/A'}%, ` +
          `${a.seenCount?.toLocaleString() ?? 'N/A'} seen) - boosting score ${a.score.toFixed(1)} -> ${adjustedScoreA.toFixed(1)}`
        );
        if (adjustedScoreA > b.score) {
          return -1; // a should come before b
        }
      }
      if (!aIsRelativelyGood && bIsRelativelyGood) {
        // Boost b's score by 30 points for being relatively good on defense
        const adjustedScoreB = b.score + 30;
        logger.info(
          `Defense sorting: ${bLeader} relatively good on defense ` +
          `(${b.holdPercentage?.toFixed(1) ?? 'N/A'}% = ${bRelativeScore.toFixed(1)}% of best ${bestHoldPercentage?.toFixed(1) ?? 'N/A'}%, ` +
          `${b.seenCount?.toLocaleString() ?? 'N/A'} seen) - boosting score ${b.score.toFixed(1)} -> ${adjustedScoreB.toFixed(1)}`
        );
        if (adjustedScoreB > a.score) {
          return 1; // a should come after b
        }
      }
      
      // Otherwise sort by score
      return b.score - a.score;
    });
    
    const balancedOffense: MatchedCounterSquad[] = [];
    const balancedDefense: Array<{
      squad: UniqueDefensiveSquad;
      holdPercentage: number | null;
      seenCount: number | null;
      avgBanners: number | null;
      score: number;
      reason: string;
    }> = [];
    
    // For defensive strategy, prioritize defense first, then add offense
    // For balanced/offensive, prioritize offense first, then add defense
    if (strategyPreference === 'defensive') {
      // DEFENSIVE STRATEGY: Add defense first, then offense
      // For defensive strategy, be more lenient about character conflicts within defense
      // Allow defense squads even if they share 1-2 characters, as long as leaders are unique
      // First pass: Add defense squads up to maxDefenseSquads
      for (const defenseSuggestion of sortedDefense) {
        if (balancedDefense.length >= maxDefenseSquads) {
          break; // Reached max defense squads
        }
        
        const defenseUnits = [
          defenseSuggestion.squad.leader.baseId,
          ...defenseSuggestion.squad.members.map(m => m.baseId)
        ];
        
        // Check if leader is already used (this is strict - no duplicate leaders)
        if (usedLeaders.has(defenseSuggestion.squad.leader.baseId)) {
          logger.debug(
            `Skipping defense squad ${defenseSuggestion.squad.leader.baseId} - leader already used`
          );
          continue; // Skip - leader already used
        }
        
        // Check for character conflicts - be lenient for defensive strategy
        // BUT: If a character is needed for offense counters (especially for opponent GLs that only have GL counters),
        // we should avoid using it in defense
        const conflictingUnits = defenseUnits.filter(unitId => usedCharacters.has(unitId));
        const conflictCount = conflictingUnits.length;
        const squadSize = defenseUnits.length;
        
        // Check if any conflicting character is needed for offense counters
        // For defensive strategy, if we have opponent GLs that only have GL counters, we need to reserve GLs for offense
        // Also check if any character is a critical offense counter leader
        const criticalOffenseCharacters = new Set<string>();
        for (const counter of sortedOffense) {
          if (!counter.offense.leader.baseId) continue;
          const isOpponentGL = this.isGalacticLegend(counter.defense.leader.baseId);
          const hasOnlyGlCounters = isOpponentGL && (
            this.isGalacticLegend(counter.offense.leader.baseId) || 
            (counter.alternatives && counter.alternatives.every(alt => !alt.offense.leader.baseId || this.isGalacticLegend(alt.offense.leader.baseId)))
          );
          if (hasOnlyGlCounters) {
            // This opponent GL only has GL counters - reserve the GL for offense
            if (this.isGalacticLegend(counter.offense.leader.baseId)) {
              criticalOffenseCharacters.add(counter.offense.leader.baseId);
            }
          }
          // Also check if JEDIMASTERKENOBI is needed for SUPREMELEADERKYLOREN (user's specific case)
          if (counter.defense.leader.baseId === 'SUPREMELEADERKYLOREN' && counter.offense.leader.baseId === 'JEDIMASTERKENOBI') {
            criticalOffenseCharacters.add('JEDIMASTERKENOBI');
          }
        }
        
        // Check if any conflicting character is critical for offense
        const criticalConflicts = conflictingUnits.filter(unitId => criticalOffenseCharacters.has(unitId));
        if (criticalConflicts.length > 0) {
          logger.info(
            `Skipping defense squad ${defenseSuggestion.squad.leader.baseId} - ` +
            `critical offense character(s) needed: ${criticalConflicts.join(', ')}`
          );
          continue; // Skip - these characters are needed for offense
        }
        
        // For defensive strategy, only skip if there are MANY conflicts (>= 50% of squad)
        // This allows GL squads and other strong defense squads even if they share 1-2 characters
        if (conflictCount > 0) {
          const conflictRatio = conflictCount / squadSize;
          // Skip only if >= 50% of the squad conflicts AND we have other options
          if (conflictRatio >= 0.5 && sortedDefense.length - balancedDefense.length > (maxDefenseSquads - balancedDefense.length) * 2) {
            logger.debug(
              `Skipping defense squad ${defenseSuggestion.squad.leader.baseId} - ` +
              `${conflictCount}/${squadSize} character(s) already used (${(conflictRatio * 100).toFixed(0)}%): ${conflictingUnits.join(', ')}`
            );
            continue; // Skip this defense squad - too many conflicts
          } else {
            // Allow this squad despite minor conflicts
            logger.debug(
              `Allowing defense squad ${defenseSuggestion.squad.leader.baseId} despite ` +
              `${conflictCount} minor character conflict(s): ${conflictingUnits.join(', ')}`
            );
          }
        }
        
        // Add this defense squad
        logger.debug(
          `Adding defense squad ${defenseSuggestion.squad.leader.baseId} ` +
          `(Hold: ${defenseSuggestion.holdPercentage?.toFixed(1) ?? 'N/A'}%, ` +
          `Score: ${defenseSuggestion.score.toFixed(1)}, ` +
          `Conflicts: ${conflictCount}/${squadSize})`
        );
        balancedDefense.push(defenseSuggestion);
        
        // Mark characters as used, but only mark non-conflicting ones if we're being lenient
        // This allows other defense squads to still be considered
        if (conflictCount > 0 && conflictCount < squadSize * 0.5) {
          // Only mark non-conflicting characters
          for (const unitId of defenseUnits) {
            if (!conflictingUnits.includes(unitId)) {
              usedCharacters.add(unitId);
            }
          }
        } else {
          // Mark all characters as used
          for (const unitId of defenseUnits) {
            usedCharacters.add(unitId);
          }
        }
        usedLeaders.add(defenseSuggestion.squad.leader.baseId);
      }
      
      // Second pass: Add offense counters that don't conflict with defense
      // For defensive strategy, we need to ensure we get enough offense teams (up to maxDefenseSquads)
      const maxOffenseNeeded = maxDefenseSquads; // Need one offense team per opponent defense slot
      
      for (const counter of sortedOffense) {
        // For defensive strategy, stop when we have enough offense teams
        if (strategyPreference === 'defensive' && balancedOffense.length >= maxOffenseNeeded) {
          break;
        }
        
        if (!counter.offense.leader.baseId) {
          continue; // Skip empty offense squads
        }
        
        // Try primary counter first, then alternatives if it conflicts
        // For defensive strategy, try non-GL alternatives first, then GL alternatives if all non-GL conflict
        const countersToTry = [counter, ...(counter.alternatives || [])];
        let addedCounter = false;
        
        // For defensive strategy, separate non-GL and GL counters
        // Try non-GL first, then GL if all non-GL conflict
        let nonGlCounters: MatchedCounterSquad[] = [];
        let glCounters: MatchedCounterSquad[] = [];
        if (strategyPreference === 'defensive') {
          for (const c of countersToTry) {
            if (!c.offense.leader.baseId) continue;
            if (this.isGalacticLegend(c.offense.leader.baseId)) {
              glCounters.push(c);
            } else {
              nonGlCounters.push(c);
            }
          }
          // Try non-GL counters first, then GL counters
          countersToTry.length = 0;
          countersToTry.push(...nonGlCounters, ...glCounters);
        }
        
        for (const counterToTry of countersToTry) {
          logger.debug(
            `Trying counter: ${counterToTry.offense.leader.baseId} vs ${counterToTry.defense.leader.baseId} ` +
            `(primary: ${counterToTry === counter}, isGL: ${this.isGalacticLegend(counterToTry.offense.leader.baseId)})`
          );
          
          // For defensive strategy, allow GL counters ONLY if:
          // 1. We've already tried all non-GL alternatives and they all conflicted (we're now in the GL counters section)
          // 2. The GL is not already used on defense
          const isCounterGL = this.isGalacticLegend(counterToTry.offense.leader.baseId);
          if (strategyPreference === 'defensive' && isCounterGL) {
            // Check if GL is already used on defense
            if (usedLeaders.has(counterToTry.offense.leader.baseId)) {
              logger.info(
                `Skipping GL offense counter ${counterToTry.offense.leader.baseId} - already used on defense`
              );
              continue; // Skip - GL already on defense
            }
            
            // If we're trying a GL counter, it means all non-GL alternatives have been tried and conflicted
            // (because we sorted countersToTry to put non-GL first, then GL)
            logger.info(
              `Allowing GL offense counter ${counterToTry.offense.leader.baseId} vs ${counterToTry.defense.leader.baseId} - all non-GL alternatives conflicted and GL not on defense`
            );
          }
          
          const offenseUnits = [
            counterToTry.offense.leader.baseId,
            ...counterToTry.offense.members.map(m => m.baseId)
          ];
          
          // Check if leader is already used (strict - no duplicate leaders)
          if (usedLeaders.has(counterToTry.offense.leader.baseId)) {
            logger.debug(
              `Skipping offense counter ${counterToTry.offense.leader.baseId} - leader already used`
            );
            continue; // Skip - leader already used
          }
          
          // Check if any USER character from this offense counter is already used in defense
          // NOTE: usedCharacters tracks USER's characters used in defense (or previous offense counters)
          // OPPONENT characters (counterToTry.defense.leader.baseId) should NEVER be in usedCharacters
          // offenseUnits contains only USER's characters (counterToTry.offense.leader + counterToTry.offense.members)
          const conflictingUnits = offenseUnits.filter(unitId => usedCharacters.has(unitId));
          const conflictCount = conflictingUnits.length;
          const squadSize = offenseUnits.length;
          
          if (conflictCount > 0) {
            logger.info(
              `[CONFLICT CHECK] Offense counter ${counterToTry.offense.leader.baseId} vs opponent ${counterToTry.defense.leader.baseId}: ` +
              `${conflictCount}/${squadSize} USER characters conflict: ${conflictingUnits.join(', ')} ` +
              `(offense squad: ${offenseUnits.join(', ')})` +
              (counterToTry !== counter ? ' [ALTERNATIVE]' : '')
            );
          }
          
          // GAC rule: Each character can only be used once per round
          // Any character conflict should block the counter - no leniency
          if (conflictCount > 0) {
            logger.info(
              `[SKIP] Offense counter ${counterToTry.offense.leader.baseId} vs ${counterToTry.defense.leader.baseId} - ` +
              `${conflictCount}/${squadSize} USER character(s) already used: ${conflictingUnits.join(', ')} ` +
              `(offense squad: ${offenseUnits.join(', ')})` +
              (counterToTry !== counter ? ' [trying next alternative...]' : '')
            );
            continue; // Skip - character conflict, try next alternative
          }
          
          // Add this offense counter (primary or alternative)
          logger.info(
            `Adding offense counter ${counterToTry.offense.leader.baseId} vs ${counterToTry.defense.leader.baseId} ` +
            `(Win: ${counterToTry.winPercentage?.toFixed(1) ?? 'N/A'}%)` +
            (counterToTry !== counter ? ' [ALTERNATIVE]' : '')
          );
          balancedOffense.push(counterToTry);
          addedCounter = true;
          
          // Mark all characters as used (GAC rule: each character can only be used once)
          for (const unitId of offenseUnits) {
            usedCharacters.add(unitId);
          }
          usedLeaders.add(counterToTry.offense.leader.baseId);
          break; // Successfully added a counter, move to next opponent defense
        }
        
        if (!addedCounter) {
          logger.warn(
            `No valid counter found for opponent ${counter.defense.leader.baseId} - ` +
            `tried ${countersToTry.length} counter(s) (primary + ${countersToTry.length - 1} alternative(s))`
          );
        }
      }
      
      // For defensive strategy, if we don't have enough offense teams, log which opponent defenses need manual counters
      // We don't generate random fallback teams - they lack synergy and are not useful
      if (strategyPreference === 'defensive' && balancedOffense.length < maxOffenseNeeded) {
        const needed = maxOffenseNeeded - balancedOffense.length;
        const unmatchedDefenses = offenseCounters
          .filter(c => !c.offense.leader.baseId)
          .map(c => c.defense.leader.baseId);
        
        logger.warn(
          `Only generated ${balancedOffense.length} offense team(s) but need ${maxOffenseNeeded}. ` +
          `${needed} opponent defense(s) have no non-GL counters available and require manual counter selection: ` +
          `${unmatchedDefenses.join(', ')}`
        );
        
        // Add empty offense entries for unmatched defenses so the user knows which ones need manual counters
        const alreadyMatchedDefenses = new Set(balancedOffense.map(c => c.defense.leader.baseId));
        for (const counter of offenseCounters) {
          if (!counter.offense.leader.baseId && !alreadyMatchedDefenses.has(counter.defense.leader.baseId)) {
            balancedOffense.push(counter); // Add the empty counter entry so it shows in the output
          }
        }
      }
    } else {
      // BALANCED/OFFENSIVE STRATEGY: Add offense first, then defense
    // First pass: Add offense counters that don't conflict with each other
    // Try primary counter first, then alternatives if it conflicts
    for (const counter of sortedOffense) {
      if (!counter.offense.leader.baseId) {
        continue; // Skip empty offense squads
      }
      
      // Try primary counter first, then alternatives if it conflicts
      const countersToTry = [counter, ...(counter.alternatives || [])];
      let addedCounter = false;
      
      for (const counterToTry of countersToTry) {
        if (!counterToTry.offense.leader.baseId) {
          continue; // Skip empty alternatives
        }
        
        const offenseUnits = [
          counterToTry.offense.leader.baseId,
          ...counterToTry.offense.members.map(m => m.baseId)
        ];
        
        // Check if leader is already used (strict - no duplicate leaders)
        if (usedLeaders.has(counterToTry.offense.leader.baseId)) {
          logger.debug(
            `Skipping offense counter ${counterToTry.offense.leader.baseId} - leader already used` +
            (counterToTry !== counter ? ' [trying next alternative...]' : '')
          );
          continue; // Skip - leader already used, try next alternative
        }
        
        // Check if any character is already used
        const conflictingUnits = offenseUnits.filter(unitId => usedCharacters.has(unitId));
        const conflictCount = conflictingUnits.length;
        
        if (conflictCount > 0) {
          logger.debug(
            `Skipping offense counter ${counterToTry.offense.leader.baseId} vs opponent ${counterToTry.defense.leader.baseId} - ` +
            `${conflictCount} character(s) already used: ${conflictingUnits.join(', ')}` +
            (counterToTry !== counter ? ' [trying next alternative...]' : '')
          );
          continue; // Skip - conflicts, try next alternative
        }
        
        // Add this offense counter (primary or alternative)
        logger.debug(
          `Adding offense counter ${counterToTry.offense.leader.baseId} vs ${counterToTry.defense.leader.baseId} ` +
          `(Win: ${counterToTry.winPercentage?.toFixed(1) ?? 'N/A'}%)` +
          (counterToTry !== counter ? ' [ALTERNATIVE]' : '')
        );
        balancedOffense.push(counterToTry);
        addedCounter = true;
        
        // Mark characters as used
        for (const unitId of offenseUnits) {
          usedCharacters.add(unitId);
        }
        usedLeaders.add(counterToTry.offense.leader.baseId);
        break; // Successfully added a counter, move to next opponent defense
      }
      
        if (!addedCounter) {
          logger.debug(
            `No valid counter found for opponent ${counter.defense.leader.baseId} - ` +
            `tried ${countersToTry.length} counter(s) (primary + ${countersToTry.length - 1} alternative(s))`
          );
        }
      }
    
    // CRITICAL: Ensure ALL GLs are used (either offense or defense)
    // GLs are the strongest characters in the game and should NEVER be left unused
    const allUserGLsForPlacement = new Set<string>();
    if (userRoster) {
      for (const unit of userRoster.units || []) {
        if (unit.data.combat_type === 1 && unit.data.is_galactic_legend && this.isGalacticLegend(unit.data.base_id)) {
          allUserGLsForPlacement.add(unit.data.base_id);
        }
      }
    }
    
    const usedGLsForPlacement = new Set<string>();
    for (const offenseCounter of balancedOffense) {
      if (offenseCounter.offense.leader.baseId && this.isGalacticLegend(offenseCounter.offense.leader.baseId)) {
        usedGLsForPlacement.add(offenseCounter.offense.leader.baseId);
      }
    }
    for (const defenseSquad of balancedDefense) {
      if (this.isGalacticLegend(defenseSquad.squad.leader.baseId)) {
        usedGLsForPlacement.add(defenseSquad.squad.leader.baseId);
      }
    }
    
    const unusedGLsForPlacement = Array.from(allUserGLsForPlacement).filter(gl => !usedGLsForPlacement.has(gl));
    if (unusedGLsForPlacement.length > 0) {
      logger.warn(
        `CRITICAL: ${unusedGLsForPlacement.length} GL(s) are UNUSED and must be placed: ${unusedGLsForPlacement.join(', ')}. ` +
        `GLs are the strongest characters in the game and should NEVER be left out.`
      );
      
      // Try to place unused GLs on offense first (they're better on offense for balanced strategy)
      // Look for opponent defenses that could use these GLs as counters
      for (const unusedGL of unusedGLsForPlacement) {
        let glPlaced = false;
        
        // First, try to place on offense by replacing ANY non-GL counter (GLs are always better)
        for (const offenseCounter of offenseCounters) {
          if (offenseCounter.offense.leader.baseId === unusedGL) {
            // This GL is available as a counter for this opponent defense
            const existingCounterIndex = balancedOffense.findIndex(c => 
              c.defense.leader.baseId === offenseCounter.defense.leader.baseId
            );
            
            if (existingCounterIndex >= 0) {
              const existingCounter = balancedOffense[existingCounterIndex];
              const existingIsGL = existingCounter.offense.leader.baseId && 
                this.isGalacticLegend(existingCounter.offense.leader.baseId);
              
              // Replace if existing is non-GL (GLs are always better than non-GLs)
              // OR if GL has better or equal win rate
              const existingWinRate = existingCounter.adjustedWinPercentage ?? existingCounter.winPercentage ?? 0;
              const glWinRate = offenseCounter.adjustedWinPercentage ?? offenseCounter.winPercentage ?? 0;
              
              if (!existingIsGL || glWinRate >= existingWinRate) {
                // Check if GL counter doesn't conflict
                const glOffenseUnits = [
                  offenseCounter.offense.leader.baseId,
                  ...offenseCounter.offense.members.map(m => m.baseId)
                ];
                const hasConflict = glOffenseUnits.some(unitId => usedCharacters.has(unitId));
                
                if (!hasConflict && !usedLeaders.has(unusedGL)) {
                  logger.info(
                    `Placing unused GL ${unusedGL} on offense vs ${offenseCounter.defense.leader.baseId} ` +
                    `(replacing ${existingCounter.offense.leader.baseId}, win rate: ${glWinRate.toFixed(1)}%)`
                  );
                  
                  // Remove old counter
                  const oldOffenseUnits = [
                    existingCounter.offense.leader.baseId,
                    ...existingCounter.offense.members.map(m => m.baseId)
                  ];
                  for (const unitId of oldOffenseUnits) {
                    usedCharacters.delete(unitId);
                  }
                  usedLeaders.delete(existingCounter.offense.leader.baseId);
                  
                  // Add GL counter
                  balancedOffense[existingCounterIndex] = offenseCounter;
                  for (const unitId of glOffenseUnits) {
                    usedCharacters.add(unitId);
                  }
                  usedLeaders.add(unusedGL);
                  glPlaced = true;
                  break; // GL placed, move to next unused GL
                }
              }
            } else {
              // No counter exists for this opponent defense, add GL counter if it doesn't conflict
              const glOffenseUnits = [
                offenseCounter.offense.leader.baseId,
                ...offenseCounter.offense.members.map(m => m.baseId)
              ];
              const hasConflict = glOffenseUnits.some(unitId => usedCharacters.has(unitId));
              
              if (!hasConflict && !usedLeaders.has(unusedGL)) {
                logger.info(
                  `Placing unused GL ${unusedGL} on offense vs ${offenseCounter.defense.leader.baseId} ` +
                  `(win rate: ${(offenseCounter.adjustedWinPercentage ?? offenseCounter.winPercentage ?? 0).toFixed(1)}%)`
                );
                balancedOffense.push(offenseCounter);
                for (const unitId of glOffenseUnits) {
                  usedCharacters.add(unitId);
                }
                usedLeaders.add(unusedGL);
                glPlaced = true;
                break; // GL placed, move to next unused GL
              }
            }
          }
        }
        
        // If still unused after trying offense, try to place on defense
        if (!glPlaced && !usedGLsForPlacement.has(unusedGL) && !usedLeaders.has(unusedGL)) {
          // Look for this GL in defense suggestions
          for (const defenseSuggestion of sortedDefense) {
            if (defenseSuggestion.squad.leader.baseId === unusedGL) {
              const defenseUnits = [
                defenseSuggestion.squad.leader.baseId,
                ...defenseSuggestion.squad.members.map(m => m.baseId)
              ];
              
              // Check if it conflicts with offense
              const hasConflict = defenseUnits.some(unitId => usedCharacters.has(unitId));
              
              if (!hasConflict && balancedDefense.length < maxDefenseSquads) {
                logger.info(
                  `Placing unused GL ${unusedGL} on defense (Hold: ${defenseSuggestion.holdPercentage?.toFixed(1) ?? 'N/A'}%)`
                );
                balancedDefense.push(defenseSuggestion);
                for (const unitId of defenseUnits) {
                  usedCharacters.add(unitId);
                }
                usedLeaders.add(unusedGL);
                usedGLsForPlacement.add(unusedGL); // Update tracking
                glPlaced = true;
                break; // GL placed
              }
            }
          }
        }
        
        // If STILL unused, try to replace ANY defense squad with this GL (GLs are always better)
        if (!glPlaced && !usedGLsForPlacement.has(unusedGL) && !usedLeaders.has(unusedGL)) {
          // Find a defense squad with this GL as leader
          for (const defenseSuggestion of sortedDefense) {
            if (defenseSuggestion.squad.leader.baseId === unusedGL) {
              // Try to find a non-GL defense squad to replace
              for (let i = 0; i < balancedDefense.length; i++) {
                const existingDefense = balancedDefense[i];
                const existingIsGL = this.isGalacticLegend(existingDefense.squad.leader.baseId);
                
                // Replace non-GL defense with GL defense
                if (!existingIsGL) {
                  const existingDefenseUnits = [
                    existingDefense.squad.leader.baseId,
                    ...existingDefense.squad.members.map(m => m.baseId)
                  ];
                  
                  // Remove existing defense
                  for (const unitId of existingDefenseUnits) {
                    usedCharacters.delete(unitId);
                  }
                  usedLeaders.delete(existingDefense.squad.leader.baseId);
                  
                  // Add GL defense
                  const glDefenseUnits = [
                    defenseSuggestion.squad.leader.baseId,
                    ...defenseSuggestion.squad.members.map(m => m.baseId)
                  ];
                  
                  // Check if GL defense conflicts with offense
                  const hasConflict = glDefenseUnits.some(unitId => usedCharacters.has(unitId));
                  
                  if (!hasConflict) {
                    logger.info(
                      `Replacing non-GL defense ${existingDefense.squad.leader.baseId} with unused GL ${unusedGL} on defense ` +
                      `(Hold: ${defenseSuggestion.holdPercentage?.toFixed(1) ?? 'N/A'}%)`
                    );
                    balancedDefense[i] = defenseSuggestion;
                    for (const unitId of glDefenseUnits) {
                      usedCharacters.add(unitId);
                    }
                    usedLeaders.add(unusedGL);
                    usedGLsForPlacement.add(unusedGL);
                    glPlaced = true;
                    break;
                  } else {
                    // Restore existing defense if GL conflicts
                    for (const unitId of existingDefenseUnits) {
                      usedCharacters.add(unitId);
                    }
                    usedLeaders.add(existingDefense.squad.leader.baseId);
                  }
                }
              }
              
              if (glPlaced) break;
            }
          }
        }
      }
    }
    
    // Post-processing: Replace low win rate counters (< 75%) with better alternatives, especially unused GLs
    // This ensures we use the best available counters, especially if GLs are available
    const MIN_WIN_RATE_THRESHOLD = 75;
    const lowWinRateCounters: Array<{ index: number; counter: MatchedCounterSquad; winRate: number }> = [];
    
    for (let i = 0; i < balancedOffense.length; i++) {
      const offenseCounter = balancedOffense[i];
      if (!offenseCounter.offense.leader.baseId) continue;
      
      const winRate = offenseCounter.adjustedWinPercentage ?? offenseCounter.winPercentage ?? 0;
      if (winRate < MIN_WIN_RATE_THRESHOLD) {
        lowWinRateCounters.push({ index: i, counter: offenseCounter, winRate });
      }
    }
    
    if (lowWinRateCounters.length > 0) {
      logger.info(
        `Found ${lowWinRateCounters.length} offense counter(s) with win rate < ${MIN_WIN_RATE_THRESHOLD}%: ` +
        lowWinRateCounters.map(c => `${c.counter.offense.leader.baseId} vs ${c.counter.defense.leader.baseId} (${c.winRate.toFixed(1)}%)`).join(', ')
      );
      
      // Re-check unused GLs after initial placement (they may have been placed above)
      const usedGLsAfterPlacement = new Set<string>();
      for (const offenseCounter of balancedOffense) {
        if (offenseCounter.offense.leader.baseId && this.isGalacticLegend(offenseCounter.offense.leader.baseId)) {
          usedGLsAfterPlacement.add(offenseCounter.offense.leader.baseId);
        }
      }
      for (const defenseSquad of balancedDefense) {
        if (this.isGalacticLegend(defenseSquad.squad.leader.baseId)) {
          usedGLsAfterPlacement.add(defenseSquad.squad.leader.baseId);
        }
      }
      
      const unusedGLsForReplacement = Array.from(allUserGLsForPlacement).filter(gl => !usedGLsAfterPlacement.has(gl));
      logger.info(
        `Unused GLs available for replacement: ${unusedGLsForReplacement.length > 0 ? unusedGLsForReplacement.join(', ') : 'none'}`
      );
      
      // Try to replace low win rate counters with better alternatives
      for (const lowWinCounter of lowWinRateCounters) {
        const opponentDefense = lowWinCounter.counter.defense.leader.baseId;
        const currentWinRate = lowWinCounter.winRate;
        
        // Look for better alternatives in the original counter's alternatives array
        const allAlternatives = [
          lowWinCounter.counter,
          ...(lowWinCounter.counter.alternatives || [])
        ];
        
        // Also check all offense counters for this opponent defense
        const allCountersForOpponent = offenseCounters.filter(c => c.defense.leader.baseId === opponentDefense);
        for (const altCounter of allCountersForOpponent) {
          if (!allAlternatives.some(a => a.offense.leader.baseId === altCounter.offense.leader.baseId)) {
            allAlternatives.push(altCounter);
          }
          if (altCounter.alternatives) {
            for (const alt of altCounter.alternatives) {
              if (!allAlternatives.some(a => a.offense.leader.baseId === alt.offense.leader.baseId)) {
                allAlternatives.push(alt);
              }
            }
          }
        }
        
        // Sort alternatives by win rate (descending), prioritizing GLs
        allAlternatives.sort((a, b) => {
          const aWinRate = a.adjustedWinPercentage ?? a.winPercentage ?? 0;
          const bWinRate = b.adjustedWinPercentage ?? b.winPercentage ?? 0;
          const aIsGL = a.offense.leader.baseId ? this.isGalacticLegend(a.offense.leader.baseId) : false;
          const bIsGL = b.offense.leader.baseId ? this.isGalacticLegend(b.offense.leader.baseId) : false;
          const aIsUnusedGL = aIsGL && unusedGLsForReplacement.includes(a.offense.leader.baseId);
          const bIsUnusedGL = bIsGL && unusedGLsForReplacement.includes(b.offense.leader.baseId);
          
          // Prioritize unused GLs
          if (aIsUnusedGL && !bIsUnusedGL) return -1;
          if (!aIsUnusedGL && bIsUnusedGL) return 1;
          
          // Then by win rate
          if (Math.abs(aWinRate - bWinRate) > 1) {
            return bWinRate - aWinRate;
          }
          
          return 0;
        });
        
        // Try to find a better alternative that doesn't conflict
        for (const betterAlternative of allAlternatives) {
          if (!betterAlternative.offense.leader.baseId) continue;
          
          const altWinRate = betterAlternative.adjustedWinPercentage ?? betterAlternative.winPercentage ?? 0;
          if (altWinRate <= currentWinRate) continue; // Not better
          
          const altOffenseUnits = [
            betterAlternative.offense.leader.baseId,
            ...betterAlternative.offense.members.map(m => m.baseId)
          ];
          
          // Check if this alternative conflicts
          const hasConflict = altOffenseUnits.some(unitId => usedCharacters.has(unitId));
          const leaderUsed = usedLeaders.has(betterAlternative.offense.leader.baseId);
          
          if (hasConflict || leaderUsed) {
            continue; // Skip - conflicts
          }
          
          // Found a better alternative! Replace the low win rate counter
          logger.info(
            `Replacing low win rate counter ${lowWinCounter.counter.offense.leader.baseId} vs ${opponentDefense} ` +
            `(${currentWinRate.toFixed(1)}%) with ${betterAlternative.offense.leader.baseId} ` +
            `(${altWinRate.toFixed(1)}%)${this.isGalacticLegend(betterAlternative.offense.leader.baseId) ? ' [GL]' : ''}`
          );
          
          // Remove old counter's characters from used sets
          const oldOffenseUnits = [
            lowWinCounter.counter.offense.leader.baseId,
            ...lowWinCounter.counter.offense.members.map(m => m.baseId)
          ];
          for (const unitId of oldOffenseUnits) {
            usedCharacters.delete(unitId);
          }
          usedLeaders.delete(lowWinCounter.counter.offense.leader.baseId);
          
          // Add new counter
          balancedOffense[lowWinCounter.index] = betterAlternative;
          
          // Mark new counter's characters as used
          for (const unitId of altOffenseUnits) {
            usedCharacters.add(unitId);
          }
          usedLeaders.add(betterAlternative.offense.leader.baseId);
          
          break; // Found replacement, move to next low win rate counter
        }
      }
    }
    
    // Second pass: Add defense squads that don't conflict with offense
    // For offensive strategy, be lenient with conflicts - allow defense squads even if they share 1-2 characters with offense
    // For offensive strategy, allow GLs on defense ONLY if they weren't used on offense (remaining unused GLs)
    // Continue until we reach maxDefenseSquads or run out of suggestions
    for (const defenseSuggestion of sortedDefense) {
      if (balancedDefense.length >= maxDefenseSquads) {
        break; // Reached max defense squads
      }
      
      const defenseUnits = [
        defenseSuggestion.squad.leader.baseId,
        ...defenseSuggestion.squad.members.map(m => m.baseId)
      ];
      
      // For offensive strategy, check if this GL was already used on offense
      if (strategyPreference === 'offensive' && this.isGalacticLegend(defenseSuggestion.squad.leader.baseId)) {
        // Check if this GL leader was used in any offense counter
        const isGlUsedOnOffense = balancedOffense.some(counter => 
          counter.offense.leader.baseId === defenseSuggestion.squad.leader.baseId
        );
        if (isGlUsedOnOffense) {
          logger.debug(
            `Skipping GL defense squad ${defenseSuggestion.squad.leader.baseId} - already used on offense (offensive strategy)`
          );
          continue; // Skip - GL already used on offense
        } else {
          logger.debug(
            `Allowing GL defense squad ${defenseSuggestion.squad.leader.baseId} - not used on offense, placing on defense (offensive strategy)`
          );
        }
      }
      
      // Check if leader is already used (strict - no duplicate leaders)
      if (usedLeaders.has(defenseSuggestion.squad.leader.baseId)) {
        logger.debug(
          `Skipping defense squad ${defenseSuggestion.squad.leader.baseId} - leader already used`
        );
        continue; // Skip - leader already used
      }
      
      // Check for character conflicts with offense
      const conflictingUnits = defenseUnits.filter(unitId => usedCharacters.has(unitId));
      const conflictCount = conflictingUnits.length;
      const squadSize = defenseUnits.length;
      
      // For offensive strategy, be lenient: only skip if >= 50% of the squad conflicts
      // This allows defense squads even if they share 1-2 characters with offense
      if (conflictCount > 0) {
        const conflictRatio = conflictCount / squadSize;
        // Skip only if >= 50% of the squad conflicts AND we have other options
        if (conflictRatio >= 0.5 && sortedDefense.length - balancedDefense.length > (maxDefenseSquads - balancedDefense.length) * 2) {
          logger.debug(
            `Skipping defense squad ${defenseSuggestion.squad.leader.baseId} - ` +
            `${conflictCount}/${squadSize} character(s) already used in offense (${(conflictRatio * 100).toFixed(0)}%): ${conflictingUnits.join(', ')}`
          );
          continue; // Skip this defense squad - too many conflicts
        } else {
          // Allow this squad despite minor conflicts
          logger.debug(
            `Allowing defense squad ${defenseSuggestion.squad.leader.baseId} despite ` +
            `${conflictCount} minor character conflict(s) with offense: ${conflictingUnits.join(', ')}`
          );
        }
      }
      
      // Add this defense squad
      logger.debug(
        `Adding defense squad ${defenseSuggestion.squad.leader.baseId} ` +
        `(Hold: ${defenseSuggestion.holdPercentage?.toFixed(1) ?? 'N/A'}%, ` +
        `Score: ${defenseSuggestion.score.toFixed(1)}, ` +
        `Conflicts: ${conflictCount}/${squadSize})`
      );
      balancedDefense.push(defenseSuggestion);
      
      // Mark characters as used, but only mark non-conflicting ones if we're being lenient
      // This allows other defense squads to still be considered
      if (conflictCount > 0 && conflictCount < squadSize * 0.5) {
        // Only mark non-conflicting characters
        for (const unitId of defenseUnits) {
          if (!conflictingUnits.includes(unitId)) {
            usedCharacters.add(unitId);
          }
        }
      } else {
        // Mark all characters as used
        for (const unitId of defenseUnits) {
          usedCharacters.add(unitId);
        }
      }
      usedLeaders.add(defenseSuggestion.squad.leader.baseId);
      }
    }
    
    // Log if we couldn't fill all defense slots
    if (balancedDefense.length < maxDefenseSquads) {
      const skippedCount = defenseSuggestions.length - balancedDefense.length;
      logger.warn(
        `Could only fill ${balancedDefense.length} of ${maxDefenseSquads} defense squad slots. ` +
        `Skipped ${skippedCount} defense suggestion(s) due to conflicts. ` +
        `Defense suggestions available: ${defenseSuggestions.length}, ` +
        `Offense counters: ${offenseCounters.filter(c => c.offense.leader.baseId).length}`
      );
      
      // Log which defense squads were skipped
      const placedLeaders = new Set(balancedDefense.map(d => d.squad.leader.baseId));
      const skippedDefense = defenseSuggestions.filter(d => !placedLeaders.has(d.squad.leader.baseId));
      if (skippedDefense.length > 0) {
        logger.info(
          `Skipped defense squads (${skippedDefense.length}): ` +
          skippedDefense.slice(0, 10).map(d => 
            `${d.squad.leader.baseId} (Hold: ${d.holdPercentage?.toFixed(1) ?? 'N/A'}%)`
          ).join(', ') +
          (skippedDefense.length > 10 ? ` ... and ${skippedDefense.length - 10} more` : '')
        );
      }
    } else {
      logger.info(
        `Successfully filled all ${maxDefenseSquads} defense squad slots`
      );
    }
    
    // Log data-driven decision summary
    // Count defense squads that are relatively good (>= 80% of best hold %)
    const defenseWithHighHold = balancedDefense.filter(d => {
      if (d.holdPercentage === null || bestHoldPercentage === null || bestHoldPercentage === 0) return false;
      const relativeScore = (d.holdPercentage / bestHoldPercentage) * 100;
      return relativeScore >= 80; // Top 20% relative to best
    }).length;
    
    // Count offense squads that are better on defense (using defense vs offense comparison)
    const offenseWithHighHold = balancedOffense.filter(c => {
      if (!c.offense.leader.baseId) return false;
      const defStats = offenseDefenseStats.get(c.offense.leader.baseId);
      return this.isBetterOnDefense(
        c.offense.leader.baseId,
        defStats?.holdPercentage ?? null,
        defStats?.seenCount ?? null,
        c.adjustedWinPercentage ?? c.winPercentage ?? null,
        c.seenCount ?? null,
        bestHoldPercentage,
        maxAllDefenseSeenCount, // Use actual max from SWGOH.GG data
        maxOffenseSeenCount     // Use actual max from SWGOH.GG data
      );
    }).length;
    
    logger.info(
      `Balanced offense and defense: ${balancedOffense.length} offense squad(s), ` +
      `${balancedDefense.length} defense squad(s), ${usedCharacters.size} unique character(s) used. ` +
      `Data-driven placement: ${defenseWithHighHold} defense squad(s) relatively good (>= 80% of best ${bestHoldPercentage?.toFixed(1) ?? 'N/A'}%), ` +
      `${offenseWithHighHold} offense squad(s) using leaders that are better on defense (defense viability > offense viability)`
    );
    
    return {
      balancedOffense,
      balancedDefense
    };
  }

  /**
   * Match counter squads against user's roster.
   * Returns the best matching counter for each defensive squad, ensuring each squad is only used once.
   * Now considers defense hold percentage when scoring counters.
   */
  async matchCountersAgainstRoster(
    defensiveSquads: UniqueDefensiveSquad[],
    userRoster: SwgohGgFullPlayerResponse,
    seasonId?: string,
    format: string = '5v5',
    strategyPreference: 'defensive' | 'balanced' | 'offensive' = 'balanced'
  ): Promise<MatchedCounterSquad[]> {
    if (!this.counterClient) {
      logger.warn('Counter client not available, cannot match counters');
      return [];
    }

    // Use full roster for counter matching - we want to find counters from all available characters
    // This ensures we can find counters even if they use characters outside the top 80 by GP
    const filteredRoster = userRoster;
    logger.info(
      `Using full roster for counter matching: ${filteredRoster.units?.filter(u => u.data.combat_type === 1).length || 0} characters ` +
      `(from ${userRoster.units?.length || 0} total units)`
    );

    // Create a map of unit base IDs to their relic levels from the user's roster
    // Relic level calculation: if gear_level >= 13 and relic_tier exists, then relic_level = relic_tier - 2
    // Note: If gear_level <= 12, relic_tier may still be 1, but the unit is not reliced
    const userUnitMap = new Map<string, number | null>();
    for (const unit of filteredRoster.units || []) {
      // Only include units that are at least 7 stars (rarity >= 7)
      if (unit.data.rarity >= 7) {
        let relicLevel: number | null = null;
        // Only calculate relic level if gear_level is 13 or higher (unit is reliced)
        // If gear_level <= 12, even if relic_tier exists (often equals 1), the unit is not reliced
        if (unit.data.gear_level >= 13 && unit.data.relic_tier !== null && unit.data.relic_tier !== undefined) {
          // Actual relic level is relic_tier - 2
          relicLevel = Math.max(0, unit.data.relic_tier - 2);
        }
        userUnitMap.set(unit.data.base_id, relicLevel);
      }
    }

    const matchedCounters: MatchedCounterSquad[] = [];
    const usedOffenseSquads = new Set<string>(); // Track used offense squads by leader base ID
    // NOTE: usedCharacters tracks USER's characters that have been used in previous offense counters
    // This prevents reusing the same USER character in multiple offense counters
    // OPPONENT characters (defensiveSquad.leader.baseId) should NEVER be added to this set
    const usedCharacters = new Set<string>(); // Track all used USER characters (leader + members) to prevent duplicates

    // Determine expected counter squad size based on format
    const expectedCounterSize = format === '3v3' ? 3 : 5;

    logger.info(`Starting counter matching for ${defensiveSquads.length} defensive squad(s) (format: ${format})`);

    for (const defensiveSquad of defensiveSquads) {
      try {
        // Get counter squads for this defensive squad leader
        const counterSquads = await this.counterClient.getCounterSquads(
          defensiveSquad.leader.baseId,
          seasonId
        );

        // Filter counter squads by format (3v3 = 3 units, 5v5 = 5 units)
        const filteredCounterSquads = counterSquads.filter(counter => {
          const allUnits = [counter.leader, ...counter.members];
          return allUnits.length === expectedCounterSize;
        });

        // Add logging to debug format filtering
        if (filteredCounterSquads.length === 0 && counterSquads.length > 0) {
          logger.warn(
            `No ${format} format counters found for ${defensiveSquad.leader.baseId}. ` +
            `Found ${counterSquads.length} total counter(s), but none match ${expectedCounterSize} units. ` +
            `Sample sizes: ${counterSquads.slice(0, 5).map(c => [c.leader, ...c.members].length).join(', ')} ` +
            `(seasonId: ${seasonId || 'none'})`
          );
        } else if (filteredCounterSquads.length > 0) {
          logger.info(
            `Filtered ${counterSquads.length} counter(s) to ${filteredCounterSquads.length} ${format} format counter(s) for ${defensiveSquad.leader.baseId}`
          );
        }

        // Find the best matching counter that:
        // 1. User has all units in their roster
        // 2. Hasn't been used yet (leader not in usedOffenseSquads)
        // 3. No characters have been used in previous counters (GAC rule: each character can only be used once per round)
        // 4. Prioritizes non-GL counters over GL counters (to conserve GLs for defense)
        // 5. Considers both win percentage and relic delta advantage
        
        // Evaluate ALL counters together (GL + non-GL) based on viability
        // We'll score them all based on seen count + win % + relic level, then apply non-GL bonus as modifier
        const allAvailableCounters: GacCounterSquad[] = [];

        for (const counter of filteredCounterSquads) {
          // Check if this counter squad has already been used
          if (usedOffenseSquads.has(counter.leader.baseId)) {
            continue;
          }

          // Check if user has all units in this counter squad
          const allUnits = [counter.leader, ...counter.members];
          const hasAllUnits = allUnits.every(unit => userUnitMap.has(unit.baseId));

          if (!hasAllUnits) {
            continue;
          }

          // Check relic levels - filter out counters where user's units are too weak
          // For defensive strategy, be more lenient since we want to find more counters
          const offenseRelics = allUnits.map(unit => userUnitMap.get(unit.baseId) ?? null);
          const defenseRelics = [
            defensiveSquad.leader.relicLevel,
            ...defensiveSquad.members.map(m => m.relicLevel)
          ];
          
          // Check if any offense unit is G12 or lower (relic null) while defense has high relics
          // For defensive strategy, only filter out if defense is R7+ and offense is G12 (more lenient)
          // For balanced/offensive, filter out if defense is R5+ and offense is G12 (stricter)
          const hasInsufficientRelics = offenseRelics.some((offRelic, idx) => {
            const defRelic = defenseRelics[idx];
            if (offRelic === null && defRelic !== null) {
              if (strategyPreference === 'defensive') {
                // For defensive strategy, only filter if defense is R7+ (very high)
                return defRelic >= 7;
              } else {
                // For balanced/offensive, filter if defense is R5+ (moderate)
                return defRelic >= 5;
              }
            }
            return false;
          });
          
          if (hasInsufficientRelics) {
            const maxDefRelic = Math.max(...defenseRelics.filter(r => r !== null) as number[]);
            logger.debug(
              `Skipping counter ${counter.leader.baseId} - insufficient relic levels (G12 vs R${maxDefRelic})`
            );
            continue;
          }

          // Check if any character in this counter has already been used
          // NOTE: usedCharacters only tracks USER's characters, not opponent's characters
          // The opponent's defense leader (defensiveSquad.leader.baseId) should NOT be in usedCharacters
          const allUnitIds = allUnits.map(unit => unit.baseId);
          const conflictingUserChars = allUnitIds.filter(unitId => usedCharacters.has(unitId));
          const hasUsedCharacters = conflictingUserChars.length > 0;
          
          if (hasUsedCharacters) {
            logger.debug(
              `Counter ${counter.leader.baseId} vs opponent ${defensiveSquad.leader.baseId}: ` +
              `User characters already used: ${conflictingUserChars.join(', ')} (from ${allUnitIds.join(', ')})`
            );
          }
          
          if (hasUsedCharacters) {
            continue;
          }
          
          // Add to all available counters (both GL and non-GL)
          allAvailableCounters.push(counter);
        }
        
        // Check if the defensive squad is a GL
        const isDefensiveSquadGL = this.isGalacticLegend(defensiveSquad.leader.baseId);
        
        // Count GL vs non-GL for logging
        const glCount = allAvailableCounters.filter(c => this.isGalacticLegend(c.leader.baseId)).length;
        const nonGlCount = allAvailableCounters.length - glCount;
        
            logger.info(
          `Counter analysis for ${defensiveSquad.leader.baseId}${isDefensiveSquadGL ? ' (GL)' : ''}: ` +
          `${allAvailableCounters.length} total counter(s) available (${nonGlCount} non-GL, ${glCount} GL) - evaluating all together`
        );
        
        // Find max seen count across ALL counters for normalization
        let maxSeenCount = 0;
        for (const counter of allAvailableCounters) {
          if (counter.seenCount !== null && counter.seenCount > maxSeenCount) {
            maxSeenCount = counter.seenCount;
          }
        }
        
        // Store ALL available counters (sorted by score) as alternatives
        // This ensures we have maximum options when primary counters conflict with defense
        // Some opponent defenses (like QUEENAMIDALA) have very limited non-GL options, so we need all of them
        const topCounters: Array<{ counter: GacCounterSquad; score: number }> = [];
        const MAX_ALTERNATIVES = allAvailableCounters.length; // Store ALL available counters as alternatives

        // Evaluate ALL counters together (GL and non-GL)
        for (const counter of allAvailableCounters) {
          // All checks already passed above, just evaluate score
          const allUnits = [counter.leader, ...counter.members];
          const allUnitIds = allUnits.map(unit => unit.baseId);
          
          // Get relic levels for this counter squad
          const offenseRelics = allUnits.map(unit => userUnitMap.get(unit.baseId) ?? null);
          const defenseRelics = [
            defensiveSquad.leader.relicLevel,
            ...defensiveSquad.members.map(m => m.relicLevel)
          ];

          // Calculate key matchups and transform win rate
          const keyMatchups = calculateKeyMatchups(offenseRelics, defenseRelics);
          const adjustedWinRate = transformWinRateForRelicDelta(counter.winPercentage, keyMatchups);
          
          // Get defense stats for the counter squad (if it's also used on defense)
          const counterDefenseStats = await this.getDefenseStatsForSquad(counter.leader.baseId, seasonId);
          
          // Get defense stats for the defensive squad we're countering
          const opponentDefenseStats = await this.getDefenseStatsForSquad(defensiveSquad.leader.baseId, seasonId);
          
          // Calculate viability score based on win % and seen count
          // This prioritizes counters that are both proven (high seen count) and effective (high win %)
          // Example: 95% win with 34,000 seen should beat 87% win with 3,881 seen
          const baseWinRate = adjustedWinRate ?? counter.winPercentage ?? 50;
          
          // Normalize seen count to 0-100 scale (using logarithmic scaling to handle large ranges)
          // This prevents one very high seen count from dominating, while still rewarding higher counts
          let normalizedSeenScore = 0;
          if (counter.seenCount !== null && maxSeenCount > 0) {
            // Use logarithmic scaling: log(seenCount + 1) / log(maxSeenCount + 1) * 100
            const logSeen = Math.log10(counter.seenCount + 1);
            const logMax = Math.log10(maxSeenCount + 1);
            normalizedSeenScore = (logSeen / logMax) * 100;
          } else if (counter.seenCount === null) {
            // If no seen count data, use a neutral score (50) to not penalize too heavily
            normalizedSeenScore = 50;
          }
          
          // Combined viability score: 60% win rate, 40% seen count (proven usage)
          // This ensures counters with both high win % AND high usage are prioritized
          const viabilityScore = (baseWinRate * 0.6) + (normalizedSeenScore * 0.4);
          
          // Score counter based on:
          // 1. Viability score (win % + seen count, weighted 50%)
          // 2. Relic delta advantage (positive delta = advantage, weighted 20%)
          // 3. Defense consideration: if counter is good on defense, small penalty (weighted 10%)
          // 4. Opponent defense strength: if opponent squad is strong on defense, bonus (weighted 10%)
          // 5. Heavy penalty for trap counters (punching up 3+ tiers)
          // 6. BONUS for non-GL counters (to conserve GLs for defense, weighted 10%)
          const viabilityScoreWeighted = viabilityScore * 0.5;
          
          // Relic delta score: use team average delta
          const relicDelta = calculateSquadRelicDelta(offenseRelics, defenseRelics);
          const relicDeltaScore = Math.max(-50, Math.min(50, relicDelta.delta * 5)) * 0.2;
          
          // Defense consideration: if the counter squad is also good on defense (hold % > 20%),
          // apply a small penalty since we might want to save it for defense
          let defensePenalty = 0;
          if (counterDefenseStats.holdPercentage !== null && counterDefenseStats.holdPercentage > 20) {
            // Penalty increases with hold percentage (max -10 points for 50%+ hold)
            defensePenalty = -Math.min(10, (counterDefenseStats.holdPercentage - 20) * 0.33) * 0.1;
          }
          
          // Opponent defense bonus: if the defensive squad is strong on defense (hold % > 25%),
          // prioritize having a good counter for it
          let opponentDefenseBonus = 0;
          if (opponentDefenseStats.holdPercentage !== null && opponentDefenseStats.holdPercentage > 25) {
            // Bonus increases with hold percentage (max +5 points for 50%+ hold)
            opponentDefenseBonus = Math.min(5, (opponentDefenseStats.holdPercentage - 25) * 0.2) * 0.1;
          }
          
          // Trap penalty: heavily penalise counters where we're punching up 3+ tiers
          let trapPenalty = 0;
          if (keyMatchups.isTrap) {
            trapPenalty = -30; // Significant penalty for trap counters
          }
          
          // Non-GL bonus: apply as modifier to viability score, not as separate category
          // Strategy preference affects GL vs non-GL prioritization
          const isCounterGL = this.isGalacticLegend(counter.leader.baseId);
          let nonGlBonus = 0;
          
          if (strategyPreference === 'defensive') {
            // Defensive strategy: COMPLETELY BLOCK GL counters - GLs must be on defense only
            if (!isCounterGL) {
              nonGlBonus = 50; // Large bonus for non-GL counters
              if (isDefensiveSquadGL) {
                nonGlBonus += 25; // Extra bonus for countering GL with non-GL
                logger.info(
                  `[Defensive Strategy] Non-GL counter ${counter.leader.baseId} vs GL ${defensiveSquad.leader.baseId} - applying bonus to conserve GL for defense`
                );
              }
            } else {
              // For defensive strategy, allow GL counters ONLY if there are no non-GL alternatives
              // Check if there are any non-GL alternatives in the available counters
              const hasNonGlAlternatives = allAvailableCounters.some(c => 
                !this.isGalacticLegend(c.leader.baseId) && c.leader.baseId !== counter.leader.baseId
              );
              if (hasNonGlAlternatives) {
                // Block GL counter if non-GL alternatives exist
                nonGlBonus = -1000; // Massive penalty to block GLs when alternatives exist
                logger.info(
                  `[Defensive Strategy] BLOCKING GL counter ${counter.leader.baseId} - non-GL alternatives exist for ${defensiveSquad.leader.baseId}`
                );
              } else {
                // Allow GL counter if no non-GL alternatives exist (but with lower priority)
                nonGlBonus = -50; // Smaller penalty - allow but deprioritize
                logger.info(
                  `[Defensive Strategy] ALLOWING GL counter ${counter.leader.baseId} vs ${defensiveSquad.leader.baseId} - no non-GL alternatives available`
                );
              }
            }
          } else if (strategyPreference === 'offensive') {
            // Offensive strategy: Prioritize ALL GLs on offense for 100% wins
            // GL counters should be heavily prioritized, especially those with high win rates
            if (!isCounterGL) {
              // Penalize non-GL counters - we want GLs on offense
              nonGlBonus = -50; // Large penalty to deprioritize non-GL counters
              if (isDefensiveSquadGL) {
                // Even more penalty if countering a GL with non-GL (we should use GLs for GL defenses)
                nonGlBonus -= 25; // Additional penalty
                logger.info(
                  `[Offensive Strategy] Non-GL counter ${counter.leader.baseId} vs GL ${defensiveSquad.leader.baseId} - deprioritizing to save GLs for offense`
                );
              }
            } else {
              // GL counters are highly valuable on offense - give large bonus
              // Bonus increases with win rate (especially 100% wins)
              const winRate = adjustedWinRate ?? counter.winPercentage ?? 0;
              if (winRate === 100) {
                nonGlBonus = 100; // Maximum bonus for 100% win rate GL counters
              } else if (winRate >= 95) {
                nonGlBonus = 75; // Large bonus for 95%+ win rate GL counters
              } else if (winRate >= 90) {
                nonGlBonus = 50; // Good bonus for 90%+ win rate GL counters
              } else {
                nonGlBonus = 25; // Still bonus for GL counters, but less for lower win rates
              }
              
              // Extra bonus if countering a GL defense with a GL counter (GL vs GL)
              if (isDefensiveSquadGL) {
                nonGlBonus += 25; // Additional bonus for GL vs GL matchups
                logger.info(
                  `[Offensive Strategy] GL counter ${counter.leader.baseId} vs GL ${defensiveSquad.leader.baseId} - ` +
                  `prioritizing (Win: ${winRate.toFixed(1)}%)`
                );
              }
            }
          } else {
            // Balanced strategy: Current behavior
            if (!isCounterGL) {
              // Base bonus for using non-GL counter (15 points)
              nonGlBonus = 15;
              
              // Extra bonus if countering a GL with a non-GL squad (10 additional points)
              if (isDefensiveSquadGL) {
                nonGlBonus += 10;
                logger.info(
                  `Non-GL counter ${counter.leader.baseId} vs GL ${defensiveSquad.leader.baseId} - applying bonus to conserve GL for defense`
                );
              }
            } else {
              // For balanced strategy, GL counters are acceptable
              // We'll prioritize unused GLs in the sorting phase, not here
              // Don't penalize GL counters too heavily - let the sorting logic handle prioritization
              const hasNonGlAlternatives = allAvailableCounters.some(c => 
                !this.isGalacticLegend(c.leader.baseId) && c.leader.baseId !== counter.leader.baseId
              );
              if (hasNonGlAlternatives) {
                nonGlBonus = -10; // Small penalty for GL counter when non-GL alternatives exist (reduced from -20)
              } else {
                nonGlBonus = 10; // Bonus if GL is the only option
              }
            }
          }
          
          const totalScore = viabilityScoreWeighted + relicDeltaScore + defensePenalty + opponentDefenseBonus + trapPenalty + nonGlBonus;

          // For defensive strategy, include GL counters in alternatives even if non-GL alternatives exist
          // They will be tried last during balancing if all non-GL alternatives conflict
          // Don't skip them here - let the balancing phase decide based on conflicts

          // Store this counter with its score
          topCounters.push({ counter, score: totalScore });
        }

        // Sort by score descending and take top MAX_ALTERNATIVES
        topCounters.sort((a, b) => b.score - a.score);
        const selectedCounters = topCounters.slice(0, MAX_ALTERNATIVES);

        // For defensive strategy, include GL counters in alternatives even if non-GL alternatives exist
        // The balancing phase will try non-GL first (they have higher scores), then GL if all non-GL conflict
        // Don't filter them out here - let the balancing phase decide based on conflicts
        const filteredCounters = selectedCounters;

        if (filteredCounters.length === 0) {
          // No valid counters found
          logger.warn(
            `No matching counter found for defensive squad with leader ${defensiveSquad.leader.baseId}`
          );
          matchedCounters.push({
            offense: {
              leader: { baseId: '', relicLevel: null, portraitUrl: null },
              members: []
            },
            defense: defensiveSquad,
            winPercentage: null,
            adjustedWinPercentage: null,
            seenCount: null,
            avgBanners: null,
            relicDelta: null,
            worstCaseRelicDelta: null,
            bestCaseRelicDelta: null,
            keyMatchups: null
          });
          continue;
        }

        // Use the best counter as primary, store others as alternatives
        const bestMatch = filteredCounters[0].counter;
        const alternatives: MatchedCounterSquad[] = [];

        // Create MatchedCounterSquad for the primary counter
        const createMatchedCounter = (counter: GacCounterSquad): MatchedCounterSquad => {
          const allUnits = [counter.leader, ...counter.members];
          const offenseRelics = allUnits.map(unit => userUnitMap.get(unit.baseId) ?? null);
          const defenseRelics = [
            defensiveSquad.leader.relicLevel,
            ...defensiveSquad.members.map(m => m.relicLevel)
          ];

          const offenseSquad: UniqueDefensiveSquad = {
            leader: {
              baseId: counter.leader.baseId,
              relicLevel: userUnitMap.get(counter.leader.baseId) ?? null,
              portraitUrl: counter.leader.portraitUrl
            },
            members: counter.members.map(m => ({
              baseId: m.baseId,
              relicLevel: userUnitMap.get(m.baseId) ?? null,
              portraitUrl: m.portraitUrl
            }))
          };

          const keyMatchups = calculateKeyMatchups(offenseRelics, defenseRelics);
          const adjustedWinRate = transformWinRateForRelicDelta(counter.winPercentage, keyMatchups);
          const relicDelta = calculateSquadRelicDelta(offenseRelics, defenseRelics);
          const worstCaseRelicDelta = calculateWorstCaseRelicDelta(offenseRelics, defenseRelics);
          const bestCaseRelicDelta = calculateBestCaseRelicDelta(offenseRelics, defenseRelics);

          return {
            offense: offenseSquad,
            defense: defensiveSquad,
            winPercentage: counter.winPercentage,
            adjustedWinPercentage: adjustedWinRate,
            seenCount: counter.seenCount,
            avgBanners: counter.avgBanners,
            relicDelta,
            worstCaseRelicDelta,
            bestCaseRelicDelta,
            keyMatchups
          };
        };

        // Create alternatives from remaining top counters
        for (let i = 1; i < filteredCounters.length; i++) {
          alternatives.push(createMatchedCounter(filteredCounters[i].counter));
        }

        // Mark this offense squad as used
        usedOffenseSquads.add(bestMatch.leader.baseId);
        
        // Mark all characters in this counter as used (GAC rule: each character can only be used once per round)
        const allBestMatchUnits = [bestMatch.leader, ...bestMatch.members];
        const characterIds = allBestMatchUnits.map(u => u.baseId);
        for (const unit of allBestMatchUnits) {
          usedCharacters.add(unit.baseId);
        }
        
        logger.info(
          `Matched counter for ${defensiveSquad.leader.baseId}: ${bestMatch.leader.baseId} ` +
          `(win rate: ${bestMatch.winPercentage ?? 'N/A'}%, characters: ${characterIds.join(', ')})` +
          (alternatives.length > 0 ? ` [${alternatives.length} alternative(s) available]` : '')
        );

        // Create primary matched counter
        const primaryCounter = createMatchedCounter(bestMatch);
        
        // Store alternatives if any
        if (alternatives.length > 0) {
          primaryCounter.alternatives = alternatives;
        }

        matchedCounters.push(primaryCounter);
      } catch (error) {
        logger.error(`Error matching counters for ${defensiveSquad.leader.baseId}:`, error);
        // Continue with next squad even if this one fails
        matchedCounters.push({
          offense: {
            leader: { baseId: '', relicLevel: null, portraitUrl: null },
            members: []
          },
          defense: defensiveSquad,
          winPercentage: null,
          adjustedWinPercentage: null,
          seenCount: null,
          avgBanners: null,
          relicDelta: null,
          worstCaseRelicDelta: null,
          bestCaseRelicDelta: null,
          keyMatchups: null
        });
      }
    }

    // Log GL vs non-GL counter usage summary
    const glCountersUsed = matchedCounters.filter(m => 
      m.offense.leader.baseId && this.isGalacticLegend(m.offense.leader.baseId)
    ).length;
    const nonGlCountersUsed = matchedCounters.filter(m => 
      m.offense.leader.baseId && !this.isGalacticLegend(m.offense.leader.baseId)
    ).length;
    const glDefensesCountered = defensiveSquads.filter(d => 
      this.isGalacticLegend(d.leader.baseId)
    ).length;

    logger.info(
      `Counter matching complete: ${matchedCounters.filter(m => m.offense.leader.baseId).length} counter(s) matched, ` +
      `${usedCharacters.size} unique character(s) used. ` +
      `GL usage: ${glCountersUsed} GL counter(s) used, ${nonGlCountersUsed} non-GL counter(s) used. ` +
      `${glDefensesCountered} GL defense(s) encountered. ` +
      `GL conservation: ${glDefensesCountered - glCountersUsed} GL(s) potentially saved for defense`
    );

    return matchedCounters;
  }

  /**
   * Evaluate user's roster against top defense squads from swgoh.gg.
   * Returns top candidates (up to 36) sorted by viability (hold % + seen count + relic level).
   * 
   * @param userRoster - User's roster
   * @param seasonId - Season ID for fetching defense data
   * @param format - Format (3v3 or 5v5)
   * @returns Top defense squad candidates with scores (up to 36 to ensure enough options after filtering)
   */
  async evaluateRosterForDefense(
    userRoster: SwgohGgFullPlayerResponse,
    seasonId: string | undefined,
    format: string = '5v5',
    strategyPreference: 'defensive' | 'balanced' | 'offensive' = 'balanced'
  ): Promise<Array<{
    squad: UniqueDefensiveSquad;
    holdPercentage: number | null;
    seenCount: number | null;
    avgBanners: number | null;
    score: number;
    isGL: boolean;
    reason: string;
  }>> {
    if (!this.defenseClient) {
      logger.warn('Defense client not available, cannot evaluate roster for defense');
      return [];
    }

    // For defense evaluation, use full roster to get more options
    // GAC matchmaking uses top 80, but for generating defense squads we want all available characters
    // This ensures we can find all GLs and create more diverse defense options
    const filteredRoster = userRoster; // Use full roster instead of top 80
    logger.info(
      `Using full roster for defense evaluation: ${filteredRoster.units?.filter(u => u.data.combat_type === 1).length || 0} characters ` +
      `(from ${userRoster.units?.length || 0} total units)`
    );

    // Fetch top defense squads - prioritize 'count' sorted list (proven usage/synergy)
    // 'count' is a better indicator of squad synergy and defensive quality than 'percent'
    // 'percent' can include rogue teams that only work in lower leagues
    const [topDefenseSquadsByCount, topDefenseSquadsByPercent] = await Promise.all([
      this.defenseClient.getTopDefenseSquads('count', seasonId, format),
      this.defenseClient.getTopDefenseSquads('percent', seasonId, format)
    ]);
    
    // Filter out low-seen-count squads from percent list (likely rogue teams from lower leagues)
    // Only include squads with seen count >= 50 to ensure they're proven
    const MIN_SEEN_COUNT_FOR_PERCENT = 50;
    const filteredPercentSquads = topDefenseSquadsByPercent.filter(
      squad => squad.seenCount !== null && squad.seenCount >= MIN_SEEN_COUNT_FOR_PERCENT
    );
    
    // Merge and deduplicate by leader baseId (keep unique squads)
    // Prioritize 'count' sorted list - it's the primary source (proven usage)
    const allTopDefenseSquads = new Map<string, typeof topDefenseSquadsByCount[0]>();
    
    // First, add all squads from 'count' sorted list (primary source)
    for (const squad of topDefenseSquadsByCount) {
      allTopDefenseSquads.set(squad.leader.baseId, squad);
    }
    
    // Then, add squads from 'percent' sorted list only if they:
    // 1. Don't already exist (not in count list)
    // 2. Have sufficient seen count (filtered above)
    for (const squad of filteredPercentSquads) {
      if (!allTopDefenseSquads.has(squad.leader.baseId)) {
        allTopDefenseSquads.set(squad.leader.baseId, squad);
      }
    }
    
    const topDefenseSquads = Array.from(allTopDefenseSquads.values());
    
    logger.info(
      `Evaluating against ${topDefenseSquads.length} unique top defense squad(s) ` +
      `(${topDefenseSquadsByCount.length} from count sort [primary], ` +
      `${filteredPercentSquads.length} from percent sort [filtered: seen >= ${MIN_SEEN_COUNT_FOR_PERCENT}])`
    );
    
    // Build user unit map (only characters, rarity >= 7)
    const userUnitMap = new Map<string, number | null>();
    for (const unit of filteredRoster.units || []) {
      // Only include characters (not ships) with rarity >= 7
      if (unit.data.combat_type === 1 && unit.data.rarity >= 7) {
        let relicLevel: number | null = null;
        if (unit.data.gear_level >= 13 && unit.data.relic_tier !== null && unit.data.relic_tier !== undefined) {
          relicLevel = Math.max(0, unit.data.relic_tier - 2);
        }
        userUnitMap.set(unit.data.base_id, relicLevel);
      }
    }
    
    logger.info(
      `User unit map: ${userUnitMap.size} character(s) with rarity >= 7 available for defense squads`
    );
    
    // Count user's GLs (from full roster, not filtered)
    const userGLs = new Set<string>();
    for (const unit of filteredRoster.units || []) {
      if (unit.data.combat_type === 1 && // Only characters
          unit.data.is_galactic_legend && 
          this.isGalacticLegend(unit.data.base_id)) {
        userGLs.add(unit.data.base_id);
      }
    }
    
    logger.info(
      `Found ${userGLs.size} GL(s) in roster: ${Array.from(userGLs).join(', ')}`
    );
    
    logger.info(
      `Found ${userGLs.size} GL(s) in roster: ${Array.from(userGLs).join(', ')}`
    );
    
    const candidates: Array<{
      squad: UniqueDefensiveSquad;
      holdPercentage: number | null;
      seenCount: number | null;
      avgBanners: number | null;
      score: number;
      isGL: boolean;
      reason: string;
    }> = [];
    
    // Find max seen count for normalization
    let maxSeenCount = 0;
    for (const defenseSquad of topDefenseSquads) {
      if (defenseSquad.seenCount !== null && defenseSquad.seenCount > maxSeenCount) {
        maxSeenCount = defenseSquad.seenCount;
      }
    }
    
    for (const defenseSquad of topDefenseSquads) {
      const holdPercentage = defenseSquad.holdPercentage;
      
      // No minimum threshold - evaluate all squads the user has
      // Lower hold % squads will be scored lower but still considered
      
      const leaderBaseId = defenseSquad.leader.baseId;
      const allUnits = [defenseSquad.leader, ...defenseSquad.members];
      
      // Check if user has all units
      const hasAllUnits = allUnits.every(unit => userUnitMap.has(unit.baseId));
      if (!hasAllUnits) {
        continue;
      }
      
      // Get relic levels
      const squadRelics = allUnits.map(unit => userUnitMap.get(unit.baseId) ?? null);
      const avgRelic = squadRelics.filter(r => r !== null).length > 0
        ? squadRelics.filter(r => r !== null).reduce((sum, r) => sum + (r ?? 0), 0) / squadRelics.filter(r => r !== null).length
        : 0;
      
      // Check if this is a GL squad
      const isGL = this.isGalacticLegend(leaderBaseId);
      
      // Score: seen count (60%) + hold % (30%) + relic score (10%)
      // Seen count is the best indicator of squad synergy and proven defensive quality
      // Hold % can be misleading (rogue teams in lower leagues), so it's weighted less
      
      // Normalize seen count (primary factor - 60% weight)
      let normalizedSeenScore = 0;
      if (defenseSquad.seenCount !== null && maxSeenCount > 0) {
        const logSeen = Math.log10(defenseSquad.seenCount + 1);
        const logMax = Math.log10(maxSeenCount + 1);
        normalizedSeenScore = (logSeen / logMax) * 100;
      }
      const seenScore = normalizedSeenScore * 0.6; // Increased from 40% to 60%
      
      // Hold percentage (secondary factor - 30% weight, reduced from 50%)
      const holdScore = (holdPercentage ?? 0) * 0.3;
      
      // Relic score: penalize if relics are too low
      let relicScore = 10;
      if (avgRelic < 5) {
        relicScore = Math.max(0, 10 - (5 - avgRelic) * 2);
      }
      
      // GL bonus: if user has GLs, boost GL squads slightly
      let glBonus = 0;
      if (isGL && userGLs.has(leaderBaseId)) {
        glBonus = 5; // Small bonus to ensure GLs are considered
      }
      
      const totalScore = holdScore + seenScore + relicScore + glBonus;
      
      candidates.push({
        squad: {
          leader: {
            baseId: leaderBaseId,
            relicLevel: userUnitMap.get(leaderBaseId) ?? null,
            portraitUrl: defenseSquad.leader.portraitUrl
          },
          members: defenseSquad.members.map(m => ({
            baseId: m.baseId,
            relicLevel: userUnitMap.get(m.baseId) ?? null,
            portraitUrl: m.portraitUrl
          }))
        },
        holdPercentage,
        seenCount: defenseSquad.seenCount,
        avgBanners: defenseSquad.avgBanners,
        score: totalScore,
        isGL,
        reason: `Hold: ${holdPercentage?.toFixed(1) ?? 'N/A'}%, Seen: ${defenseSquad.seenCount?.toLocaleString() ?? 'N/A'}, Avg Relic: ${avgRelic.toFixed(1)}`
      });
    }
    
    // Step 2: Generate additional squads from roster
    const generatedCandidates = await this.generateDefenseSquadsFromRoster(
      filteredRoster,
      seasonId,
      format,
      topDefenseSquads
    );
    
    // Step 3: Combine and deduplicate by leader + members
    const allCandidates = new Map<string, typeof candidates[0]>();
    
    // Add matched candidates first (they have better stats from swgoh.gg)
    for (const candidate of candidates) {
      const memberIds = candidate.squad.members.map(m => m.baseId).sort();
      const key = `${candidate.squad.leader.baseId}_${memberIds.join('_')}`;
      allCandidates.set(key, candidate);
    }
    
    // Add generated candidates (only if not already present)
    for (const candidate of generatedCandidates) {
      const memberIds = candidate.squad.members.map(m => m.baseId).sort();
      const key = `${candidate.squad.leader.baseId}_${memberIds.join('_')}`;
      if (!allCandidates.has(key)) {
        allCandidates.set(key, candidate);
      }
    }
    
    // Sort by score and ensure we have a good mix of GL and non-GL candidates
    const allCandidatesArray = Array.from(allCandidates.values());
    const sortedCandidates = allCandidatesArray.sort((a, b) => b.score - a.score);
    
    // For defensive strategy, we want more GLs, but still need non-GL options
    // Take top candidates but ensure we have at least some non-GL options
    const glCandidates = sortedCandidates.filter(c => c.isGL);
    const nonGlCandidates = sortedCandidates.filter(c => !c.isGL);
    
    // For defensive strategy, prioritize getting ALL unique GL leaders
    // Take top GLs and top non-GLs separately, then combine
    // This ensures we have both types even if GLs score much higher
    let topGlCandidates: typeof glCandidates;
    if (strategyPreference === 'defensive') {
      // For defensive strategy, group GLs by leader and take best of each
      // This ensures we get all unique GL leaders, not just top-scoring squads
      const glByLeader = new Map<string, typeof glCandidates>();
      for (const gl of glCandidates) {
        const leaderId = gl.squad.leader.baseId;
        if (!glByLeader.has(leaderId)) {
          glByLeader.set(leaderId, []);
        }
        glByLeader.get(leaderId)!.push(gl);
      }
      // Get best candidate per GL leader, then sort by score
      const bestGlPerLeader = Array.from(glByLeader.values()).map(gls => 
        gls.sort((a, b) => b.score - a.score)[0]
      );
      topGlCandidates = bestGlPerLeader.sort((a, b) => b.score - a.score);
    logger.info(
        `Defensive strategy: Found ${topGlCandidates.length} unique GL leader(s) in candidates ` +
        `(user has ${userGLs.size} GL(s) total)`
      );
    } else {
      topGlCandidates = glCandidates.slice(0, Math.min(30, glCandidates.length));
    }
    const topNonGlCandidates = nonGlCandidates.slice(0, Math.min(30, nonGlCandidates.length));
    
    // Combine and deduplicate (in case there are duplicates)
    const combinedCandidates = new Map<string, typeof sortedCandidates[0]>();
    for (const candidate of [...topGlCandidates, ...topNonGlCandidates]) {
      const memberIds = candidate.squad.members.map(m => m.baseId).sort();
      const key = `${candidate.squad.leader.baseId}_${memberIds.join('_')}`;
      if (!combinedCandidates.has(key)) {
        combinedCandidates.set(key, candidate);
      }
    }
    
    // Sort by score again and take top 50
    const finalCandidates = Array.from(combinedCandidates.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, 50);
    
    // Log breakdown of GL vs non-GL candidates
    const glCandidatesCount = finalCandidates.filter(c => c.isGL).length;
    const nonGlCandidatesCount = finalCandidates.length - glCandidatesCount;
    
    logger.info(
      `Combined defense candidates: ${candidates.length} matched from top squads, ${generatedCandidates.length} generated from roster, ` +
      `${finalCandidates.length} unique candidates (top ${finalCandidates.length} will be used)`
    );
    logger.info(
      `Candidate breakdown: ${glCandidatesCount} GL candidate(s), ${nonGlCandidatesCount} non-GL candidate(s)`
    );
    
    return finalCandidates;
  }

  /**
   * Generate defense squads directly from user's roster.
   * Creates combinations using potential leaders and other characters.
   * 
   * @param userRoster - User's roster (should be filtered to top 80)
   * @param seasonId - Season ID for fetching defense data
   * @param format - Format (3v3 or 5v5)
   * @param topDefenseSquads - Top defense squads from swgoh.gg (for leader prioritization)
   * @returns Generated defense squad candidates
   */
  private async generateDefenseSquadsFromRoster(
    userRoster: SwgohGgFullPlayerResponse,
    seasonId: string | undefined,
    format: string = '5v5',
    topDefenseSquads: GacTopDefenseSquad[]
  ): Promise<Array<{
    squad: UniqueDefensiveSquad;
    holdPercentage: number | null;
    seenCount: number | null;
    avgBanners: number | null;
    score: number;
    isGL: boolean;
    reason: string;
  }>> {
    const squadSize = format === '3v3' ? 3 : 5;
    const candidates: Array<{
      squad: UniqueDefensiveSquad;
      holdPercentage: number | null;
      seenCount: number | null;
      avgBanners: number | null;
      score: number;
      isGL: boolean;
      reason: string;
    }> = [];

    // Build user unit map (rarity >= 7, with relic levels)
    // Portrait URLs will be constructed from baseId when needed
    // Use full roster (not just top 80) to get all available characters
    const userUnitMap = new Map<string, { relicLevel: number | null }>();
    for (const unit of userRoster.units || []) {
      // Only include characters (not ships) with rarity >= 7
      if (unit.data.combat_type === 1 && unit.data.rarity >= 7) {
        let relicLevel: number | null = null;
        if (unit.data.gear_level >= 13 && unit.data.relic_tier !== null && unit.data.relic_tier !== undefined) {
          relicLevel = Math.max(0, unit.data.relic_tier - 2);
        }
        userUnitMap.set(unit.data.base_id, {
          relicLevel
        });
      }
    }

    const availableCharacters = Array.from(userUnitMap.keys());
    
    if (availableCharacters.length < squadSize) {
      logger.warn(`Not enough characters (${availableCharacters.length}) to generate ${squadSize}-character squads`);
      return [];
    }
    
    // Get potential leaders - prioritize characters that appear as leaders in top defense squads
    const leaderFrequency = new Map<string, number>();
    for (const squad of topDefenseSquads) {
      const count = leaderFrequency.get(squad.leader.baseId) || 0;
      leaderFrequency.set(squad.leader.baseId, count + 1);
    }
    
    // Sort potential leaders by frequency in top squads, then by whether they're GLs
    const potentialLeaders = availableCharacters
      .sort((a, b) => {
        const aFreq = leaderFrequency.get(a) || 0;
        const bFreq = leaderFrequency.get(b) || 0;
        if (aFreq !== bFreq) return bFreq - aFreq; // Higher frequency first
        
        // If same frequency, prioritize GLs
        const aIsGL = this.isGalacticLegend(a);
        const bIsGL = this.isGalacticLegend(b);
        if (aIsGL && !bIsGL) return -1;
        if (!aIsGL && bIsGL) return 1;
        return 0;
      })
      .slice(0, 50); // Limit to top 50 potential leaders to avoid performance issues

    logger.info(
      `Generating defense squads from roster: ${availableCharacters.length} available characters, ` +
      `${potentialLeaders.length} potential leaders`
    );

    // Generate squads for each potential leader
    for (const leaderId of potentialLeaders) {
      if (candidates.length >= 100) break; // Limit total candidates
      
      // Filter out the leader and ALL GLs from remaining characters
      // GLs should only be leaders, never members of other squads
      const remainingChars = availableCharacters.filter(id => 
        id !== leaderId && !this.isGalacticLegend(id)
      );
      
      // Generate combinations of members (squadSize - 1 members needed)
      const memberCombinations = this.generateCombinations(remainingChars, squadSize - 1, 10); // Limit to 10 combinations per leader
      
      for (const members of memberCombinations) {
        // Check if this exact squad exists in top defense squads (to avoid duplicates)
        const squadExists = topDefenseSquads.some(squad => {
          if (squad.leader.baseId !== leaderId || squad.members.length !== members.length) {
            return false;
          }
          const squadMemberIds = squad.members.map(m => m.baseId).sort();
          const memberIds = [...members].sort();
          return squadMemberIds.every((id, i) => id === memberIds[i]);
        });
        
        if (squadExists) continue; // Skip - will be handled by existing matching logic
        
        // Try to find defense stats for this leader
        const stats = await this.getDefenseStatsForSquad(leaderId, seasonId);
        
        // Build the squad
        // Portrait URLs will be constructed from baseId when rendering (similar to existing logic)
        const squad: UniqueDefensiveSquad = {
          leader: {
            baseId: leaderId,
            relicLevel: userUnitMap.get(leaderId)?.relicLevel ?? null,
            portraitUrl: null // Will be constructed from baseId when needed
          },
          members: members.map(memberId => ({
            baseId: memberId,
            relicLevel: userUnitMap.get(memberId)?.relicLevel ?? null,
            portraitUrl: null // Will be constructed from baseId when needed
          }))
        };
        
        // Calculate score
        const isGL = this.isGalacticLegend(leaderId);
        const holdScore = (stats.holdPercentage ?? 0) * 0.5;
        
        // Normalize seen count (similar to existing logic)
        let normalizedSeenScore = 0;
        if (stats.seenCount !== null && stats.seenCount > 0) {
          // Use a reasonable max for normalization (100k seen count)
          const logSeen = Math.log10(stats.seenCount + 1);
          const logMax = Math.log10(100000 + 1);
          normalizedSeenScore = (logSeen / logMax) * 100;
        }
        const seenScore = normalizedSeenScore * 0.4;
        
        const relicScore = 10; // Assume decent relics (already filtered to 7*)
        const glBonus = isGL ? 5 : 0;
        const leaderFreqBonus = (leaderFrequency.get(leaderId) || 0) * 2; // Bonus for common leaders
        
        const totalScore = holdScore + seenScore + relicScore + glBonus + leaderFreqBonus;
        
        candidates.push({
          squad,
          holdPercentage: stats.holdPercentage,
          seenCount: stats.seenCount,
          avgBanners: null,
          score: totalScore,
          isGL,
          reason: stats.holdPercentage !== null 
            ? `Generated from roster (Hold: ${stats.holdPercentage.toFixed(1)}%, Seen: ${stats.seenCount?.toLocaleString() ?? 'N/A'})`
            : `Generated from roster (no stats available)`
        });
      }
    }

    logger.info(`Generated ${candidates.length} defense squad(s) from roster`);
    return candidates;
  }

  /**
   * Generate combinations of items (for squad member selection).
   * 
   * @param items - Array of items to combine
   * @param size - Size of each combination
   * @param maxCombinations - Maximum number of combinations to return
   * @returns Array of combinations
   */
  private generateCombinations<T>(items: T[], size: number, maxCombinations: number): T[][] {
    if (size === 0) return [[]];
    if (items.length < size) return [];
    
    const combinations: T[][] = [];
    
    // Use a simple recursive approach, but limit results
    const generate = (start: number, current: T[]): void => {
      if (combinations.length >= maxCombinations) return;
      if (current.length === size) {
        combinations.push([...current]);
        return;
      }
      
      for (let i = start; i < items.length; i++) {
        current.push(items[i]);
        generate(i + 1, current);
        current.pop();
      }
    };
    
    generate(0, []);
    return combinations;
  }

  /**
   * Suggest defense squads based on top defense squads from swgoh.gg,
   * while considering the user's roster and not compromising offense too much.
   * 
   * @param userRoster - User's roster
   * @param maxDefenseSquads - Maximum number of defense squads to suggest (based on league)
   * @param seasonId - Optional season ID
   * @param format - GAC format ('5v5' or '3v3')
   * @param offenseSquads - Optional list of squads already planned for offense (to avoid using them on defense)
   * @param defenseCandidates - Optional pre-evaluated defense candidates (from evaluateRosterForDefense)
   */
  async suggestDefenseSquads(
    userRoster: SwgohGgFullPlayerResponse,
    maxDefenseSquads: number,
    seasonId?: string,
    format: string = '5v5',
    offenseSquads?: UniqueDefensiveSquad[],
    defenseCandidates?: Array<{
      squad: UniqueDefensiveSquad;
      holdPercentage: number | null;
      seenCount: number | null;
      avgBanners: number | null;
      score: number;
      isGL: boolean;
      reason: string;
    }>,
    strategyPreference: 'defensive' | 'balanced' | 'offensive' = 'balanced'
  ): Promise<Array<{
    squad: UniqueDefensiveSquad;
    holdPercentage: number | null;
    seenCount: number | null;
    avgBanners: number | null;
    score: number;
    reason: string;
  }>> {
    // If candidates provided, use them; otherwise evaluate roster
    let candidates: Array<{
      squad: UniqueDefensiveSquad;
      holdPercentage: number | null;
      seenCount: number | null;
      avgBanners: number | null;
      score: number;
      isGL: boolean;
      reason: string;
    }>;
    
    if (defenseCandidates && defenseCandidates.length > 0) {
      candidates = defenseCandidates;
      logger.info(`Using ${candidates.length} pre-evaluated defense candidate(s)`);
    } else {
      // Fallback: evaluate roster if no candidates provided
      candidates = await this.evaluateRosterForDefense(userRoster, seasonId, format, strategyPreference);
    }

    // Create a set of units already used in offense squads
    const offenseUnits = new Set<string>();
    if (offenseSquads) {
      for (const squad of offenseSquads) {
        offenseUnits.add(squad.leader.baseId);
        for (const member of squad.members) {
          offenseUnits.add(member.baseId);
        }
      }
    }

    // Count user's GLs from FULL roster (not just top 80)
    // For defensive strategy, we want all GLs available, not just those in top 80 by GP
    const userGLs = new Set<string>();
    for (const unit of userRoster.units || []) {
      if (unit.data.combat_type === 1 && // Only characters
          unit.data.is_galactic_legend && 
          this.isGalacticLegend(unit.data.base_id)) {
        userGLs.add(unit.data.base_id);
      }
    }

    logger.info(
      `User has ${userGLs.size} GL(s) total: ${Array.from(userGLs).join(', ')}`
    );

    // Track which leaders we've already added (GAC rule: one squad per leader)
    const usedLeaders = new Set<string>();
    // Track which characters we've already used (GAC rule: each character can only be used once)
    const usedCharacters = new Set<string>();

    const suggestedSquads: Array<{
      squad: UniqueDefensiveSquad;
      holdPercentage: number | null;
      seenCount: number | null;
      avgBanners: number | null;
      score: number;
      reason: string;
    }> = [];

    // First pass: Select GL squads if user has GLs
    // Strategy preference affects GL targeting on defense
    let targetGLDefense: number;
    if (strategyPreference === 'defensive') {
      // Defensive: Use ALL GLs on defense (they're the strongest squads)
      // Target all available GLs, but cap at maxDefenseSquads
      targetGLDefense = Math.min(userGLs.size, maxDefenseSquads);
    } else if (strategyPreference === 'offensive') {
      // Offensive: Prioritize GLs on offense, but allow remaining unused GLs on defense
      // We'll determine how many GLs are actually used on offense during balancing
      // For now, set a low target (will be adjusted based on actual offense usage)
      targetGLDefense = 0; // Start with 0, but allow unused GLs to be placed on defense
    } else {
      // Balanced: Current behavior (30-40% of defense slots)
      targetGLDefense = userGLs.size > 0 ? Math.max(1, Math.floor(maxDefenseSquads * 0.35)) : 0;
    }
    
    let glDefenseCount = 0;
    
    logger.info(
      `Strategy: ${strategyPreference}, User has ${userGLs.size} GL(s), ` +
      `targeting ${targetGLDefense} GL squad(s) for defense (${maxDefenseSquads} total defense slots)`
    );
    
    const glCandidates = candidates.filter(c => c.isGL);
    const nonGlCandidates = candidates.filter(c => !c.isGL);
    
    // For defensive strategy, ensure ALL user GLs are in candidates
    // If a GL is missing from candidates, create a basic squad entry for it
    if (strategyPreference === 'defensive') {
      for (const glId of userGLs) {
        const hasGlCandidate = glCandidates.some(c => c.squad.leader.baseId === glId);
        if (!hasGlCandidate) {
          // GL is missing from candidates - check if user has this GL
          const glUnit = userRoster.units?.find(u => u.data.base_id === glId);
          if (glUnit && glUnit.data.combat_type === 1) {
            // Create a basic GL squad entry (will need members, but this ensures GL is considered)
            logger.info(
              `GL ${glId} not found in candidates - will attempt to create squad from roster`
            );
            // Note: This GL will be picked up by generateDefenseSquadsFromRoster if it runs
            // For now, we'll rely on that mechanism
          }
        }
      }
    }
    
    logger.info(
      `GL selection pass: ${glCandidates.length} GL candidate(s) available, ${nonGlCandidates.length} non-GL candidate(s) available, ` +
      `targeting ${targetGLDefense} GL squad(s), user has ${userGLs.size} GL(s) total`
    );
    
    let glSkippedReasons = {
      alreadyUsed: 0,
      characterConflict: 0,
      offenseConflict: 0,
      notInUserRoster: 0,
      other: 0
    };
    
    // Sort GL candidates by score to prioritize best GLs first
    // Group by GL leader to ensure we get unique GL leaders, not just unique squad compositions
    const glCandidatesByLeader = new Map<string, typeof glCandidates>();
    for (const candidate of glCandidates) {
      const leaderId = candidate.squad.leader.baseId;
      if (!glCandidatesByLeader.has(leaderId)) {
        glCandidatesByLeader.set(leaderId, []);
      }
      glCandidatesByLeader.get(leaderId)!.push(candidate);
    }
    
    // Sort each leader's candidates by score, then get best candidate per leader
    const bestGlCandidatesPerLeader: typeof glCandidates = [];
    for (const [leaderId, leaderCandidates] of glCandidatesByLeader.entries()) {
      const bestCandidate = leaderCandidates.sort((a, b) => b.score - a.score)[0];
      bestGlCandidatesPerLeader.push(bestCandidate);
    }
    
    // Sort by score to prioritize best GLs first
    const sortedGlCandidates = bestGlCandidatesPerLeader.sort((a, b) => b.score - a.score);
    
    logger.info(
      `GL candidates: ${glCandidates.length} total, ${glCandidatesByLeader.size} unique GL leaders, ` +
      `selecting best candidate per leader`
    );
    
    for (const candidate of sortedGlCandidates) {
      if (glDefenseCount >= targetGLDefense) break;
      
      const allUnits = [candidate.squad.leader, ...candidate.squad.members];
      const allUnitIds = allUnits.map(u => u.baseId);
      
      // Calculate conflicts first (needed for both checking and later use)
      const characterConflicts = allUnitIds.filter(id => usedCharacters.has(id));
      const offenseConflicts = allUnitIds.filter(id => offenseUnits.has(id));
      
      // Check conflicts with detailed logging
      if (usedLeaders.has(candidate.squad.leader.baseId)) {
        glSkippedReasons.alreadyUsed++;
        logger.debug(`Skipping GL ${candidate.squad.leader.baseId} - leader already used`);
        continue;
      }
      
      // For defensive strategy, be more lenient about character conflicts
      // Only skip if there are MANY conflicts (>= 3 characters) - let balance logic handle minor conflicts
      if (characterConflicts.length > 0) {
        if (strategyPreference === 'defensive') {
          // For defensive strategy, only skip if 3+ characters conflict
          if (characterConflicts.length >= 3) {
            glSkippedReasons.characterConflict++;
            logger.debug(`Skipping GL ${candidate.squad.leader.baseId} - ${characterConflicts.length} character conflicts (>= 3): ${characterConflicts.join(', ')}`);
            continue;
          } else {
            // Allow GL squads with 1-2 character conflicts - balance logic will handle it
            logger.debug(`Allowing GL ${candidate.squad.leader.baseId} with ${characterConflicts.length} minor character conflict(s): ${characterConflicts.join(', ')}`);
          }
        } else {
          // For balanced/offensive, skip if any conflicts
          glSkippedReasons.characterConflict++;
          logger.debug(`Skipping GL ${candidate.squad.leader.baseId} - character conflicts: ${characterConflicts.join(', ')}`);
          continue;
        }
      }
      
      // Check offense conflicts - be lenient for defensive strategy
      if (offenseConflicts.length > 0) {
        if (strategyPreference === 'defensive') {
          // For defensive strategy, only skip if 3+ characters conflict with offense
          if (offenseConflicts.length >= 3) {
            glSkippedReasons.offenseConflict++;
            logger.debug(`Skipping GL ${candidate.squad.leader.baseId} - ${offenseConflicts.length} offense conflicts (>= 3): ${offenseConflicts.join(', ')}`);
            continue;
          } else {
            // Allow GL squads with 1-2 offense conflicts - balance logic will handle it
            logger.debug(`Allowing GL ${candidate.squad.leader.baseId} with ${offenseConflicts.length} minor offense conflict(s): ${offenseConflicts.join(', ')}`);
          }
        } else {
          // For balanced/offensive, skip if any conflicts
          glSkippedReasons.offenseConflict++;
          logger.debug(`Skipping GL ${candidate.squad.leader.baseId} - offense conflicts: ${offenseConflicts.join(', ')}`);
          continue;
        }
      }
      
      // Check if user actually has this GL (from FULL roster)
      if (!userGLs.has(candidate.squad.leader.baseId)) {
        glSkippedReasons.notInUserRoster++;
        logger.debug(`Skipping GL ${candidate.squad.leader.baseId} - not in user's roster`);
        continue;
      }
      
      // Add this GL squad
      const hasMinorConflicts = (characterConflicts.length > 0 && characterConflicts.length < 3) || 
                                (offenseConflicts.length > 0 && offenseConflicts.length < 3);
      
      suggestedSquads.push({
        squad: candidate.squad,
        holdPercentage: candidate.holdPercentage,
        seenCount: candidate.seenCount,
        avgBanners: candidate.avgBanners,
        score: candidate.score,
        reason: hasMinorConflicts 
          ? `${candidate.reason} (GL, ${characterConflicts.length} char conflict(s), ${offenseConflicts.length} offense conflict(s) - balance logic will filter)`
          : candidate.reason + ' (GL)'
      });
      
      usedLeaders.add(candidate.squad.leader.baseId);
      // For defensive strategy, be very lenient with character tracking
      // Don't mark characters as used if we're trying to get all GLs on defense
      // This allows multiple GL squads even if they share some characters
      if (strategyPreference === 'defensive') {
        // For defensive strategy, only mark the leader as used
        // Don't mark members as used - this allows GL squads to share members
        // The balance logic will handle final conflict resolution
        usedCharacters.add(candidate.squad.leader.baseId);
        // Only mark non-conflicting members if there are no conflicts at all
        if (characterConflicts.length === 0 && offenseConflicts.length === 0) {
      for (const id of allUnitIds) {
            if (id !== candidate.squad.leader.baseId) {
        usedCharacters.add(id);
            }
          }
        }
      } else if (hasMinorConflicts) {
        // For balanced/offensive with minor conflicts, only mark non-conflicting characters
        for (const id of allUnitIds) {
          if (!characterConflicts.includes(id) && !offenseConflicts.includes(id)) {
            usedCharacters.add(id);
          }
        }
      } else {
        // Mark all characters as used (normal behavior for balanced/offensive)
        for (const id of allUnitIds) {
          usedCharacters.add(id);
        }
      }
      glDefenseCount++;
      
      logger.info(
        `Added GL squad ${candidate.squad.leader.baseId} (${glDefenseCount}/${targetGLDefense}) ` +
        `- Hold: ${candidate.holdPercentage?.toFixed(1) ?? 'N/A'}%, Score: ${candidate.score.toFixed(1)}`
      );
    }
    
    logger.info(
      `GL selection complete: ${glDefenseCount} selected, skipped: ` +
      `${glSkippedReasons.alreadyUsed} already used, ${glSkippedReasons.characterConflict} character conflict, ` +
      `${glSkippedReasons.offenseConflict} offense conflict, ${glSkippedReasons.notInUserRoster} not in roster`
    );

    // Second pass: Fill remaining slots with best available squads
    // Continue until we reach maxDefenseSquads (which may be 2x the actual max to account for filtering)
    // Note: We filter out offense conflicts here, but the balance logic will do final filtering
    const remainingNeeded = maxDefenseSquads - suggestedSquads.length;
    const hasLimitedCandidates = candidates.length <= maxDefenseSquads * 2;
    
    const nonGlCandidatesInSecondPass = candidates.filter(c => !c.isGL && !suggestedSquads.some(d => d.squad.leader.baseId === c.squad.leader.baseId));
    logger.info(
      `Second pass: ${candidates.length} total candidates (${nonGlCandidatesInSecondPass.length} non-GL available), ${suggestedSquads.length} already selected, ` +
      `need ${remainingNeeded} more, hasLimitedCandidates: ${hasLimitedCandidates}`
    );
    
    let secondPassSkipped = {
      alreadySelected: 0,
      leaderConflict: 0,
      defenseConflict: 0,
      offenseConflict: 0,
      other: 0
    };
    
    for (const candidate of candidates) {
      if (suggestedSquads.length >= maxDefenseSquads) break;
      
      // Check if this leader is already in suggested squads
      const leaderAlreadySelected = suggestedSquads.some(d => d.squad.leader.baseId === candidate.squad.leader.baseId);
      if (leaderAlreadySelected) {
        secondPassSkipped.alreadySelected++;
        logger.debug(
          `Skipping ${candidate.squad.leader.baseId} in second pass - leader already selected in first pass`
        );
        continue;
      }
      
      const allUnits = [candidate.squad.leader, ...candidate.squad.members];
      const allUnitIds = allUnits.map(u => u.baseId);
      
      // Check conflicts within defense (leader and character reuse)
      // Be more lenient if we have limited candidates - let balance logic handle conflicts
      if (usedLeaders.has(candidate.squad.leader.baseId)) {
        secondPassSkipped.leaderConflict++;
        logger.debug(
          `Skipping ${candidate.squad.leader.baseId} in second pass - leader already used in first pass`
        );
        continue;
      }
      
      // If we have limited candidates, be more lenient about character conflicts within defense
      // Only skip if we have plenty of other options
      const defenseConflicts = allUnitIds.filter(id => usedCharacters.has(id));
      
      // For defensive strategy, be less strict about conflicts
      if (strategyPreference === 'defensive') {
        // For defensive strategy, only skip if there are MANY conflicts (>= 3 characters)
        // and we have plenty of other options
        if (defenseConflicts.length >= 3 && candidates.length - suggestedSquads.length > remainingNeeded * 3) {
          secondPassSkipped.defenseConflict++;
          logger.debug(
            `Skipping ${candidate.squad.leader.baseId} - ${defenseConflicts.length} defense conflicts, ` +
            `but have ${candidates.length - suggestedSquads.length} remaining candidates`
          );
          continue;
        }
      } else {
        // Original logic for balanced/offensive
        if (defenseConflicts.length > 0 && !hasLimitedCandidates && candidates.length - suggestedSquads.length > remainingNeeded * 2) {
          secondPassSkipped.defenseConflict++;
          continue; // Skip if we have plenty of other options
        }
      }
      
      // Check conflicts with offense - but be less strict here
      // If we have many conflicts, we'll still include the squad and let balance logic decide
      const offenseConflicts = allUnitIds.filter(id => offenseUnits.has(id));
      const hasOffenseConflicts = offenseConflicts.length > 0;
      
      // Only skip if there are many conflicts AND we have plenty of other options
      // For defensive strategy, be even more lenient
      const offenseConflictThreshold = strategyPreference === 'defensive' ? 4 : 3;
      if (hasOffenseConflicts && offenseConflicts.length >= offenseConflictThreshold && !hasLimitedCandidates && candidates.length - suggestedSquads.length > remainingNeeded * 2) {
        secondPassSkipped.offenseConflict++;
        logger.debug(
          `Skipping defense squad ${candidate.squad.leader.baseId} - ${offenseConflicts.length} character(s) conflict with offense (${offenseConflicts.join(', ')})`
        );
        continue;
      }
      
      suggestedSquads.push({
        squad: candidate.squad,
        holdPercentage: candidate.holdPercentage,
        seenCount: candidate.seenCount,
        avgBanners: candidate.avgBanners,
        score: candidate.score,
        reason: hasOffenseConflicts || defenseConflicts.length > 0
          ? `${candidate.reason} (${offenseConflicts.length} offense conflict(s), ${defenseConflicts.length} defense conflict(s) - balance logic will filter)`
          : candidate.reason
      });
      
      usedLeaders.add(candidate.squad.leader.baseId);
      // Only add to usedCharacters if we're not being lenient (to avoid blocking too many future squads)
      if (!hasLimitedCandidates || defenseConflicts.length === 0) {
      for (const id of allUnitIds) {
        usedCharacters.add(id);
        }
      }
    }
    
    logger.info(
      `Second pass complete: ${suggestedSquads.length} total, skipped: ` +
      `${secondPassSkipped.alreadySelected} already selected, ${secondPassSkipped.leaderConflict} leader conflict, ` +
      `${secondPassSkipped.defenseConflict} defense conflict, ${secondPassSkipped.offenseConflict} offense conflict`
    );
    
    // If we still don't have enough suggestions, be more aggressive
    // This can happen if there are many character conflicts with offense
    if (suggestedSquads.length < maxDefenseSquads && candidates.length > suggestedSquads.length) {
      logger.info(
        `Only found ${suggestedSquads.length} defense squad(s) without major conflicts, but need ${maxDefenseSquads}. ` +
        `Will attempt to find more from ${candidates.length} total candidates (balance logic will handle final filtering).`
      );
      
      // Reset usedCharacters for this pass (but keep usedLeaders to avoid duplicate leaders)
      const usedCharactersInDefense = new Set<string>();
      for (const squad of suggestedSquads) {
        usedCharactersInDefense.add(squad.squad.leader.baseId);
        for (const member of squad.squad.members) {
          usedCharactersInDefense.add(member.baseId);
        }
      }
      
      let thirdPassAdded = 0;
      // Try to find more squads, only checking for conflicts within defense
      // Let balance logic handle offense conflicts
      for (const candidate of candidates) {
        if (suggestedSquads.length >= maxDefenseSquads) break;
        if (suggestedSquads.some(d => d.squad.leader.baseId === candidate.squad.leader.baseId)) continue;
        
        const allUnits = [candidate.squad.leader, ...candidate.squad.members];
        const allUnitIds = allUnits.map(u => u.baseId);
        
        // Only check for leader conflicts and character conflicts within defense
        // Don't check offense conflicts here - let balance logic handle that
        if (usedLeaders.has(candidate.squad.leader.baseId)) continue;
        if (allUnitIds.some(id => usedCharactersInDefense.has(id))) continue;
        
        suggestedSquads.push({
          squad: candidate.squad,
          holdPercentage: candidate.holdPercentage,
          seenCount: candidate.seenCount,
          avgBanners: candidate.avgBanners,
          score: candidate.score,
          reason: candidate.reason + ' (balance logic will check offense conflicts)'
        });
        
        usedLeaders.add(candidate.squad.leader.baseId);
        for (const id of allUnitIds) {
          usedCharactersInDefense.add(id);
        }
        thirdPassAdded++;
      }
      
      logger.info(
        `Third pass complete: Added ${thirdPassAdded} more squad(s), total: ${suggestedSquads.length}`
      );
    }

    // Sort by score (highest first) - already sorted as we go, but ensure final sort
    suggestedSquads.sort((a, b) => b.score - a.score);
    
    const glCount = suggestedSquads.filter(s => this.isGalacticLegend(s.squad.leader.baseId)).length;
    logger.info(
      `Defense squad suggestion complete: ${suggestedSquads.length} squad(s) suggested ` +
      `(${usedLeaders.size} unique leaders, ${usedCharacters.size} unique characters used, ${glCount} GL squad(s))`
    );
    
    return suggestedSquads;
  }

  /**
   * Generate an image visualising defensive squads only (no offense side, no relic delta).
   * Uses a narrower layout optimized for defense-only display.
   */
  async generateDefensiveSquadsImage(
    opponentLabel: string,
    squads: UniqueDefensiveSquad[],
    format: string = '5v5'
  ): Promise<Buffer> {
    const browser = await this.getBrowser();
    const page = await browser.newPage();

    try {
      await page.setViewport({
        width: 800, // Narrower width for defense-only
        height: 1600,
        deviceScaleFactor: 2
      });

      const html = this.generateDefenseOnlyHtml(opponentLabel, squads, format);

      await page.setContent(html, { waitUntil: 'networkidle0' });

      const screenshot = await page.screenshot({
        type: 'png',
        fullPage: true
      });

      return screenshot as Buffer;
    } finally {
      await page.close();
    }
  }

  /**
   * Generate an image visualising matched offense vs defense squads using an HTML template rendered via Puppeteer.
   */
  async generateMatchedCountersImage(
    opponentLabel: string,
    matchedCounters: MatchedCounterSquad[],
    format: string = '5v5'
  ): Promise<Buffer> {
    const browser = await this.getBrowser();
    const page = await browser.newPage();

    try {
      await page.setViewport({
        width: 1400,
        height: 1600,
        deviceScaleFactor: 2
      });

      const html = this.generateMatchedCountersHtml(opponentLabel, matchedCounters, format);

      await page.setContent(html, { waitUntil: 'networkidle0' });

      const screenshot = await page.screenshot({
        type: 'png',
        fullPage: true
      });

      return screenshot as Buffer;
    } catch (error) {
      logger.error('Error generating defensive squads image:', error);
      throw new Error('Failed to generate defensive squads image.');
    } finally {
      await page.close();
    }
  }

  /**
   * Generate HTML for defense-only view (no offense side, no relic delta comparison).
   * Uses a narrower layout optimized for showing just defense squads.
   */
  private generateDefenseOnlyHtml(opponentLabel: string, squads: UniqueDefensiveSquad[], format: string = '5v5'): string {
    const maxSquads = 12;
    const visibleSquads = squads.slice(0, maxSquads);
    const expectedSquadSize = format === '3v3' ? 3 : 5;

    const renderSquad = (squad: UniqueDefensiveSquad): string => {
      if (!squad.leader.baseId) {
        // Empty squad - show placeholders
        return Array.from({ length: expectedSquadSize }).map(() => `
          <div class="character">
            <div class="character-placeholder"></div>
          </div>
        `).join('');
      }

      const allUnits = [squad.leader, ...squad.members];
      const totalSlots = expectedSquadSize;
      const usedSlots = allUnits.length;
      const emptySlots = Math.max(0, totalSlots - usedSlots);

      const unitHtml = allUnits.map((unit) => {
        let relic: string | number = '?';
        if (typeof unit.relicLevel === 'number') {
          relic = Math.max(0, Math.min(10, unit.relicLevel));
        }
        const portraitImg = unit.portraitUrl
          ? `<img src="${unit.portraitUrl}" alt="${unit.baseId}" />`
          : '';
        return `
          <div class="character">
            <div class="character-portrait dark">
              ${portraitImg}
              <div class="relic-number">${relic}</div>
            </div>
            <div class="stars">
              <div class="star"></div>
              <div class="star"></div>
              <div class="star"></div>
              <div class="star"></div>
              <div class="star"></div>
              <div class="star"></div>
              <div class="star"></div>
            </div>
          </div>
        `;
      }).join('');

      const placeholders = Array.from({ length: emptySlots }).map(() => `
        <div class="character">
          <div class="character-placeholder"></div>
        </div>
      `).join('');

      return unitHtml + placeholders;
    };

    const squadCards = visibleSquads.map((squad, index) => {
      const defenseHtml = renderSquad(squad);
      const squadTitle = `Squad ${index + 1}`;

      return `
        <div class="battle-card">
          <div class="battle-header">
            <div class="defender-name">${squadTitle}</div>
          </div>
          <div style="display: flex; justify-content: center;">
            <div class="squad-container">
              <div class="squad-label">Defense</div>
              <div class="squad">${defenseHtml}</div>
            </div>
          </div>
        </div>
      `;
    }).join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>GAC Defense</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      background: #1a1a1a;
      font-family: Arial, sans-serif;
      padding: 20px;
      color: white;
      display: flex;
      justify-content: center;
      align-items: flex-start;
      min-height: 100vh;
    }
    .container {
      max-width: 600px;
      width: 100%;
    }
    .title {
      text-align: center;
      margin-bottom: 10px;
      font-size: 28px;
      font-weight: bold;
      color: #f5deb3;
      text-shadow: 2px 2px 4px rgba(0,0,0,0.8);
      background: linear-gradient(135deg, #3a2a1a 0%, #1a1410 100%);
      padding: 20px;
      border-radius: 8px;
      border: 2px solid #c4a35a;
      margin-bottom: 20px;
    }
    .subtitle {
      text-align: center;
      margin-bottom: 20px;
      font-size: 16px;
      color: #f5deb3;
    }
    .battle-card {
      background: #2a2a2a;
      border-radius: 8px;
      padding: 18px 20px;
      margin-bottom: 18px;
      border: 2px solid #c4a35a;
    }
    .battle-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
      padding-bottom: 10px;
      border-bottom: 1px solid #8b7355;
    }
    .defender-name {
      font-size: 20px;
      font-weight: bold;
      color: #f5deb3;
    }
    .squad-container {
      display: flex;
      flex-direction: column;
      align-items: center;
    }
    .squad-label {
      font-size: 14px;
      font-weight: bold;
      color: #f5deb3;
      margin-bottom: 8px;
      text-transform: uppercase;
    }
    .squad {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      flex-wrap: nowrap;
      justify-content: center;
    }
    .character {
      position: relative;
      display: flex;
      flex-direction: column;
      align-items: center;
    }
    .character-portrait {
      width: 60px;
      height: 60px;
      border-radius: 50%;
      border: 3px solid;
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #4a4a4a;
      overflow: hidden;
    }
    .character-portrait img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      border-radius: 50%;
    }
    .character-portrait.dark {
      border-color: #c4a35a;
      box-shadow: 0 0 15px rgba(196, 163, 90, 0.4);
    }
    .relic-number {
      position: absolute;
      bottom: -5px;
      left: 50%;
      transform: translateX(-50%);
      background: linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%);
      color: #000;
      font-weight: bold;
      font-size: 12px;
      width: 22px;
      height: 22px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      border: 2px solid #1a1a1a;
      z-index: 2;
    }
    .stars {
      display: flex;
      gap: 2px;
      margin-top: 4px;
    }
    .star {
      width: 6px;
      height: 6px;
      background: #fbbf24;
      clip-path: polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%);
    }
    .character-placeholder {
      width: 60px;
      height: 60px;
      border-radius: 50%;
      background: rgba(74, 74, 74, 0.3);
      border: 2px dashed #8b7355;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1 class="title">GAC Strategy – ${opponentLabel}</h1>
    <p class="subtitle">Your suggested defense squads (${format} format).</p>
    ${squadCards}
  </div>
</body>
</html>`;
  }

  private generateMatchedCountersHtml(opponentLabel: string, matchedCounters: MatchedCounterSquad[], format: string = '5v5'): string {
    const maxSquads = 12;
    const visibleCounters = matchedCounters.slice(0, maxSquads);
    const expectedSquadSize = format === '3v3' ? 3 : 5;

    const renderSquad = (squad: UniqueDefensiveSquad, isOffense: boolean, squadSize: number = expectedSquadSize): string => {
      if (!squad.leader.baseId) {
        // Empty squad - show placeholders
        return Array.from({ length: squadSize }).map(() => `
          <div class="character">
            <div class="character-placeholder"></div>
          </div>
        `).join('');
      }

      const allUnits = [squad.leader, ...squad.members];
      const totalSlots = squadSize;
      const usedSlots = allUnits.length;
      const emptySlots = Math.max(0, totalSlots - usedSlots);

      const unitHtml = allUnits.map((unit) => {
        let relic: string | number = '?';
        if (typeof unit.relicLevel === 'number') {
          relic = Math.max(0, Math.min(10, unit.relicLevel));
        }
        const portraitImg = unit.portraitUrl
          ? `<img src="${unit.portraitUrl}" alt="${unit.baseId}" />`
          : '';
        const portraitClass = isOffense ? 'character-portrait offense' : 'character-portrait dark';
        return `
          <div class="character">
            <div class="${portraitClass}">
              ${portraitImg}
              <div class="relic-number">${relic}</div>
            </div>
            <div class="stars">
              <div class="star"></div>
              <div class="star"></div>
              <div class="star"></div>
              <div class="star"></div>
              <div class="star"></div>
              <div class="star"></div>
              <div class="star"></div>
            </div>
          </div>
        `;
      }).join('');

      const placeholders = Array.from({ length: emptySlots }).map(() => `
        <div class="character">
          <div class="character-placeholder"></div>
        </div>
      `).join('');

      return unitHtml + placeholders;
    };

    const squadCards = visibleCounters.map((match, index) => {
      const offenseHtml = renderSquad(match.offense, true, expectedSquadSize);
      const defenseHtml = renderSquad(match.defense, false, expectedSquadSize);
      const squadTitle = `Squad ${index + 1}`;
      
      // Build stats HTML
      const statItems: string[] = [];
      
      // Show adjusted win rate (preferred) or base win rate
      const displayWinRate = match.adjustedWinPercentage ?? match.winPercentage;
      if (displayWinRate !== null) {
        const isAdjusted = match.adjustedWinPercentage !== null && match.adjustedWinPercentage !== match.winPercentage;
        const winRateColor = displayWinRate >= 70 ? '#4ade80' : displayWinRate >= 50 ? '#fbbf24' : '#f87171';
        
        statItems.push(`
          <div class="stat-item">
            <span class="stat-label">${isAdjusted ? 'Adj Win %' : 'Win %'}</span>
            <span class="stat-value" style="color: ${winRateColor}">${displayWinRate.toFixed(0)}%</span>
            ${isAdjusted && match.winPercentage !== null ? `
              <span class="stat-subtext" style="color: #8b7355; font-size: 10px;">
                (Base: ${match.winPercentage}%)
              </span>
            ` : ''}
          </div>
        `);
      }
      
      if (match.seenCount !== null) {
        statItems.push(`
          <div class="stat-item">
            <span class="stat-label">Seen</span>
            <span class="stat-value">${match.seenCount.toLocaleString()}</span>
          </div>
        `);
      }
      
      if (match.avgBanners !== null) {
        statItems.push(`
          <div class="stat-item">
            <span class="stat-label">Avg Banners</span>
            <span class="stat-value">${match.avgBanners.toFixed(1)}</span>
          </div>
        `);
      }
      
      // Add Relic Delta information if available (simplified for stats bar)
      if (match.relicDelta) {
        const delta = match.relicDelta.delta;
        const deltaColor = delta > 0 ? '#4ade80' : delta < 0 ? '#f87171' : '#f5deb3';
        
        // Use simple language for the stat bar
        let deltaLabel = 'Relic Match';
        let deltaValue = 'Even';
        if (delta > 2) {
          deltaLabel = 'Relic Level';
          deltaValue = `${Math.abs(delta).toFixed(0)} tiers higher`;
        } else if (delta > 0) {
          deltaLabel = 'Relic Level';
          deltaValue = `${Math.abs(delta).toFixed(0)} tier higher`;
        } else if (delta < -2) {
          deltaLabel = 'Relic Level';
          deltaValue = `${Math.abs(delta).toFixed(0)} tiers lower`;
        } else if (delta < 0) {
          deltaLabel = 'Relic Level';
          deltaValue = `${Math.abs(delta).toFixed(0)} tier lower`;
        }
        
        statItems.push(`
          <div class="stat-item">
            <span class="stat-label">${deltaLabel}</span>
            <span class="stat-value" style="color: ${deltaColor}">${deltaValue}</span>
          </div>
        `);
      }
      
      // Add simplified Relic Delta metrics section - only overall team comparison
      // Always from offense team's perspective - use the most representative delta
      let relicDeltaDetailsHtml = '';
      if (match.keyMatchups) {
        // Use the most representative delta: best if advantage, worst if trap, otherwise average
        // This ensures consistency with the advantage/trap detection
        let displayDelta: number;
        let displayModifiers: RelicDeltaModifiers;
        
        if (match.keyMatchups.hasAdvantage) {
          // If we have advantage, show the best case (most favorable for offense)
          const bestDelta = Math.max(
            match.keyMatchups.leaderVsLeader.delta,
            match.keyMatchups.highestOffenseVsHighestDefense.delta,
            match.keyMatchups.teamAverage.delta
          );
          // Find which matchup corresponds to this best delta
          if (bestDelta === match.keyMatchups.leaderVsLeader.delta) {
            displayDelta = match.keyMatchups.leaderVsLeader.delta;
            displayModifiers = match.keyMatchups.leaderVsLeader;
          } else if (bestDelta === match.keyMatchups.highestOffenseVsHighestDefense.delta) {
            displayDelta = match.keyMatchups.highestOffenseVsHighestDefense.delta;
            displayModifiers = match.keyMatchups.highestOffenseVsHighestDefense;
          } else {
            displayDelta = match.keyMatchups.teamAverage.delta;
            displayModifiers = match.keyMatchups.teamAverage;
          }
        } else if (match.keyMatchups.isTrap) {
          // If it's a trap, show the worst case (least favorable for offense)
          const worstDelta = Math.min(
            match.keyMatchups.leaderVsLeader.delta,
            match.keyMatchups.highestOffenseVsHighestDefense.delta,
            match.keyMatchups.teamAverage.delta
          );
          // Find which matchup corresponds to this worst delta
          if (worstDelta === match.keyMatchups.leaderVsLeader.delta) {
            displayDelta = match.keyMatchups.leaderVsLeader.delta;
            displayModifiers = match.keyMatchups.leaderVsLeader;
          } else if (worstDelta === match.keyMatchups.highestOffenseVsHighestDefense.delta) {
            displayDelta = match.keyMatchups.highestOffenseVsHighestDefense.delta;
            displayModifiers = match.keyMatchups.highestOffenseVsHighestDefense;
          } else {
            displayDelta = match.keyMatchups.teamAverage.delta;
            displayModifiers = match.keyMatchups.teamAverage;
          }
        } else {
          // Otherwise use team average
          displayDelta = match.keyMatchups.teamAverage.delta;
          displayModifiers = match.keyMatchups.teamAverage;
        }
        
        const avgDelta = displayDelta;
        const avgModifiers = displayModifiers;
        
        const getSimpleDescription = (delta: number, modifiers: RelicDeltaModifiers): { icon: string; text: string; color: string } => {
          const damageMod = ((modifiers.attackerDamageMultiplier - 1.0) * 100);
          
          if (delta >= 3) {
            return {
              icon: '🔥',
              text: `Much stronger (${Math.abs(delta).toFixed(0)} tiers higher) - You deal ${Math.abs(damageMod).toFixed(0)}% MORE damage`,
              color: '#4ade80'
            };
          } else if (delta >= 2) {
            return {
              icon: '✅',
              text: `Stronger (${Math.abs(delta).toFixed(0)} tiers higher) - You deal ${Math.abs(damageMod).toFixed(0)}% more damage`,
              color: '#4ade80'
            };
          } else if (delta >= 1) {
            return {
              icon: '✓',
              text: `Slightly stronger (${Math.abs(delta).toFixed(0)} tier higher) - Small damage boost`,
              color: '#86efac'
            };
          } else if (delta === 0) {
            return {
              icon: '⚖️',
              text: 'Even match - Same relic levels',
              color: '#f5deb3'
            };
          } else if (delta >= -2) {
            return {
              icon: '⚠️',
              text: `Slightly weaker (${Math.abs(delta).toFixed(0)} tier${Math.abs(delta) > 1 ? 's' : ''} lower) - You deal ${Math.abs(damageMod).toFixed(0)}% LESS damage`,
              color: '#fbbf24'
            };
          } else if (delta >= -3) {
            return {
              icon: '❌',
              text: `Much weaker (${Math.abs(delta).toFixed(0)} tiers lower) - You deal ${Math.abs(damageMod).toFixed(0)}% LESS damage`,
              color: '#f87171'
            };
          } else {
            return {
              icon: '🚫',
              text: `Very weak (${Math.abs(delta).toFixed(0)} tiers lower) - You deal ${Math.abs(damageMod).toFixed(0)}% LESS damage - RISKY!`,
              color: '#dc2626'
            };
          }
        };
        
        const avgDesc = getSimpleDescription(avgDelta, avgModifiers);
        
        relicDeltaDetailsHtml = `
          <div class="relic-delta-details" style="
            background: #1a1a1a;
            border: 1px solid #8b7355;
            border-radius: 6px;
            padding: 12px;
            font-size: 12px;
            height: fit-content;
          ">
            <div style="
              font-weight: bold;
              color: #f5deb3;
              margin-bottom: 10px;
              border-bottom: 1px solid #8b7355;
              padding-bottom: 6px;
              font-size: 13px;
            ">📊 Relic Delta Comparison</div>
            <div style="
              background: #2a2a2a;
              padding: 10px;
              border-radius: 4px;
              border-left: 3px solid ${avgDesc.color};
            ">
              <div style="color: ${avgDesc.color}; font-size: 13px; line-height: 1.5;">
                <span style="font-size: 16px; margin-right: 6px;">${avgDesc.icon}</span> ${avgDesc.text}
              </div>
            </div>
          </div>
        `;
      }
      
      // Add trap warning if applicable
      let warningHtml = '';
      if (match.keyMatchups?.isTrap) {
        const worstDelta = Math.min(
          match.keyMatchups.leaderVsLeader.delta,
          match.keyMatchups.highestOffenseVsHighestDefense.delta,
          match.keyMatchups.teamAverage.delta
        );
        const yourDamageMod = match.relicDelta ? ((match.relicDelta.attackerDamageMultiplier - 1.0) * 100) : 0;
        const enemyDamageMod = match.relicDelta ? ((1.0 - match.relicDelta.defenderDamageMultiplier) * 100) : 0;
        const yourDamageSign = yourDamageMod >= 0 ? '+' : '';
        const enemyDamageSign = enemyDamageMod >= 0 ? '+' : '';
        
        const tierWord = Math.abs(worstDelta) === 1 ? 'tier' : 'tiers';
        warningHtml = `
          <div class="trap-warning" style="
            background: #7f1d1d;
            border: 2px solid #dc2626;
            border-radius: 6px;
            padding: 12px;
            margin-top: 12px;
            color: #fca5a5;
            font-size: 13px;
            line-height: 1.5;
          ">
            <div style="font-weight: bold; margin-bottom: 6px; font-size: 14px;">
              ⚠️ WARNING: Your Team is Weaker
            </div>
            <div style="font-size: 12px;">
              Your team is <strong>${Math.abs(worstDelta).toFixed(0)} relic ${tierWord} lower</strong> than the enemy.
              <br/>
              • You deal <strong>${Math.abs(yourDamageMod).toFixed(0)}% LESS damage</strong> than normal
              <br/>
              • Enemy deals <strong>${Math.abs(enemyDamageMod).toFixed(0)}% MORE damage</strong> to you
              <br/>
              <span style="color: #fca5a5; font-weight: bold;">This counter may fail even if it usually works!</span>
            </div>
          </div>
        `;
      } else if (match.keyMatchups?.hasAdvantage) {
        const bestDelta = Math.max(
          match.keyMatchups.leaderVsLeader.delta,
          match.keyMatchups.highestOffenseVsHighestDefense.delta,
          match.keyMatchups.teamAverage.delta
        );
        const yourDamageMod = match.relicDelta ? ((match.relicDelta.attackerDamageMultiplier - 1.0) * 100) : 0;
        const damageSign = yourDamageMod >= 0 ? '+' : '';
        
        const tierWord = bestDelta === 1 ? 'tier' : 'tiers';
        warningHtml = `
          <div class="advantage-notice" style="
            background: #14532d;
            border: 2px solid #22c55e;
            border-radius: 6px;
            padding: 12px;
            margin-top: 12px;
            color: #86efac;
            font-size: 13px;
            line-height: 1.5;
          ">
            <div style="font-weight: bold; margin-bottom: 6px; font-size: 14px;">
              ✓ Advantage: Your Team is Stronger
            </div>
            <div style="font-size: 12px;">
              Your team is <strong>${bestDelta.toFixed(0)} relic ${tierWord} higher</strong> than the enemy.
              <br/>
              • You deal <strong>${Math.abs(yourDamageMod).toFixed(0)}% MORE damage</strong> than normal
              <br/>
              • Enemy deals <strong>less damage</strong> to you
              <br/>
              <span style="color: #86efac; font-weight: bold;">This counter should work well!</span>
            </div>
          </div>
        `;
      }
      
      const statsHtml = statItems.length > 0 ? `
        <div class="battle-stats">
          ${statItems.join('')}
        </div>
      ` : '';

      // Determine card border color based on Relic Delta status
      let cardBorderStyle = '';
      if (match.keyMatchups?.isTrap) {
        cardBorderStyle = 'border-color: #dc2626; border-width: 3px;';
      } else if (match.keyMatchups?.hasAdvantage) {
        cardBorderStyle = 'border-color: #22c55e; border-width: 3px;';
      }

      return `
        <div class="battle-card" style="${cardBorderStyle}">
          <div class="battle-header">
            <div class="defender-name">${squadTitle}</div>
            ${match.keyMatchups?.isTrap ? `
              <div style="
                background: #dc2626;
                color: white;
                padding: 4px 8px;
                border-radius: 4px;
                font-size: 11px;
                font-weight: bold;
              ">⚠️ TRAP</div>
            ` : match.keyMatchups?.hasAdvantage ? `
              <div style="
                background: #22c55e;
                color: white;
                padding: 4px 8px;
                border-radius: 4px;
                font-size: 11px;
                font-weight: bold;
              ">✓ ADVANTAGE</div>
            ` : ''}
          </div>
          <div style="display: flex; gap: 20px; align-items: flex-start;">
            <div style="flex: 1;">
              <div class="battle-content">
                <div class="squad-container">
                  <div class="squad-label">Offense</div>
                  <div class="squad">${offenseHtml}</div>
                </div>
                <div class="vs-divider">VS</div>
                <div class="squad-container">
                  <div class="squad-label">Defense</div>
                  <div class="squad">${defenseHtml}</div>
                </div>
              </div>
          ${statsHtml}
            </div>
            <div style="flex: 0 0 280px; min-width: 280px;">
              ${relicDeltaDetailsHtml}
            </div>
          </div>
        </div>
      `;
    }).join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>GAC Strategy</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      background: #1a1a1a;
      font-family: Arial, sans-serif;
      padding: 20px;
      color: white;
      display: flex;
      justify-content: center;
      align-items: flex-start;
      min-height: 100vh;
    }
    .container {
      max-width: 1400px;
      width: 100%;
    }
    .title {
      text-align: center;
      margin-bottom: 10px;
      font-size: 28px;
      font-weight: bold;
      color: #f5deb3;
      text-shadow: 2px 2px 4px rgba(0,0,0,0.8);
      background: linear-gradient(135deg, #3a2a1a 0%, #1a1410 100%);
      padding: 20px;
      border-radius: 8px;
      border: 2px solid #c4a35a;
      margin-bottom: 20px;
    }
    .subtitle {
      text-align: center;
      margin-bottom: 20px;
      font-size: 16px;
      color: #f5deb3;
    }
    .battle-card {
      background: #2a2a2a;
      border-radius: 8px;
      padding: 18px 20px;
      margin-bottom: 18px;
      border: 2px solid #c4a35a;
    }
    .battle-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
      padding-bottom: 10px;
      border-bottom: 1px solid #8b7355;
    }
    .defender-name {
      font-size: 20px;
      font-weight: bold;
      color: #f5deb3;
    }
    .battle-content {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 20px;
      margin-bottom: 12px;
    }
    .squad-container {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
    }
    .squad-label {
      font-size: 14px;
      font-weight: bold;
      color: #f5deb3;
      margin-bottom: 8px;
      text-transform: uppercase;
    }
    .vs-divider {
      font-size: 18px;
      font-weight: bold;
      color: #c4a35a;
      padding: 0 10px;
    }
    .squad {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      flex-wrap: nowrap;
      justify-content: center;
    }
    .character {
      position: relative;
      display: flex;
      flex-direction: column;
      align-items: center;
    }
    .character-portrait {
      width: 60px;
      height: 60px;
      border-radius: 50%;
      border: 3px solid;
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #4a4a4a;
      overflow: hidden;
    }
    .character-portrait img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      border-radius: 50%;
    }
    .character-portrait.offense {
      border-color: #4ade80;
      box-shadow: 0 0 15px rgba(74, 222, 128, 0.4);
    }
    .character-portrait.dark {
      border-color: #c4a35a;
      box-shadow: 0 0 15px rgba(196, 163, 90, 0.4);
    }
    .relic-number {
      position: absolute;
      bottom: -5px;
      left: 50%;
      transform: translateX(-50%);
      background: linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%);
      color: #000;
      font-weight: bold;
      font-size: 12px;
      width: 22px;
      height: 22px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      border: 2px solid #1a1a1a;
      z-index: 2;
    }
    .stars {
      display: flex;
      gap: 2px;
      margin-top: 4px;
    }
    .star {
      width: 6px;
      height: 6px;
      background: #fbbf24;
      clip-path: polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%);
    }
    .character-placeholder {
      width: 60px;
      height: 60px;
      border-radius: 50%;
      background: rgba(74, 74, 74, 0.3);
      border: 2px dashed #8b7355;
    }
    .battle-stats {
      display: flex;
      gap: 20px;
      justify-content: center;
      padding-top: 12px;
      border-top: 1px solid #8b7355;
      margin-top: 12px;
    }
    .stat-item {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
    }
    .stat-label {
      font-size: 11px;
      color: #8b7355;
      text-transform: uppercase;
    }
    .stat-value {
      font-size: 16px;
      font-weight: bold;
      color: #f5deb3;
    }
    .stat-subtext {
      display: block;
      font-size: 10px;
      color: #8b7355;
      margin-top: 2px;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1 class="title">GAC Strategy – ${opponentLabel}</h1>
    <p class="subtitle">Matched offense counters vs opponent's defensive squads (best matches from your roster).</p>
    ${squadCards}
  </div>
</body>
</html>`;
  }

  /**
   * Generate HTML for balanced strategy view showing three columns:
   * my-defense || my offense || opponents defence
   */
  private generateBalancedStrategyHtml(
    opponentLabel: string,
    balancedOffense: MatchedCounterSquad[],
    balancedDefense: Array<{
      squad: UniqueDefensiveSquad;
      holdPercentage: number | null;
      seenCount: number | null;
      avgBanners: number | null;
      score: number;
      reason: string;
    }>,
    opponentDefense: UniqueDefensiveSquad[],
    format: string = '5v5',
    maxSquads: number = 11,
    userRoster?: SwgohGgFullPlayerResponse,
    strategyPreference: 'defensive' | 'balanced' | 'offensive' = 'balanced'
  ): string {
    logger.info(`[Image Generation] Starting HTML generation for ${opponentLabel} (${format} format)`);
    logger.info(`[Image Generation] Input data: ${balancedOffense.length} offense squad(s), ${balancedDefense.length} defense squad(s), ${opponentDefense.length} opponent defense squad(s)`);
    logger.info(`[Image Generation] Max squads to display: ${maxSquads}`);
    
    const expectedSquadSize = format === '3v3' ? 3 : 5;
    
    // Limit to 4 squads as per wireframe
    const visibleDefense = balancedDefense.slice(0, maxSquads);
    const visibleOffense = balancedOffense.slice(0, maxSquads);
    const visibleOpponentDefense = opponentDefense.slice(0, maxSquads);
    
    logger.info(`[Image Generation] Visible squads after limiting to ${maxSquads}: ${visibleDefense.length} defense, ${visibleOffense.length} offense, ${visibleOpponentDefense.length} opponent defense`);

    // Create character name mapping from user roster (filtered to top 80 characters by GP)
    const characterNameMap = new Map<string, string>();
    const characterStatsMap = new Map<string, { speed: number; health: number; protection: number }>();
    if (userRoster && userRoster.units) {
      // Filter to top 80 characters by GP for consistency with GAC matchmaking
      const filteredRoster = this.getTop80CharactersRoster(userRoster);
      for (const unit of filteredRoster.units) {
        if (unit.data && unit.data.base_id) {
          if (unit.data.name) {
            characterNameMap.set(unit.data.base_id, unit.data.name);
          }
          // Extract stats
          const stats = unit.data.stats || {};
          const speed = Math.round(stats['5'] || 0);
          const health = (stats['1'] || 0) / 1000; // Convert to K
          const protection = (stats['28'] || 0) / 1000; // Convert to K
          characterStatsMap.set(unit.data.base_id, { speed, health, protection });
        }
      }
    }

    // Collect all user GLs from roster (filtered to top 80 characters by GP)
    const allUserGLs = new Set<string>();
    if (userRoster && userRoster.units) {
      // Filter to top 80 characters by GP for consistency with GAC matchmaking
      const filteredRoster = this.getTop80CharactersRoster(userRoster);
      for (const unit of filteredRoster.units) {
        if (unit.data && unit.data.base_id && unit.data.is_galactic_legend && this.isGalacticLegend(unit.data.base_id)) {
          allUserGLs.add(unit.data.base_id);
        }
      }
    }

    // Track GLs used in offense
    const usedGLsInOffense = new Set<string>();
    for (const offense of balancedOffense) {
      if (offense.offense.leader.baseId && this.isGalacticLegend(offense.offense.leader.baseId)) {
        usedGLsInOffense.add(offense.offense.leader.baseId);
      }
    }

    // Track GLs used in defense
    const usedGLsInDefense = new Set<string>();
    for (const defense of balancedDefense) {
      if (defense.squad.leader.baseId && this.isGalacticLegend(defense.squad.leader.baseId)) {
        usedGLsInDefense.add(defense.squad.leader.baseId);
      }
    }

    logger.info(
      `[Image Generation] GL tracking: ${allUserGLs.size} total GL(s), ` +
      `${usedGLsInOffense.size} used in offense, ${usedGLsInDefense.size} used in defense`
    );

    // Helper to format baseId as a readable name with truncation
    const formatCharacterName = (baseId: string, maxLength: number = 15): string => {
      if (!baseId) return 'Name';
      const friendlyName = characterNameMap.get(baseId) || baseId;
      if (friendlyName.length > maxLength) {
        return friendlyName.substring(0, maxLength - 3) + '...';
      }
      return friendlyName;
    };

    // Helper to get character stats
    const getCharacterStats = (baseId: string): { speed: number; health: number; protection: number } | null => {
      return characterStatsMap.get(baseId) || null;
    };

    // Render defense squad with stats tables (no names)
    const renderDefenseSquad = (squad: UniqueDefensiveSquad, squadSize: number = expectedSquadSize): string => {
      if (!squad.leader.baseId) {
        // Empty squad - show placeholders with proper layout
        const topRow = squadSize === 3 ? 2 : 2; // 3v3: 2 top
        const bottomRow = squadSize === 3 ? 1 : 3; // 3v3: 1 bottom, 5v5: 3 bottom
        const topPlaceholders = Array.from({ length: topRow }).map((_, idx) => `
          <div class="character-with-stats">
            <div class="character-portrait dark">
            <div class="character-placeholder"></div>
            </div>
            <div class="character-stats-table">
              <div class="stat-row">
                <span class="stat-label">Speed</span>
                <span class="stat-value">-</span>
              </div>
              <div class="stat-row">
                <span class="stat-label">Health</span>
                <span class="stat-value">-</span>
              </div>
              <div class="stat-row">
                <span class="stat-label">Prot</span>
                <span class="stat-value">-</span>
              </div>
            </div>
          </div>
        `).join('');
        const bottomPlaceholders = Array.from({ length: bottomRow }).map((_, idx) => `
          <div class="character-with-stats">
            <div class="character-portrait dark">
              <div class="character-placeholder"></div>
            </div>
            <div class="character-stats-table">
              <div class="stat-row">
                <span class="stat-label">Speed</span>
                <span class="stat-value">-</span>
              </div>
              <div class="stat-row">
                <span class="stat-label">Health</span>
                <span class="stat-value">-</span>
              </div>
              <div class="stat-row">
                <span class="stat-label">Prot</span>
                <span class="stat-value">-</span>
              </div>
            </div>
          </div>
        `).join('');
        return `<div class="squad-layout"><div class="squad-row">${topPlaceholders}</div><div class="squad-row">${bottomPlaceholders}</div></div>`;
      }

      const allUnits = [squad.leader, ...squad.members];
      const totalSlots = squadSize;
      const usedSlots = allUnits.length;
      const emptySlots = Math.max(0, totalSlots - usedSlots);

      // Layout: 3v3 = 2 top, 1 bottom; 5v5 = 2 top, 3 bottom
      const topRowCount = 2; // Always 2 on top
      const bottomRowCount = squadSize === 3 ? 1 : 3; // 3v3: 1 bottom, 5v5: 3 bottom
      
      const topUnits = allUnits.slice(0, topRowCount);
      const bottomUnits = allUnits.slice(topRowCount, topRowCount + bottomRowCount);

      const renderUnit = (unit: UniqueDefensiveSquadUnit | null, idx: number): string => {
        if (!unit) {
          return `
          <div class="character-with-stats">
            <div class="character-portrait dark">
              <div class="character-placeholder"></div>
            </div>
            <div class="character-stats-table">
              <div class="stat-row">
                <span class="stat-label">Speed</span>
                <span class="stat-value">-</span>
              </div>
              <div class="stat-row">
                <span class="stat-label">Health</span>
                <span class="stat-value">-</span>
              </div>
              <div class="stat-row">
                <span class="stat-label">Prot</span>
                <span class="stat-value">-</span>
              </div>
            </div>
          </div>
        `;
        }
        let relic: string | number = '?';
        if (typeof unit.relicLevel === 'number') {
          relic = Math.max(0, Math.min(10, unit.relicLevel));
        }
        // Construct portrait URL from baseId if not provided
        const portraitUrl = unit.portraitUrl || (unit.baseId ? `https://swgoh.gg/static/img/assets/character-portrait/${unit.baseId}.png` : null);
        const portraitImg = portraitUrl
          ? `<img src="${portraitUrl}" alt="${unit.baseId}" onerror="this.style.display='none'; this.parentElement.querySelector('.character-placeholder')?.style.setProperty('display', 'flex');" />`
          : '';
        
        // Get stats for this character
        const stats = getCharacterStats(unit.baseId);
        const speedValue = stats ? stats.speed.toLocaleString() : '-';
        const healthValue = stats ? stats.health.toFixed(2) + 'K' : '-';
        const protectionValue = stats ? stats.protection.toFixed(2) + 'K' : '-';
        
        return `
          <div class="character-with-stats">
            <div class="character-portrait dark">
              ${portraitImg}
              <div class="character-placeholder" style="display: ${portraitImg ? 'none' : 'flex'};"></div>
              <div class="relic-number">${relic}</div>
            </div>
            <div class="character-stats-table">
              <div class="stat-row">
                <span class="stat-label">Speed</span>
                <span class="stat-value">${speedValue}</span>
              </div>
              <div class="stat-row">
                <span class="stat-label">Health</span>
                <span class="stat-value">${healthValue}</span>
              </div>
              <div class="stat-row">
                <span class="stat-label">Prot</span>
                <span class="stat-value">${protectionValue}</span>
              </div>
            </div>
          </div>
        `;
      };

      const topRowHtml = Array.from({ length: topRowCount }).map((_, idx) => 
        renderUnit(topUnits[idx] || null, idx)
      ).join('');
      
      const bottomRowHtml = Array.from({ length: bottomRowCount }).map((_, idx) => 
        renderUnit(bottomUnits[idx] || null, topRowCount + idx)
      ).join('');

      return `<div class="squad-layout"><div class="squad-row">${topRowHtml}</div><div class="squad-row">${bottomRowHtml}</div></div>`;
    };

    // Regular renderSquad for offense/opponent (with stats tables, no names)
    const renderSquad = (squad: UniqueDefensiveSquad, squadSize: number = expectedSquadSize, isOffense: boolean = false): string => {
      if (!squad.leader.baseId) {
        // Empty squad - show placeholders with proper layout
        const topRow = squadSize === 3 ? 2 : 2; // 3v3: 2 top, 5v5: 2 top
        const bottomRow = squadSize === 3 ? 1 : 3; // 3v3: 1 bottom, 5v5: 3 bottom
        const topPlaceholders = Array.from({ length: topRow }).map((_, idx) => `
          <div class="character-with-stats">
            <div class="character-portrait ${isOffense ? 'offense' : 'dark'}">
            <div class="character-placeholder"></div>
            </div>
            <div class="character-stats-table">
              <div class="stat-row">
                <span class="stat-label">Speed</span>
                <span class="stat-value">-</span>
              </div>
              <div class="stat-row">
                <span class="stat-label">Health</span>
                <span class="stat-value">-</span>
              </div>
              <div class="stat-row">
                <span class="stat-label">Prot</span>
                <span class="stat-value">-</span>
              </div>
            </div>
          </div>
        `).join('');
        const bottomPlaceholders = Array.from({ length: bottomRow }).map((_, idx) => `
          <div class="character-with-stats">
            <div class="character-portrait ${isOffense ? 'offense' : 'dark'}">
              <div class="character-placeholder"></div>
            </div>
            <div class="character-stats-table">
              <div class="stat-row">
                <span class="stat-label">Speed</span>
                <span class="stat-value">-</span>
              </div>
              <div class="stat-row">
                <span class="stat-label">Health</span>
                <span class="stat-value">-</span>
              </div>
              <div class="stat-row">
                <span class="stat-label">Prot</span>
                <span class="stat-value">-</span>
              </div>
            </div>
          </div>
        `).join('');
        return `<div class="squad-layout"><div class="squad-row">${topPlaceholders}</div><div class="squad-row">${bottomPlaceholders}</div></div>`;
      }

      const allUnits = [squad.leader, ...squad.members];
      const totalSlots = squadSize;
      const usedSlots = allUnits.length;
      const emptySlots = Math.max(0, totalSlots - usedSlots);

      // Layout: 3v3 = 2 top, 1 bottom; 5v5 = 2 top, 3 bottom
      const topRowCount = 2; // Always 2 on top
      const bottomRowCount = squadSize === 3 ? 1 : 3; // 3v3: 1 bottom, 5v5: 3 bottom
      
      const topUnits = allUnits.slice(0, topRowCount);
      const bottomUnits = allUnits.slice(topRowCount, topRowCount + bottomRowCount);

      const renderUnit = (unit: UniqueDefensiveSquadUnit | null, idx: number): string => {
        if (!unit) {
          return `
          <div class="character-with-stats">
            <div class="character-portrait ${isOffense ? 'offense' : 'dark'}">
              <div class="character-placeholder"></div>
            </div>
            <div class="character-stats-table">
              <div class="stat-row">
                <span class="stat-label">Speed</span>
                <span class="stat-value">-</span>
              </div>
              <div class="stat-row">
                <span class="stat-label">Health</span>
                <span class="stat-value">-</span>
              </div>
              <div class="stat-row">
                <span class="stat-label">Prot</span>
                <span class="stat-value">-</span>
              </div>
            </div>
          </div>
        `;
        }
        let relic: string | number = '?';
        if (typeof unit.relicLevel === 'number') {
          relic = Math.max(0, Math.min(10, unit.relicLevel));
        }
        // Construct portrait URL from baseId if not provided
        const portraitUrl = unit.portraitUrl || (unit.baseId ? `https://swgoh.gg/static/img/assets/character-portrait/${unit.baseId}.png` : null);
        const portraitImg = portraitUrl
          ? `<img src="${portraitUrl}" alt="${unit.baseId}" onerror="this.style.display='none'; this.parentElement.querySelector('.character-placeholder')?.style.setProperty('display', 'flex');" />`
          : '';
        
        // Get stats for this character
        const stats = getCharacterStats(unit.baseId);
        const speedValue = stats ? stats.speed.toLocaleString() : '-';
        const healthValue = stats ? stats.health.toFixed(2) + 'K' : '-';
        const protectionValue = stats ? stats.protection.toFixed(2) + 'K' : '-';
        
        return `
          <div class="character-with-stats">
            <div class="character-portrait ${isOffense ? 'offense' : 'dark'}">
              ${portraitImg}
              <div class="character-placeholder" style="display: ${portraitImg ? 'none' : 'flex'};"></div>
              <div class="relic-number">${relic}</div>
            </div>
            <div class="character-stats-table">
              <div class="stat-row">
                <span class="stat-label">Speed</span>
                <span class="stat-value">${speedValue}</span>
              </div>
              <div class="stat-row">
                <span class="stat-label">Health</span>
                <span class="stat-value">${healthValue}</span>
              </div>
              <div class="stat-row">
                <span class="stat-label">Prot</span>
                <span class="stat-value">${protectionValue}</span>
              </div>
            </div>
          </div>
        `;
      };

      const topRowHtml = Array.from({ length: topRowCount }).map((_, idx) => 
        renderUnit(topUnits[idx] || null, idx)
      ).join('');
      
      const bottomRowHtml = Array.from({ length: bottomRowCount }).map((_, idx) => 
        renderUnit(bottomUnits[idx] || null, topRowCount + idx)
      ).join('');

      return `<div class="squad-layout"><div class="squad-row">${topRowHtml}</div><div class="squad-row">${bottomRowHtml}</div></div>`;
    };

    const renderOffenseSquad = (match: MatchedCounterSquad, squadSize: number = expectedSquadSize): string => {
      // Use the regular renderSquad with isOffense=true
      return renderSquad(match.offense, squadSize, true);
    };

    // Create a map of offense to opponent defense to preserve original matchups
    const offenseToOpponentMap = new Map<MatchedCounterSquad, UniqueDefensiveSquad>();
    for (const offense of balancedOffense) {
      if (offense.defense && offense.defense.leader.baseId) {
        offenseToOpponentMap.set(offense, offense.defense);
        logger.debug(`[Image Generation] Mapped offense ${offense.offense.leader.baseId} -> opponent defense ${offense.defense.leader.baseId}`);
      }
    }
    
    logger.info(`[Image Generation] Created ${offenseToOpponentMap.size} offense-to-opponent-defense mapping(s) from ${balancedOffense.length} total offense squad(s)`);
    
    // Build rows - each row has: Defense | Offense Strategy | Relic Analysis
    const squadRows = Array.from({ length: maxSquads }).map((_, index) => {
      const myDefense = visibleDefense[index];
      const myOffense = visibleOffense[index];
      
      // Try to get opponent defense from the mapped offense, otherwise fall back to index
      let opponentDef: UniqueDefensiveSquad | undefined = undefined;
      let opponentDefSource = 'none';
      
      if (myOffense && offenseToOpponentMap.has(myOffense)) {
        opponentDef = offenseToOpponentMap.get(myOffense)!;
        opponentDefSource = 'mapped';
        logger.debug(`[Image Generation] Row ${index + 1}: Using mapped opponent defense ${opponentDef.leader.baseId} for offense ${myOffense.offense.leader.baseId}`);
      } else if (visibleOpponentDefense[index]) {
        opponentDef = visibleOpponentDefense[index];
        opponentDefSource = 'index-fallback';
        logger.debug(`[Image Generation] Row ${index + 1}: Using index-based opponent defense ${opponentDef.leader.baseId} (no mapping found for offense ${myOffense?.offense.leader.baseId || 'none'})`);
      } else {
        opponentDefSource = 'empty';
        let fallbackDefId = 'none';
        if (index < visibleOpponentDefense.length) {
          const fallbackDef = visibleOpponentDefense[index] as UniqueDefensiveSquad | undefined;
          if (fallbackDef) {
            fallbackDefId = fallbackDef.leader.baseId;
          }
        }
        logger.warn(`[Image Generation] Row ${index + 1}: No opponent defense available (offense: ${myOffense?.offense.leader.baseId || 'none'}, mapped: ${myOffense && offenseToOpponentMap.has(myOffense)}, index fallback: ${fallbackDefId})`);
      }
      
      logger.info(`[Image Generation] Row ${index + 1}: Defense=${myDefense?.squad.leader.baseId || 'none'}, Offense=${myOffense?.offense.leader.baseId || 'none'}, OpponentDef=${opponentDef?.leader.baseId || 'none'} (source: ${opponentDefSource})`);

      const myDefenseHtml = myDefense ? renderDefenseSquad(myDefense.squad, expectedSquadSize) : renderDefenseSquad({
        leader: { baseId: '', relicLevel: null, portraitUrl: null },
        members: []
      }, expectedSquadSize);
      
      const myOffenseHtml = myOffense ? renderOffenseSquad(myOffense, expectedSquadSize) : renderSquad({
        leader: { baseId: '', relicLevel: null, portraitUrl: null },
        members: []
      }, expectedSquadSize, true);
      
      const opponentDefHtml = opponentDef ? renderSquad(opponentDef, expectedSquadSize, false) : renderSquad({
        leader: { baseId: '', relicLevel: null, portraitUrl: null },
        members: []
      }, expectedSquadSize, false);

      // Build defense analysis HTML
      let defenseAnalysisHtml = '<div class="defense-analysis-box"><div class="defense-analysis-title">DEFENSE ANALYSIS</div></div>';
      if (myDefense) {
        const holdPercentage = myDefense.holdPercentage;
        const seenCount = myDefense.seenCount;
        const holdText = holdPercentage !== null ? `${holdPercentage.toFixed(0)}%` : 'N/A';
        const seenText = seenCount !== null ? seenCount.toLocaleString() : 'N/A';
        const holdColor = holdPercentage !== null ? (holdPercentage >= 50 ? '#4ade80' : holdPercentage >= 30 ? '#fbbf24' : '#f87171') : '#f5deb3';
        
        defenseAnalysisHtml = `
          <div class="defense-analysis-box">
            <div class="defense-analysis-title">DEFENSE ANALYSIS</div>
            <div class="defense-analysis-content" style="color: ${holdColor};">
              <span style="font-size: 18px; margin-right: 6px;">${holdPercentage !== null ? '🛡️' : '❓'}</span>
              <span>Hold %: ${holdText}</span>
            </div>
            <div class="defense-analysis-stats">
              <div class="stat-row">
                <span class="stat-label">Seen:</span>
                <span class="stat-value">${seenText}</span>
            </div>
            </div>
            </div>
        `;
      }

      // Build battle analysis HTML
      let battleAnalysisHtml = '<div class="battle-analysis-box"><div class="battle-analysis-title">BATTLE ANALYSIS</div></div>';
      if (myOffense && myOffense.keyMatchups && opponentDef) {
        const match = myOffense;
        const keyMatchups = match.keyMatchups;
        if (keyMatchups) {
          let displayDelta: number;
          let displayModifiers: RelicDeltaModifiers;
          
          if (keyMatchups.hasAdvantage) {
            const bestDelta = Math.max(
              keyMatchups.leaderVsLeader.delta,
              keyMatchups.highestOffenseVsHighestDefense.delta,
              keyMatchups.teamAverage.delta
            );
            if (bestDelta === keyMatchups.leaderVsLeader.delta) {
              displayDelta = keyMatchups.leaderVsLeader.delta;
              displayModifiers = keyMatchups.leaderVsLeader;
            } else if (bestDelta === keyMatchups.highestOffenseVsHighestDefense.delta) {
              displayDelta = keyMatchups.highestOffenseVsHighestDefense.delta;
              displayModifiers = keyMatchups.highestOffenseVsHighestDefense;
            } else {
              displayDelta = keyMatchups.teamAverage.delta;
              displayModifiers = keyMatchups.teamAverage;
            }
          } else if (keyMatchups.isTrap) {
            const worstDelta = Math.min(
              keyMatchups.leaderVsLeader.delta,
              keyMatchups.highestOffenseVsHighestDefense.delta,
              keyMatchups.teamAverage.delta
            );
            if (worstDelta === keyMatchups.leaderVsLeader.delta) {
              displayDelta = keyMatchups.leaderVsLeader.delta;
              displayModifiers = keyMatchups.leaderVsLeader;
            } else if (worstDelta === keyMatchups.highestOffenseVsHighestDefense.delta) {
              displayDelta = keyMatchups.highestOffenseVsHighestDefense.delta;
              displayModifiers = keyMatchups.highestOffenseVsHighestDefense;
            } else {
              displayDelta = keyMatchups.teamAverage.delta;
              displayModifiers = keyMatchups.teamAverage;
            }
          } else {
            displayDelta = keyMatchups.teamAverage.delta;
            displayModifiers = keyMatchups.teamAverage;
          }
          
          const getSimpleDescription = (delta: number, modifiers: RelicDeltaModifiers): { icon: string; text: string; color: string } => {
          const damageMod = ((modifiers.attackerDamageMultiplier - 1.0) * 100);
          
          if (delta >= 3) {
            return {
              icon: '🔥',
                text: `Much stronger (${Math.abs(delta).toFixed(0)} tiers higher)`,
              color: '#4ade80'
            };
          } else if (delta >= 2) {
            return {
              icon: '✅',
                text: `Stronger (${Math.abs(delta).toFixed(0)} tiers higher)`,
              color: '#4ade80'
            };
          } else if (delta >= 1) {
            return {
              icon: '✓',
                text: `Slightly stronger (${Math.abs(delta).toFixed(0)} tier higher)`,
              color: '#86efac'
            };
          } else if (delta === 0) {
            return {
              icon: '⚖️',
                text: 'Even match',
              color: '#f5deb3'
            };
          } else if (delta >= -2) {
            return {
              icon: '⚠️',
                text: `Slightly weaker (${Math.abs(delta).toFixed(0)} tier${Math.abs(delta) > 1 ? 's' : ''} lower)`,
              color: '#fbbf24'
            };
          } else if (delta >= -3) {
            return {
              icon: '❌',
                text: `Much weaker (${Math.abs(delta).toFixed(0)} tiers lower)`,
              color: '#f87171'
            };
          } else {
            return {
              icon: '🚫',
                text: `Very weak (${Math.abs(delta).toFixed(0)} tiers lower) - RISKY!`,
              color: '#dc2626'
            };
          }
          };
          
          const avgDesc = getSimpleDescription(displayDelta, displayModifiers);
          
          // Build stats section
          const displayWinRate = myOffense.adjustedWinPercentage ?? myOffense.winPercentage;
          const winRateText = displayWinRate !== null ? `${displayWinRate.toFixed(0)}%` : 'N/A';
          const seenCountText = myOffense.seenCount !== null ? myOffense.seenCount.toLocaleString() : 'N/A';
          
          battleAnalysisHtml = `
            <div class="battle-analysis-box">
              <div class="battle-analysis-title">BATTLE ANALYSIS</div>
              <div class="battle-analysis-content" style="color: ${avgDesc.color};">
                <span style="font-size: 18px; margin-right: 6px;">${avgDesc.icon}</span>
                <span>${avgDesc.text}</span>
                </div>
              <div class="battle-analysis-stats">
                <div class="stat-row">
                  <span class="stat-label">Win %:</span>
                  <span class="stat-value">${winRateText}</span>
                </div>
                <div class="stat-row">
                  <span class="stat-label">Seen:</span>
                  <span class="stat-value">${seenCountText}</span>
                </div>
              </div>
            </div>
          `;
        }
      }

      return {
        defenseRow: `
          <div class="defense-card">
            <div class="defense-header">
              <div class="squad-label">Squad ${index + 1}</div>
          </div>
            <div class="defense-content-wrapper">
              <div class="squad-layout">
                ${myDefenseHtml}
            </div>
              <div class="defense-analysis-column">
                ${defenseAnalysisHtml}
            </div>
          </div>
              </div>
        `,
        strategyRow: `
          <div class="strategy-card">
            <div class="strategy-header">
              <div class="squad-label">Squad ${index + 1}</div>
            </div>
            <div class="strategy-content-wrapper">
              <div class="strategy-squads">
                <div class="squad-layout">
                  ${myOffenseHtml}
            </div>
                <div class="vs-indicator">VS</div>
                <div class="squad-layout">
                  ${opponentDefHtml}
          </div>
        </div>
              <div class="battle-analysis-column">
                ${battleAnalysisHtml}
              </div>
            </div>
          </div>
        `
      };
    });

    const defenseRows = squadRows.map(r => r.defenseRow).join('');
    const strategyRows = squadRows.map(r => r.strategyRow).join('');

    // Remaining GLs section removed - all GLs should be used in battle

    // Calculate defense column width based on format
    const defenseMinWidth = format === '3v3' ? 750 : 840;
    const defenseMaxWidth = format === '3v3' ? 900 : 1050;
    const defenseColumnWidth = `min-width: ${defenseMinWidth}px; max-width: ${defenseMaxWidth}px;`;
    
    // Calculate strategy column width as 2.25x the defense column width
    const strategyMinWidth = Math.round(defenseMinWidth * 2.25);
    const strategyMaxWidth = Math.round(defenseMaxWidth * 2.25);
    const strategyColumnWidth = `min-width: ${strategyMinWidth}px; max-width: ${strategyMaxWidth}px;`;

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>GAC Strategy</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      background: #1a1a1a;
      font-family: Arial, sans-serif;
      padding: 20px;
      color: white;
      display: flex;
      justify-content: center;
      align-items: flex-start;
      min-height: 100vh;
    }
    .main-container {
      display: flex;
      gap: 20px;
      width: fit-content;
      min-width: 100%;
      justify-content: center;
    }
    .defense-container {
      ${defenseColumnWidth}
      background: #2a2a2a;
      border: 2px solid #c4a35a;
      border-radius: 8px;
      padding: 20px;
      overflow: hidden;
    }
    .strategy-container {
      ${strategyColumnWidth}
      background: #2a2a2a;
      border: 2px solid #c4a35a;
      border-radius: 8px;
      padding: 20px;
      overflow: hidden;
    }
    .defense-container-header {
      background: #c4a35a;
      color: #1a1a1a;
      padding: 8px;
      font-weight: bold;
      text-align: center;
      font-size: 18px;
      border-radius: 4px;
      margin-bottom: 20px;
    }
    .strategy-container-header {
      background: #c4a35a;
      color: #1a1a1a;
      padding: 8px;
      font-weight: bold;
      text-align: center;
      font-size: 18px;
      border-radius: 4px;
      margin-bottom: 20px;
    }
    .strategy-card {
      background: #d4b56a;
      border-radius: 8px;
      margin-bottom: 15px;
      overflow: hidden;
      border: 1px solid #8b7355;
      display: flex;
      flex-direction: column;
      min-height: 200px;
    }
    .strategy-card:nth-child(even) {
      background: #b8935a;
    }
    .strategy-card:last-child {
      margin-bottom: 0;
    }
    .strategy-header {
      background: linear-gradient(135deg, #3a2a1a 0%, #1a1410 100%);
      padding: 10px 15px;
      color: #f5deb3;
      font-size: 16px;
      font-weight: bold;
      text-shadow: 1px 1px 2px rgba(0,0,0,0.8);
      border-bottom: 1px solid #8b7355;
    }
    .strategy-content-wrapper {
      display: flex;
      padding: 15px;
      gap: 15px;
      align-items: flex-start;
      flex: 1;
    }
    .battle-analysis-column {
      flex-shrink: 0;
      width: 300px;
    }
    .defense-row {
      display: flex;
      flex-direction: column;
      border-bottom: 1px solid #8b7355;
      padding: 20px 0;
      align-items: flex-start;
      min-height: 150px;
      background: #d4b56a;
    }
    .defense-row:nth-child(even) {
      background: #b8935a;
    }
    .defense-row:last-child {
      border-bottom: none;
    }
    .squad-label {
      font-size: 16px;
      font-weight: normal;
      margin-bottom: 10px;
      color: #f5deb3;
      text-align: left;
    }
    .squad-content {
      display: flex;
      flex-direction: column;
      gap: 8px;
      justify-content: center;
      align-items: center;
      flex: 1;
    }
    .squad-layout {
      display: flex;
      flex-direction: column;
      gap: 8px;
      align-items: center;
      width: 100%;
    }
    .squad-row {
      display: flex;
      gap: 12px;
      justify-content: center;
      align-items: center;
    }
    .strategy-squads {
      display: flex;
      align-items: center;
      gap: 15px;
      width: 100%;
      flex: 1;
    }
    .strategy-squads .squad-layout {
      flex: 1;
      min-width: 0;
    }
    .vs-indicator {
      font-size: 16px;
      font-weight: bold;
      text-align: center;
      color: #1a1a1a;
      text-transform: uppercase;
      letter-spacing: 2px;
      flex-shrink: 0;
    }
    .defense-analysis-wrapper {
      width: 100%;
      margin-top: 10px;
    }
    .character {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 5px;
      width: 90px;
      flex-shrink: 0;
    }
    .character-portrait {
      width: 60px;
      height: 60px;
      border-radius: 50%;
      border: 3px solid;
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #4a4a4a;
      overflow: hidden;
      flex-shrink: 0;
    }
    .character-portrait img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      border-radius: 50%;
    }
    .character-portrait.dark {
      border-color: #c4a35a;
      box-shadow: 0 0 15px rgba(196, 163, 90, 0.4);
    }
    .character-portrait.offense {
      border-color: #4ade80;
      box-shadow: 0 0 15px rgba(74, 222, 128, 0.4);
    }
    .character-placeholder {
      width: 60px;
      height: 60px;
      border-radius: 50%;
      background: rgba(74, 74, 74, 0.3);
      border: 2px dashed #8b7355;
      flex-shrink: 0;
    }
    .character-name {
      font-size: 16px;
      text-align: center;
      color: #1a1a1a;
      width: 90px;
      word-wrap: break-word;
      line-height: 1.2;
      overflow: hidden;
      text-overflow: ellipsis;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      font-weight: bold;
    }
    .relic-number {
      position: absolute;
      bottom: -5px;
      left: 50%;
      transform: translateX(-50%);
      background: linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%);
      color: #000;
      font-weight: bold;
      font-size: 12px;
      width: 22px;
      height: 22px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      border: 2px solid #1a1a1a;
      z-index: 2;
    }
    .battle-analysis-box {
      width: 100%;
      min-height: 100px;
      border: 2px solid #c4a35a;
      border-radius: 6px;
      padding: 15px;
      background: #2a2a2a;
    }
    .battle-analysis-title {
      font-size: 16px;
      font-weight: bold;
      margin-bottom: 10px;
      text-align: center;
      background: #c4a35a;
      color: #1a1a1a;
      padding: 6px;
      border-radius: 4px;
    }
    .battle-analysis-content {
      font-size: 16px;
      text-align: center;
      line-height: 1.5;
      margin-bottom: 10px;
      color: #f5deb3;
    }
    .battle-analysis-stats {
      display: flex;
      flex-direction: column;
      gap: 8px;
      font-size: 16px;
    }
    .battle-analysis-stats .stat-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 4px 8px;
      background: #2a2a2a !important;
      border-radius: 3px;
      margin-bottom: 0;
    }
    .battle-analysis-stats .stat-row .stat-label {
      font-weight: normal;
      color: #d3d3d3 !important;
    }
    .battle-analysis-stats .stat-row .stat-value {
      color: #d3d3d3 !important;
      font-weight: normal;
      text-align: right;
    }
    .stat-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 6px;
      font-size: 16px;
      padding: 4px 8px;
      background: #b8935a;
      border-radius: 3px;
    }
    .stat-row:last-child {
      margin-bottom: 0;
    }
    .stat-row .stat-label {
      color: #1a1a1a;
      font-weight: bold;
    }
    .stat-row .stat-value {
      color: #1a1a1a;
      font-weight: bold;
    }
    .defense-card {
      background: #d4b56a;
      border-radius: 8px;
      margin-bottom: 15px;
      overflow: hidden;
      border: 1px solid #8b7355;
      display: flex;
      flex-direction: column;
      min-height: 200px;
    }
    .defense-card:nth-child(even) {
      background: #b8935a;
    }
    .defense-card:last-child {
      margin-bottom: 0;
    }
    .defense-header {
      background: linear-gradient(135deg, #3a2a1a 0%, #1a1410 100%);
      padding: 10px 15px;
      color: #f5deb3;
      font-size: 16px;
      font-weight: bold;
      text-shadow: 1px 1px 2px rgba(0,0,0,0.8);
      border-bottom: 1px solid #8b7355;
    }
    .defense-content-wrapper {
      display: flex;
      padding: 15px;
      gap: 15px;
      align-items: flex-start;
      flex: 1;
    }
    .defense-analysis-column {
      flex-shrink: 0;
      width: 150px;
    }
    .character-with-stats {
      display: flex;
      flex-direction: row;
      align-items: center;
      gap: 12px;
      flex-shrink: 0;
    }
    .character-stats-table {
      display: flex;
      flex-direction: column;
      gap: 4px;
      width: 100%;
      min-width: 140px;
      background: #2a2a2a;
      border: 1px solid #8b7355;
      border-radius: 4px;
      padding: 8px;
    }
    .character-stats-table .stat-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 4px 6px;
      background: #1a1a1a;
      border-radius: 2px;
      margin-bottom: 0;
    }
    .character-stats-table .stat-label {
      font-size: 12px;
      color: #8b7355;
      text-transform: uppercase;
      font-weight: bold;
    }
    .character-stats-table .stat-value {
      font-size: 14px;
      color: #f5deb3;
      font-weight: bold;
    }
    .defense-analysis-box {
      width: 100%;
      min-height: 100px;
      border: 2px solid #c4a35a;
      border-radius: 6px;
      padding: 15px;
      background: #2a2a2a;
    }
    .defense-analysis-title {
      font-size: 16px;
      font-weight: bold;
      margin-bottom: 10px;
      text-align: center;
      background: #c4a35a;
      color: #1a1a1a;
      padding: 6px;
      border-radius: 4px;
    }
    .defense-analysis-content {
      font-size: 16px;
      text-align: center;
      line-height: 1.5;
      margin-bottom: 10px;
      color: #f5deb3;
    }
    .defense-analysis-stats {
      display: flex;
      flex-direction: column;
      gap: 8px;
      font-size: 16px;
      color: #f5deb3;
    }
    .defense-analysis-stats .stat-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 4px 8px;
      background: #1a1a1a;
      border-radius: 3px;
      margin-bottom: 0;
    }
    .defense-analysis-stats .stat-label {
      font-weight: bold;
      color: #f5deb3;
    }
    .defense-analysis-stats .stat-value {
      color: #f5deb3;
    }
  </style>
</head>
<body>
  <div class="main-container">
    <div class="defense-container">
      <div class="defense-container-header">YOUR DEFENSE${strategyPreference === 'defensive' ? ' (DEFENSIVE STRATEGY)' : strategyPreference === 'offensive' ? ' (OFFENSIVE STRATEGY)' : ' (BALANCED STRATEGY)'}</div>
      ${defenseRows}
    </div>
    <div class="strategy-container">
      <div class="strategy-container-header">YOUR GAC STRATEGY</div>
      ${strategyRows}
    </div>
  </div>
</body>
</html>`;
    
    logger.info(`[Image Generation] HTML generation complete: ${squadRows.length} row(s) generated`);
    return html;
  }

  /**
   * Generate an image visualising balanced offense and defense strategy.
   */
  async generateBalancedStrategyImage(
    opponentLabel: string,
    balancedOffense: MatchedCounterSquad[],
    balancedDefense: Array<{
      squad: UniqueDefensiveSquad;
      holdPercentage: number | null;
      seenCount: number | null;
      avgBanners: number | null;
      score: number;
      reason: string;
    }>,
    opponentDefense: UniqueDefensiveSquad[],
    format: string = '5v5',
    maxSquads: number = 11,
    userRoster?: SwgohGgFullPlayerResponse,
    strategyPreference: 'defensive' | 'balanced' | 'offensive' = 'balanced'
  ): Promise<Buffer> {
    logger.info(`[Image Generation] Starting image generation for ${opponentLabel}`);
    logger.info(`[Image Generation] Image input: ${balancedOffense.length} offense, ${balancedDefense.length} defense, ${opponentDefense.length} opponent defense`);
    
    const browser = await this.getBrowser();
    const page = await browser.newPage();

    try {
      logger.info('[Image Generation] Setting viewport: dynamic width @ 2x scale');
      await page.setViewport({
        width: 1920,
        height: 1080,
        deviceScaleFactor: 2
      });

      logger.info('[Image Generation] Generating HTML...');
      const html = this.generateBalancedStrategyHtml(
        opponentLabel,
        balancedOffense,
        balancedDefense,
        opponentDefense,
        format,
        maxSquads,
        userRoster,
        strategyPreference
      );

      logger.info(`[Image Generation] HTML generated (${html.length} characters), loading into page...`);
      await page.setContent(html, { waitUntil: 'networkidle0' });

      // Calculate expected width based on column widths + gap + padding
      // Defense: 750-900 (3v3) or 840-1050 (5v5)
      // Strategy: 2.25x defense = 1687.5-2025 (3v3) or 1890-2362.5 (5v5)
      // Gap: 20px, Padding: 20px per container = 40px total, Body padding: 20px each side = 40px
      const defenseMax = format === '3v3' ? 900 : 1050;
      const strategyMax = Math.round(defenseMax * 2.25);
      const expectedWidth = defenseMax + strategyMax + 20 + 40 + 40; // columns + gap + container padding + body padding
      
      // Get the actual content width to make the canvas dynamic
      const contentWidth = await page.evaluate((expectedWidth) => {
        // @ts-expect-error - document is available in browser context
        const container = document.querySelector('.main-container');
        if (container) {
          // Get the actual rendered width including all children
          // @ts-expect-error - document is available in browser context
          const defenseContainer = document.querySelector('.defense-container');
          // @ts-expect-error - document is available in browser context
          const strategyContainer = document.querySelector('.strategy-container');
          const gap = 20; // gap between containers
          const bodyPadding = 40; // 20px padding on each side
          
          const defenseWidth = defenseContainer ? defenseContainer.getBoundingClientRect().width : 0;
          const strategyWidth = strategyContainer ? strategyContainer.getBoundingClientRect().width : 0;
          const totalWidth = defenseWidth + strategyWidth + gap + bodyPadding;
          
          return Math.ceil(Math.max(totalWidth, container.scrollWidth));
        }
        return expectedWidth;
      }, expectedWidth);
      
      logger.info(`[Image Generation] Content width detected: ${contentWidth}px (expected: ${expectedWidth}px), updating viewport...`);
      await page.setViewport({
        width: Math.max(contentWidth, expectedWidth),
        height: 1080,
        deviceScaleFactor: 2
      });
      
      // Wait a bit for viewport to update
      await new Promise(resolve => setTimeout(resolve, 100));
      
      logger.info('[Image Generation] Taking screenshot...');
      const screenshot = await page.screenshot({
        type: 'png',
        fullPage: true
      });

      logger.info(`[Image Generation] Screenshot complete (${(screenshot as Buffer).length} bytes)`);
      return screenshot as Buffer;
    } catch (error) {
      logger.error('[Image Generation] Error generating balanced strategy image:', error);
      if (error instanceof Error) {
        logger.error(`[Image Generation] Error details: ${error.message}`);
        logger.error(`[Image Generation] Stack: ${error.stack}`);
      }
      throw new Error('Failed to generate balanced strategy image.');
    } finally {
      await page.close();
      logger.info('[Image Generation] Page closed');
    }
  }
}


