/**
 * Centralised external API URLs.
 * Each endpoint can be overridden via environment variable.
 */
export const API_ENDPOINTS = {
  /** swgoh.gg REST API base (e.g. /player/{allyCode}/) */
  SWGOH_GG_API: process.env.SWGOH_GG_API_URL || 'https://swgoh.gg/api',

  /** swgoh.gg website base (for scraping GAC pages) */
  SWGOH_GG_BASE: process.env.SWGOH_GG_BASE_URL || 'https://swgoh.gg',

  /** Game asset CDN for character portraits and textures */
  GAME_ASSETS_BASE: process.env.GAME_ASSETS_BASE_URL || 'https://game-assets.swgoh.gg',

  /** Default Comlink server URL */
  COMLINK_DEFAULT: process.env.COMLINK_URL || 'http://localhost:3200',
} as const;
