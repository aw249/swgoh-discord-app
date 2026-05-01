import { SwgohGgFullPlayerResponse } from '../../integrations/swgohGgApi';
import { GameDataService } from '../gameDataService';
import { GlBreakdown, GlCountSummary } from './types';

const TOP_N = 10;

export function countGuildGalacticLegends(
  roster: Map<string, SwgohGgFullPlayerResponse>
): GlCountSummary {
  const svc = GameDataService.getInstance();
  if (!svc.isReady()) return { total: 0, topByCount: [] };

  const counts = new Map<string, number>();
  for (const player of roster.values()) {
    for (const unit of player.units) {
      if (unit.data.rarity !== 7) continue;
      if (!svc.isGalacticLegend(unit.data.base_id)) continue;
      counts.set(unit.data.base_id, (counts.get(unit.data.base_id) ?? 0) + 1);
    }
  }

  let total = 0;
  for (const c of counts.values()) total += c;

  const topByCount: GlBreakdown[] = Array.from(counts.entries())
    .map(([baseId, count]) => ({ baseId, unitName: svc.getUnitName(baseId), count }))
    .sort((a, b) => b.count - a.count || a.unitName.localeCompare(b.unitName))
    .slice(0, TOP_N);

  return { total, topByCount };
}
