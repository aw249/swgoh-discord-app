import { PlayerStore } from '../storage/inMemoryStore';
import { normaliseAllyCode } from '../utils/allyCodeUtils';

export interface PlayerRegistration {
  discordUserId: string;
  allyCode: string;
}

export class PlayerService {
  constructor(private readonly store: PlayerStore) {}

  async registerPlayer(discordUserId: string, allyCode: string): Promise<void> {
    const numericAllyCode = normaliseAllyCode(allyCode);

    await this.store.registerPlayer(discordUserId, numericAllyCode);
  }

  async getAllyCode(discordUserId: string): Promise<string | null> {
    return await this.store.getAllyCode(discordUserId);
  }

  async isPlayerRegistered(discordUserId: string): Promise<boolean> {
    const allyCode = await this.getAllyCode(discordUserId);
    return allyCode !== null;
  }
}

