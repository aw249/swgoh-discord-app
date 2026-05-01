import { GameDataService } from './gameDataService';

export interface UnitChoice {
  name: string;
  value: string;
}

export interface SearchOptions {
  combatType?: 'characters' | 'ships' | 'all';
}

const MAX_CHOICES = 25;

export function searchUnits(query: string, opts: SearchOptions = {}): UnitChoice[] {
  const svc = GameDataService.getInstance();
  if (!svc.isReady()) return [];

  const combatType = opts.combatType ?? 'all';
  let baseIds: string[];
  if (combatType === 'characters') baseIds = svc.getAllCharacters();
  else if (combatType === 'ships') baseIds = svc.getAllShips();
  else baseIds = [...svc.getAllCharacters(), ...svc.getAllShips()];

  const q = query.toLowerCase().trim();

  return baseIds
    .map(id => ({ id, name: svc.getUnitName(id) }))
    .filter(({ id, name }) => !q || id.toLowerCase().includes(q) || name.toLowerCase().includes(q))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, MAX_CHOICES)
    .map(({ id, name }) => ({
      name: name.length > 100 ? name.slice(0, 100) : name,
      value: id,
    }));
}
