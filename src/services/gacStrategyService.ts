import { GacDefensiveSquad, GacDefensiveSquadUnit, GacCounterSquad, GacTopDefenseSquad, SwgohGgFullPlayerResponse } from '../integrations/swgohGgApi';
import { logger } from '../utils/logger';
import { BrowserService } from './browserService';
import { UniqueDefensiveSquad, UniqueDefensiveSquadUnit, MatchedCounterSquad } from '../types/gacStrategyTypes';
import { isGalacticLegend, MAX_DEFENSIVE_SQUADS_BY_LEAGUE, normaliseLeague } from '../config/gacConstants';
import { getCharacterPortraitUrl } from '../config/characterPortraits';

// Import extracted modules
import { balanceOffenseAndDefense } from './gacStrategy/balanceStrategy';
import { suggestDefenseSquads } from './gacStrategy/defenseSuggestion';
import { evaluateRosterForDefense } from './gacStrategy/defenseEvaluation';
import { matchCountersAgainstRoster } from './gacStrategy/squadMatching/matchCounters';
import { generateDefenseOnlyHtml } from './gacStrategy/imageGeneration/defenseOnlyHtml';
import { generateMatchedCountersHtml } from './gacStrategy/imageGeneration/matchedCountersHtml';
import { generateDefenseStrategyHtml } from './gacStrategy/imageGeneration/defenseStrategyHtml';
import { generateOffenseStrategyHtml } from './gacStrategy/imageGeneration/offenseStrategyHtml';
import { getTop80CharactersRoster } from './gacStrategy/utils/rosterUtils';

// Datacron allocation
import { ComlinkDatacron } from '../integrations/comlink/comlinkClient';
import { DatacronSnapshotStore } from '../storage/datacronSnapshotStore';
import {
  fromComlink,
  ScopeResolver,
  allocateDatacrons,
  AllocationResult,
  SquadInput,
} from './datacronAllocator';
import { GameDataService } from './gameDataService';

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
  getFullPlayerWithStats?(allyCode: string): Promise<SwgohGgFullPlayerResponse>;
}

export interface GacStrategyServiceOptions {
  historyClient: GacHistoryClient;
  counterClient?: CounterClient;
  defenseClient?: DefenseClient;
  playerClient?: PlayerClient;
  /** Optional. When provided, enables datacron lock-in via per-season snapshots. */
  snapshotStore?: DatacronSnapshotStore;
}

export class GacStrategyService {
  private browserService = new BrowserService();
  private topDefenseSquadsCache: Map<string, GacTopDefenseSquad[]> = new Map();
  private defenseSquadStatsCache: Map<string, { holdPercentage: number | null; seenCount: number | null }> = new Map();

  private readonly apiClient: GacHistoryClient;
  private readonly counterClient?: CounterClient;
  private readonly defenseClient?: DefenseClient;
  private readonly playerClient?: PlayerClient;
  private readonly snapshotStore?: DatacronSnapshotStore;

  constructor(options: GacStrategyServiceOptions) {
    this.apiClient = options.historyClient;
    this.counterClient = options.counterClient;
    this.defenseClient = options.defenseClient;
    this.playerClient = options.playerClient;
    this.snapshotStore = options.snapshotStore;
  }

  /**
   * Get the maximum number of defensive squads for a given league and format.
   */
  private getMaxSquadsForLeague(league: string | null | undefined, format: string = '5v5'): number {
    if (!league) {
      return MAX_DEFENSIVE_SQUADS_BY_LEAGUE['Kyber'][format as '5v5' | '3v3'] || 11;
    }
    const normalizedLeague = normaliseLeague(league);
    const leagueConfig = MAX_DEFENSIVE_SQUADS_BY_LEAGUE[normalizedLeague];
    if (!leagueConfig) {
      return MAX_DEFENSIVE_SQUADS_BY_LEAGUE['Kyber'][format as '5v5' | '3v3'] || 11;
    }
    return leagueConfig[format as '5v5' | '3v3'] || leagueConfig['5v5'];
  }

  async closeBrowser(): Promise<void> {
    await this.browserService.close();
  }

