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
  [1,  { label: 'Health',                    format: 'flat' }],
  [5,  { label: 'Speed',                     format: 'flat' }],
  [6,  { label: 'Physical Damage',           format: 'flat' }],
  [7,  { label: 'Special Damage',            format: 'flat' }],
  [8,  { label: 'Armor',                     format: 'percent' }],
  [9,  { label: 'Resistance',                format: 'percent' }],
  [10, { label: 'Armor Penetration',         format: 'flat' }],
  [11, { label: 'Resistance Penetration',    format: 'flat' }],
  [14, { label: 'Physical Crit Chance',      format: 'percent' }],
  [15, { label: 'Special Crit Chance',       format: 'percent' }],
  [16, { label: 'Critical Damage',           format: 'percent' }],
  [17, { label: 'Potency',                   format: 'percent' }],
  [18, { label: 'Tenacity',                  format: 'percent' }],
  [25, { label: 'Armor Penetration %',       format: 'percent' }],
  [27, { label: 'Health Steal',              format: 'percent' }],
  [28, { label: 'Protection',                format: 'flat' }],
  [41, { label: 'Offense',                   format: 'flat' }],
  [42, { label: 'Defense',                   format: 'flat' }],
  [48, { label: 'Offense %',                 format: 'percent' }],
  [49, { label: 'Defense %',                 format: 'percent' }],
  [53, { label: 'Crit Avoidance',            format: 'percent' }],
  [55, { label: 'Health %',                  format: 'percent' }],
  [56, { label: 'Protection %',              format: 'percent' }],
]);

const PERCENT_DIVISOR = 100_000_000;
const FLAT_DIVISOR    = 1_000_000;

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
      out.push({ name: `Stat ${statType}`, displayValue: `+${total.toLocaleString('en-GB')}` });
      continue;
    }
    if (meta.format === 'percent') {
      const pct = (total / PERCENT_DIVISOR) * 100;
      out.push({ name: meta.label, displayValue: `+${pct.toFixed(2)}%` });
    } else {
      const flat = total / FLAT_DIVISOR;
      out.push({ name: meta.label, displayValue: `+${Math.round(flat).toLocaleString('en-GB')}` });
    }
  }
  return out;
}
