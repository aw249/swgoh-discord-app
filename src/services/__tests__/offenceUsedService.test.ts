import { OffenceUsedService } from '../offenceUsedService';
import { OffenceUsedStore, OffenceUsedEntry } from '../../storage/offenceUsedStore';

class InMemoryStore extends OffenceUsedStore {
  private mem = new Map<string, OffenceUsedEntry>();
  constructor() { super('/dev/null'); }
  async get(ally: string) { return this.mem.get(ally) ?? null; }
  async set(ally: string, entry: OffenceUsedEntry) { this.mem.set(ally, JSON.parse(JSON.stringify(entry))); }
}

describe('OffenceUsedService', () => {
  let store: InMemoryStore;
  let svc: OffenceUsedService;
  beforeEach(() => { store = new InMemoryStore(); svc = new OffenceUsedService(store); });

  it('getUsed returns an empty set when the store has no entry', async () => {
    expect((await svc.getUsed('111', 'CW21:O1', 1)).size).toBe(0);
  });

  it('markUsed adds chars and pushes a history entry', async () => {
    await svc.markUsed('111', 'CW21:O1', 1, 'GLREY', ['GLREY', 'EZRA', 'REY', 'BENSOLO', 'BB8']);
    expect(await svc.getUsed('111', 'CW21:O1', 1)).toEqual(new Set(['GLREY', 'EZRA', 'REY', 'BENSOLO', 'BB8']));
  });

  it('markUsed twice unions the sets', async () => {
    await svc.markUsed('111', 'CW21:O1', 1, 'GLREY', ['GLREY', 'EZRA', 'REY', 'BENSOLO', 'BB8']);
    await svc.markUsed('111', 'CW21:O1', 1, 'JKL',   ['JKL', 'HERMIT', 'GAS', 'CT5555', 'CT7567']);
    const r = await svc.getUsed('111', 'CW21:O1', 1);
    expect(r.size).toBe(10);
    expect(r.has('GLREY')).toBe(true);
    expect(r.has('JKL')).toBe(true);
  });

  it('undoLast removes the chars from the most recent markUsed', async () => {
    await svc.markUsed('111', 'CW21:O1', 1, 'GLREY', ['GLREY', 'EZRA']);
    await svc.markUsed('111', 'CW21:O1', 1, 'JKL',   ['JKL', 'GAS']);
    await svc.undoLast('111', 'CW21:O1', 1);
    expect(await svc.getUsed('111', 'CW21:O1', 1)).toEqual(new Set(['GLREY', 'EZRA']));
  });

  it('undoLast on empty history is a no-op', async () => {
    await svc.undoLast('111', 'CW21:O1', 1);
    expect((await svc.getUsed('111', 'CW21:O1', 1)).size).toBe(0);
  });

  it('resetAll clears set and history', async () => {
    await svc.markUsed('111', 'CW21:O1', 1, 'GLREY', ['GLREY', 'EZRA']);
    await svc.markUsed('111', 'CW21:O1', 1, 'JKL',   ['JKL']);
    await svc.resetAll('111', 'CW21:O1', 1);
    expect((await svc.getUsed('111', 'CW21:O1', 1)).size).toBe(0);
  });

  it('round-change silently clears (different currentRound)', async () => {
    await svc.markUsed('111', 'CW21:O1', 1, 'GLREY', ['GLREY', 'EZRA']);
    expect((await svc.getUsed('111', 'CW21:O1', 2)).size).toBe(0);
  });

  it('round-change silently clears (different eventInstanceId)', async () => {
    await svc.markUsed('111', 'CW21:O1', 1, 'GLREY', ['GLREY', 'EZRA']);
    expect((await svc.getUsed('111', 'CW22:O2', 1)).size).toBe(0);
  });

  it('historyDepth reports the size of the undo stack', async () => {
    expect(await svc.historyDepth('111', 'CW21:O1', 1)).toBe(0);
    await svc.markUsed('111', 'CW21:O1', 1, 'GLREY', ['GLREY']);
    expect(await svc.historyDepth('111', 'CW21:O1', 1)).toBe(1);
    await svc.markUsed('111', 'CW21:O1', 1, 'JKL', ['JKL']);
    expect(await svc.historyDepth('111', 'CW21:O1', 1)).toBe(2);
    await svc.undoLast('111', 'CW21:O1', 1);
    expect(await svc.historyDepth('111', 'CW21:O1', 1)).toBe(1);
  });
});
