// src/services/gacStrategy/balanceScoring.ts
//
// Pure scoring helpers for the `balanced` strategy mode contention rule.
// All functions are deterministic, side-effect free, and unit-testable.
// Constants are exported so they can be tuned in one place.

import { MatchedCounterSquad } from '../../types/gacStrategyTypes';

// --- Tunable constants ---

/**
 * Saturation point for the offense-counter seen-count log scale.
 * A counter at or above this seen count gets full 1.0 confidence.
 * Below, confidence ramps log-smoothly down to CONFIDENCE_FLOOR.
 */
export const MAX_SEEN_OFFENSE = 10000;

/**
 * Confidence multiplier floor for null/zero seen counts (no community data).
 * 0.30 means an "N/A seen" 90%-win counter scores 90 × 0.30 = 27,
 * meaningfully worse than a 5k-seen 70%-win counter at 70 × 0.95 = 66.5.
 */
export const CONFIDENCE_FLOOR = 0.30;

/**
 * Minimum win rate for an offense alternative to count as "viable" during
 * a contention swap. If defense wants to claim a leader and the only alt
 * available has win < this floor (or null/N/A), we keep the primary on
 * offense. Avoids forcing the user into 30-50% matchups just to fill a
 * defense slot.
 */
export const ALT_WIN_FLOOR = 60;

/**
 * Maximum allowed win-rate drop between primary and alt when swapping for
 * a contention claim. If the primary is a high-confidence pick (e.g. 95% win),
 * we only swap to an alt if it's within this many points (e.g. an alt at 80%
 * is acceptable for a 95% primary, but a 60% alt is not — that's giving up
 * confidence the user explicitly asked us to preserve).
 */
export const ALT_WIN_DROP_LIMIT = 20;

/**
 * Maximum theoretical banners per battle, with first-attempt bonus + all
 * units surviving full HP/protection.
 * Source: https://swgoh.wiki/wiki/Grand_Arena_Championships
 */
export const MAX_BANNERS_5V5 = 69;
export const MAX_BANNERS_3V3 = 63; // Conservative; verify against wiki at any banner-rule update.

export function maxBannersForFormat(format: string): number {
  return format === '3v3' ? MAX_BANNERS_3V3 : MAX_BANNERS_5V5;
}

/**
 * Confidence multiplier for a counter's seen count.
 * Log-scaled so 100→0.65, 1k→0.83, 10k→1.0. Floor at CONFIDENCE_FLOOR
 * for null/zero/negative inputs.
 */
export function confidenceMultiplier(seen: number | null): number {
  if (seen === null || seen <= 0) return CONFIDENCE_FLOOR;
  const cap = Math.min(seen, MAX_SEEN_OFFENSE);
  const numerator = Math.log10(cap + 1);
  const denominator = Math.log10(MAX_SEEN_OFFENSE + 1);
  return CONFIDENCE_FLOOR + (1 - CONFIDENCE_FLOOR) * (numerator / denominator);
}

/**
 * Composite "is this offense counter worth using" score.
 *   winRate × (avgBanners / formatMax, capped at 1) × confidence(seen)
 * Returns 0 if winPercentage or avgBanners is null.
 * Uses adjustedWinPercentage when present (the existing GL-conservation tweak).
 */
export function offenseViability(counter: MatchedCounterSquad, format: string): number {
  const win = counter.adjustedWinPercentage ?? counter.winPercentage;
  if (win === null || counter.avgBanners === null) return 0;
  const max = maxBannersForFormat(format);
  const bannerFraction = Math.min(1, counter.avgBanners / max);
  return win * bannerFraction * confidenceMultiplier(counter.seenCount);
}

/**
 * Minimal shape needed to score a defense suggestion.
 * Matches the relevant subset of DefenseSuggestion / the inline shape
 * used by balanceOffenseAndDefense's `defenseSuggestions` parameter.
 */
export interface DefenseScoreInput {
  holdPercentage: number | null;
  seenCount: number | null;
}

/**
 * Composite "is this defense placement worth defending" score.
 *   holdPercentage × confidence(seen)
 * Returns 0 if holdPercentage is null. Banner yield on defense is paid
 * by the opponent so it's irrelevant to the user-side score.
 */
