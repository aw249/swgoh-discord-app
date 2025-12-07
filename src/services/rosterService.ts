import { SwgohApiClient, SwgohPlayer } from '../integrations/swgohApi';

export interface RosterSummary {
  allyCode: string;
  playerName: string;
  galacticPower: number;
  galacticLegends: number;
  keySquads: string[];
}

export class RosterService {
  constructor(private readonly apiClient: SwgohApiClient) {}

  async getRosterSummary(allyCode: string): Promise<RosterSummary> {
    // TODO: Implement actual roster analysis
    // For now, return a mock summary
    const player = await this.apiClient.getPlayer(allyCode);

    return {
      allyCode: player.allyCode,
      playerName: player.name,
      galacticPower: player.galacticPower,
      galacticLegends: 0, // TODO: Calculate from units
      keySquads: [] // TODO: Identify key squads
    };
  }
}

