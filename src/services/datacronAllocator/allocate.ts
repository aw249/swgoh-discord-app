import { DatacronCandidate, SquadInput, AllocationResult, AssignedCron } from './types';
import { ScopeResolver } from './scopeResolver';
import {
  scoreCronOnSquad,
  TIER_WEIGHTS,
  TIER_TIEBREAK_PER_LEVEL,
  MAX_STAT_MAGNITUDE_BONUS,
} from './scoring';
import { hungarianMaximise } from './hungarian';

/**
 * A score at or below this threshold means no faction or character primary
 * landed — the cron contributes only stat weights and the tier/magnitude
 * tie-breaks, and is "filler" for that squad. The threshold accounts for
 * the worst-case stat-only score: all 6 stat tiers × 1 + the maximum tier
 * tie-break (a fully-rolled L9 cron) + MAX_STAT_MAGNITUDE_BONUS. A
 * stat-heavy cron without a primary match can't accidentally cross into
 * "real match" range.
 */
export const FILLER_THRESHOLD =
  6 * TIER_WEIGHTS.stat + 9 * TIER_TIEBREAK_PER_LEVEL + MAX_STAT_MAGNITUDE_BONUS;

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
