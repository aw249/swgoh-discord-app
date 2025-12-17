import puppeteer, { Browser } from 'puppeteer';
import { GacDefensiveSquad, GacDefensiveSquadUnit, GacCounterSquad, GacTopDefenseSquad, SwgohGgFullPlayerResponse } from '../integrations/swgohGgApi';
import { logger } from '../utils/logger';
import { UniqueDefensiveSquad, UniqueDefensiveSquadUnit, MatchedCounterSquad } from '../types/gacStrategyTypes';
import { isGalacticLegend, MAX_DEFENSIVE_SQUADS_BY_LEAGUE } from '../config/gacConstants';
import { getCharacterPortraitUrl } from '../config/characterPortraits';

// Import extracted modules
import { balanceOffenseAndDefense } from './gacStrategy/balanceStrategy';
import { suggestDefenseSquads } from './gacStrategy/defenseSuggestion';
import { evaluateRosterForDefense } from './gacStrategy/defenseEvaluation';
import { matchCountersAgainstRoster } from './gacStrategy/squadMatching/matchCounters';
import { generateDefenseOnlyHtml } from './gacStrategy/imageGeneration/defenseOnlyHtml';
import { generateMatchedCountersHtml } from './gacStrategy/imageGeneration/matchedCountersHtml';
import { generateBalancedStrategyHtml } from './gacStrategy/imageGeneration/balancedStrategyHtml';
import { generateDefenseStrategyHtml } from './gacStrategy/imageGeneration/defenseStrategyHtml';
import { generateOffenseStrategyHtml } from './gacStrategy/imageGeneration/offenseStrategyHtml';
import { getTop80CharactersRoster } from './gacStrategy/utils/rosterUtils';

// Re-export types for backward compatibility
export { UniqueDefensiveSquad, UniqueDefensiveSquadUnit, MatchedCounterSquad } from '../types/gacStrategyTypes';

interface GacHistoryClient {
  getPlayerRecentGacDefensiveSquads(allyCode: string, format?: string): Promise<GacDefensiveSquad[]>;
}

interface CounterClient {
  getCounterSquads(defensiveLeaderBaseId: string, seasonId?: string): Promise<GacCounterSquad[]>;
}

interface DefenseClient {
  getTopDefenseSquads(sortBy?: 'percent' | 'count' | 'banners', seasonId?: string, format?: string): Promise<GacTopDefenseSquad[]>;
}

interface PlayerClient {
  getFullPlayer(allyCode: string): Promise<SwgohGgFullPlayerResponse>;
}

export class GacStrategyService {
  private browser: Browser | null = null;
  private topDefenseSquadsCache: Map<string, GacTopDefenseSquad[]> = new Map();
  private defenseSquadStatsCache: Map<string, { holdPercentage: number | null; seenCount: number | null }> = new Map();

  constructor(
    private readonly apiClient: GacHistoryClient,
    private readonly counterClient?: CounterClient,
    private readonly defenseClient?: DefenseClient,
    private readonly playerClient?: PlayerClient
  ) {}

  /**
   * Get the maximum number of defensive squads for a given league and format.
   */
  private getMaxSquadsForLeague(league: string | null | undefined, format: string = '5v5'): number {
    if (!league) {
      return MAX_DEFENSIVE_SQUADS_BY_LEAGUE['Kyber'][format as '5v5' | '3v3'] || 11;
    }
    const normalizedLeague = league.charAt(0).toUpperCase() + league.slice(1).toLowerCase();
    const leagueConfig = MAX_DEFENSIVE_SQUADS_BY_LEAGUE[normalizedLeague];
    if (!leagueConfig) {
      return MAX_DEFENSIVE_SQUADS_BY_LEAGUE['Kyber'][format as '5v5' | '3v3'] || 11;
    }
    return leagueConfig[format as '5v5' | '3v3'] || leagueConfig['5v5'];
  }

