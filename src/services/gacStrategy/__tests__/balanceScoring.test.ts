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

import { defenseViability, DefenseScoreInput } from '../balanceScoring';

const makeDef = (overrides: Partial<DefenseScoreInput> = {}): DefenseScoreInput => ({
  holdPercentage: 30,
  seenCount: 5000,
  ...overrides,
});

describe('defenseViability', () => {
  it('returns 0 when holdPercentage is null', () => {
    expect(defenseViability(makeDef({ holdPercentage: null }))).toBe(0);
  });

  it('combines hold and seen confidence', () => {
    // 30 × confidenceMultiplier(5000) ≈ 30 × 0.945 ≈ 28.4
    expect(defenseViability(makeDef({ holdPercentage: 30, seenCount: 5000 }))).toBeCloseTo(28.4, 1);
  });

  it('uses confidence floor for null seen', () => {
    // 30 × 0.30 = 9
    expect(defenseViability(makeDef({ holdPercentage: 30, seenCount: null }))).toBeCloseTo(9, 1);
  });
});

import { bestAvailableAlt } from '../balanceScoring';

describe('bestAvailableAlt', () => {
  it('returns viability 0 and null alt when alternatives is empty', () => {
    const c = makeCounter({ alternatives: [] });
    expect(bestAvailableAlt(c, new Set(), '5v5')).toEqual({ alt: null, viability: 0 });
  });

  it('returns the highest-viability alternative whose units are all available', () => {
    const altA = makeCounter({
      offense: { leader: { baseId: 'A', relicLevel: null, portraitUrl: null }, members: [{ baseId: 'A2', relicLevel: null, portraitUrl: null }] },
      winPercentage: 70,
    });
    const altB = makeCounter({
      offense: { leader: { baseId: 'B', relicLevel: null, portraitUrl: null }, members: [{ baseId: 'B2', relicLevel: null, portraitUrl: null }] },
      winPercentage: 90,
    });
    const c = makeCounter({ alternatives: [altA, altB] });
    const result = bestAvailableAlt(c, new Set(), '5v5');
    expect(result.alt).toBe(altB);
    expect(result.viability).toBeGreaterThan(0);
  });

  it('skips alternatives whose leader is in claimedChars', () => {
    const altA = makeCounter({
      offense: { leader: { baseId: 'A', relicLevel: null, portraitUrl: null }, members: [] },
      winPercentage: 70,
    });
    const altB = makeCounter({
      offense: { leader: { baseId: 'B', relicLevel: null, portraitUrl: null }, members: [] },
      winPercentage: 90,
    });
    const c = makeCounter({ alternatives: [altA, altB] });
    const result = bestAvailableAlt(c, new Set(['B']), '5v5');
    expect(result.alt).toBe(altA);
  });

  it('skips alternatives whose members are in claimedChars', () => {
    const altA = makeCounter({
      offense: { leader: { baseId: 'A', relicLevel: null, portraitUrl: null }, members: [{ baseId: 'M1', relicLevel: null, portraitUrl: null }] },
      winPercentage: 70,
    });
    const c = makeCounter({ alternatives: [altA] });
    const result = bestAvailableAlt(c, new Set(['M1']), '5v5');
    expect(result.alt).toBeNull();
    expect(result.viability).toBe(0);
  });

  it('skips alternatives with null offense leader', () => {
    const altA = makeCounter({
      offense: { leader: { baseId: '', relicLevel: null, portraitUrl: null }, members: [] },
      winPercentage: 70,
    });
    const c = makeCounter({ alternatives: [altA] });
    expect(bestAvailableAlt(c, new Set(), '5v5')).toEqual({ alt: null, viability: 0 });
  });
});
