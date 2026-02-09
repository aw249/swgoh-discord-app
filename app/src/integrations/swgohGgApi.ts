/**
 * Main swgoh.gg API client that composes all specialized clients.
 * This provides a unified interface while keeping implementation modular.
 */
import { BrowserManager } from './swgohGg/browser';
import { GacBracketClient } from './swgohGg/gacBracketClient';
import { PlayerClient } from './swgohGg/playerClient';
import { GacHistoryClient } from './swgohGg/gacHistoryClient';
import { CountersClient } from './swgohGg/countersClient';
import { DefenseSquadsClient } from './swgohGg/defenseSquadsClient';

// Re-export types for convenience
export * from '../types/swgohGgTypes';

export class SwgohGgApiClient {
  private readonly browserManager: BrowserManager;
  private readonly gacBracketClient: GacBracketClient;
  private readonly playerClient: PlayerClient;
  private readonly gacHistoryClient: GacHistoryClient;
  private readonly countersClient: CountersClient;
  private readonly defenseSquadsClient: DefenseSquadsClient;

  constructor() {
    this.browserManager = new BrowserManager();
    this.gacBracketClient = new GacBracketClient(this.browserManager);
    this.playerClient = new PlayerClient(this.browserManager);
    this.gacHistoryClient = new GacHistoryClient(this.browserManager);
    this.countersClient = new CountersClient(this.browserManager);
    this.defenseSquadsClient = new DefenseSquadsClient(this.browserManager);
  }

  async close(): Promise<void> {
    await this.browserManager.close();
  }

  // GAC Bracket methods
  async getGacBracket(allyCode: string) {
    return this.gacBracketClient.getGacBracket(allyCode);
  }

  // Player methods
  async getPlayer(allyCode: string) {
    return this.playerClient.getPlayer(allyCode);
  }

  async getFullPlayer(allyCode: string) {
    return this.playerClient.getFullPlayer(allyCode);
  }

  // GAC History methods
  async getPlayerRecentGacDefensiveSquads(allyCode: string, format: string = '5v5', maxRounds = 4) {
    return this.gacHistoryClient.getPlayerRecentGacDefensiveSquads(allyCode, format, maxRounds);
  }

  // Counter methods
  async getCounterSquads(defensiveLeaderBaseId: string, seasonId?: string) {
    return this.countersClient.getCounterSquads(defensiveLeaderBaseId, seasonId);
  }

  // Defense Squads methods
  async getTopDefenseSquads(sortBy: 'percent' | 'count' | 'banners' = 'count', seasonId?: string, format?: string) {
    return this.defenseSquadsClient.getTopDefenseSquads(sortBy, seasonId, format);
  }
}
