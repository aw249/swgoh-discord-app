import samplePlayer from './fixtures/samplePlayer.json';
import { PlayerInsightsService } from '../playerInsightsService';
import { SwgohGgFullPlayerResponse } from '../../integrations/swgohGgApi';

interface MockClient {
  getFullPlayer: jest.Mock<Promise<SwgohGgFullPlayerResponse>, [string]>;
}

function makeClient(overrides: Partial<MockClient> = {}): MockClient {
  return {
    getFullPlayer: jest.fn().mockResolvedValue(samplePlayer),
    ...overrides,
  };
}

describe('PlayerInsightsService', () => {
  it('getUnitReady returns the unit ready state', async () => {
    const svc = new PlayerInsightsService(makeClient() as never);
    const out = await svc.getUnitReady('123456789', 'GLREY');
    expect(out.found).toBe(true);
    expect(out.baseId).toBe('GLREY');
  });

  it('getUnitReady forwards a missing unit cleanly', async () => {
    const svc = new PlayerInsightsService(makeClient() as never);
    const out = await svc.getUnitReady('123456789', 'NOT_A_UNIT');
    expect(out.found).toBe(false);
  });
});
