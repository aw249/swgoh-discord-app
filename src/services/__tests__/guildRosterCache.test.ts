import { GuildRosterCache } from '../guildRosterCache';
import { SwgohGgFullPlayerResponse } from '../../integrations/swgohGgApi';

function fakePlayer(name: string): SwgohGgFullPlayerResponse {
  return {
    data: {
      ally_code: 1, name, level: 85, galactic_power: 1, character_galactic_power: 0,
      ship_galactic_power: 0, skill_rating: 0, league_name: '', guild_name: '', last_updated: '',
    },
    units: [], mods: [],
  };
}

describe('GuildRosterCache', () => {
  it('returns null on miss', () => {
    expect(new GuildRosterCache().get('g', 'a')).toBeNull();
  });

  it('returns set value within TTL', () => {
    const c = new GuildRosterCache();
    c.set('g', 'a', fakePlayer('Alice'));
    expect(c.get('g', 'a')?.data.name).toBe('Alice');
  });

  it('evicts oldest entry when over capacity', () => {
    const c = new GuildRosterCache({ maxEntries: 2 });
    c.set('g', 'a', fakePlayer('A'));
    c.set('g', 'b', fakePlayer('B'));
    c.set('g', 'c', fakePlayer('C'));
    expect(c.get('g', 'a')).toBeNull();
    expect(c.get('g', 'b')).not.toBeNull();
    expect(c.get('g', 'c')).not.toBeNull();
  });

  it('refreshes LRU position on get', () => {
    const c = new GuildRosterCache({ maxEntries: 2 });
    c.set('g', 'a', fakePlayer('A'));
    c.set('g', 'b', fakePlayer('B'));
    c.get('g', 'a');
    c.set('g', 'c', fakePlayer('C'));
    expect(c.get('g', 'a')).not.toBeNull();
    expect(c.get('g', 'b')).toBeNull();
  });

  it('drops entries past the TTL', () => {
    let now = 1000;
    const c = new GuildRosterCache({ ttlMs: 100, now: () => now });
    c.set('g', 'a', fakePlayer('A'));
    expect(c.get('g', 'a')).not.toBeNull();
    now = 1101;
    expect(c.get('g', 'a')).toBeNull();
  });
});
