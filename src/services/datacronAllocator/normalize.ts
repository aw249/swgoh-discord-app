import { ComlinkDatacron } from '../../integrations/comlink/comlinkClient';
import { GameDataService } from '../gameDataService';
import { DatacronCandidate, DatacronTier, AccumulatedStat } from './types';
import { accumulateComlinkAffixStats } from './cronStats';

const ASSET_BASE = 'https://game-assets.swgoh.gg/textures/';

interface ScrapedCronJson {
  id: string;
  set_id: number;
  template_id: string;
  tags: string[];
  reroll_count: number;
  focused: boolean;
  derived: {
    name: string;
    tier: number;
    accumulated_stats?: Array<{
      stat_name: string;
      display_stat_value: string;
    }>;
    tiers: Array<{
      target_rule_id: string;
      ability_id: string;
      scope_icon: string | null;
      derived: {
        has_data: boolean;
        tier_id: number;
        scope_target_name: string;
        is_primary_tier: boolean;
      };
    }>;
    box_image_url: string;
    callout_image_url: string;
  };
}

/**
 * Convert a swgoh.gg `data-player-datacron-tooltip-app` JSON to DatacronCandidate.
 */
export function fromScraped(scraped: ScrapedCronJson): DatacronCandidate {
  const d = scraped.derived;
  const tiers: DatacronTier[] = (d.tiers ?? []).map((t, i) => ({
    index: i + 1,
    targetRuleId: t.target_rule_id ?? '',
    abilityId: t.ability_id ?? '',
    scopeTargetName: t.derived?.scope_target_name ?? '',
    hasData: !!t.derived?.has_data,
  }));
  while (tiers.length < 9) {
    tiers.push({
      index: tiers.length + 1, targetRuleId: '', abilityId: '', scopeTargetName: '', hasData: false,
    });
  }
  const accumulatedStats: AccumulatedStat[] = (d.accumulated_stats ?? []).map(s => ({
    name: s.stat_name,
    displayValue: s.display_stat_value.startsWith('+') || s.display_stat_value.startsWith('-')
      ? s.display_stat_value
      : `+${s.display_stat_value}`,
  }));

  return {
    source: 'scraped',
    id: scraped.id,
    setId: scraped.set_id,
    focused: !!scraped.focused,
    currentTier: d.tier ?? 0,
    name: d.name ?? '',
    tiers,
    boxImageUrl: d.box_image_url ?? '',
    calloutImageUrl: d.callout_image_url ?? '',
    accumulatedStats,
  };
}

/** Map a Comlink set id to its texture letter. Sets cycle a/b/c/d. */
function setIdToTextureLetter(setId: number): 'a' | 'b' | 'c' | 'd' {
  const idx = (setId - 21) % 4;
  return (['a', 'b', 'c', 'd'] as const)[(idx + 4) % 4];
}

function comlinkScopeNameFromTargetRule(targetRule: string): string {
  if (!targetRule) return '';
  const prefix = 'target_datacron_';
  return targetRule.startsWith(prefix) ? targetRule.slice(prefix.length) : targetRule;
}

/** Convert a Comlink datacron (from /player.datacron[]) to DatacronCandidate.
 *
 *  Comlink represents the cron's current tier implicitly via the `affix[]` array
 *  length — a tier-5 cron has exactly 5 affix entries; a fully-rolled focused
 *  tier-9 cron has 9. `rerollIndex` is the reroll counter, NOT the tier.
 *  Unfocused crons cap at tier 6 (the focusing decision unlocks tiers 7-9). */
export function fromComlink(d: ComlinkDatacron): DatacronCandidate {
  const focused = !!d.focused;
  const affixCount = d.affix?.length ?? 0;
  const tierCap = focused ? 9 : 6;
  const currentTier = Math.min(tierCap, affixCount);

  type ComlinkAffix = {
    targetRule?: string;
    abilityId?: string;
    scopeIcon?: string;
    requiredUnitTier?: number;
    requiredRelicTier?: number;
    tag?: string[];
  };

  const tiers: DatacronTier[] = (d.affix as ComlinkAffix[] ?? []).map((a, i) => ({
    index: i + 1,
    targetRuleId: a.targetRule ?? '',
    abilityId: a.abilityId ?? '',
    scopeTargetName: comlinkScopeNameFromTargetRule(a.targetRule ?? ''),
    hasData: i + 1 <= currentTier,
  }));
  while (tiers.length < 9) {
    tiers.push({
      index: tiers.length + 1, targetRuleId: '', abilityId: '', scopeTargetName: '', hasData: false,
    });
  }

  const letter = setIdToTextureLetter(d.setId);
  const boxSuffix = currentTier >= 9 ? '_max' : '';
  const boxImageUrl = `${ASSET_BASE}tex.datacron_${letter}${boxSuffix}.png`;

  // Callout: pick the highest-tier primary affix at-or-below currentTier with a tex.* scopeIcon.
  let calloutImageUrl = '';
  for (let i = (d.affix as ComlinkAffix[] ?? []).length - 1; i >= 0; i--) {
    const aff = (d.affix as ComlinkAffix[])[i];
    if (i + 1 > currentTier) continue;
    const icon = aff.scopeIcon ?? '';
    if (icon && icon.startsWith('tex.')) {
      calloutImageUrl = `${ASSET_BASE}${icon}.png`;
      break;
    }
  }

  // Derive a friendly cron name from the focused-tier tag when available.
  // templateId: 'datacron_set_27_focused_maulhatefueled' → final segment 'maulhatefueled'
  // tag[]: ['maulhatefueled'] also works as a fallback.
  // We resolve the tag against gameDataService unit names where possible
  // ("Maul Hate-Fueled" → "Sith Eternal Maul"), otherwise fall back to a
  // titlecased tag string. As a last resort, "Set N (focused/unfocused)".
  let derivedName = '';
  const focusedTag = (d.tag ?? [])[0]
    ?? (d.templateId.startsWith('datacron_set_') ? d.templateId.split('_').slice(4).join('_') : '');
  if (focusedTag) {
    const gd = GameDataService.getInstance();
    if (gd.isReady()) {
      const allBaseIds = [...gd.getAllCharacters(), ...gd.getAllShips()];
      const lc = focusedTag.toLowerCase();
      const matchByBaseId = allBaseIds.find(id => id.toLowerCase() === lc);
      if (matchByBaseId) {
        derivedName = gd.getUnitName(matchByBaseId);
      }
    }
    if (!derivedName) {
      derivedName = focusedTag.replace(/[_-]/g, ' ').replace(/\b\w/g, ch => ch.toUpperCase());
    }
  }
  if (!derivedName) {
    derivedName = `Set ${d.setId} ${focused ? 'focused' : 'unfocused'}`;
  }

  // Comlink affix entries carry numeric statType + decimal-string statValue
  // alongside the targetRule we already extract. The type on ComlinkDatacron.affix
  // is `unknown[]`, so we re-shape per-entry for the stat aggregator.
  const affixForStats = (d.affix as Array<Partial<{
    statType: number;
    statValue: string;
    targetRule: string;
  }>> ?? []).map(a => ({
    statType: typeof a.statType === 'number' ? a.statType : -1,
    statValue: a.statValue ?? '0',
    targetRule: a.targetRule ?? '',
  }));
  const accumulatedStats = accumulateComlinkAffixStats(affixForStats, currentTier);

  return {
    source: 'comlink',
    id: d.id,
    setId: d.setId,
    focused,
    currentTier,
    name: derivedName,
    tiers,
    boxImageUrl,
    calloutImageUrl,
    accumulatedStats,
  };
}
