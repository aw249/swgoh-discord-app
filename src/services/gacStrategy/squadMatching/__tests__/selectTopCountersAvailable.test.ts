import { selectTopCountersAvailable } from '../selectTopCountersAvailable';
import { GacCounterSquad } from '../../../../types/swgohGgTypes';
import { UniqueDefensiveSquad } from '../../../../types/gacStrategyTypes';
import { SwgohGgFullPlayerResponse } from '../../../../types/swgohGgTypes';

function counter(leader: string, members: string[]): GacCounterSquad {
  return {
    leader: { baseId: leader, name: leader, gearLevel: 13, relicTier: 8 },
    members: members.map(m => ({ baseId: m, name: m, gearLevel: 13, relicTier: 8 })),
    winPercentage: 75, seenCount: 100, avgBanners: 60,
  } as never;
}

function defence(leader: string, members: string[]): UniqueDefensiveSquad {
  return {
    leader: { baseId: leader, gearLevel: 13, relicLevel: 6, portraitUrl: null },
    members: members.map(m => ({ baseId: m, gearLevel: 13, relicLevel: 6, portraitUrl: null })),
  };
}

function rosterContaining(baseIds: string[]): SwgohGgFullPlayerResponse {
  return {
    units: baseIds.map(b => ({ data: { base_id: b, rarity: 7, gear_level: 13, relic_tier: 8, combat_type: 1 } })),
  } as never;
}

describe('selectTopCountersAvailable', () => {
  const def = defence('QUEEN_AMIDALA', ['ANAKIN', 'PADME', 'JAR_JAR', 'GUNGAN_BOOMA']);

  it('returns the top 5 counters when 6 candidates are available', () => {
    const counters = [
      counter('GLREY', ['EZRA', 'REY', 'BENSOLO', 'BB8']),
      counter('JKL',   ['HERMIT', 'GAS', 'CT5555', 'CT7567']),
      counter('PADME', ['JKA', 'AHSOKA', 'GK', 'YODA']),
      counter('SLKR',  ['HUX', 'SITHTROOPER', 'KYLO', 'FOST']),
      counter('TRAYA', ['SION', 'NIHILUS', 'DARTHSION', 'DARTHMALAK']),
      counter('JKR',   ['BASTILA', 'JOLEEBINDO', 'JEDIKNIGHTREVAN', 'JEDIKNIGHTGUARDIAN']),
    ];
    const allOwned = rosterContaining(counters.flatMap(c => [c.leader.baseId, ...c.members.map(m => m.baseId)]));
    expect(selectTopCountersAvailable(counters, def, allOwned, new Set())).toHaveLength(5);
  });

  it('excludes counters that contain a used character', () => {
    const counters = [
      counter('GLREY', ['EZRA', 'REY', 'BENSOLO', 'BB8']),
      counter('JKL',   ['HERMIT', 'GAS', 'CT5555', 'CT7567']),
      counter('SLKR',  ['HUX', 'SITHTROOPER', 'KYLO', 'FOST']),
    ];
    const roster = rosterContaining(counters.flatMap(c => [c.leader.baseId, ...c.members.map(m => m.baseId)]));
    const out = selectTopCountersAvailable(counters, def, roster, new Set(['REY']));
    expect(out.map(c => c.leader.baseId)).not.toContain('GLREY');
    expect(out).toHaveLength(2);
  });

  it('excludes counters whose leader is in the used set', () => {
    const counters = [
      counter('GLREY', ['EZRA', 'REY', 'BENSOLO', 'BB8']),
      counter('JKL',   ['HERMIT', 'GAS', 'CT5555', 'CT7567']),
    ];
    const roster = rosterContaining(counters.flatMap(c => [c.leader.baseId, ...c.members.map(m => m.baseId)]));
    expect(selectTopCountersAvailable(counters, def, roster, new Set(['GLREY'])).map(c => c.leader.baseId)).toEqual(['JKL']);
  });

  it('excludes counters with members the user does not own', () => {
    const counters = [counter('GLREY', ['EZRA', 'REY', 'BENSOLO', 'BB8'])];
    const partial = rosterContaining(['GLREY', 'EZRA']); // missing REY, BENSOLO, BB8
    expect(selectTopCountersAvailable(counters, def, partial, new Set())).toEqual([]);
  });

  it('returns [] when every candidate is filtered', () => {
    const counters = [
      counter('GLREY', ['EZRA', 'REY', 'BENSOLO', 'BB8']),
      counter('JKL',   ['HERMIT', 'GAS', 'CT5555', 'CT7567']),
    ];
    const roster = rosterContaining(counters.flatMap(c => [c.leader.baseId, ...c.members.map(m => m.baseId)]));
    expect(selectTopCountersAvailable(counters, def, roster, new Set(['REY', 'JKL']))).toEqual([]);
  });

  it('respects 3v3 sizing (counters of size <= 3)', () => {
    const counters = [
      counter('GLREY', ['EZRA',    'REY']),
      counter('JKL',   ['HERMIT',  'GAS']),
      counter('PADME', ['JKA',     'YODA']),
      counter('SLKR',  ['HUX',     'KYLO']),
      counter('TRAYA', ['SION',    'NIHILUS']),
      counter('JKR',   ['BASTILA', 'JOLEEBINDO']),
    ];
    const roster = rosterContaining(counters.flatMap(c => [c.leader.baseId, ...c.members.map(m => m.baseId)]));
    const def3v3 = { leader: def.leader, members: def.members.slice(0, 2) };
    const out = selectTopCountersAvailable(counters, def3v3, roster, new Set(), '3v3');
    expect(out.length).toBeLessThanOrEqual(5);
    for (const c of out) expect(c.members.length).toBe(2);
  });
});
