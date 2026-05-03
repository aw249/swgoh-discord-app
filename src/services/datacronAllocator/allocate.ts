import { DatacronCandidate, SquadInput, AllocationResult, AssignedCron } from './types';
import { ScopeResolver } from './scopeResolver';
import { scoreCronOnSquad, TIER_WEIGHTS, MAX_STAT_MAGNITUDE_BONUS } from './scoring';
import { hungarianMaximise } from './hungarian';

/**
 * A score at or below this threshold means no faction or character primary
 * landed — the cron contributes only stat weights and the magnitude
 * tie-break, and is "filler" for that squad. The threshold accounts for
 * both: 6 stat tiers × 1 + MAX_STAT_MAGNITUDE_BONUS, so a stat-heavy cron
 * without a primary match can't accidentally cross into "real match" range.
 */
export const FILLER_THRESHOLD = 6 * TIER_WEIGHTS.stat + MAX_STAT_MAGNITUDE_BONUS;

export function allocateDatacrons(
  squads: SquadInput[],
  crons: DatacronCandidate[],
  resolver: ScopeResolver
): AllocationResult {
  if (squads.length === 0 || crons.length === 0) {
    return { assignments: new Map(), scoreMatrix: [] };
  }

  const scoreMatrix: number[][] = squads.map(squad =>
    crons.map(cron => scoreCronOnSquad(cron, squad, resolver))
  );

  const assignments = new Map<string, AssignedCron | null>();
  const colAssignments = hungarianMaximise(scoreMatrix);

  for (let i = 0; i < squads.length; i++) {
    const colIdx = colAssignments[i];
    if (colIdx === -1 || colIdx >= crons.length) {
      assignments.set(squads[i].squadKey, null);
      continue;
    }
    const score = scoreMatrix[i][colIdx];
    assignments.set(squads[i].squadKey, {
      candidate: crons[colIdx],
      score,
      filler: score <= FILLER_THRESHOLD,
    });
  }

  return { assignments, scoreMatrix };
}
