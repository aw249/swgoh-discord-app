import { ScopeResolver } from '../../datacronAllocator/scopeResolver';
import { GameDataService } from '../../gameDataService';

describe('ScopeResolver', () => {
  beforeEach(() => GameDataService.resetInstance());

  function fakeGameData(units: Record<string, { name: string; categories: string[] }>, categoryNames: Record<string, string>): void {
    const svc = GameDataService.getInstance();
    (svc as unknown as { initialized: boolean }).initialized = true;
    (svc as unknown as { lastUpdate: Date }).lastUpdate = new Date();
    jest.spyOn(svc, 'getAllCharacters').mockReturnValue(Object.keys(units));
    jest.spyOn(svc, 'getAllShips').mockReturnValue([]);
    jest.spyOn(svc, 'getUnitName').mockImplementation(id => units[id]?.name ?? id);
    jest.spyOn(svc, 'getUnitCategories').mockImplementation(id => units[id]?.categories ?? []);
    jest.spyOn(svc, 'getLocString').mockImplementation((k: string) => categoryNames[k]);
  }

  it('returns kind=unknown when gameDataService is not ready', () => {
    const r = new ScopeResolver();
    expect(r.resolveScopeTarget('Krrsantan')).toEqual({ kind: 'unknown' });
  });

  it('resolves a character name (case-insensitive)', () => {
    fakeGameData({ KRRSANTAN: { name: 'Krrsantan', categories: ['faction_bountyhunter'] } }, {});
    const r = new ScopeResolver();
    expect(r.resolveScopeTarget('Krrsantan')).toEqual({ kind: 'character', baseId: 'KRRSANTAN' });
    expect(r.resolveScopeTarget('krrsantan')).toEqual({ kind: 'character', baseId: 'KRRSANTAN' });
  });

  it('resolves a category by display name when no character matches', () => {
    fakeGameData(
      {
        GLREY: { name: 'Rey', categories: ['alignment_light'] },
        VADER: { name: 'Darth Vader', categories: ['alignment_dark'] },
      },
      { 'CATEGORY_alignment_dark_NAME': 'Dark Side' }
    );
    const r = new ScopeResolver();
    expect(r.resolveScopeTarget('Dark Side')).toEqual({ kind: 'category', categoryId: 'alignment_dark' });
  });

  it('returns kind=unknown for an unmatched target', () => {
    fakeGameData({ GLREY: { name: 'Rey', categories: [] } }, {});
    const r = new ScopeResolver();
    expect(r.resolveScopeTarget('Made Up Faction Name')).toEqual({ kind: 'unknown' });
  });

  it('character match takes precedence over category match on naming collision', () => {
    fakeGameData(
      { SCOUNDREL: { name: 'Scoundrel', categories: [] } },
      { 'CATEGORY_role_scoundrel_NAME': 'Scoundrel' }
    );
    const r = new ScopeResolver();
    expect(r.resolveScopeTarget('Scoundrel').kind).toBe('character');
  });
});
