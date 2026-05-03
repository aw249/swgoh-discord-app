import { ComlinkDatacron } from '../../integrations/comlink/comlinkClient';
import { DatacronCandidate, DatacronTier } from './types';

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

/** Convert a Comlink datacron (from /player.datacron[]) to DatacronCandidate. */
export function fromComlink(d: ComlinkDatacron): DatacronCandidate {
  const focused = !!d.focused;
  const currentTier = focused ? 9 : Math.min(6, d.rerollIndex + 1);

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

  return {
    source: 'comlink',
    id: d.id,
    setId: d.setId,
    focused,
    currentTier,
    name: '',
    tiers,
    boxImageUrl,
    calloutImageUrl,
  };
}
