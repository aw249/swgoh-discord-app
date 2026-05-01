import { SwgohGgFullPlayerResponse } from '../integrations/swgohGgApi';

export interface GuildRosterCacheOptions {
  maxEntries?: number;
  ttlMs?: number;
  now?: () => number;
}

interface Entry {
  value: SwgohGgFullPlayerResponse;
  storedAt: number;
}

const DEFAULT_MAX = 500;
const DEFAULT_TTL = 30 * 60 * 1000;

export class GuildRosterCache {
  private readonly maxEntries: number;
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly map = new Map<string, Entry>();

  constructor(opts: GuildRosterCacheOptions = {}) {
    this.maxEntries = opts.maxEntries ?? DEFAULT_MAX;
    this.ttlMs = opts.ttlMs ?? DEFAULT_TTL;
    this.now = opts.now ?? Date.now;
  }

  private static keyOf(guildId: string, allyCode: string): string {
    return `${guildId}:${allyCode}`;
  }

  get(guildId: string, allyCode: string): SwgohGgFullPlayerResponse | null {
    const key = GuildRosterCache.keyOf(guildId, allyCode);
    const entry = this.map.get(key);
    if (!entry) return null;
    if (this.now() - entry.storedAt > this.ttlMs) {
      this.map.delete(key);
      return null;
    }
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  set(guildId: string, allyCode: string, value: SwgohGgFullPlayerResponse): void {
    const key = GuildRosterCache.keyOf(guildId, allyCode);
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, { value, storedAt: this.now() });
    while (this.map.size > this.maxEntries) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }

  size(): number { return this.map.size; }
  clear(): void { this.map.clear(); }
}
