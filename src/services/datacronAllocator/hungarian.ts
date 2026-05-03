/**
 * Hungarian algorithm for maximum-weight assignment on a rectangular matrix.
 *
 * Returns an array `assignments` where `assignments[row] = col` (or -1 if the
 * row could not be assigned because cols < rows). Each col is used at most once.
 *
 * Pads to a square matrix with zero rows/cols and converts maximisation to
 * minimisation by subtracting from the matrix max. O(n^3) where n = max(rows, cols).
 */
export function hungarianMaximise(matrix: number[][]): number[] {
  const rows = matrix.length;
  if (rows === 0) return [];
  const cols = matrix[0].length;
  if (cols === 0) return new Array(rows).fill(-1);

  const n = Math.max(rows, cols);
  let max = 0;
  for (const row of matrix) for (const v of row) { if (v > max) max = v; }
  // Build square cost matrix (minimise). Padded rows/cols cost 0 (no preference).
  const cost: number[][] = [];
  for (let i = 0; i < n; i++) {
    const r: number[] = [];
    for (let j = 0; j < n; j++) {
      const v = i < rows && j < cols ? matrix[i][j] : 0;
      r.push(max - v);
    }
    cost.push(r);
  }

  // Standard O(n^3) Hungarian (Kuhn–Munkres) on a square cost matrix.
  const INF = Number.POSITIVE_INFINITY;
  const u: number[] = new Array(n + 1).fill(0);
  const v: number[] = new Array(n + 1).fill(0);
  const p: number[] = new Array(n + 1).fill(0);
  const way: number[] = new Array(n + 1).fill(0);

  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv: number[] = new Array(n + 1).fill(INF);
    const used: boolean[] = new Array(n + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = INF;
      let j1 = 0;
      for (let j = 1; j <= n; j++) {
        if (!used[j]) {
          const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
          if (cur < minv[j]) {
            minv[j] = cur;
            way[j] = j0;
          }
          if (minv[j] < delta) {
            delta = minv[j];
            j1 = j;
          }
        }
      }
      for (let j = 0; j <= n; j++) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else {
          minv[j] -= delta;
        }
      }
      j0 = j1;
    } while (p[j0] !== 0);

    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0 !== 0);
  }

  // Build row→col assignments. Skip padded rows; mark unfilled real rows as -1.
  const assignments: number[] = new Array(rows).fill(-1);
  for (let j = 1; j <= n; j++) {
    const i = p[j];
    if (i >= 1 && i <= rows && j <= cols) {
      assignments[i - 1] = j - 1;
    }
  }
  return assignments;
}
