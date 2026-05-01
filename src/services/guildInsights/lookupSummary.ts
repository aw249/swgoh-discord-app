import { GuildLookupResult, GuildLookupRow } from './types';

const ID_PATTERN = /^[A-Za-z0-9_-]{20,30}$/;

export function isLikelyGuildId(query: string): boolean {
  return ID_PATTERN.test(query.trim());
}

export function summariseLookup(candidates: GuildLookupRow[]): GuildLookupResult {
  if (candidates.length === 0) return { kind: 'empty' };
  const sorted = [...candidates].sort((a, b) => b.guildGalacticPower - a.guildGalacticPower);
  if (sorted.length === 1) return { kind: 'profile', profile: { ...sorted[0] } };
  return { kind: 'list', candidates: sorted.slice(0, 10) };
}
