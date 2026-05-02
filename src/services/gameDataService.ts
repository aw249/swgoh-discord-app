/**
 * GameDataService - Fetches and caches game data from Comlink.
 * 
 * Provides accurate unit definitions, names, and categories directly from CG's servers.
 * This replaces hardcoded lists that need manual updates when new content is released.
 */
import { logger } from '../utils/logger';

/** Comlink can drop large responses (e.g. localization JSON) under load; treat as transient. */
function isTransientComlinkFetchError(error: unknown): boolean {
  if (error instanceof TypeError && error.message === 'fetch failed') {
    return true;
  }
  const err = error as Error & { code?: string; cause?: unknown };
  if (err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT' || err.code === 'ECONNREFUSED') {
    return true;
  }
  const cause = err.cause as { code?: string } | undefined;
  const code = cause?.code;
  return (
    code === 'UND_ERR_SOCKET' ||
    code === 'ECONNRESET' ||
    code === 'UND_ERR_HEADERS_TIMEOUT' ||
    code === 'UND_ERR_BODY_TIMEOUT'
  );
}

export interface UnitDefinition {
  baseId: string;
  nameKey: string;
  combatType: number;  // 1 = character, 2 = ship
  categoryId: string[];
  forceAlignment: number;  // 2 = light, 3 = dark
  rarity: number;
  obtainable: boolean;
  obtainableTime: number;
}

/**
 * One prerequisite unit needed to unlock a Galactic Legend.
 *
 * Sourced from the chain:
 *   unitGuideDefinition → requirement → challenge → task
 *
 * Each task encodes the prerequisite kind via its descKey:
 * - `GLEVENT_PREREQ_RELIC_NN` → kind='relic', value=NN, implies 7★ + G13
 * - `GLEVENT_PREREQ_STAR_NN`  → kind='star',  value=NN, no relic requirement
 *
 * The unit identity is parsed from `actionLinkDef.link`
 * (e.g. "UNIT_DETAILS?unit_meta=BASE_ID&base_id=BADBATCHHUNTER").
 */
export interface JourneyPrerequisite {
  baseId: string;
  /** 'relic' = needs ★7 + G13 + relic >= value; 'star' = needs stars >= value */
  kind: 'relic' | 'star';
  value: number;
}

export interface JourneyRequirement {
  /** The GL unit being unlocked, e.g. 'LORDVADER' */
  glBaseId: string;
  prerequisites: JourneyPrerequisite[];
}

interface ComlinkChallengeTask {
  id: string;
  descKey: string;
  actionLinkDef?: { link?: string; type?: number };
}

interface ComlinkChallenge {
  id: string;
  task?: ComlinkChallengeTask[];
}

interface ComlinkRequirementItem {
  type: number;
  id: string;
}

interface ComlinkRequirement {
  id: string;
  requirementItem?: ComlinkRequirementItem[];
}

interface ComlinkUnitGuideDefinition {
  unitBaseId: string;
  galacticLegend?: boolean;
  additionalActivationRequirementId?: string;
}

const TYPE_CHALLENGE_COMPLETION = 105;
const PREREQ_BASE_ID_RE = /base_id=([A-Z0-9_]+)/;
const PREREQ_DESC_RE = /^GLEVENT_PREREQ_(RELIC|STAR)_0?(\d+)$/;

/**
 * Parse a single challenge task into a prerequisite entry.
 * Returns null when the task isn't a unit-prerequisite (e.g. some tasks are
 * meta tasks like "complete the previous challenge" that don't carry a
 * base_id link or don't match the relic/star descKey shape).
 */
export function parsePrerequisiteFromTask(task: ComlinkChallengeTask): JourneyPrerequisite | null {
  const descMatch = PREREQ_DESC_RE.exec(task.descKey);
  if (!descMatch) return null;
  const kind = descMatch[1] === 'RELIC' ? 'relic' : 'star';
  const value = parseInt(descMatch[2], 10);
  if (!Number.isFinite(value)) return null;

  const link = task.actionLinkDef?.link ?? '';
  const linkMatch = PREREQ_BASE_ID_RE.exec(link);
  if (!linkMatch) return null;

  return { baseId: linkMatch[1], kind, value };
}

export interface GameDataMetadata {
  latestGamedataVersion: string;
  latestLocalizationBundleVersion: string;
  serverVersion: string;
}

