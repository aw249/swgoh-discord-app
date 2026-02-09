import { UniqueDefensiveSquad } from '../../../types/gacStrategyTypes';

export function getAllUnitIds(squad: UniqueDefensiveSquad): string[] {
  return [
    squad.leader.baseId,
    ...squad.members.map(m => m.baseId)
  ].filter(Boolean);
}

export function squadsShareCharacters(squad1: UniqueDefensiveSquad, squad2: UniqueDefensiveSquad): boolean {
  const ids1 = new Set(getAllUnitIds(squad1));
  const ids2 = new Set(getAllUnitIds(squad2));
  for (const id of ids1) {
    if (ids2.has(id)) return true;
  }
  return false;
}

export function isCharacterUsedInSquads(characterId: string, squads: UniqueDefensiveSquad[]): boolean {
  for (const squad of squads) {
    const ids = getAllUnitIds(squad);
    if (ids.includes(characterId)) return true;
  }
  return false;
}

export function getAllUsedCharacters(squads: UniqueDefensiveSquad[]): Set<string> {
  const used = new Set<string>();
  for (const squad of squads) {
    getAllUnitIds(squad).forEach(id => used.add(id));
  }
  return used;
}

export function formatCharacterName(
  baseId: string,
  nameMap: Map<string, string>,
  maxLength: number = 15
): string {
  if (!baseId) return 'Name';
  const friendlyName = nameMap.get(baseId) || baseId;
  if (friendlyName.length > maxLength) {
    return friendlyName.substring(0, maxLength - 3) + '...';
  }
  return friendlyName;
}
