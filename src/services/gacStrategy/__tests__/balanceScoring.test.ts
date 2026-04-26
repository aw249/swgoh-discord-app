import {
  confidenceMultiplier,
  CONFIDENCE_FLOOR,
  MAX_SEEN_OFFENSE,
} from '../balanceScoring';

describe('confidenceMultiplier', () => {
  it('returns the floor for null seen count', () => {
    expect(confidenceMultiplier(null)).toBeCloseTo(CONFIDENCE_FLOOR, 2);
  });

  it('returns the floor for zero seen count', () => {
    expect(confidenceMultiplier(0)).toBeCloseTo(CONFIDENCE_FLOOR, 2);
  });

  it('returns the floor for negative seen count (defensive)', () => {
    expect(confidenceMultiplier(-1)).toBeCloseTo(CONFIDENCE_FLOOR, 2);
  });

  it('ramps to ~0.65 at 100 seen', () => {
    expect(confidenceMultiplier(100)).toBeCloseTo(0.65, 1);
  });

  it('ramps to ~0.83 at 1000 seen', () => {
    expect(confidenceMultiplier(1000)).toBeCloseTo(0.83, 1);
  });

  it('reaches 1.0 at MAX_SEEN_OFFENSE', () => {
    expect(confidenceMultiplier(MAX_SEEN_OFFENSE)).toBeCloseTo(1.0, 2);
  });

  it('caps at 1.0 for very large seen counts', () => {
    expect(confidenceMultiplier(1_000_000)).toBeCloseTo(1.0, 2);
  });
});

import { offenseViability } from '../balanceScoring';
import { MatchedCounterSquad } from '../../../types/gacStrategyTypes';

const makeCounter = (overrides: Partial<MatchedCounterSquad> = {}): MatchedCounterSquad => ({
  defense: { leader: { baseId: 'OPP_LEADER', relicLevel: null, portraitUrl: null }, members: [] },
  offense: { leader: { baseId: 'YOU_LEADER', relicLevel: null, portraitUrl: null }, members: [] },
  winPercentage: 80,
  adjustedWinPercentage: null,
  seenCount: 1000,
  avgBanners: 60,
  relicDelta: null,
  worstCaseRelicDelta: null,
  bestCaseRelicDelta: null,
  keyMatchups: null,
  alternatives: [],
  ...overrides,
});

describe('offenseViability', () => {
  it('returns 0 when winPercentage is null', () => {
    const c = makeCounter({ winPercentage: null });
    expect(offenseViability(c, '5v5')).toBe(0);
  });

  it('returns 0 when avgBanners is null', () => {
    const c = makeCounter({ avgBanners: null });
    expect(offenseViability(c, '5v5')).toBe(0);
  });

  it('combines win, banners, and seen for 5v5', () => {
    const c = makeCounter({ winPercentage: 80, avgBanners: 60, seenCount: 1000 });
    // 80 × (60/69) × 0.825 ≈ 57.4
    expect(offenseViability(c, '5v5')).toBeCloseTo(57.4, 1);
  });

  it('uses 3v3 max banners when format is 3v3', () => {
    const c = makeCounter({ winPercentage: 80, avgBanners: 60, seenCount: 1000 });
    // 80 × (60/63) × 0.825 ≈ 62.9
    expect(offenseViability(c, '3v3')).toBeCloseTo(62.9, 1);
  });

  it('caps avgBanners at maxBannersForFormat (no over-100% credit)', () => {
    const c = makeCounter({ winPercentage: 80, avgBanners: 200, seenCount: 1000 });
    // (200/69) capped to 1.0 → 80 × 1.0 × 0.825 ≈ 66.0
    expect(offenseViability(c, '5v5')).toBeCloseTo(66.0, 1);
  });

  it('prefers adjustedWinPercentage when set', () => {
    const c = makeCounter({ winPercentage: 100, adjustedWinPercentage: 60, avgBanners: 60, seenCount: 1000 });
    // Uses 60, not 100 → 60 × (60/69) × 0.825 ≈ 43.0
    expect(offenseViability(c, '5v5')).toBeCloseTo(43.0, 1);
  });
});