  /**
   * Run the datacron allocator over a player's eligible cron pool against the
   * defense + offense squads chosen for this GAC.
   *
   * `seasonId` (from `combinedClient.getCurrentGacInstance().eventInstanceId`)
   * keys the lock-in snapshot. The first call within a season writes a snapshot
   * of the player's current cron IDs; subsequent calls within the same season
   * filter the live pool to that snapshot — mid-season acquisitions are excluded.
   *
   * Returns `null` when no crons are passed (no allocation possible).
   */
  async allocateDatacrons(
    allyCode: string,
    datacrons: ComlinkDatacron[] | undefined,
    seasonId: string | null,
    defenseSquads: SquadInput[],
    offenseSquads: SquadInput[]
  ): Promise<AllocationResult | null> {
    if (!datacrons || datacrons.length === 0) return null;

    let eligibleIds: Set<string> | null = null;
    if (seasonId && this.snapshotStore) {
      try {
        const stored = await this.snapshotStore.get(allyCode, seasonId);
        if (stored) {
          eligibleIds = new Set(stored);
          logger.info(`[Datacron snapshot] Applied snapshot for season ${seasonId}: ${stored.length} eligible cron IDs (live pool: ${datacrons.length})`);
        } else {
          await this.snapshotStore.set(allyCode, seasonId, datacrons.map(c => c.id));
          logger.info(`[Datacron snapshot] First observation for season ${seasonId} — saved ${datacrons.length} cron IDs as the lock-in snapshot. Subsequent calls in this season will filter to this set.`);
        }
      } catch (err) {
        logger.warn('Datacron snapshot lookup failed; using full live pool:', err);
      }
    } else {
      logger.info(`[Datacron snapshot] No snapshot applied (seasonId=${seasonId ? 'present' : 'null'}, store=${this.snapshotStore ? 'present' : 'null'}). Using full live pool of ${datacrons.length}.`);
    }

    const filtered = eligibleIds
      ? datacrons.filter(c => eligibleIds!.has(c.id))
      : datacrons;

    if (filtered.length === 0) return null;

    // Drop unrolled crons (currentTier 0 = no stats and no abilities). They'd
    // contribute zero score everywhere and just inflate the input pool.
    const allCandidates = filtered.map(fromComlink);
    const candidates = allCandidates.filter(c => c.currentTier >= 1);
    const droppedCount = allCandidates.length - candidates.length;
    if (droppedCount > 0) {
      logger.info(`[Datacron pool] Excluded ${droppedCount} unrolled crons (tier < 1) from allocation pool.`);
    }
    if (candidates.length === 0) return null;

    const resolver = new ScopeResolver();
    const allSquads = [...defenseSquads, ...offenseSquads];
    return allocateDatacrons(allSquads, candidates, resolver);
  }

