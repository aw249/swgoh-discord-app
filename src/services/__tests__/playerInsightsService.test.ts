import samplePlayer from './fixtures/samplePlayer.json';
import { PlayerInsightsService } from '../playerInsightsService';
import { GameDataService, JourneyRequirement } from '../gameDataService';
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
  beforeEach(() => GameDataService.resetInstance());

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

  describe('getJourneyReady', () => {
    function fakeReady(req?: JourneyRequirement): void {
      const gd = GameDataService.getInstance();
      (gd as unknown as { initialized: boolean }).initialized = true;
      (gd as unknown as { lastUpdate: Date }).lastUpdate = new Date();
      jest.spyOn(gd, 'getUnitName').mockImplementation(id => id);
      jest.spyOn(gd, 'getJourneyRequirement').mockReturnValue(req ?? null);
    }

    it('returns no-journey-data when gameDataService is not ready', async () => {
      const svc = new PlayerInsightsService(makeClient() as never);
      const out = await svc.getJourneyReady('123456789', 'LORDVADER');
      expect(out.kind).toBe('no-journey-data');
    });

    it('returns unknown-gl when journey requirement is not in the cache', async () => {
      fakeReady(undefined);
      const svc = new PlayerInsightsService(makeClient() as never);
      const out = await svc.getJourneyReady('123456789', 'LORDVADER');
      expect(out.kind).toBe('unknown-gl');
    });

    it('returns ok with the JourneyReadyResult when the requirement exists', async () => {
      fakeReady({
        glBaseId: 'LORDVADER',
        prerequisites: [{ baseId: 'GLREY', kind: 'relic', value: 5 }],
      });
      const svc = new PlayerInsightsService(makeClient() as never);
      const out = await svc.getJourneyReady('123456789', 'LORDVADER');
      expect(out.kind).toBe('ok');
      if (out.kind === 'ok') {
        expect(out.result.glBaseId).toBe('LORDVADER');
        expect(out.result.totalCount).toBe(1);
      }
    });
  });
});
