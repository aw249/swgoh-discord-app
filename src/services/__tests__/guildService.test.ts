import sampleGuild from './fixtures/sampleGuild.json';
import { GuildService } from '../guildService';
import { GuildRosterCache } from '../guildRosterCache';
import { ComlinkGuildData } from '../../integrations/comlink/comlinkClient';
import { SwgohGgFullPlayerResponse } from '../../integrations/swgohGgApi';

const guild = sampleGuild as unknown as ComlinkGuildData;

interface FakeClient {
  getGuild: jest.Mock;
  searchGuildsByName: jest.Mock;
  getFullPlayer: jest.Mock;
  getComlinkClient: jest.Mock;
}

function fakePlayer(name: string): SwgohGgFullPlayerResponse {
  return {
    data: {
      ally_code: 0, name, level: 85, galactic_power: 1, character_galactic_power: 0,
      ship_galactic_power: 0, skill_rating: 0, league_name: '', guild_name: '', last_updated: '',
    },
    units: [], mods: [],
  };
}

function makeClient(over: Partial<FakeClient> = {}): FakeClient {
  return {
    getGuild: jest.fn().mockResolvedValue(guild),
    searchGuildsByName: jest.fn().mockResolvedValue({ guild: [] }),
    getFullPlayer: jest.fn().mockImplementation((ac: string) => Promise.resolve(fakePlayer(`P-${ac}`))),
    getComlinkClient: jest.fn().mockReturnValue({
      getPlayerById: jest.fn().mockImplementation((pid: string) => Promise.resolve({
        allyCode: `AC-${pid}`, name: `Member-${pid}`, level: 85,
      })),
      getPlayer: jest.fn().mockResolvedValue({ guildId: 'guild-x', name: 'Self' }),
    }),
    ...over,
  };
}

describe('GuildService', () => {
  describe('lookup', () => {
    it('22-char query → direct fetch', async () => {
      const client = makeClient();
      const svc = new GuildService(client as never, new GuildRosterCache());
      await svc.lookup('a'.repeat(22));
      expect(client.getGuild).toHaveBeenCalledWith('a'.repeat(22), false);
    });

    it('short query → search', async () => {
      const client = makeClient();
      const svc = new GuildService(client as never, new GuildRosterCache());
      await svc.lookup('Alpha');
      expect(client.searchGuildsByName).toHaveBeenCalledWith('Alpha');
    });

    it('returns empty when search returns null', async () => {
      const client = makeClient({ searchGuildsByName: jest.fn().mockResolvedValue(null) });
      const svc = new GuildService(client as never, new GuildRosterCache());
      expect((await svc.lookup('X')).kind).toBe('empty');
    });

    it('parses real-shape search response into candidates', async () => {
      const client = makeClient({ searchGuildsByName: jest.fn().mockResolvedValue({
        guild: [
          { id: 'g1', name: 'One', memberCount: 50, guildGalacticPower: '600000000' },
          { id: 'g2', name: 'Two', memberCount: 50, guildGalacticPower: '500000000' },
        ],
      })});
      const svc = new GuildService(client as never, new GuildRosterCache());
      const r = await svc.lookup('One');
      expect(r.kind).toBe('list');
      expect(r.candidates?.length).toBe(2);
    });
  });

  describe('getGuildRoster', () => {
    it('caches members on first run', async () => {
      const client = makeClient();
      const cache = new GuildRosterCache();
      const svc = new GuildService(client as never, cache);
      await svc.getGuildRoster(guild);
      expect(cache.size()).toBe(guild.guild.member.length);
    });

    it('skips cached members on second run', async () => {
      const client = makeClient();
      const cache = new GuildRosterCache();
      const svc = new GuildService(client as never, cache);
      await svc.getGuildRoster(guild);
      client.getFullPlayer.mockClear();
      await svc.getGuildRoster(guild);
      expect(client.getFullPlayer).not.toHaveBeenCalled();
    });

    it('survives partial fan-out failure', async () => {
      let call = 0;
      const client = makeClient({
        getFullPlayer: jest.fn().mockImplementation(() => {
          call += 1;
          if (call === 2) return Promise.reject(new Error('boom'));
          return Promise.resolve(fakePlayer(`P${call}`));
        }),
      });
      const svc = new GuildService(client as never, new GuildRosterCache());
      const roster = await svc.getGuildRoster(guild);
      expect(roster.size).toBeLessThan(guild.guild.member.length);
    });
  });

  describe('resolveCallerGuildId', () => {
    it('returns guildId from Comlink player record', async () => {
      const client = makeClient();
      const svc = new GuildService(client as never, new GuildRosterCache());
      const id = await svc.resolveCallerGuildId('123456789');
      expect(id).toBe('guild-x');
    });
  });
});