  /**
   * Helper for callers building SquadInput[] from the existing UniqueDefensiveSquad
   * shape. Looks up each member's categories via gameDataService for use by the
   * allocator's faction-target scoring.
   */
  buildSquadInput(
    squadKey: string,
    leaderBaseId: string,
    memberBaseIds: string[],
    side: 'defense' | 'offense'
  ): SquadInput {
    const gd = GameDataService.getInstance();
    const memberCategories = new Map<string, string[]>();
    for (const id of [leaderBaseId, ...memberBaseIds]) {
      memberCategories.set(id, gd.isReady() ? gd.getUnitCategories(id) : []);
    }
    return {
      squadKey,
      leaderBaseId,
      memberBaseIds: [leaderBaseId, ...memberBaseIds],
      memberCategories,
      side,
    };
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

      // Convert to unique squads, preserving the scraped datacron so the
      // offense image can render the opponent's actual cron later.
      const allSquads = defensiveSquads.map(squad => ({
        leader: toUniqueUnit(squad.leader),
        members: squad.members.map(toUniqueUnit),
        ...(squad.datacron ? { datacron: squad.datacron } : {}),
      }));

      // Filter by format: allow up to expectedMembers (5v5: 4, 3v3: 2). Undersized
      // squads are legit (Wampa solo, Bane+Dooku duo, etc.) and should be shown.
      // We trust the swgoh.gg format query for the upper bound; over-sized squads
      // would indicate scraping error.
      const expectedMembers = format === '3v3' ? 2 : 4;
      const formatFiltered = allSquads.filter(squad => squad.members.length <= expectedMembers);
      if (formatFiltered.length < allSquads.length) {
        logger.info(
          `Filtered opponent squads by format: ${allSquads.length} total -> ${formatFiltered.length} matching ${format} (${allSquads.length - formatFiltered.length} wrong-format removed)`
        );
      }

      // De-duplicate by leader - keep only the most recent (first) occurrence of each leader
      // This is because the opponent can only set one squad per leader in any GAC round
      const seenLeaders = new Set<string>();
      const uniqueSquads: UniqueDefensiveSquad[] = [];

      for (const squad of formatFiltered) {
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
    strategyPreference: 'defensive' | 'balanced' | 'offensive' = 'balanced',
    userDatacronLeveragedChars?: Set<string>,
    metaDatacronActivatedChars?: Set<string>
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
      strategyPreference,
      userDatacronLeveragedChars,
      metaDatacronActivatedChars
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
    const html = generateDefenseOnlyHtml(opponentLabel, squads, format);
    return this.browserService.renderHtml(html, { width: 800, height: 1600 });
  }

  /**
   * Generate an image showing matched offense counters against opponent defense.
   */
  async generateMatchedCountersImage(
    opponentLabel: string,
    matchedCounters: MatchedCounterSquad[],
    format: string = '5v5'
  ): Promise<Buffer> {
    const html = generateMatchedCountersHtml(opponentLabel, matchedCounters, format);
    return this.browserService.renderHtml(html, { width: 1400, height: 2000 });
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
    opponentAllyCode?: string,
    /** Per-squad cron assignments. Keys: 'def-{idx}' for defense, 'off-{idx}' for offense. */
    assignedCrons?: Map<string, import('./datacronAllocator').AssignedCron | null>,
    /** Opponent's actual cron per offense battle (scraped from swgoh.gg). Keys: 'opp-def-{idx}'. */
    opponentCronsByDefenseKey?: Map<string, import('./datacronAllocator').AssignedCron | null>
  ): Promise<{ defenseImage: Buffer; offenseImages: Buffer[] }> {
    // Fetch opponent roster if ally code provided
    // Must use getFullPlayerWithStats to get calculated stats (Speed, Health, Protection)
    // Comlink doesn't provide these stats, only swgoh.gg does
    let opponentRoster: SwgohGgFullPlayerResponse | undefined;
    if (opponentAllyCode && this.playerClient) {
      try {
        logger.info(`Fetching opponent roster for ally code ${opponentAllyCode} to show stats in offense image`);
        // Use getFullPlayerWithStats if available, otherwise fall back to getFullPlayer
        const getPlayerWithStats = this.playerClient.getFullPlayerWithStats 
          ? this.playerClient.getFullPlayerWithStats.bind(this.playerClient)
          : this.playerClient.getFullPlayer.bind(this.playerClient);
        opponentRoster = await getPlayerWithStats(opponentAllyCode);
        logger.info(`Fetched opponent roster: ${opponentRoster.units?.length || 0} units`);
      } catch (error) {
        logger.warn(`Could not fetch opponent roster for ${opponentAllyCode}: ${error}`);
        // Continue without opponent roster - stats will show as '-'
      }
    }
    // Calculate unused GLs (needed for both defense and offense images)
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

    // Generate defense image (2-column layout requires wider viewport)
    // Width matches container: 2 columns of squads + gap (5v5: 920*2+40=1880, 3v3: 620*2+40=1280)
    // Defense uses the same compact character-cell sizing as the offense template,
    // so the cron column fits inside the existing budget — no canvas growth.
    const defenseWidth = format === '3v3' ? 1330 : 1950;
    const defenseHtml = generateDefenseStrategyHtml(
      opponentLabel,
      balancedDefense,
      format,
      maxSquads,
      userRoster,
      strategyPreference,
      unusedGLs,
      assignedCrons
    );
    const defenseImage = await this.browserService.renderHtml(defenseHtml, { width: defenseWidth, height: 2400 });

    // Generate offense images. Split into up to 3 chunks of ~5 battles each
    // to keep each image short enough to dodge Chromium's tall-screenshot
    // duplication path. Single chunk (no chunking) for ≤5 battles.
    //
    // Split balancedOffense into:
    //   - countered: entries with a real offense leader, become battle rows
    //   - uncountered: entries with empty offense.leader.baseId, rendered in
    //     a separate "Uncountered Defenses" section on the LAST chunk only
    // Offense already uses compact character cells; cron columns fit within the
    // existing budget. No canvas growth.
    const offenseWidth = format === '3v3' ? 1100 : 1650;
    const visible = balancedOffense.slice(0, maxSquads);
    const counteredBattles = visible.filter(c => !!c.offense.leader.baseId);
    const uncounteredDefenses = visible.filter(c => !c.offense.leader.baseId);

    const totalBattles = counteredBattles.length;
    const totalChunks = Math.max(1, Math.min(3, Math.ceil(totalBattles / 5)));
    const baseSize = totalBattles > 0 ? Math.floor(totalBattles / totalChunks) : 0;
    const remainder = totalBattles > 0 ? totalBattles % totalChunks : 0;

    const offenseImages: Buffer[] = [];
    let cursor = 0;
    for (let i = 0; i < totalChunks; i++) {
      const size = baseSize + (i < remainder ? 1 : 0);
      const chunk = counteredBattles.slice(cursor, cursor + size);
      const isLast = i === totalChunks - 1;
      const chunkInfo = totalChunks > 1 ? { current: i + 1, total: totalChunks } : undefined;

      const offenseHtml = generateOffenseStrategyHtml(
        opponentLabel,
        chunk,
        format,
        chunk.length,
        userRoster,
        opponentRoster,
        isLast ? unusedGLs : undefined,
        cursor,
        chunkInfo,
        isLast ? uncounteredDefenses : undefined,
        assignedCrons,
        opponentCronsByDefenseKey
      );
      const offenseImage = await this.browserService.renderHtml(offenseHtml, { width: offenseWidth, height: 2400 });
      offenseImages.push(offenseImage);
      cursor += size;
    }

    return { defenseImage, offenseImages };
  }
}
