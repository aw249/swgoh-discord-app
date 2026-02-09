/**
 * Character Portrait Cache
 * 
 * Stores and manages the mapping from character baseId to their swgoh.gg portrait URLs.
 * This cache is persisted to disk and updated automatically when new characters are discovered
 * during scraping operations.
 */

import { promises as fs } from 'fs';
import { join } from 'path';
import { logger } from '../utils/logger';

const CACHE_FILE = join(process.cwd(), 'data', 'character-portraits.json');

// In-memory cache
let portraitCache: Record<string, string> = {};
let initialized = false;
let pendingUpdates = false;

/**
 * Force reload the cache from disk.
 * Useful after batch updates to ensure fresh data.
 */
export async function reloadCache(): Promise<void> {
  initialized = false;
  await loadCache();
}

/**
 * Load the portrait cache from disk.
 * Called automatically on first use.
 */
async function loadCache(): Promise<void> {
  if (initialized) return;

  try {
    const content = await fs.readFile(CACHE_FILE, 'utf-8');
    portraitCache = JSON.parse(content);
    logger.info(`Loaded ${Object.keys(portraitCache).length} character portrait mappings from cache`);
    initialized = true;
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      logger.info('No character portrait cache found, starting fresh');
      portraitCache = {};
      initialized = true;
    } else {
      logger.error('Error loading character portrait cache:', error);
      portraitCache = {};
      initialized = true;
    }
  }
}

/**
 * Save the portrait cache to disk.
 */
async function saveCache(): Promise<void> {
  try {
    // Ensure data directory exists
    const dataDir = join(process.cwd(), 'data');
    await fs.mkdir(dataDir, { recursive: true });

    // Sort keys for consistent output
    const sorted: Record<string, string> = {};
    for (const key of Object.keys(portraitCache).sort()) {
      sorted[key] = portraitCache[key];
    }

    await fs.writeFile(CACHE_FILE, JSON.stringify(sorted, null, 2), 'utf-8');
    logger.debug(`Saved ${Object.keys(portraitCache).length} character portrait mappings to cache`);
    pendingUpdates = false;
  } catch (error) {
    logger.error('Error saving character portrait cache:', error);
  }
}

/**
 * Get the portrait URL for a character by baseId.
 * Uses the cached mapping for known characters, falls back to the standard pattern.
 */
export async function getCharacterPortraitUrl(baseId: string): Promise<string> {
  await loadCache();

  if (portraitCache[baseId]) {
    return portraitCache[baseId];
  }

  // Fallback to the standard pattern (works for some characters)
  return `https://game-assets.swgoh.gg/textures/tex.charui_${baseId.toLowerCase()}.png`;
}

/**
 * Synchronous version for use in HTML templates where async isn't practical.
 * Must be called after ensureInitialized().
 */
export function getCharacterPortraitUrlSync(baseId: string): string {
  if (portraitCache[baseId]) {
    return portraitCache[baseId];
  }
  return `https://game-assets.swgoh.gg/textures/tex.charui_${baseId.toLowerCase()}.png`;
}

/**
 * Ensure the cache is loaded. Call this at startup.
 */
export async function ensureInitialized(): Promise<void> {
  await loadCache();
}

/**
 * Update the cache with a new portrait URL.
 * Call this when scraping discovers a new character or updated URL.
 */
export async function updatePortraitUrl(baseId: string, portraitUrl: string): Promise<void> {
  await loadCache();

  // Accept any portrait URL that looks valid
  if (!portraitUrl || (!portraitUrl.includes('charui') && !portraitUrl.includes('portrait') && !portraitUrl.startsWith('http'))) {
    return;
  }

  // Check if this is a new or changed mapping
  if (portraitCache[baseId] !== portraitUrl) {
    portraitCache[baseId] = portraitUrl;
    pendingUpdates = true;
    logger.debug(`Updated portrait URL for ${baseId}`);
  }
}

/**
 * Batch update multiple portrait URLs.
 * More efficient than calling updatePortraitUrl repeatedly.
 */
export async function batchUpdatePortraitUrls(mappings: Array<{ baseId: string; portraitUrl: string | null }>): Promise<void> {
  await loadCache();

  let updated = 0;
  for (const { baseId, portraitUrl } of mappings) {
    // Accept any portrait URL that looks valid (contains image-related keywords or is a full URL)
    if (baseId && portraitUrl && (
      portraitUrl.includes('charui') || 
      portraitUrl.includes('portrait') || 
      portraitUrl.includes('character') ||
      portraitUrl.startsWith('http')
    )) {
      if (portraitCache[baseId] !== portraitUrl) {
        portraitCache[baseId] = portraitUrl;
        updated++;
      }
    }
  }

  if (updated > 0) {
    pendingUpdates = true;
    logger.info(`Updated ${updated} character portrait mappings`);
    // Auto-save after batch update
    await saveCache();
  }
}

/**
 * Flush any pending updates to disk.
 * Call this periodically or on shutdown.
 */
export async function flushCache(): Promise<void> {
  if (pendingUpdates) {
    await saveCache();
  }
}

/**
 * Get the total number of cached portrait URLs.
 */
export function getCacheSize(): number {
  return Object.keys(portraitCache).length;
}
