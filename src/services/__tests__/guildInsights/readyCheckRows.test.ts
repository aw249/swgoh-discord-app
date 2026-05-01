import { buildReadyCheckRows } from '../../guildInsights/readyCheckRows';
import { SwgohGgFullPlayerResponse } from '../../../integrations/swgohGgApi';

// Helper: rawRelic 12 = display R10, rawRelic 11 = R9, rawRelic 5 = R3, etc.
function p(name: string, units: Array<{ id: string; rawRelic: number; gear?: number }>): SwgohGgFullPlayerResponse {
  return {
    data: {
      ally_code: 0, name, level: 85, galactic_power: 0, character_galactic_power: 0,
      ship_galactic_power: 0, skill_rating: 0, league_name: '', guild_name: '', last_updated: '',
    },
    units: units.map(u => ({
      data: {
        base_id: u.id, name: u.id, gear_level: u.gear ?? 13, level: 85, power: 0,
        rarity: 7, stats: {}, relic_tier: u.rawRelic, is_galactic_legend: false,
        combat_type: 1, mod_set_ids: [], zeta_abilities: [], omicron_abilities: [],
      },
    })),
    mods: [],
  };
}

describe('buildReadyCheckRows', () => {
  it('omits members below display minRelic (5)', () => {
    const roster = new Map([
      // Alice: rawRelic 7 → display R5 — qualifies
      ['m1', p('Alice', [{ id: 'GLREY', rawRelic: 7 }])],
      // Bob: rawRelic 5 → display R3 — does not qualify
      ['m2', p('Bob',   [{ id: 'GLREY', rawRelic: 5 }])],
    ]);
    expect(buildReadyCheckRows(roster, 'GLREY', 5).map(r => r.playerName)).toEqual(['Alice']);
  });

  it('sorts qualifying rows by display relic tier desc', () => {
    const roster = new Map([
      // raw 9 → R7
      ['m1', p('A', [{ id: 'GLREY', rawRelic: 9 }])],
      // raw 12 → R10 (max)
      ['m2', p('B', [{ id: 'GLREY', rawRelic: 12 }])],
      // raw 10 → R8
      ['m3', p('C', [{ id: 'GLREY', rawRelic: 10 }])],
    ]);
    expect(buildReadyCheckRows(roster, 'GLREY', 5).map(r => r.playerName)).toEqual(['B', 'C', 'A']);
  });

  it('includeMissing=true appends below-min and unowned members marked found=false', () => {
    const roster = new Map([
      ['m1', p('A', [{ id: 'GLREY', rawRelic: 9 }])], // R7 qualifies
      ['m2', p('B', [])],                              // unit not unlocked
    ]);
    const rows = buildReadyCheckRows(roster, 'GLREY', 5, { includeMissing: true });
    expect(rows.map(r => r.playerName)).toEqual(['A', 'B']);
    expect(rows[1].found).toBe(false);
  });

  it('a unit owned but pre-G13 has display 0 and does not qualify at minRelic >= 1', () => {
    const roster = new Map([
      ['m1', p('Alice', [{ id: 'GLREY', rawRelic: 5, gear: 12 }])], // pre-G13 → display null → 0
    ]);
    expect(buildReadyCheckRows(roster, 'GLREY', 1)).toEqual([]);
  });
});
