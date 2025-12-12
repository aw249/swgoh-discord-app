import { SwgohGgApiClient, SwgohGgFullPlayerResponse } from '../integrations/swgohGgApi';
import { logger } from '../utils/logger';
import { GALACTIC_LEGEND_IDS } from '../config/gacConstants';

export interface RosterSummary {
  allyCode: string;
  playerName: string;
  galacticPower: number;
  characterGalacticPower: number;
  shipGalacticPower: number;
  galacticLegends: number;
  keySquads: string[];
}

export class RosterService {
  constructor(private readonly apiClient: SwgohGgApiClient) {}

  async getRosterSummary(allyCode: string): Promise<RosterSummary> {
    const playerRoster: SwgohGgFullPlayerResponse = await this.apiClient.getFullPlayer(allyCode);

    const galacticLegends = (playerRoster.units || []).filter(
      (unit) => unit.data.is_galactic_legend && (GALACTIC_LEGEND_IDS as readonly string[]).includes(unit.data.base_id)
    ).length;

    return {
      allyCode: playerRoster.data.ally_code.toString(),
      playerName: playerRoster.data.name,
      galacticPower: playerRoster.data.galactic_power,
      characterGalacticPower: playerRoster.data.character_galactic_power,
      shipGalacticPower: playerRoster.data.ship_galactic_power,
      galacticLegends: galacticLegends,
      keySquads: [] // TODO: Identify key squads
    };
  }
}
