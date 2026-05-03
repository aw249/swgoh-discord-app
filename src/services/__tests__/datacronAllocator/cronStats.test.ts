import { accumulateComlinkAffixStats } from '../../datacronAllocator/cronStats';

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
    expect(result).toEqual([{ name: 'Critical Damage', displayValue: '+25.00%' }]);
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
      { name: 'Critical Damage', displayValue: '+20.00%' },
      { name: 'Potency',         displayValue: '+50.00%' },
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
      { name: 'Critical Damage', displayValue: '+20.00%' },
      { name: 'Potency',         displayValue: '+50.00%' },
    ]);
  });

  it('formats Speed (statType 5) as a flat number', () => {
    const result = accumulateComlinkAffixStats(
      [{ statType: 5, statValue: '20000000', targetRule: '' }],
      1
    );
    expect(result).toEqual([{ name: 'Speed', displayValue: '+20' }]);
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
