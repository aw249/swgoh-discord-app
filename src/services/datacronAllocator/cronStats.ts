/**
 * Translate Comlink datacron affix raw values into displayable stat lines.
 *
 * Comlink reports each affix as `{ statType, statValue }` where statType is
 * CG's stable unit-stat enum and statValue is a raw integer. Most datacron
 * stats are percentages encoded as `value / 100_000_000` (e.g. 20_000_000 →
 * 0.20 → "+20.00%"). Speed (statType 5) is a flat boost using a different
 * divisor.
 *
 * Stat-type mapping is the same one used in `swgohGgTypes.SwgohGgUnitStats`:
 * stable game-mechanic constants, not curated meta data.
 */

import { AccumulatedStat } from './types';

/** Per-stat metadata: display label + how to format the raw integer. */
interface StatTypeMeta {
  label: string;
  /** 'percent' divides by 100_000_000 and appends "%". 'flat' divides by 1_000_000. */
  format: 'percent' | 'flat';
}

/** statType → display metadata. Subset focused on stats actually appearing on
 *  modern datacrons. Unknown stat types fall back to "Stat <id>". */
const STAT_TYPE_META: ReadonlyMap<number, StatTypeMeta> = new Map([
  [1,  { label: 'Health',     format: 'flat' }],
  [5,  { label: 'Speed',      format: 'flat' }],
  [6,  { label: 'Phys Dam',   format: 'flat' }],
  [7,  { label: 'Spec Dam',   format: 'flat' }],
  [8,  { label: 'Armor',      format: 'percent' }],
  [9,  { label: 'Resist',     format: 'percent' }],
  [10, { label: 'Armor Pen',  format: 'flat' }],
  [11, { label: 'Resist Pen', format: 'flat' }],
  [14, { label: 'Phys CC',    format: 'percent' }],
  [15, { label: 'Spec CC',    format: 'percent' }],
  [16, { label: 'Crit Dam',   format: 'percent' }],
  [17, { label: 'Potency',    format: 'percent' }],
  [18, { label: 'Tenacity',   format: 'percent' }],
  [25, { label: 'Armor Pen %', format: 'percent' }],
  [27, { label: 'HP Steal',   format: 'percent' }],
  [28, { label: 'Prot',       format: 'flat' }],
  [41, { label: 'Offense',    format: 'flat' }],
  [42, { label: 'Defense',    format: 'flat' }],
  [48, { label: 'Off %',      format: 'percent' }],
  [49, { label: 'Def %',      format: 'percent' }],
  [53, { label: 'Crit Avoid', format: 'percent' }],
  [55, { label: 'HP %',       format: 'percent' }],
  [56, { label: 'Prot %',     format: 'percent' }],
]);

const PERCENT_DIVISOR = 100_000_000;
const FLAT_DIVISOR    = 1_000_000;

/** swgoh.gg's tooltip JSON uses CG's full English stat labels — match them
 *  to the short forms used here so opponent (scraped) crons render with the
 *  same compact labels as the user's own (Comlink) crons. */
const LONG_TO_SHORT_LABEL: ReadonlyMap<string, string> = new Map([
  ['Physical Damage',        'Phys Dam'],
  ['Special Damage',         'Spec Dam'],
  ['Resistance',             'Resist'],
  ['Armor Penetration',      'Armor Pen'],
  ['Resistance Penetration', 'Resist Pen'],
  ['Physical Crit Chance',   'Phys CC'],
  ['Special Crit Chance',    'Spec CC'],
  ['Critical Damage',        'Crit Dam'],
  ['Health Steal',           'HP Steal'],
  ['Protection',             'Prot'],
  ['Offense %',              'Off %'],
  ['Defense %',              'Def %'],
  ['Crit Avoidance',         'Crit Avoid'],
  ['Health %',               'HP %'],
  ['Protection %',           'Prot %'],
  ['Armor Penetration %',    'Armor Pen %'],
]);

/** Convert any long-form stat label to its compact display form. Returns the
 *  input unchanged if no mapping exists (so non-stat labels and already-short
 *  names pass through untouched). */
export function shortenStatLabel(label: string): string {
  return LONG_TO_SHORT_LABEL.get(label) ?? label;
}

interface ComlinkAffixLike {
  statType: number;
  /** Decimal string per Comlink. Empty for ability-only affixes. */
  statValue: string;
  targetRule?: string;
}

/**
 * Aggregate a Comlink datacron's affixes into an AccumulatedStat[] suitable
 * for the cron-cell footer rendering.
 *
 * Skips ability-only affixes (`statValue === '0'` AND `targetRule` is set —
 * those carry the tier-3/6/9 primary effects, not stat boosts).
 *
 * Sums numeric statValues by statType. Returns one entry per stat type, in
 * insertion order — typically Crit Damage / Potency / Offense / Health for a
 * fully-rolled cron.
 */
export function accumulateComlinkAffixStats(
  affixes: ComlinkAffixLike[],
  populatedAffixCount: number
): AccumulatedStat[] {
  const totalsByType = new Map<number, number>();
  const orderByType: number[] = [];

  for (let i = 0; i < Math.min(affixes.length, populatedAffixCount); i++) {
    const a = affixes[i];
    const valueStr = a.statValue ?? '0';
    if (valueStr === '0') continue; // ability tier — no stat to sum

    const raw = parseInt(valueStr, 10);
    if (!Number.isFinite(raw) || raw === 0) continue;

    if (!totalsByType.has(a.statType)) {
      orderByType.push(a.statType);
    }
    totalsByType.set(a.statType, (totalsByType.get(a.statType) ?? 0) + raw);
  }

  const out: AccumulatedStat[] = [];
  for (const statType of orderByType) {
    const total = totalsByType.get(statType)!;
    const meta = STAT_TYPE_META.get(statType);
    if (!meta) {
      // Unknown — show the raw type id so we notice and can extend the map.
      // Use the raw integer as the magnitude — caller can still rank crons by
      // total even when the type isn't recognised.
      out.push({ name: `Stat ${statType}`, displayValue: `+${total.toLocaleString('en-GB')}`, value: total });
      continue;
    }
    if (meta.format === 'percent') {
      const pct = (total / PERCENT_DIVISOR) * 100;
      out.push({ name: meta.label, displayValue: `+${pct.toFixed(2)}%`, value: pct });
    } else {
      const flat = total / FLAT_DIVISOR;
      const rounded = Math.round(flat);
      out.push({ name: meta.label, displayValue: `+${rounded.toLocaleString('en-GB')}`, value: rounded });
    }
  }
  return out;
}

/**
 * Sum of |value| across a cron's accumulated stats. Used by the scorer as a
 * neutral tie-breaker — two crons with identical primary tiers will differ
 * here by the cumulative magnitude of their stat rolls, so a +50% Crit Dam
 * cron beats a +30% Crit Dam cron, a +50% Armor Pen beats a +30% Armor Pen,
 * etc. Stays neutral on which stats matter — only rewards higher rolls.
 *
 * Percent stats contribute their percent value directly (25 for "+25%").
 * Flat stats contribute their displayed flat number (20 for "+20" speed).
 * Both are roughly comparable in raw magnitude on real datacrons.
 */
export function computeStatMagnitude(stats: AccumulatedStat[]): number {
  let total = 0;
  for (const s of stats) total += Math.abs(s.value);
  return total;
}
