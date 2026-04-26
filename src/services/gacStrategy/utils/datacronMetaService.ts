/**
 * Datacron meta service — caches the set of focused-datacron tags that
 * exist in the current game meta. Pulled from comlink's data segment 4
 * (`datacronTemplate`). Used to determine which characters in a roster
 * could potentially be cron-empowered, so we can detect when a recommended
 * counter relies on a datacron the user doesn't have.
 *
 * Cached in memory for 24h — the underlying game data updates only when
 * the season rolls or a balance patch hits. First strategy call after a
 * cold start triggers the fetch; subsequent calls within 24h hit cache.
 */

import { logger } from '../../../utils/logger';
import { gameDataService } from '../../gameDataService';

const COMLINK_URL = process.env.COMLINK_URL || 'http://localhost:3200';
const TTL_HOURS = 24;
const TTL_MS = TTL_HOURS * 60 * 60 * 1000;

interface DatacronTemplate {
  fixedTag?: string[];
  tier?: Array<{
    id: number;
    affixTemplateSetId?: string[];
  }>;
}

interface CachedMeta {
  fetchedAt: number;
  metaTags: Set<string>;
}

let cache: CachedMeta | null = null;
let inFlight: Promise<Set<string>> | null = null;

/**
 * Returns the set of focused-cron tags currently in the meta. Cached for
 * TTL_HOURS. On error, returns an empty set (callers should treat empty as
 * "no meta info available" and skip the cron filter rather than block).
 */
export async function getMetaCronTags(): Promise<Set<string>> {
  if (cache && Date.now() - cache.fetchedAt < TTL_MS) {
    return cache.metaTags;
  }
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const version = gameDataService.getVersion() ?? '';
      const body = {
        payload: {
          version,
          includePveUnits: false,
          requestSegment: 4,
        },
      };
      const res = await fetch(`${COMLINK_URL}/data`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        logger.warn(`datacronMetaService: /data segment 4 returned ${res.status}; cron filter will be best-effort`);
        return new Set<string>();
      }
      const data = await res.json() as { datacronTemplate?: DatacronTemplate[] };
      const templates = data.datacronTemplate ?? [];
      const tags = new Set<string>();
      for (const t of templates) {
        for (const tag of t.fixedTag ?? []) {
          if (tag) tags.add(tag.toLowerCase());
        }
      }
      cache = { fetchedAt: Date.now(), metaTags: tags };
      logger.info(
        `datacronMetaService: loaded ${tags.size} focused-cron tag(s) from meta ` +
        `(cached for ${TTL_HOURS}h)`
      );
      return tags;
    } catch (err) {
      logger.warn('datacronMetaService: failed to fetch comlink datacron meta:', err);
      return new Set<string>();
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}
