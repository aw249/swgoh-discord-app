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

import { shouldDefenseClaim } from '../balanceScoring';

describe('shouldDefenseClaim', () => {
  it('claims when no offense slot uses the leader', () => {
    const result = shouldDefenseClaim('JABBA', 35, new Map(), new Set(), '5v5');
    expect(result.claim).toBe(true);
    expect(result.replacementCounter).toBeUndefined();
  });

  it('claims when defense viability >= offense swap cost', () => {
    // Primary offense: win=80, banners=60, seen=1000 → ~57.4
    // Alt: win=70, banners=55, seen=1000 → ~46.0
    // Swap cost: 57.4 - 46.0 = 11.4
    // Defense viability: 35 → claim wins
    const primary = makeCounter({
      offense: { leader: { baseId: 'JABBA', relicLevel: null, portraitUrl: null }, members: [] },
      winPercentage: 80, avgBanners: 60, seenCount: 1000,
      alternatives: [
        makeCounter({
          offense: { leader: { baseId: 'BOBA', relicLevel: null, portraitUrl: null }, members: [] },
          winPercentage: 70, avgBanners: 55, seenCount: 1000, alternatives: [],
        }),
      ],
    });
    const slotMap = new Map([['JABBA', primary]]);
    const result = shouldDefenseClaim('JABBA', 35, slotMap, new Set(), '5v5');
    expect(result.claim).toBe(true);
    expect(result.replacementCounter?.offense.leader.baseId).toBe('BOBA');
  });

  it('declines when defense viability < offense swap cost', () => {
    // Primary win=95, banners=65, seen=5000 → ~85
    // No alt → swap cost ≈ 85
    // Defense viability = 10 → decline
    const primary = makeCounter({
      offense: { leader: { baseId: 'JABBA', relicLevel: null, portraitUrl: null }, members: [] },
      winPercentage: 95, avgBanners: 65, seenCount: 5000, alternatives: [],
    });
    const slotMap = new Map([['JABBA', primary]]);
    const result = shouldDefenseClaim('JABBA', 10, slotMap, new Set(), '5v5');
    expect(result.claim).toBe(false);
  });

  it('does not claim when primary is speculative AND no alt exists', () => {
    // Primary win=null with no alt: contention has nothing to swap to. Keep
    // primary on offense — even a speculative match is more useful to the
    // user than an empty offense slot.
    const primary = makeCounter({
      offense: { leader: { baseId: 'BOBA', relicLevel: null, portraitUrl: null }, members: [] },
      winPercentage: null, avgBanners: 60, seenCount: 1000, alternatives: [],
    });
    const slotMap = new Map([['BOBA', primary]]);
    const result = shouldDefenseClaim('BOBA', 5, slotMap, new Set(), '5v5');
    expect(result.claim).toBe(false);
  });

  it('does not claim when no alt exists, even with positive defense gain', () => {
    // No alt to swap to → bail. Forcing offense to walk alternatives at the
    // call site would either find a weak alt or leave the slot empty.
    const primary = makeCounter({
      offense: { leader: { baseId: 'X', relicLevel: null, portraitUrl: null }, members: [] },
      winPercentage: 50, avgBanners: 30, seenCount: 100, alternatives: [],
    });
    const slotMap = new Map([['X', primary]]);
    const result = shouldDefenseClaim('X', 20, slotMap, new Set(), '5v5');
    expect(result.claim).toBe(false);
  });

  it('does not claim when the only alt has win < ALT_WIN_FLOOR', () => {
    // Alt exists but is a 30% match — forcing offense into that is worse
    // than keeping the primary on offense, regardless of defense gain.
    const weakAlt = makeCounter({
      offense: { leader: { baseId: 'WEAK', relicLevel: null, portraitUrl: null }, members: [] },
      winPercentage: 30, avgBanners: 40, seenCount: 1000,
    });
    const primary = makeCounter({
      offense: { leader: { baseId: 'STRONG', relicLevel: null, portraitUrl: null }, members: [] },
      winPercentage: 80, avgBanners: 60, seenCount: 5000,
      alternatives: [weakAlt],
    });
    const slotMap = new Map([['STRONG', primary]]);
    const result = shouldDefenseClaim('STRONG', 80, slotMap, new Set(), '5v5');
    expect(result.claim).toBe(false);
  });

  it('does not claim when the only alt has null win rate', () => {
    const nullWinAlt = makeCounter({
      offense: { leader: { baseId: 'UNKNOWN', relicLevel: null, portraitUrl: null }, members: [] },
      winPercentage: null, avgBanners: 50, seenCount: 1000,
    });
    const primary = makeCounter({
      offense: { leader: { baseId: 'STRONG', relicLevel: null, portraitUrl: null }, members: [] },
      winPercentage: 80, avgBanners: 60, seenCount: 5000,
      alternatives: [nullWinAlt],
    });
    const slotMap = new Map([['STRONG', primary]]);
    const result = shouldDefenseClaim('STRONG', 80, slotMap, new Set(), '5v5');
    expect(result.claim).toBe(false);
  });

  it('does not swap a high-confidence primary for a much weaker alt', () => {
    // Primary is 95% win — high confidence. Alt is 65% win — viable per
    // ALT_WIN_FLOOR but a 30-point drop. With ALT_WIN_DROP_LIMIT=20, bail.
    const weakerAlt = makeCounter({
      offense: { leader: { baseId: 'WEAKER', relicLevel: null, portraitUrl: null }, members: [] },
      winPercentage: 65, avgBanners: 60, seenCount: 5000,
    });
    const primary = makeCounter({
      offense: { leader: { baseId: 'STRONG', relicLevel: null, portraitUrl: null }, members: [] },
      winPercentage: 95, avgBanners: 65, seenCount: 5000,
      alternatives: [weakerAlt],
    });
    const slotMap = new Map([['STRONG', primary]]);
    const result = shouldDefenseClaim('STRONG', 80, slotMap, new Set(), '5v5');
    expect(result.claim).toBe(false);
  });

  it('does swap a high-confidence primary for a similarly-confident alt', () => {
    // Primary 95%, alt 80% (15-point drop) — within ALT_WIN_DROP_LIMIT, allow swap.
    const closeAlt = makeCounter({
      offense: { leader: { baseId: 'CLOSE', relicLevel: null, portraitUrl: null }, members: [] },
      winPercentage: 80, avgBanners: 60, seenCount: 5000,
    });
    const primary = makeCounter({
      offense: { leader: { baseId: 'STRONG', relicLevel: null, portraitUrl: null }, members: [] },
      winPercentage: 95, avgBanners: 65, seenCount: 5000,
      alternatives: [closeAlt],
    });
    const slotMap = new Map([['STRONG', primary]]);
    const result = shouldDefenseClaim('STRONG', 50, slotMap, new Set(), '5v5');
    expect(result.claim).toBe(true);
    expect(result.replacementCounter?.offense.leader.baseId).toBe('CLOSE');
  });

  it('never returns an alt whose leader matches the contested leader', () => {
    // Real-world bug: counter.alternatives can contain another comp led by the
    // same character (different teammates). When defense claims that character,
    // the alt is a no-op and offense ends up with no usable counter.
    // Expected: alt with same leader is excluded from the search.
    // Win rates kept within ALT_WIN_DROP_LIMIT so the swap is otherwise legal.
    const sameLeaderAlt = makeCounter({
      offense: { leader: { baseId: 'LV', relicLevel: null, portraitUrl: null }, members: [{ baseId: 'OTHER', relicLevel: null, portraitUrl: null }] },
      winPercentage: 85, avgBanners: 60, seenCount: 5000,
    });
    const realDifferentAlt = makeCounter({
      offense: { leader: { baseId: 'JMK', relicLevel: null, portraitUrl: null }, members: [] },
      winPercentage: 80, avgBanners: 60, seenCount: 5000,
    });
    const primary = makeCounter({
      offense: { leader: { baseId: 'LV', relicLevel: null, portraitUrl: null }, members: [] },
      winPercentage: 95, avgBanners: 60, seenCount: 5000,
      alternatives: [sameLeaderAlt, realDifferentAlt],
    });
    const slotMap = new Map([['LV', primary]]);
    // 95% primary, 80% JMK alt → 15-point drop, within ALT_WIN_DROP_LIMIT.
    // defenseV=50 high enough to claim past the (small) swap cost.
    const result = shouldDefenseClaim('LV', 50, slotMap, new Set(), '5v5');
    expect(result.claim).toBe(true);
    // Must not be the same-leader alt
    expect(result.replacementCounter?.offense.leader.baseId).not.toBe('LV');
    expect(result.replacementCounter?.offense.leader.baseId).toBe('JMK');
  });
});
