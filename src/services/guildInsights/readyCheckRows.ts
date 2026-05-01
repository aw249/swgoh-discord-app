import { SwgohGgFullPlayerResponse } from '../../integrations/swgohGgApi';
import { getDisplayRelicLevel } from '../../utils/unitLevelUtils';
import { ReadyCheckRow } from './types';

export interface ReadyCheckOptions {
  includeMissing?: boolean;
}

function rowFor(player: SwgohGgFullPlayerResponse, baseId: string): ReadyCheckRow {
  const unit = player.units.find(u => u.data.base_id === baseId);
  if (!unit) {
    return { playerName: player.data.name, found: false, rarity: 0, gearLevel: 0, relicTier: 0, zetaCount: 0, omicronCount: 0 };
  }
  const displayRelic = getDisplayRelicLevel(unit.data.gear_level, unit.data.relic_tier) ?? 0;
  return {
    playerName: player.data.name,
    found: true,
    rarity: unit.data.rarity,
    gearLevel: unit.data.gear_level,
    relicTier: displayRelic,
    zetaCount: unit.data.zeta_abilities.length,
    omicronCount: unit.data.omicron_abilities.length,
  };
}

export function buildReadyCheckRows(
  roster: Map<string, SwgohGgFullPlayerResponse>,
  baseId: string,
  minRelic: number,
  opts: ReadyCheckOptions = {}
): ReadyCheckRow[] {
  const all: ReadyCheckRow[] = Array.from(roster.values()).map(p => rowFor(p, baseId));
  const passing = all.filter(r => r.found && r.relicTier >= minRelic).sort((a, b) => b.relicTier - a.relicTier);
  if (!opts.includeMissing) return passing;
  const missing = all.filter(r => !(r.found && r.relicTier >= minRelic)).map(r => ({ ...r, found: false }));
  return [...passing, ...missing];
}
