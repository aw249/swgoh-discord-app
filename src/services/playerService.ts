import { PlayerStore } from '../storage/inMemoryStore';

export interface PlayerRegistration {
  discordUserId: string;
  allyCode: string;
}

export class PlayerService {
  constructor(private readonly store: PlayerStore) {}

  async registerPlayer(discordUserId: string, allyCode: string): Promise<void> {
    // Validate ally code format (should be numeric, typically 9 digits)
    const numericAllyCode = allyCode.replace(/-/g, '');
    if (!/^\d{9}$/.test(numericAllyCode)) {
      throw new Error('Invalid ally code format. Expected 9 digits (e.g., 123456789 or 123-456-789).');
    }

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

