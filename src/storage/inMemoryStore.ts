export interface PlayerRegistration {
  allyCode: string;
  registeredAt: string;
  legacy?: true;
}

export interface PlayerStore {
  registerPlayer(discordUserId: string, allyCode: string): Promise<void>;
  getAllyCode(discordUserId: string): Promise<string | null>;
  removePlayer(discordUserId: string): Promise<void>;
  getAllAllyCodes?(): Promise<string[]>;
  getRegistration?(discordUserId: string): Promise<PlayerRegistration | null>;
}

class InMemoryPlayerStore implements PlayerStore {
  private readonly players: Map<string, string> = new Map();

  async registerPlayer(discordUserId: string, allyCode: string): Promise<void> {
    this.players.set(discordUserId, allyCode);
  }

  async getAllyCode(discordUserId: string): Promise<string | null> {
    return this.players.get(discordUserId) || null;
  }

  async removePlayer(discordUserId: string): Promise<void> {
    this.players.delete(discordUserId);
  }
}

export const playerStore: PlayerStore = new InMemoryPlayerStore();

