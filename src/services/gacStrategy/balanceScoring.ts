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