  private async getBrowser(): Promise<Browser> {
    if (!this.browser) {
      this.browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
      });
    }
    return this.browser;
  }

  async closeBrowser(): Promise<void> {
    if (this.browser) {
      try {
        await this.browser.close();
      } catch (error) {
        logger.warn('Error closing browser:', error);
      }
      this.browser = null;
    }
  }

  /**
   * Get opponent's recent defensive squads from GAC history.
   */
  async getOpponentDefensiveSquads(
    opponentAllyCode: string,
    opponentLeague?: string | null,
    format: string = '5v5'
  ): Promise<UniqueDefensiveSquad[]> {
    try {
      const defensiveSquads = await this.apiClient.getPlayerRecentGacDefensiveSquads(opponentAllyCode, format);
      
      const toUniqueUnit = (u: GacDefensiveSquadUnit): UniqueDefensiveSquadUnit => ({
        baseId: u.baseId,
        relicLevel: u.relicLevel,
        portraitUrl: u.portraitUrl || (u.baseId ? getCharacterPortraitUrl(u.baseId) : null)
      });

      // Convert to unique squads
      const allSquads = defensiveSquads.map(squad => ({
        leader: toUniqueUnit(squad.leader),
        members: squad.members.map(toUniqueUnit)
      }));

      // De-duplicate by leader - keep only the most recent (first) occurrence of each leader
      // This is because the opponent can only set one squad per leader in any GAC round
      const seenLeaders = new Set<string>();
      const uniqueSquads: UniqueDefensiveSquad[] = [];
      
      for (const squad of allSquads) {
        if (!seenLeaders.has(squad.leader.baseId)) {
          seenLeaders.add(squad.leader.baseId);
          uniqueSquads.push(squad);
        }
      }
      
      logger.info(
        `De-duplicated opponent squads: ${allSquads.length} total -> ${uniqueSquads.length} unique (by leader)`
      );
      
      return uniqueSquads;
    } catch (error) {
      logger.error(`Failed to get opponent defensive squads for ${opponentAllyCode}:`, error);
      return [];
    }
  }

  /**
   * Balance offense and defense squads - delegates to extracted module.
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
    return balanceOffenseAndDefense(
      offenseCounters,
      defenseSuggestions,
      maxDefenseSquads,
      seasonId,
      strategyPreference,
      userRoster,
      format,
      this.defenseClient,
      this.defenseSquadStatsCache,
      this.topDefenseSquadsCache
    );
  }

  /**
   * Match counter squads against user's roster - delegates to extracted module.
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
    return matchCountersAgainstRoster(
      this.counterClient,
      defensiveSquads,
      userRoster,
      seasonId,
      format,
      strategyPreference
    );
  }

  /**
   * Evaluate user's roster for defense - delegates to extracted module.
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
    return evaluateRosterForDefense(
      userRoster,
      seasonId,
      format,
      strategyPreference,
      this.defenseClient,
      this.defenseSquadStatsCache,
      this.topDefenseSquadsCache
    );
  }

  /**
   * Suggest defense squads - delegates to extracted module.
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
    return suggestDefenseSquads(
      userRoster,
      maxDefenseSquads,
      seasonId,
      format,
      offenseSquads,
      defenseCandidates,
      strategyPreference,
      this.defenseClient,
      this.defenseSquadStatsCache,
      this.topDefenseSquadsCache
    );
  }

  /**
   * Generate an image visualising defensive squads only.
   */
  async generateDefensiveSquadsImage(
    opponentLabel: string,
    squads: UniqueDefensiveSquad[],
    format: string = '5v5'
  ): Promise<Buffer> {
    const browser = await this.getBrowser();
    const page = await browser.newPage();

    try {
      await page.setViewport({ width: 800, height: 1600, deviceScaleFactor: 2 });
      const html = generateDefenseOnlyHtml(opponentLabel, squads, format);
      await page.setContent(html, { waitUntil: 'networkidle0' });
      const screenshot = await page.screenshot({ type: 'png', fullPage: true });
      return screenshot as Buffer;
    } finally {
      await page.close();
    }
  }

  /**
   * Generate an image showing matched offense counters against opponent defense.
   */
  async generateMatchedCountersImage(
    opponentLabel: string,
    matchedCounters: MatchedCounterSquad[],
    format: string = '5v5'
  ): Promise<Buffer> {
    const browser = await this.getBrowser();
    const page = await browser.newPage();

    try {
      await page.setViewport({ width: 1400, height: 2000, deviceScaleFactor: 2 });
      const html = generateMatchedCountersHtml(opponentLabel, matchedCounters, format);
      await page.setContent(html, { waitUntil: 'networkidle0' });
      const screenshot = await page.screenshot({ type: 'png', fullPage: true });
      return screenshot as Buffer;
    } finally {
      await page.close();
    }
  }

  /**
   * Generate a balanced strategy image showing both offense and defense assignments.
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
    const browser = await this.getBrowser();
    const page = await browser.newPage();

    try {
      // Calculate viewport width based on format
      // 3v3: defense (750) + strategy (1687) + gap (40) = ~2500px needed
      // 5v5: defense (840) + strategy (1890) + gap (40) = ~2800px needed
      const viewportWidth = format === '3v3' ? 2600 : 2900;
      await page.setViewport({ width: viewportWidth, height: 2400, deviceScaleFactor: 2 });
      const html = generateBalancedStrategyHtml(
        opponentLabel,
        balancedOffense,
        balancedDefense,
        opponentDefense,
        format,
        maxSquads,
        userRoster,
        strategyPreference
      );
      await page.setContent(html, { waitUntil: 'networkidle0' });
      const screenshot = await page.screenshot({ type: 'png', fullPage: true });
      return screenshot as Buffer;
    } finally {
      await page.close();
    }
  }

  /**
   * Generate split strategy images: one for defense, one for offense.
   * Returns two separate image buffers for better Discord viewing.
   */
  async generateSplitStrategyImages(
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
    format: string = '5v5',
    maxSquads: number = 11,
    userRoster?: SwgohGgFullPlayerResponse,
    strategyPreference: 'defensive' | 'balanced' | 'offensive' = 'balanced',
    opponentAllyCode?: string
  ): Promise<{ defenseImage: Buffer; offenseImage: Buffer }> {
    // Fetch opponent roster if ally code provided
    let opponentRoster: SwgohGgFullPlayerResponse | undefined;
    if (opponentAllyCode && this.playerClient) {
      try {
        logger.info(`Fetching opponent roster for ally code ${opponentAllyCode} to show stats in offense image`);
        opponentRoster = await this.playerClient.getFullPlayer(opponentAllyCode);
        logger.info(`Fetched opponent roster: ${opponentRoster.units?.length || 0} units`);
      } catch (error) {
        logger.warn(`Could not fetch opponent roster for ${opponentAllyCode}: ${error}`);
        // Continue without opponent roster - stats will show as '-'
      }
    }
    const browser = await this.getBrowser();

    // Generate defense image (2-column layout requires wider viewport)
    const defensePage = await browser.newPage();
    let defenseImage: Buffer;
    try {
      // Width matches container: 2 columns of squads + gap (5v5: 920*2+40=1880, 3v3: 680*2+40=1400)
      const defenseWidth = format === '3v3' ? 1450 : 1950;
      await defensePage.setViewport({ width: defenseWidth, height: 2400, deviceScaleFactor: 2 });
      const defenseHtml = generateDefenseStrategyHtml(
        opponentLabel,
        balancedDefense,
        format,
        maxSquads,
        userRoster,
        strategyPreference
      );
      await defensePage.setContent(defenseHtml, { waitUntil: 'networkidle0' });
      defenseImage = await defensePage.screenshot({ type: 'png', fullPage: true }) as Buffer;
    } finally {
      await defensePage.close();
    }

    // Calculate unused GLs for the offense image
    const unusedGLs: string[] = [];
    if (userRoster) {
      // Get all GLs from user roster
      const allUserGLs = new Set<string>();
      for (const unit of userRoster.units || []) {
        if (unit.data.combat_type === 1 && (isGalacticLegend(unit.data.base_id) || unit.data.is_galactic_legend)) {
          allUserGLs.add(unit.data.base_id);
        }
      }
      
      // Get GLs used in offense
      const usedGLs = new Set<string>();
      for (const counter of balancedOffense) {
        if (counter.offense.leader.baseId && isGalacticLegend(counter.offense.leader.baseId)) {
          usedGLs.add(counter.offense.leader.baseId);
        }
      }
      
      // Get GLs used in defense
      for (const defense of balancedDefense) {
        if (isGalacticLegend(defense.squad.leader.baseId)) {
          usedGLs.add(defense.squad.leader.baseId);
        }
      }
      
      // Find unused GLs
      for (const gl of allUserGLs) {
        if (!usedGLs.has(gl)) {
          unusedGLs.push(gl);
        }
      }
      
      if (unusedGLs.length > 0) {
        logger.info(`[Strategy Images] ${unusedGLs.length} GL(s) not placed in strategy: ${unusedGLs.join(', ')}`);
      }
    }

    // Generate offense image
    const offensePage = await browser.newPage();
    let offenseImage: Buffer;
    try {
      const offenseWidth = format === '3v3' ? 1250 : 1650;
      await offensePage.setViewport({ width: offenseWidth, height: 2400, deviceScaleFactor: 2 });
      const offenseHtml = generateOffenseStrategyHtml(
        opponentLabel,
        balancedOffense,
        format,
        maxSquads,
        userRoster,
        opponentRoster,
        unusedGLs
      );
      await offensePage.setContent(offenseHtml, { waitUntil: 'networkidle0' });
      offenseImage = await offensePage.screenshot({ type: 'png', fullPage: true }) as Buffer;
    } finally {
      await offensePage.close();
    }

    return { defenseImage, offenseImage };
  }
}
