import { DatacronCandidate, SquadInput } from './types';
import { ScopeResolver } from './scopeResolver';
import { computeStatMagnitude } from './cronStats';

export const TIER_WEIGHTS = {
  /** Tiers 1, 2, 4, 5, 7, 8 — stat boosts. */
  stat: 1,
  /** Tier 3 — first faction/role primary ability. */
  primary3: 6,
  /** Tier 6 — second faction/role primary ability. */
  primary6: 10,
  /** Tier 9 — character-specific primary ability. */
  primary9: 25,
} as const;

export const LEADER_BONUS_MULTIPLIER = 1.5;

/** Extra weight added when a tier-9 primary specifically targets a character
 *  who is in the squad. The tier-9 ability only fires for that exact unit, so
 *  a focused tier-9 cron is essentially wasted unless the named character is
 *  present — pushing this above the sum of all lower-tier contributions
 *  (≈22) makes the assignment unambiguous: a T9-Vane cron lands on the squad
 *  containing Vane, a T9-Grand-Inquisitor cron lands on the squad containing
 *  Grand Inquisitor, etc. */
export const T9_CHARACTER_ANCHOR_BONUS = 30;

/** Multiplier applied to the cron's total stat magnitude when adding the
 *  tie-break contribution to its score. Kept small so the magnitude bonus
 *  for a fully-rolled cron (~150 magnitude points) stays under
 *  TIER_WEIGHTS.primary3 (6) — guaranteeing it can never override a primary
 *  tier match, only differentiate two otherwise-equal crons. */
export const STAT_MAGNITUDE_SCALE = 0.01;

/** Hard cap on the magnitude tie-break contribution, regardless of how
 *  inflated a cron's accumulated stats are. Guarantees the bonus never
 *  spills into primary-tier territory and keeps filler detection clean
 *  (a cron with no primary match cannot exceed STAT_TIER_TOTAL + this cap). */
export const MAX_STAT_MAGNITUDE_BONUS = 3;

const STAT_TIER_INDEXES = new Set([1, 2, 4, 5, 7, 8]);

function weightForTier(index: number): number {
  if (STAT_TIER_INDEXES.has(index)) return TIER_WEIGHTS.stat;
  if (index === 3) return TIER_WEIGHTS.primary3;
  if (index === 6) return TIER_WEIGHTS.primary6;
  if (index === 9) return TIER_WEIGHTS.primary9;
  return 0;
}

function squadHasCategory(squad: SquadInput, categoryId: string): boolean {
  for (const memberId of squad.memberBaseIds) {
    const cats = squad.memberCategories.get(memberId) ?? [];
    if (cats.includes(categoryId)) return true;
  }
  return false;
}

/**
 * Score one (cron, squad) cell for the allocation matrix.
 * Higher score = better fit. Always non-negative.
 */
export function scoreCronOnSquad(
  cron: DatacronCandidate,
  squad: SquadInput,
  resolver: ScopeResolver
): number {
  let total = 0;
  for (const tier of cron.tiers) {
    if (!tier.hasData) continue;
    if (tier.index > cron.currentTier) continue;

    const baseWeight = weightForTier(tier.index);
    if (baseWeight === 0) continue;

    // Stat tiers never have a target — they always contribute their base weight.
    if (STAT_TIER_INDEXES.has(tier.index)) {
      total += baseWeight;
      continue;
    }

    // Primary tiers (3/6/9) only score when they carry a target rule.
    if (!tier.targetRuleId) continue;

    const target = resolver.resolveScopeTarget(tier.scopeTargetName);

    if (target.kind === 'character') {
      if (squad.memberBaseIds.includes(target.baseId)) {
        const isLeader = squad.leaderBaseId === target.baseId;
        const multiplier = isLeader && tier.index === 9 ? LEADER_BONUS_MULTIPLIER : 1;
        total += baseWeight * multiplier;
        // T9 abilities only fire for the named character — anchor the cron
        // to that squad strongly enough to dominate other partial matches.
        if (tier.index === 9) total += T9_CHARACTER_ANCHOR_BONUS;
      }
      continue;
    }

    if (target.kind === 'category') {
      if (squadHasCategory(squad, target.categoryId)) {
        total += baseWeight;
      }
      continue;
    }

    // Unknown target — fall back to stat-weight contribution so we don't silently
    // underrate a cron whose target name didn't resolve.
    total += TIER_WEIGHTS.stat;
  }

  // Magnitude tie-breaker: a higher-rolled cron beats a lower-rolled one to
  // the same squad. Stays neutral on which stats matter — only rewards the
  // rolls the user has actually invested in. Hard-capped at
  // MAX_STAT_MAGNITUDE_BONUS so it can never override a primary-tier match.
  const magnitudeBonus = Math.min(
    MAX_STAT_MAGNITUDE_BONUS,
    computeStatMagnitude(cron.accumulatedStats) * STAT_MAGNITUDE_SCALE
  );
  total += magnitudeBonus;

  return total;
}
