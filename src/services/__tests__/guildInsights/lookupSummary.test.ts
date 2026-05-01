import { isLikelyGuildId, summariseLookup } from '../../guildInsights/lookupSummary';
import { GuildLookupRow } from '../../guildInsights/types';

describe('isLikelyGuildId', () => {
  it('treats 22-char alphanumeric as an ID', () => {
    expect(isLikelyGuildId('aBcDeFgHiJkLmNoPqRsTuV')).toBe(true);
  });
  it('rejects shorter strings', () => { expect(isLikelyGuildId('abc123')).toBe(false); });
  it('rejects strings with whitespace', () => { expect(isLikelyGuildId('a B')).toBe(false); });
  it('accepts 20–30 chars', () => {
    expect(isLikelyGuildId('a'.repeat(20))).toBe(true);
    expect(isLikelyGuildId('a'.repeat(30))).toBe(true);
    expect(isLikelyGuildId('a'.repeat(31))).toBe(false);
  });
});

describe('summariseLookup', () => {
  const a: GuildLookupRow = { id: 'a'.repeat(22), name: 'Alpha', memberCount: 50, guildGalacticPower: 600_000_000 };
  const b: GuildLookupRow = { id: 'b'.repeat(22), name: 'Beta',  memberCount: 50, guildGalacticPower: 590_000_000 };

  it('empty when no candidates', () => { expect(summariseLookup([])).toEqual({ kind: 'empty' }); });
  it('profile when single candidate', () => {
    const r = summariseLookup([a]);
    expect(r.kind).toBe('profile');
    expect(r.profile?.id).toBe(a.id);
  });
  it('list when multiple, sorted by GP desc', () => {
    const r = summariseLookup([b, a]);
    expect(r.kind).toBe('list');
    expect(r.candidates?.[0].id).toBe(a.id);
  });
});
