import { logger } from '../utils/logger';
import { GacService } from './gacService';
import { PlayerStore } from '../storage/inMemoryStore';

const DEFAULT_WARM_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
const DEFAULT_INITIAL_DELAY_MS = 30 * 1000; // 30 seconds after start
const STAGGER_DELAY_MS = 2000; // 2 seconds between each user fetch

export class BracketCacheWarmer {
  private timer: ReturnType<typeof setInterval> | null = null;
  private initialTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly intervalMs: number;

  constructor(
    private readonly gacService: GacService,
    private readonly playerStore: PlayerStore
  ) {
    this.intervalMs = parseInt(process.env.BRACKET_WARM_INTERVAL_MS || String(DEFAULT_WARM_INTERVAL_MS), 10);
  }

  start(): void {
    if (this.timer) return;

    logger.info(
      `[BracketCacheWarmer] Starting — first warm in ${DEFAULT_INITIAL_DELAY_MS / 1000}s, ` +
      `then every ${this.intervalMs / 60000} minutes`
    );

    // First warm after a short delay (Comlink needs time to initialise)
    this.initialTimer = setTimeout(() => {
      this.initialTimer = null;
      void this.warmAll();
    }, DEFAULT_INITIAL_DELAY_MS);

    // Recurring warm cycle
    this.timer = setInterval(() => void this.warmAll(), this.intervalMs);
  }

  stop(): void {
    if (this.initialTimer) {
      clearTimeout(this.initialTimer);
      this.initialTimer = null;
    }
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    logger.info('[BracketCacheWarmer] Stopped');
  }

  private async warmAll(): Promise<void> {
    if (!this.playerStore.getAllAllyCodes) {
      logger.debug('[BracketCacheWarmer] PlayerStore does not support getAllAllyCodes — skipping');
      return;
    }

    let allyCodes: string[];
    try {
      allyCodes = await this.playerStore.getAllAllyCodes();
    } catch (err) {
      logger.warn('[BracketCacheWarmer] Failed to get ally codes:', err);
      return;
    }

    if (allyCodes.length === 0) {
      logger.debug('[BracketCacheWarmer] No registered users — skipping');
      return;
    }

    logger.info(`[BracketCacheWarmer] Warming bracket cache for ${allyCodes.length} registered user(s)...`);

    let success = 0;
    let errors = 0;

    for (const allyCode of allyCodes) {
      try {
        await this.gacService.getLiveBracket(allyCode, false);
        success++;
      } catch {
        errors++;
      }

      // Stagger to avoid overwhelming Comlink
      if (allyCodes.indexOf(allyCode) < allyCodes.length - 1) {
        await new Promise(r => setTimeout(r, STAGGER_DELAY_MS));
      }
    }

    logger.info(
      `[BracketCacheWarmer] Complete — ${success}/${allyCodes.length} warmed` +
      (errors > 0 ? ` (${errors} error(s))` : '')
    );
  }
}
