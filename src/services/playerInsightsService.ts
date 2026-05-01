import { CombinedApiClient } from '../integrations/comlink';
import { describeUnitReady, UnitReadyState } from './playerInsights';

export class PlayerInsightsService {
  constructor(private readonly client: CombinedApiClient) {}

  async getUnitReady(allyCode: string, baseId: string): Promise<UnitReadyState> {
    const player = await this.client.getFullPlayer(allyCode);
    return describeUnitReady(player, baseId);
  }
}
