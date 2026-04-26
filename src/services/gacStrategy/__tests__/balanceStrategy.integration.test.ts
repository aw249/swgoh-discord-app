import { balanceOffenseAndDefense } from '../balanceStrategy';
import { MatchedCounterSquad, UniqueDefensiveSquad } from '../../../types/gacStrategyTypes';

const mkUnit = (id: string) => ({ baseId: id, relicLevel: 7, portraitUrl: null });

const mkCounter = (
  off: string,
  def: string,
  win: number | null,
  banners: number,
  seen: number,
  alts: MatchedCounterSquad[] = []
): MatchedCounterSquad => ({
  defense: { leader: mkUnit(def), members: [mkUnit(`${def}_M1`), mkUnit(`${def}_M2`)] },
  offense: { leader: mkUnit(off), members: [mkUnit(`${off}_M1`), mkUnit(`${off}_M2`)] },
  winPercentage: win,
  adjustedWinPercentage: null,
  seenCount: seen,
  avgBanners: banners,
  relicDelta: null,
  worstCaseRelicDelta: null,
  bestCaseRelicDelta: null,
  keyMatchups: null,
  alternatives: alts,
});

const mkDefense = (leader: string, hold: number, seen: number) => ({
  squad: {
    leader: mkUnit(leader),
    members: [mkUnit(`${leader}_DM1`), mkUnit(`${leader}_DM2`)],
  } as UniqueDefensiveSquad,
  holdPercentage: hold,
  seenCount: seen,
  avgBanners: 0,
  score: hold,
  reason: 'test',
});

const noopCache = { get: () => undefined, set: () => undefined } as any;

describe('balanceOffenseAndDefense — balanced mode contention', () => {
  it('claims a leader for defense when an offense alt is still strong', async () => {
    // LV is leader of offense vs SLKR (95% win, 5000 seen) AND a top-hold defense candidate (33% hold)
    // Alternative: JMK vs SLKR (70% win, 5000 seen) — still wins
    // Expected: LV lands on defense; JMK takes the SLKR offense slot.
    const altJmk = mkCounter('JMK', 'SLKR', 70, 50, 5000);
    const offense = [
      mkCounter('LV', 'SLKR', 95, 60, 5000, [altJmk]),
    ];
    const defense = [
      mkDefense('LV', 33, 5000),
    ];
    const result = await balanceOffenseAndDefense(
      offense,
      defense,
      11,
      undefined,
      'balanced',
      undefined,
      '5v5',
      undefined,
      new Map(),
      noopCache
    );
    expect(result.balancedDefense.map(d => d.squad.leader.baseId)).toContain('LV');
    expect(result.balancedOffense.map(c => c.offense.leader.baseId)).toContain('JMK');
    expect(result.balancedOffense.map(c => c.offense.leader.baseId)).not.toContain('LV');
  });

  it('leaves a leader on offense when the alt is much weaker', async () => {
    // LV win=95% vs SLKR; alt DARTHREVAN win=30% vs SLKR; defense hold for LV is only 10%
    // Swap cost ≫ defense gain → LV stays on offense.
    const altDr = mkCounter('DARTHREVAN', 'SLKR', 30, 30, 1000);
    const offense = [
      mkCounter('LV', 'SLKR', 95, 60, 5000, [altDr]),
    ];
    const defense = [
      mkDefense('LV', 10, 1000),
    ];
    const result = await balanceOffenseAndDefense(
      offense,
      defense,
      11,
      undefined,
      'balanced',
      undefined,
      '5v5',
      undefined,
      new Map(),
      noopCache
    );
    expect(result.balancedOffense.map(c => c.offense.leader.baseId)).toContain('LV');
    expect(result.balancedDefense.map(d => d.squad.leader.baseId)).not.toContain('LV');
  });

  it('rejects defense squads that share characters with already-placed defense', async () => {
    // Defense 1: JABBA + members
    // Defense 2: BOBA leader + JABBA as member ← must be rejected (illegal in-game)
    const def1 = mkDefense('JABBA', 30, 5000);
    const def2 = {
      squad: {
        leader: mkUnit('BOBA'),
        members: [mkUnit('JABBA'), mkUnit('OTHER')],
      } as UniqueDefensiveSquad,
      holdPercentage: 25,
      seenCount: 5000,
      avgBanners: 0,
      score: 25,
      reason: 'test',
    };
    const result = await balanceOffenseAndDefense(
      [],
      [def1, def2],
      11,
      undefined,
      'balanced',
      undefined,
      '5v5',
      undefined,
      new Map(),
      noopCache
    );
    const allChars = new Set<string>();
    let dupes = 0;
    for (const d of result.balancedDefense) {
      const chars = [d.squad.leader.baseId, ...d.squad.members.map(m => m.baseId)];
      for (const c of chars) {
        if (allChars.has(c)) dupes++;
        allChars.add(c);
      }
    }
    expect(dupes).toBe(0);
  });
});
