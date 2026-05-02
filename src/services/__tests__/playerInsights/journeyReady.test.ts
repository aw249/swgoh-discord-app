import { describeJourneyReady } from '../../playerInsights/journeyReady';
import { JourneyRequirement } from '../../gameDataService';
import { SwgohGgFullPlayerResponse } from '../../../integrations/swgohGgApi';

function p(units: Array<{ id: string; rarity?: number; gear?: number; rawRelic?: number }>): SwgohGgFullPlayerResponse {
  return {
    data: {
      ally_code: 0, name: 'Test', level: 85, galactic_power: 0,
      character_galactic_power: 0, ship_galactic_power: 0, skill_rating: 0,
      league_name: '', guild_name: '', last_updated: '',
    },
    units: units.map(u => ({
      data: {
        base_id: u.id, name: u.id, gear_level: u.gear ?? 13, level: 85, power: 0,
        rarity: u.rarity ?? 7, stats: {}, relic_tier: u.rawRelic ?? 0,
        is_galactic_legend: false, combat_type: 1,
        mod_set_ids: [], zeta_abilities: [], omicron_abilities: [],
      },
    })),
    mods: [],
  };
}

const req: JourneyRequirement = {
  glBaseId: 'LORDVADER',
  prerequisites: [
    { baseId: 'BADBATCHHUNTER', kind: 'relic', value: 5 },
    { baseId: 'BADBATCHTECH',   kind: 'relic', value: 5 },
    { baseId: 'PADMEAMIDALA',   kind: 'relic', value: 8 },
    { baseId: 'TUSKENRAIDER',   kind: 'star',  value: 7 },
    { baseId: 'CLONESERGEANTPHASE1', kind: 'star', value: 7 },
  ],
};

describe('describeJourneyReady', () => {
  it('returns alreadyUnlocked=true when GL is in roster at ★7', () => {
    const player = p([{ id: 'LORDVADER', rarity: 7, rawRelic: 12 }]);
    const r = describeJourneyReady(player, req, 'Lord Vader');
    expect(r.alreadyUnlocked).toBe(true);
  });

  it('returns alreadyUnlocked=false when GL is owned but below ★7 (impossible in-game but defensive)', () => {
    const player = p([{ id: 'LORDVADER', rarity: 6, rawRelic: 12 }]);
    expect(describeJourneyReady(player, req, 'LV').alreadyUnlocked).toBe(false);
  });

  it('marks ready when relic prereq met', () => {
    // BADBATCHHUNTER needs relic 5 → raw 7 = display 5. Set raw 7.
    const player = p([{ id: 'BADBATCHHUNTER', rarity: 7, gear: 13, rawRelic: 7 }]);
    const r = describeJourneyReady(player, req, 'LV');
    const hunter = r.prerequisites.find(x => x.baseId === 'BADBATCHHUNTER')!;
    expect(hunter.status).toBe('ready');
    expect(hunter.shortBy).toBe('');
  });

  it('marks short when relic below required', () => {
    // PADMEAMIDALA needs relic 8 (raw 10). Player at relic 5 (raw 7).
    const player = p([{ id: 'PADMEAMIDALA', rarity: 7, gear: 13, rawRelic: 7 }]);
    const padme = describeJourneyReady(player, req, 'LV').prerequisites
      .find(x => x.baseId === 'PADMEAMIDALA')!;
    expect(padme.status).toBe('short');
    expect(padme.shortBy).toBe('R5/8');
  });

  it('marks short when at ★7 but below G13', () => {
    const player = p([{ id: 'BADBATCHHUNTER', rarity: 7, gear: 12, rawRelic: 0 }]);
    const hunter = describeJourneyReady(player, req, 'LV').prerequisites
      .find(x => x.baseId === 'BADBATCHHUNTER')!;
    expect(hunter.status).toBe('short');
    expect(hunter.shortBy).toBe('G12/13');
  });

  it('marks understarred when below ★7 (regardless of req kind)', () => {
    const player = p([{ id: 'TUSKENRAIDER', rarity: 5 }]);
    const tusken = describeJourneyReady(player, req, 'LV').prerequisites
      .find(x => x.baseId === 'TUSKENRAIDER')!;
    expect(tusken.status).toBe('understarred');
    expect(tusken.shortBy).toBe('★5/7');
  });

  it('marks ready for star-only prereqs at ★7', () => {
    const player = p([{ id: 'TUSKENRAIDER', rarity: 7, gear: 1, rawRelic: 0 }]);
    const tusken = describeJourneyReady(player, req, 'LV').prerequisites
      .find(x => x.baseId === 'TUSKENRAIDER')!;
    // Star kind, requires ★7, has ★7 → ready (G1 ignored for star kind).
    expect(tusken.status).toBe('ready');
  });

  it('marks locked when unit is not in roster', () => {
    const cs = describeJourneyReady(p([]), req, 'LV').prerequisites
      .find(x => x.baseId === 'CLONESERGEANTPHASE1')!;
    expect(cs.status).toBe('locked');
    expect(cs.shortBy).toBe('Not unlocked');
  });

  it('counts ready prereqs in summary', () => {
    const player = p([
      { id: 'BADBATCHHUNTER', rarity: 7, gear: 13, rawRelic: 7 }, // R5 ready
      { id: 'BADBATCHTECH',   rarity: 7, gear: 13, rawRelic: 7 }, // R5 ready
      { id: 'PADMEAMIDALA',   rarity: 7, gear: 13, rawRelic: 5 }, // R3 short
      { id: 'TUSKENRAIDER',   rarity: 7 },                         // star ready
      // CLONESERGEANTPHASE1 absent → locked
    ]);
    const r = describeJourneyReady(player, req, 'LV');
    expect(r.readyCount).toBe(3);
    expect(r.totalCount).toBe(5);
  });
});
