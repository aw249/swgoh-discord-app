import { DatacronCandidate, SquadInput } from './types';
import { ScopeResolver } from './scopeResolver';

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
  return total;
}
