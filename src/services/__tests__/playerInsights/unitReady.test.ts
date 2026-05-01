import samplePlayer from '../fixtures/samplePlayer.json';
import { SwgohGgFullPlayerResponse } from '../../../integrations/swgohGgApi';
import { describeUnitReady } from '../../playerInsights/unitReady';

const player = samplePlayer as unknown as SwgohGgFullPlayerResponse;

describe('describeUnitReady', () => {
  it('returns found=true with stars/gear/display-relic for an owned unit', () => {
    const r = describeUnitReady(player, 'GLREY');
    expect(r.found).toBe(true);
    expect(r.rarity).toBe(7);
    expect(r.gearLevel).toBe(13);
    expect(r.relicTier).toBe(10);
    expect(r.zetaCount).toBe(3);
    expect(r.omicronCount).toBe(1);
  });

  it('returns found=false with zeroed fields for a missing unit', () => {
    const r = describeUnitReady(player, 'NONEXISTENT_BASE_ID');
    expect(r.found).toBe(false);
    expect(r.rarity).toBe(0);
    expect(r.relicTier).toBe(0);
    expect(r.nextStepHint.toLowerCase()).toContain('not unlocked');
  });

  it('emits a "next gear" hint when below gear 13', () => {
    const r = describeUnitReady(player, 'BASTILASHAN');
    expect(r.gearLevel).toBe(12);
    expect(r.nextStepHint).toMatch(/Gear\s*13/);
    expect(r.relicTier).toBe(0);
  });

  it('emits a "next relic" hint when at gear 13 and relic < max', () => {
    const r = describeUnitReady(player, 'JEDIMASTERKENOBI');
    expect(r.gearLevel).toBe(13);
    expect(r.relicTier).toBe(9);
    expect(r.nextStepHint).toMatch(/Relic\s*10/);
  });

  it('returns "fully geared" when at gear 13 and relic at max', () => {
    const r = describeUnitReady(player, 'GLREY');
    expect(r.nextStepHint.toLowerCase()).toContain('fully');
  });
});
