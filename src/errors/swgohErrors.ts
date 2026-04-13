/**
 * Custom error classes for SWGOH bot.
 * Replace string-based error classification with typed errors.
 */

export class CloudflareBlockError extends Error {
  constructor(message: string = 'Cloudflare challenge could not be resolved — please try again later') {
    super(message);
    this.name = 'CloudflareBlockError';
  }
}

export class NoActiveBracketError extends Error {
  constructor(message: string = 'No active GAC bracket found — player may not be in an active GAC event') {
    super(message);
    this.name = 'NoActiveBracketError';
  }
}

export class PlayerNotFoundError extends Error {
  constructor(message: string = 'Player not found. Please check the ally code.') {
    super(message);
    this.name = 'PlayerNotFoundError';
  }
}
