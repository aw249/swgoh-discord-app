import { CombinedApiClient } from '../integrations/comlink';
import { describeUnitReady, describeJourneyReady, UnitReadyState, JourneyReadyResult } from './playerInsights';
import { GameDataService } from './gameDataService';

export type JourneyReadyOutcome =
  | { kind: 'ok'; result: JourneyReadyResult }
  | { kind: 'no-journey-data'; glBaseId: string }
  | { kind: 'unknown-gl'; glBaseId: string };

export class PlayerInsightsService {
  constructor(private readonly client: CombinedApiClient) {}

  async getUnitReady(allyCode: string, baseId: string): Promise<UnitReadyState> {
    const player = await this.client.getFullPlayer(allyCode);
    return describeUnitReady(player, baseId);
  }

  async getJourneyReady(allyCode: string, glBaseId: string): Promise<JourneyReadyOutcome> {
    const svc = GameDataService.getInstance();
    if (!svc.isReady()) {
      return { kind: 'no-journey-data', glBaseId };
    }

    const requirement = svc.getJourneyRequirement(glBaseId);
    if (!requirement) {
      // GL exists in unit data but no journey requirement was extracted (shouldn't happen
      // for current GLs, but a new/upcoming GL might lack one).
      return { kind: 'unknown-gl', glBaseId };
    }

    const player = await this.client.getFullPlayer(allyCode);
    const glName = svc.getUnitName(glBaseId);
    return { kind: 'ok', result: describeJourneyReady(player, requirement, glName) };
  }
}
