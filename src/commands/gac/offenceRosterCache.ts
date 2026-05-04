interface CacheEntry<T> { value: T; storedAt: number; }

export interface OffenceRosterCacheOptions {
  ttlMs: number;
  now?: () => number;
}

export class OffenceRosterCache<T = unknown> {
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly store = new Map<string, CacheEntry<T>>();

  constructor(opts: OffenceRosterCacheOptions) {
    this.ttlMs = opts.ttlMs;
    this.now = opts.now ?? (() => Date.now());
  }

  async get(key: string, fetcher: () => Promise<T>): Promise<T> {
    const existing = this.store.get(key);
    if (existing && this.now() - existing.storedAt < this.ttlMs) return existing.value;
    const fresh = await fetcher();
    this.store.set(key, { value: fresh, storedAt: this.now() });
    return fresh;
  }

  invalidate(key: string): void { this.store.delete(key); }
}
