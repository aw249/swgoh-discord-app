import { OffenceUsedStore, OffenceUsedEntry } from '../storage/offenceUsedStore';

export class OffenceUsedService {
  constructor(private readonly store: OffenceUsedStore) {}

  async getUsed(ally: string, eventInstanceId: string, currentRound: number): Promise<Set<string>> {
    const entry = await this.loadFresh(ally, eventInstanceId, currentRound);
    return new Set(entry.usedCharacters);
  }

  async markUsed(
    ally: string, eventInstanceId: string, currentRound: number,
    counterLeader: string, counterChars: string[],
  ): Promise<void> {
    const entry = await this.loadFresh(ally, eventInstanceId, currentRound);
    const existing = new Set(entry.usedCharacters);
    const added = counterChars.filter(c => !existing.has(c));
    for (const c of added) existing.add(c);
    entry.usedCharacters = Array.from(existing);
    entry.history.push({ counterLeader, addedChars: added });
    await this.store.set(ally, entry);
  }

  async undoLast(ally: string, eventInstanceId: string, currentRound: number): Promise<void> {
    const entry = await this.loadFresh(ally, eventInstanceId, currentRound);
    const last = entry.history.pop();
    if (!last) return;
    const set = new Set(entry.usedCharacters);
    for (const c of last.addedChars) set.delete(c);
    entry.usedCharacters = Array.from(set);
    await this.store.set(ally, entry);
  }

  async resetAll(ally: string, eventInstanceId: string, currentRound: number): Promise<void> {
    await this.store.set(ally, { eventInstanceId, currentRound, usedCharacters: [], history: [] });
  }

  async historyDepth(ally: string, eventInstanceId: string, currentRound: number): Promise<number> {
    const entry = await this.loadFresh(ally, eventInstanceId, currentRound);
    return entry.history.length;
  }

  /** Silently overwrite when the stored entry is from a different round/event. */
  private async loadFresh(ally: string, eventInstanceId: string, currentRound: number): Promise<OffenceUsedEntry> {
    const existing = await this.store.get(ally);
    if (existing && existing.eventInstanceId === eventInstanceId && existing.currentRound === currentRound) return existing;
    const fresh: OffenceUsedEntry = { eventInstanceId, currentRound, usedCharacters: [], history: [] };
    await this.store.set(ally, fresh);
    return fresh;
  }
}
