import { accumulateComlinkAffixStats, computeStatMagnitude } from '../../datacronAllocator/cronStats';

describe('accumulateComlinkAffixStats', () => {
  it('aggregates percentage stats and formats them with % suffix', () => {
    // Two tiers contribute Crit Damage (statType 16) at 20M + 5M = 25M raw → 25%.
    const result = accumulateComlinkAffixStats(
      [
        { statType: 16, statValue: '20000000', targetRule: '' },
        { statType: 16, statValue: '5000000',  targetRule: '' },
      ],
      2
    );
    expect(result).toEqual([{ name: 'Crit Dam', displayValue: '+25.00%', value: 25 }]);
  });

  it('skips ability tiers (statValue=0 with a targetRule)', () => {
    const result = accumulateComlinkAffixStats(
      [
        { statType: 16, statValue: '20000000', targetRule: '' },
        { statType: 1,  statValue: '0',        targetRule: 'target_datacron_darkside' },
        { statType: 17, statValue: '50000000', targetRule: '' },
      ],
      3
    );
    // Only the two stat tiers contribute. Order preserved.
    expect(result).toEqual([
      { name: 'Crit Dam', displayValue: '+20.00%', value: 20 },
      { name: 'Potency',  displayValue: '+50.00%', value: 50 },
    ]);
  });

  it('only counts up to populatedAffixCount tiers (unrolled tiers ignored)', () => {
    const result = accumulateComlinkAffixStats(
      [
        { statType: 16, statValue: '20000000', targetRule: '' },
        { statType: 17, statValue: '50000000', targetRule: '' },
        { statType: 48, statValue: '90000000', targetRule: '' }, // tier 3 — should be ignored
      ],
      2
    );
    expect(result).toEqual([
      { name: 'Crit Dam', displayValue: '+20.00%', value: 20 },
      { name: 'Potency',  displayValue: '+50.00%', value: 50 },
    ]);
  });

  it('formats Speed (statType 5) as a flat number', () => {
    const result = accumulateComlinkAffixStats(
      [{ statType: 5, statValue: '20000000', targetRule: '' }],
      1
    );
    expect(result).toEqual([{ name: 'Speed', displayValue: '+20', value: 20 }]);
  });

  it('falls back to "Stat <id>" for unknown stat types', () => {
    const result = accumulateComlinkAffixStats(
      [{ statType: 999, statValue: '12345', targetRule: '' }],
      1
    );
    expect(result[0].name).toBe('Stat 999');
  });

  it('returns empty array when there are no populated stat tiers', () => {
    expect(accumulateComlinkAffixStats([], 0)).toEqual([]);
  });
});

describe('computeStatMagnitude', () => {
  it('returns 0 for an empty stat list', () => {
    expect(computeStatMagnitude([])).toBe(0);
  });

  it('sums absolute values across all stats', () => {
    expect(computeStatMagnitude([
      { name: 'Crit Dam',  displayValue: '+25.00%', value: 25 },
      { name: 'Armor Pen', displayValue: '+15.00%', value: 15 },
      { name: 'Speed',     displayValue: '+20',     value: 20 },
    ])).toBe(60);
  });

  it('uses absolute value so debuff stats still contribute their magnitude', () => {
    expect(computeStatMagnitude([
      { name: 'Crit Dam', displayValue: '-10.00%', value: -10 },
      { name: 'Speed',    displayValue: '+20',     value: 20 },
    ])).toBe(30);
  });
});
