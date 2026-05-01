import { countGuildGalacticLegends } from '../../guildInsights/glCount';
import { SwgohGgFullPlayerResponse } from '../../../integrations/swgohGgApi';
import { GameDataService } from '../../gameDataService';

function p(name: string, units: Array<{ id: string; rarity?: number }>): SwgohGgFullPlayerResponse {
  return {
    data: {
      ally_code: 0, name, level: 85, galactic_power: 0, character_galactic_power: 0,
      ship_galactic_power: 0, skill_rating: 0, league_name: '', guild_name: '', last_updated: '',
    },
    units: units.map(u => ({
      data: {
        base_id: u.id, name: u.id, gear_level: 13, level: 85, power: 0,
        rarity: u.rarity ?? 7, stats: {}, relic_tier: 8, is_galactic_legend: false,
        combat_type: 1, mod_set_ids: [], zeta_abilities: [], omicron_abilities: [],
      },
    })),
    mods: [],
  };
}

describe('countGuildGalacticLegends', () => {
  beforeEach(() => GameDataService.resetInstance());

  it('returns total=0 when gameDataService is not ready', () => {
    const roster = new Map([['m1', p('Alice', [{ id: 'GLREY' }])]]);
    expect(countGuildGalacticLegends(roster).total).toBe(0);
  });

  it('counts each 7-star GL once per owner', () => {
    const svc = GameDataService.getInstance();
    (svc as unknown as { initialized: boolean }).initialized = true;
    (svc as unknown as { lastUpdate: Date }).lastUpdate = new Date();
    jest.spyOn(svc, 'isGalacticLegend').mockImplementation(id => id.startsWith('GL'));
    jest.spyOn(svc, 'getUnitName').mockImplementation(id => id);

    const roster = new Map([
      ['m1', p('Alice', [{ id: 'GLREY' }, { id: 'JEDIMASTERKENOBI' }])],
      ['m2', p('Bob',   [{ id: 'GLREY' }])],
      ['m3', p('Cara',  [{ id: 'GLLEIA' }])],
    ]);
    const out = countGuildGalacticLegends(roster);
    expect(out.total).toBe(3);
    expect(out.topByCount[0]).toEqual({ baseId: 'GLREY', unitName: 'GLREY', count: 2 });
  });

  it('excludes non-7-star ownership from the count', () => {
    const svc = GameDataService.getInstance();
    (svc as unknown as { initialized: boolean }).initialized = true;
    (svc as unknown as { lastUpdate: Date }).lastUpdate = new Date();
    jest.spyOn(svc, 'isGalacticLegend').mockReturnValue(true);
    jest.spyOn(svc, 'getUnitName').mockImplementation(id => id);

    const roster = new Map([
      ['m1', p('Alice', [{ id: 'GLREY', rarity: 6 }])],
    ]);
    expect(countGuildGalacticLegends(roster).total).toBe(0);
  });
});
