/**
 * Internal types for the datacron allocator.
 *
 * Both Comlink and the scraped swgoh.gg JSON normalise to DatacronCandidate.
 * All downstream modules (scoring, allocate, cron-cell renderer) see only this
 * unified type — they never know which rail produced it.
 */

export type CronSource = 'comlink' | 'scraped';

export interface DatacronTier {
  /** 1..9 */
  index: number;
  /** Empty string for stat-boost tiers; non-empty for primary tiers (3/6/9) targeting a faction/character. */
  targetRuleId: string;
  /** Empty string for stat-boost tiers; non-empty for primary tiers carrying a specific ability. */
  abilityId: string;
  /** "Krrsantan", "Dark Side", "Critical Damage", etc. — CG's localised target name. */
  scopeTargetName: string;
  /** True when this tier carries data; false for partially-rolled crons that haven't reached this tier. */
  hasData: boolean;
}

export interface AccumulatedStat {
  /** Display name, e.g. "Critical Damage", "Potency", "Offense %". */
  name: string;
  /** Pre-formatted display string, e.g. "+23.78%" or "+150". */
  displayValue: string;
  /** Numeric magnitude in raw display units — 23.78 for "+23.78%", 150 for
   *  "+150". Used by the scorer as a tie-breaker so a higher-rolled cron
   *  beats a lower-rolled one when their primary tiers are otherwise equal. */
  value: number;
}

export interface DatacronCandidate {
  source: CronSource;
  /** Stable identifier — opaque string used for snapshot lookup and tie-breaking. */
  id: string;
  setId: number;
  /** True when level 9 ability is committed (focused crons unlock the tier-9 primary). */
  focused: boolean;
  /** 1..9 — current effective tier of the cron. */
  currentTier: number;
  /** Human-readable cron name (e.g. "Power for Hire"). Empty string if unknown. */
  name: string;
  /** Up to 9 tiers, indexed 0..8 → tier 1..9. */
  tiers: DatacronTier[];
  /** CDN URL for the cron's box art. Empty when unavailable. */
  boxImageUrl: string;
  /** CDN URL for the empowered character / faction icon. Empty when unavailable. */
  calloutImageUrl: string;
  /** Aggregated stat boosts across all populated tiers, ready for display. */
  accumulatedStats: AccumulatedStat[];
}

export interface SquadInput {
  /** Stable identifier the caller uses to associate the assignment back. */
  squadKey: string;
  leaderBaseId: string;
  /** All 5 squad members, leader first. */
  memberBaseIds: string[];
  /** Per-member category list keyed by baseId — provided by the caller, populated from gameDataService. */
  memberCategories: Map<string, string[]>;
  /** 'defense' | 'offense' — used only for telemetry/labels; allocation treats both identically. */
  side: 'defense' | 'offense';
}

export interface AssignedCron {
  candidate: DatacronCandidate;
  /** Score the allocator picked this for. */
  score: number;
  /** True when score reflects only stat tiers — no faction/character primary landed. */
  filler: boolean;
}

export interface AllocationResult {
  /** Map from squad key → assignment, or null when no cron was available. */
  assignments: Map<string, AssignedCron | null>;
  /** Raw value matrix for telemetry / debugging. rows align with squads input order. */
  scoreMatrix: number[][];
}

export type ResolvedScopeTarget =
  | { kind: 'character'; baseId: string }
  | { kind: 'category'; categoryId: string }
  | { kind: 'unknown' };
