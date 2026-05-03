import { allocateDatacrons, FILLER_THRESHOLD } from '../../datacronAllocator/allocate';
import { DatacronCandidate, SquadInput, DatacronTier } from '../../datacronAllocator/types';
import { ScopeResolver } from '../../datacronAllocator/scopeResolver';

function tier(index: number, opts: Partial<DatacronTier> = {}): DatacronTier {
  return {
    index, targetRuleId: opts.targetRuleId ?? '', abilityId: opts.abilityId ?? '',
    scopeTargetName: opts.scopeTargetName ?? '', hasData: opts.hasData ?? true,
  };
}

function cron(id: string, tier9: { targetRuleId?: string; scopeTargetName?: string } = {}): DatacronCandidate {
  const tiers = Array.from({ length: 9 }, (_, i) => tier(i + 1));
  if (tier9.targetRuleId) {
    tiers[8] = tier(9, { targetRuleId: tier9.targetRuleId, scopeTargetName: tier9.scopeTargetName ?? '' });
  }
  return {
    source: 'scraped', id, setId: 28, focused: true, currentTier: 9, name: id,
    tiers, boxImageUrl: '', calloutImageUrl: '', accumulatedStats: [],
  };
}

function squad(key: string, leader: string, members: string[]): SquadInput {
  return {
    squadKey: key, leaderBaseId: leader, memberBaseIds: [leader, ...members],
    memberCategories: new Map(), side: 'defense',
  };
}

function fakeResolver(charMap: Record<string, string>): ScopeResolver {
  const r = new ScopeResolver();
  jest.spyOn(r, 'resolveScopeTarget').mockImplementation((name: string) => {
    const k = name.toLowerCase();
    if (charMap[k]) return { kind: 'character', baseId: charMap[k] };
    return { kind: 'unknown' };
  });
  return r;
}

describe('allocateDatacrons', () => {
  it('assigns each squad its highest-scoring cron when uniqueness is not contested', () => {
    const squads = [squad('s-rey', 'GLREY', []), squad('s-vader', 'LORDVADER', [])];
    const crons = [
      cron('rey-cron', { targetRuleId: 'target_datacron_glrey', scopeTargetName: 'Rey' }),
      cron('vader-cron', { targetRuleId: 'target_datacron_lordvader', scopeTargetName: 'Vader' }),
    ];
    const r = fakeResolver({ rey: 'GLREY', vader: 'LORDVADER' });
    const result = allocateDatacrons(squads, crons, r);
    expect(result.assignments.get('s-rey')!.candidate.id).toBe('rey-cron');
    expect(result.assignments.get('s-vader')!.candidate.id).toBe('vader-cron');
    expect(result.assignments.get('s-rey')!.filler).toBe(false);
  });

  it('marks an assignment as filler when score is at or below FILLER_THRESHOLD', () => {
    const squads = [squad('s-empty', 'GENERIC', [])];
    const crons = [cron('any', {})]; // pure stat boosts → score = 6
    const result = allocateDatacrons(squads, crons, fakeResolver({}));
    const a = result.assignments.get('s-empty')!;
    expect(a).not.toBeNull();
    expect(a.filler).toBe(true);
  });

  it('leaves squads unassigned (null) when fewer crons than squads', () => {
    const squads = [squad('s1', 'A', []), squad('s2', 'B', []), squad('s3', 'C', [])];
    const crons = [cron('c1'), cron('c2')];
    const result = allocateDatacrons(squads, crons, fakeResolver({}));
    const nulls = [...result.assignments.values()].filter(a => a === null).length;
    expect(nulls).toBe(1);
    const ids = [...result.assignments.values()].filter(Boolean).map(a => a!.candidate.id);
    expect(new Set(ids).size).toBe(2); // unique
  });

  it('returns empty assignments for empty inputs', () => {
    const r = allocateDatacrons([], [], fakeResolver({}));
    expect(r.assignments.size).toBe(0);
    expect(r.scoreMatrix).toEqual([]);
  });

  it('exposes the score matrix in row-of-squad / col-of-cron order', () => {
    const squads = [squad('s1', 'A', []), squad('s2', 'B', [])];
    const crons = [cron('c1'), cron('c2')];
    const result = allocateDatacrons(squads, crons, fakeResolver({}));
    expect(result.scoreMatrix.length).toBe(2);
    expect(result.scoreMatrix[0].length).toBe(2);
  });

  it('avoids the greedy trap — picks globally-best assignment, not row-by-row', () => {
    const squads = [squad('s1', 'X', []), squad('s2', 'Y', [])];
    const crons = [
      cron('A', { targetRuleId: 'target_datacron_x', scopeTargetName: 'X' }),
      cron('B', { targetRuleId: 'target_datacron_y', scopeTargetName: 'Y' }),
    ];
    const r = fakeResolver({ x: 'X', y: 'Y' });
    const result = allocateDatacrons(squads, crons, r);
    expect(result.assignments.get('s1')!.candidate.id).toBe('A');
    expect(result.assignments.get('s2')!.candidate.id).toBe('B');
  });
});
