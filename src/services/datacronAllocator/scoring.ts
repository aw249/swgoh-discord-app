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

/** Per-level bonus added to a cron's score. Forces the higher-tier copy of
 *  any duplicate template to always rank above lower-tier copies on every
 *  squad: a 1-tier advantage adds TIER_TIEBREAK_PER_LEVEL, which is
 *  strictly greater than MAX_STAT_MAGNITUDE_BONUS — so even an L9 with
 *  zero stat rolls beats an L8 with maxed stats when their primary
 *  contributions are equal. */
export const TIER_TIEBREAK_PER_LEVEL = 0.2;

/** Multiplier applied to the cron's total stat magnitude when adding the
 *  finer tie-break contribution. Sized so a fully-rolled cron (~200
 *  magnitude points) saturates at MAX_STAT_MAGNITUDE_BONUS, and the cap
 *  itself stays smaller than TIER_TIEBREAK_PER_LEVEL so magnitude can
 *  never flip the order between adjacent-tier duplicates. */
export const STAT_MAGNITUDE_SCALE = 0.0005;

/** Hard cap on the magnitude tie-break contribution, regardless of how
 *  inflated a cron's accumulated stats are. Strictly less than
 *  TIER_TIEBREAK_PER_LEVEL, and combined with the tier bonus it stays
 *  below TIER_WEIGHTS.primary3 — so neither tie-break ever spills into
 *  primary-tier territory. */
export const MAX_STAT_MAGNITUDE_BONUS = 0.1;

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

  // Tier tie-breaker: prefer the higher-tier copy of any duplicate template.
  // Two crons with identical scoping (e.g. an L8 + L9 of the same focused
  // Maul template) will differ only here on a squad whose tier-9 anchor
  // doesn't fire, and this bonus exceeds the largest possible magnitude
  // differential — so the L9 always beats the L8 head-to-head.
  total += cron.currentTier * TIER_TIEBREAK_PER_LEVEL;

  // Magnitude tie-breaker: among same-tier crons, a higher-rolled cron beats
  // a lower-rolled one. Capped strictly below TIER_TIEBREAK_PER_LEVEL so it
  // can never invert the tier ordering above; combined with the tier bonus
  // it stays below TIER_WEIGHTS.primary3 so neither tie-break can override
  // a primary-tier match.
  const magnitudeBonus = Math.min(
    MAX_STAT_MAGNITUDE_BONUS,
    computeStatMagnitude(cron.accumulatedStats) * STAT_MAGNITUDE_SCALE
  );
  total += magnitudeBonus;

  return total;
}
