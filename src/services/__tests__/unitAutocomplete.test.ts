import { searchUnits } from '../unitAutocomplete';
import { GameDataService } from '../gameDataService';

function fakeReady(units: Record<string, { name: string; combatType: number }>): void {
  const svc = GameDataService.getInstance();
  (svc as unknown as { initialized: boolean }).initialized = true;
  (svc as unknown as { lastUpdate: Date }).lastUpdate = new Date();
  jest.spyOn(svc, 'getAllCharacters').mockReturnValue(
    Object.entries(units).filter(([, u]) => u.combatType === 1).map(([id]) => id)
  );
  jest.spyOn(svc, 'getAllShips').mockReturnValue(
    Object.entries(units).filter(([, u]) => u.combatType === 2).map(([id]) => id)
  );
  jest.spyOn(svc, 'getUnitName').mockImplementation((id: string) => units[id]?.name ?? id);
}

describe('searchUnits', () => {
  beforeEach(() => GameDataService.resetInstance());

  it('returns [] when gameDataService is not ready', () => {
    expect(searchUnits('rey')).toEqual([]);
  });

  it('matches by name (case-insensitive substring)', () => {
    fakeReady({ GLREY: { name: 'Rey', combatType: 1 }, JMK: { name: 'Jedi Master Kenobi', combatType: 1 } });
    const choices = searchUnits('rey');
    expect(choices.map(c => c.value)).toContain('GLREY');
    expect(choices.map(c => c.value)).not.toContain('JMK');
  });

  it('matches by base id', () => {
    fakeReady({ GLREY: { name: 'Rey', combatType: 1 } });
    expect(searchUnits('glrey').map(c => c.value)).toContain('GLREY');
  });

  it('caps results at 25', () => {
    const big: Record<string, { name: string; combatType: number }> = {};
    for (let i = 0; i < 50; i++) big[`UNIT_${i}`] = { name: `Hero ${i}`, combatType: 1 };
    fakeReady(big);
    expect(searchUnits('hero').length).toBe(25);
  });

  it('combatType=characters excludes ships', () => {
    fakeReady({ GLREY: { name: 'Rey', combatType: 1 }, EXECUTOR: { name: 'Executor', combatType: 2 } });
    expect(searchUnits('', { combatType: 'characters' }).map(c => c.value)).toEqual(['GLREY']);
  });

  it('returns full list (capped at 25) when query is empty', () => {
    fakeReady({ A: { name: 'Alpha', combatType: 1 }, B: { name: 'Bravo', combatType: 1 } });
    expect(searchUnits('').length).toBe(2);
  });
});
