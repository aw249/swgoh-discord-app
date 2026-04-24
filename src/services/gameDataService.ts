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

      const data = await response.json() as { units: ComlinkUnitData[] };

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
    });
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

