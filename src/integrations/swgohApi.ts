import { SwgohGgApiClient, SwgohGgPlayerData } from './swgohGgApi';
import { logger } from '../utils/logger';

export interface SwgohUnit {
  id: string;
  name: string;
  rarity: number;
  level: number;
  gear: number;
  power: number;
}

export interface SwgohPlayer {
  allyCode: string;
  name: string;
  galacticPower: number;
  units: SwgohUnit[];
}

export class SwgohApiClient {
  private readonly swgohGgClient: SwgohGgApiClient;

  constructor(apiKey: string) {
    // apiKey is kept for future use with other APIs
    // For now, we use swgoh.gg which doesn't require an API key
    this.swgohGgClient = new SwgohGgApiClient();
  }

  async getPlayer(allyCode: string): Promise<SwgohPlayer> {
    try {
      const playerData = await this.swgohGgClient.getPlayer(allyCode);
      
      return {
        allyCode: playerData.ally_code.toString(),
        name: playerData.name,
        galacticPower: playerData.galactic_power,
        units: [] // Units would need to be parsed from the full player response
      };
    } catch (error) {
      logger.error(`Error fetching player data for ally code ${allyCode}:`, error);
      throw error;
    }
  }

  async getPlayerUnits(allyCode: string): Promise<SwgohUnit[]> {
    // TODO: Parse units from swgoh.gg player response
    // The full player response includes units array with detailed data
    return [];
  }
}

