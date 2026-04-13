import { buildCharacterStatsMap, CharacterStats } from '../rosterUtils';

// Minimal mock that matches the SwgohGgFullPlayerResponse shape
function makeRoster(units: Array<{
  base_id: string;
  combat_type: number;
  stats?: Record<string, number>;
  gear_level?: number;
  relic_tier?: number | null;
  name?: string;
}>) {
  return {
    units: units.map(u => ({
      data: {
        base_id: u.base_id,
        combat_type: u.combat_type,
        stats: u.stats || {},
        gear_level: u.gear_level ?? 13,
        relic_tier: u.relic_tier ?? 9,
        name: u.name || u.base_id,
        power: 30000,
      }
    }))
  } as any;
}

describe('buildCharacterStatsMap', () => {
  it('should build a stats map from a roster with characters', () => {
    const roster = makeRoster([
      { base_id: 'VADER', combat_type: 1, stats: { '5': 210, '1': 65000, '28': 120000 }, gear_level: 13, relic_tier: 9 },
      { base_id: 'PALPATINE', combat_type: 1, stats: { '5': 305, '1': 48000, '28': 89000 }, gear_level: 13, relic_tier: 7 },
    ]);

    const result = buildCharacterStatsMap(roster);

    expect(result.size).toBe(2);

    const vader = result.get('VADER')!;
    expect(vader.speed).toBe(210);
    expect(vader.health).toBe(65);
    expect(vader.protection).toBe(120);
    expect(vader.relic).toBe(7);
    expect(vader.gearLevel).toBe(13);
    expect(vader.levelLabel).toBe('R7');

    const palpatine = result.get('PALPATINE')!;
    expect(palpatine.speed).toBe(305);
    expect(palpatine.relic).toBe(5);
    expect(palpatine.levelLabel).toBe('R5');
  });

  it('should skip ships (combat_type !== 1)', () => {
    const roster = makeRoster([
      { base_id: 'YOURUNIT', combat_type: 1, stats: { '5': 100 } },
      { base_id: 'YOURSHIP', combat_type: 2, stats: { '5': 50 } },
    ]);

    const result = buildCharacterStatsMap(roster);

    expect(result.size).toBe(1);
    expect(result.has('YOURUNIT')).toBe(true);
    expect(result.has('YOURSHIP')).toBe(false);
  });

  it('should return an empty map for null/undefined roster', () => {
    expect(buildCharacterStatsMap(null as any).size).toBe(0);
    expect(buildCharacterStatsMap(undefined as any).size).toBe(0);
  });

  it('should return an empty map for roster with no units', () => {
    expect(buildCharacterStatsMap({ units: [] } as any).size).toBe(0);
    expect(buildCharacterStatsMap({} as any).size).toBe(0);
  });

  it('should handle missing stats gracefully', () => {
    const roster = makeRoster([
      { base_id: 'NOSTAT', combat_type: 1, stats: {}, gear_level: 10, relic_tier: null },
    ]);

    const result = buildCharacterStatsMap(roster);
    const unit = result.get('NOSTAT')!;

    expect(unit.speed).toBe(0);
    expect(unit.health).toBe(0);
    expect(unit.protection).toBe(0);
    expect(unit.relic).toBeNull();
    expect(unit.gearLevel).toBe(10);
    expect(unit.levelLabel).toBe('G10');
  });

  it('should handle pre-relic G13 units (relic_tier < 3)', () => {
    const roster = makeRoster([
      { base_id: 'FRESHG13', combat_type: 1, stats: { '5': 200 }, gear_level: 13, relic_tier: 1 },
    ]);

    const result = buildCharacterStatsMap(roster);
    const unit = result.get('FRESHG13')!;

    expect(unit.relic).toBe(0);
    expect(unit.levelLabel).toBe('R0');
  });
});
