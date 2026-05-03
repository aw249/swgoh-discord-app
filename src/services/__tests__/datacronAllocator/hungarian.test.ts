import { hungarianMaximise } from '../../datacronAllocator/hungarian';

describe('hungarianMaximise', () => {
  it('handles a 1×1 matrix', () => {
    expect(hungarianMaximise([[42]])).toEqual([0]);
  });

  it('finds the optimal 2×2 assignment (avoids the greedy trap)', () => {
    // greedy would pick row0/col0 (10), then row1/col1 (1) = 11
    // optimal is row0/col1 (9), row1/col0 (8) = 17
    const m = [
      [10, 9],
      [8, 1],
    ];
    const out = hungarianMaximise(m);
    expect(out).toEqual([1, 0]);
  });

  it('handles a rectangular matrix with more cols than rows (cron-rich case)', () => {
    // 2 squads, 3 crons. Pick 2 of 3 to maximise sum.
    const m = [
      [5, 2, 9],
      [4, 8, 6],
    ];
    const assignments = hungarianMaximise(m);
    expect(assignments).toHaveLength(2);
    // best: r0→c2 (9), r1→c1 (8) = 17
    expect(assignments).toEqual([2, 1]);
  });

  it('handles a rectangular matrix with more rows than cols (cron-poor case)', () => {
    // 3 squads, 2 crons. Some squad gets -1.
    const m = [
      [10, 2],
      [4, 8],
      [3, 5],
    ];
    const assignments = hungarianMaximise(m);
    expect(assignments).toHaveLength(3);
    const used = assignments.filter(a => a !== -1);
    expect(used.length).toBe(2);
    expect(new Set(used).size).toBe(2); // unique cols
  });

  it('returns -1 for unassigned rows when there are zero columns', () => {
    expect(hungarianMaximise([[]])).toEqual([-1]);
  });

  it('returns [] for an empty matrix', () => {
    expect(hungarianMaximise([])).toEqual([]);
  });
});