interface ComlinkUnitData {
  baseId: string;
  nameKey: string;
  combatType: number;
  categoryId: string[];
  forceAlignment?: number;
  obtainable?: boolean;
  obtainableTime?: number;
  rarity?: number;
}

/**
 * GameDataService singleton that manages game data from Comlink
 */
export class GameDataService {
  private static instance: GameDataService | null = null;
  
  private units: Map<string, UnitDefinition> = new Map();
  private localization: Map<string, string> = new Map();
  private journeyRequirements: Map<string, JourneyRequirement> = new Map();
  private comlinkUrl: string;
  private initialized = false;
  private lastUpdate: Date | null = null;
  private currentVersion: string | null = null;
  
  // Cache for 24 hours (game data rarely changes)
  private readonly CACHE_TTL_MS = 24 * 60 * 60 * 1000;

  /** Retry Comlink HTTP calls when the server closes the socket mid-body (common on Pi + large JSON). */
  private async withComlinkRetries<T>(operation: string, fn: () => Promise<T>): Promise<T> {
    const maxAttempts = 5;
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (e) {
        lastError = e;
        const transient = isTransientComlinkFetchError(e);
        if (!transient || attempt === maxAttempts) {
          throw e;
        }
        const delayMs = Math.min(10_000, 1000 * 2 ** (attempt - 1));
        logger.warn(
          `${operation} failed (attempt ${attempt}/${maxAttempts}), retrying in ${delayMs}ms:`,
          e instanceof Error ? e.message : e
        );
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
    throw lastError;
  }

  private constructor(comlinkUrl?: string) {
    this.comlinkUrl = comlinkUrl ?? process.env.COMLINK_URL ?? 'http://localhost:3200';
  }

  /**
   * Get the singleton instance
   */
  static getInstance(comlinkUrl?: string): GameDataService {
    if (!GameDataService.instance) {
      GameDataService.instance = new GameDataService(comlinkUrl);
    }
    return GameDataService.instance;
  }

  /**
   * Reset the singleton (for testing)
   */
  static resetInstance(): void {
    GameDataService.instance = null;
  }

  /**
   * Check if the service is initialized and cache is valid
   */
  isReady(): boolean {
    if (!this.initialized) return false;
    if (!this.lastUpdate) return false;
    
    const age = Date.now() - this.lastUpdate.getTime();
    return age < this.CACHE_TTL_MS;
  }

  /**
   * Initialize the service by fetching game data and localization
   */
  async initialize(): Promise<void> {
    if (this.isReady()) {
      logger.debug('GameDataService already initialized and cache is valid');
      return;
    }

    logger.info('Initializing GameDataService...');
    const startTime = Date.now();

    try {
      // Step 1: Get metadata to find current versions
      const metadata = await this.fetchMetadata();
      logger.info(`Game data version: ${metadata.latestGamedataVersion}`);

      // Step 2: Fetch game data
      await this.fetchGameData(metadata.latestGamedataVersion);
      logger.info(`Loaded ${this.units.size} unit definitions`);

      // Step 3: Fetch localization
      await this.fetchLocalization(metadata.latestLocalizationBundleVersion);
      logger.info(`Loaded ${this.localization.size} localization entries`);

      this.initialized = true;
      this.lastUpdate = new Date();
      this.currentVersion = metadata.latestGamedataVersion;

      const duration = Date.now() - startTime;
      logger.info(`GameDataService initialized in ${duration}ms`);

      // Log stats (using filtered counts for playable units)
      const glCount = this.getAllGalacticLegends().length;
      const shipCount = this.getAllShips().length;
      const charCount = this.getAllCharacters().length;
      logger.info(`Found ${glCount} Galactic Legends, ${charCount} characters, ${shipCount} ships`);

    } catch (error) {
      logger.error('Failed to initialize GameDataService:', error);
      throw error;
    }
  }

  /**
   * Fetch metadata from Comlink
   */
  private async fetchMetadata(): Promise<GameDataMetadata> {
    return this.withComlinkRetries('Comlink /metadata', async () => {
      const response = await fetch(`${this.comlinkUrl}/metadata`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payload: {} }),
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch metadata: ${response.status}`);
      }

      const data = await response.json() as GameDataMetadata;
      return {
        latestGamedataVersion: data.latestGamedataVersion,
        latestLocalizationBundleVersion: data.latestLocalizationBundleVersion,
        serverVersion: data.serverVersion,
      };
    });
  }

  /**
   * Fetch and parse game data from Comlink
   */
  private async fetchGameData(version: string): Promise<void> {
    await this.withComlinkRetries('Comlink /data', async () => {
      const response = await fetch(`${this.comlinkUrl}/data`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          payload: {
            version,
            includePveUnits: false,
            requestSegment: 0,
          },
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch game data: ${response.status}`);
      }

      const data = await response.json() as {
        units: ComlinkUnitData[];
        unitGuideDefinition?: ComlinkUnitGuideDefinition[];
        requirement?: ComlinkRequirement[];
        challenge?: ComlinkChallenge[];
      };

      this.units.clear();
      for (const unit of data.units) {
        this.units.set(unit.baseId, {
          baseId: unit.baseId,
          nameKey: unit.nameKey,
          combatType: unit.combatType,
          categoryId: unit.categoryId || [],
          forceAlignment: unit.forceAlignment || 0,
          rarity: unit.rarity || 0,
          obtainable: unit.obtainable ?? true,
          obtainableTime: unit.obtainableTime || 0,
        });
      }

      this.journeyRequirements.clear();
      if (data.unitGuideDefinition && data.requirement && data.challenge) {
        this.extractJourneyRequirements(
          data.unitGuideDefinition,
          data.requirement,
          data.challenge
        );
      }
    });
  }

  /**
   * Walk the chain unitGuideDefinition → requirement → challenge → task
   * to build a per-GL list of prerequisite units. Sets in journeyRequirements.
   */
  private extractJourneyRequirements(
    guides: ComlinkUnitGuideDefinition[],
    requirements: ComlinkRequirement[],
    challenges: ComlinkChallenge[]
  ): void {
    const reqById = new Map(requirements.map(r => [r.id, r]));
    const challengeById = new Map(challenges.map(c => [c.id, c]));

    for (const guide of guides) {
      if (!guide.galacticLegend) continue;
      if (!guide.additionalActivationRequirementId) continue;

      const topReq = reqById.get(guide.additionalActivationRequirementId);
      if (!topReq?.requirementItem) continue;

      const prerequisites: JourneyPrerequisite[] = [];
      for (const item of topReq.requirementItem) {
        if (item.type !== TYPE_CHALLENGE_COMPLETION) continue;
        const challenge = challengeById.get(item.id);
        if (!challenge?.task) continue;

        for (const task of challenge.task) {
          const prereq = parsePrerequisiteFromTask(task);
          if (prereq) prerequisites.push(prereq);
        }
      }

      if (prerequisites.length > 0) {
        this.journeyRequirements.set(guide.unitBaseId, {
          glBaseId: guide.unitBaseId,
          prerequisites,
        });
      }
    }

    logger.info(`Loaded journey requirements for ${this.journeyRequirements.size} GLs`);
  }

  /**
   * Fetch and parse English localization from Comlink
   */
  private async fetchLocalization(bundleVersion: string): Promise<void> {
    await this.withComlinkRetries('Comlink /localization', async () => {
      const response = await fetch(`${this.comlinkUrl}/localization`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          unzip: true,
          payload: { id: bundleVersion },
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch localization: ${response.status}`);
      }

      const data = await response.json() as Record<string, string>;
      const engData = data['Loc_ENG_US.txt'];

      if (!engData) {
        throw new Error('English localization not found');
      }

      // Parse pipe-separated format: KEY|VALUE
      this.localization.clear();
      const lines = engData.split('\n');
      for (const line of lines) {
        const pipeIndex = line.indexOf('|');
        if (pipeIndex > 0) {
          const key = line.substring(0, pipeIndex);
          const value = line.substring(pipeIndex + 1);
          this.localization.set(key, value);
        }
      }
    });
  }

  // ===== Public API =====

  /**
   * Check if a unit is a Galactic Legend
   */
  isGalacticLegend(baseId: string): boolean {
    const unit = this.units.get(baseId);
    if (!unit) return false;
    return unit.categoryId.includes('galactic_legend');
  }

  /**
   * Check if a unit is a ship (combat type 2)
   */
  isShip(baseId: string): boolean {
    const unit = this.units.get(baseId);
    if (!unit) return false;
    return unit.combatType === 2;
  }

  /**
   * Check if a unit is a character (combat type 1)
   */
  isCharacter(baseId: string): boolean {
    const unit = this.units.get(baseId);
    if (!unit) return true; // Default to character if unknown
    return unit.combatType === 1;
  }

  /**
   * Get the display name for a unit
   */
  getUnitName(baseId: string): string {
    const unit = this.units.get(baseId);
    if (!unit) return baseId;
    
    const nameKey = unit.nameKey;
    const name = this.localization.get(nameKey);
    return name || baseId;
  }

  /**
   * Get all categories for a unit
   */
  getUnitCategories(baseId: string): string[] {
    const unit = this.units.get(baseId);
    return unit?.categoryId || [];
  }

  /**
   * Check if a unit has a specific category
   */
  hasCategory(baseId: string, category: string): boolean {
    const categories = this.getUnitCategories(baseId);
    return categories.includes(category);
  }

  /**
   * Get the unit definition
   */
  getUnit(baseId: string): UnitDefinition | undefined {
    return this.units.get(baseId);
  }

  /**
   * Get all Galactic Legend base IDs.
   * Filters out event/inherit variants to return only base playable GLs.
   */
  getAllGalacticLegends(): string[] {
    return Array.from(this.units.values())
      .filter(u => u.categoryId.includes('galactic_legend'))
      .filter(u => this.isBasePlayableUnit(u.baseId))
      .map(u => u.baseId);
  }

  /**
   * Returns the parsed journey requirement for a GL, or null if not found.
   * Available after `initialize()` completes.
   */
  getJourneyRequirement(glBaseId: string): JourneyRequirement | null {
    return this.journeyRequirements.get(glBaseId) ?? null;
  }

  /** GL base IDs that have an extracted journey requirement available. */
  getJourneyReadyGLs(): string[] {
    return Array.from(this.journeyRequirements.keys());
  }

  /**
   * Check if a unit ID is a base playable unit (not an event/inherit variant)
   */
  private isBasePlayableUnit(baseId: string): boolean {
    // Filter out event variants and inherit copies
    const variantPatterns = [
      '_GLE_INHERIT',
      '_GLE',
      '_GL_EVENT',
      '_GLAHSOKAEVENT',
      '_SPEEDERBIKERAID',
      '_T4_HERO',
      '_T6',
      '_NOULT',
      '_STANDARD'
    ];
    
    const upperBaseId = baseId.toUpperCase();
    return !variantPatterns.some(pattern => upperBaseId.includes(pattern));
  }

  /**
   * Get all ship base IDs (filtered to base playable units)
   */
  getAllShips(): string[] {
    return Array.from(this.units.values())
      .filter(u => u.combatType === 2)
      .filter(u => this.isBasePlayableUnit(u.baseId))
      .map(u => u.baseId);
  }

  /**
   * Get all character base IDs (filtered to base playable units)
   */
  getAllCharacters(): string[] {
    return Array.from(this.units.values())
      .filter(u => u.combatType === 1)
      .filter(u => this.isBasePlayableUnit(u.baseId))
      .map(u => u.baseId);
  }

  /**
   * Get units by category
   */
  getUnitsByCategory(category: string): string[] {
    return Array.from(this.units.values())
      .filter(u => u.categoryId.includes(category))
      .map(u => u.baseId);
  }

  /**
   * Get light side units
   */
  getLightSideUnits(): string[] {
    return Array.from(this.units.values())
      .filter(u => u.categoryId.includes('alignment_light'))
      .map(u => u.baseId);
  }

  /**
   * Get dark side units
   */
  getDarkSideUnits(): string[] {
    return Array.from(this.units.values())
      .filter(u => u.categoryId.includes('alignment_dark'))
      .map(u => u.baseId);
  }

  /**
   * Look up a localization string by key
   */
  getLocString(key: string): string | undefined {
    return this.localization.get(key);
  }

  /**
   * Get the current game data version
   */
  getVersion(): string | null {
    return this.currentVersion;
  }

  /**
   * Force a refresh of the game data cache
   */
  async refresh(): Promise<void> {
    this.initialized = false;
    await this.initialize();
  }
}

// Export singleton accessor
export const gameDataService = GameDataService.getInstance();

/**
 * Initialize the game data service (call on startup)
 */
export async function initializeGameData(): Promise<void> {
  await gameDataService.initialize();
}