export function defenseViability(input: DefenseScoreInput): number {
  if (input.holdPercentage === null) return 0;
  return input.holdPercentage * confidenceMultiplier(input.seenCount);
}

export interface AltSearchResult {
  alt: MatchedCounterSquad | null;
  viability: number;
}

/**
 * Find the best alternative counter from `counter.alternatives` whose
 * leader and members are all absent from `claimedChars`. Returns the
 * winner and its viability, or { alt: null, viability: 0 } if none fit.
 */
export function bestAvailableAlt(
  counter: MatchedCounterSquad,
  claimedChars: Set<string>,
  format: string
): AltSearchResult {
  let best: AltSearchResult = { alt: null, viability: 0 };
  for (const alt of counter.alternatives ?? []) {
    if (!alt.offense.leader.baseId) continue;
    if (claimedChars.has(alt.offense.leader.baseId)) continue;
    const memberCollision = alt.offense.members.some(m => m.baseId && claimedChars.has(m.baseId));
    if (memberCollision) continue;
    const v = offenseViability(alt, format);
    if (v > best.viability) best = { alt, viability: v };
  }
  return best;
}

export interface ClaimDecision {
  claim: boolean;
  /** If claim is true and offense had this leader as primary, the alt to swap to. Undefined if no offense conflict or no alt found. */
  replacementCounter?: MatchedCounterSquad;
}

/**
 * Decide whether defense should claim `leaderId`, accounting for offense impact.
 *
 * Algorithm:
 *   1. If `offenseLeaderToSlot` doesn't contain leaderId → claim (no offense conflict).
 *   2. Compute primaryOffenseV = offenseViability of the current offense pick.
 *   3. Compute bestAltV from primary's alternatives, EXCLUDING any alt that would
 *      reuse the contested leader (defense is about to claim it, so an "alt"
 *      led by the same character is a no-op that fails downstream).
 *   4. If no alt exists, OR the best alt's win rate is below ALT_WIN_FLOOR (or
 *      null), bail — keeping the primary on offense is better than forcing a
 *      weak/speculative replacement just to fill a defense slot.
 *   5. swapCost = max(0, primaryOffenseV - bestAltV).
 *   6. claim if defenseV >= swapCost; emit replacementCounter (always non-null
 *      at this point because we bailed on null-alt above).
 */
export function shouldDefenseClaim(
  leaderId: string,
  defenseV: number,
  offenseLeaderToSlot: Map<string, MatchedCounterSquad>,
  claimedChars: Set<string>,
  format: string
): ClaimDecision {
  const primary = offenseLeaderToSlot.get(leaderId);
  if (!primary) return { claim: true };

  const primaryV = offenseViability(primary, format);
  // Defense is about to claim leaderId; treat it as already-used when scoring
  // alternative offense counters so we never return an alt led by the same character.
  const claimedWithLeader = new Set(claimedChars);
  claimedWithLeader.add(leaderId);
  const { alt, viability: altV } = bestAvailableAlt(primary, claimedWithLeader, format);

  // Bail if there's no usable alt to fall back to — forcing offense into the
  // alternative-walk fallback often produces challenging matchups (low win or
  // null win). The user prefers a known-good primary to a speculative fill.
  if (alt === null) return { claim: false };
  const altWin = alt.adjustedWinPercentage ?? alt.winPercentage;
  if (altWin === null || altWin < ALT_WIN_FLOOR) return { claim: false };

  // Confidence preservation: don't swap a high-confidence primary for a much
  // weaker alt, even if the swap would mathematically pay off in defense gain.
  // The user explicitly wants confident matchups preserved on offense.
  const primaryWin = primary.adjustedWinPercentage ?? primary.winPercentage;
  if (primaryWin !== null && primaryWin - altWin > ALT_WIN_DROP_LIMIT) {
    return { claim: false };
  }

  const swapCost = Math.max(0, primaryV - altV);
  if (defenseV >= swapCost) {
    return { claim: true, replacementCounter: alt };
  }
  return { claim: false };
}
