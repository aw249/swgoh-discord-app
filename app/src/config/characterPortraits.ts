/**
 * Character Portrait URL utilities.
 * 
 * The actual mapping is stored in data/character-portraits.json and managed by
 * the characterPortraitCache storage module. This file provides a simple sync
 * interface for use in HTML template generation.
 */

import { getCharacterPortraitUrlSync, ensureInitialized } from '../storage/characterPortraitCache';

// Re-export the sync function for use in templates
export { getCharacterPortraitUrlSync as getCharacterPortraitUrl };

// Re-export initialization for startup
export { ensureInitialized as initializeCharacterPortraits };
