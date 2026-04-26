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
