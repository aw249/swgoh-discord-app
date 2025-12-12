import { SwgohGgFullPlayerResponse } from '../../../integrations/swgohGgApi';
import { isGalacticLegend } from '../../../config/gacConstants';

export function getTop80CharactersRoster(roster: SwgohGgFullPlayerResponse): SwgohGgFullPlayerResponse {
  const characters = (roster.units || [])
    .filter(unit => unit.data.combat_type === 1)
    .sort((a, b) => (b.data.power || 0) - (a.data.power || 0))
    .slice(0, 80);
  return { ...roster, units: characters };
}

export function getGalacticLegendsFromRoster(roster: SwgohGgFullPlayerResponse): Set<string> {
  const gls = new Set<string>();
  const filteredRoster = getTop80CharactersRoster(roster);
  for (const unit of filteredRoster.units) {
    if (unit.data?.base_id && unit.data.is_galactic_legend && isGalacticLegend(unit.data.base_id)) {
      gls.add(unit.data.base_id);
    }
  }
  return gls;
}

export function createCharacterMaps(roster: SwgohGgFullPlayerResponse): {
  nameMap: Map<string, string>;
  statsMap: Map<string, { speed: number; health: number; protection: number }>;
} {
  const nameMap = new Map<string, string>();
  const statsMap = new Map<string, { speed: number; health: number; protection: number }>();
  const filteredRoster = getTop80CharactersRoster(roster);
  for (const unit of filteredRoster.units) {
    if (unit.data?.base_id) {
      if (unit.data.name) nameMap.set(unit.data.base_id, unit.data.name);
      const stats = unit.data.stats || {};
      const speed = Math.round(stats['5'] || 0);
      const health = (stats['1'] || 0) / 1000;
      const protection = (stats['28'] || 0) / 1000;
      statsMap.set(unit.data.base_id, { speed, health, protection });
    }
  }
  return { nameMap, statsMap };
}
