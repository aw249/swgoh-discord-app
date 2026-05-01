import { buildGuildSnapshot, buildCompareSummary } from '../../guildInsights/compareSummary';
import { ComlinkGuildData } from '../../../integrations/comlink/comlinkClient';
import { SwgohGgFullPlayerResponse } from '../../../integrations/swgohGgApi';
import { GameDataService } from '../../gameDataService';

function g(id: string, name: string, members: number, gp: number, memberIds: string[] = []): ComlinkGuildData {
  return {
    guild: {
      profile: {
        id, name, memberCount: members, memberMax: 50, level: 1,
        guildGalacticPower: String(gp),
      },
      member: memberIds.map(playerId => ({
        playerId, playerName: '', playerLevel: 0, memberLevel: 2,
        galacticPower: '0', characterGalacticPower: '0', shipGalacticPower: '0',
        guildJoinTime: '0', lastActivityTime: '0',
      })) as never,
    },
  };
}

function p(name: string, gp: number): SwgohGgFullPlayerResponse {
  return {
    data: {
      ally_code: 0, name, level: 85, galactic_power: gp, character_galactic_power: 0,
      ship_galactic_power: 0, skill_rating: 0, league_name: '', guild_name: '', last_updated: '',
    },
    units: [], mods: [],
  };
}

beforeEach(() => GameDataService.resetInstance());

describe('buildGuildSnapshot', () => {
  it('summarises basic profile fields', () => {
    const guild = g('1', 'Alpha', 3, 100);
    const snap = buildGuildSnapshot(guild, new Map());
    expect(snap.id).toBe('1');
    expect(snap.name).toBe('Alpha');
    expect(snap.memberCount).toBe(3);
    expect(snap.guildGalacticPower).toBe(100);
    expect(snap.glCount.total).toBe(0);
  });

  it('derives topMembers from the roster fan-out, sorted by GP desc', () => {
    const guild = g('1', 'Alpha', 3, 100, ['m1', 'm2', 'm3']);
    const roster = new Map<string, SwgohGgFullPlayerResponse>([
      ['m1', p('Alice', 30)],
      ['m2', p('Bob',   50)],
      ['m3', p('Cara',  20)],
    ]);
    const snap = buildGuildSnapshot(guild, roster);
    expect(snap.topMembers.map(m => m.name)).toEqual(['Bob', 'Alice', 'Cara']);
    expect(snap.topMembers[0].galacticPower).toBe(50);
  });

  it('returns empty topMembers when roster is empty', () => {
    const guild = g('1', 'A', 5, 100, ['m1','m2','m3','m4','m5']);
    const snap = buildGuildSnapshot(guild, new Map());
    expect(snap.topMembers).toEqual([]);
  });

  it('caps topMembers at 10', () => {
    const ids = Array.from({ length: 15 }, (_, i) => `m${i}`);
    const guild = g('1', 'A', 15, 100, ids);
    const roster = new Map(ids.map((id, i) => [id, p(`P${i}`, i)]));
    const snap = buildGuildSnapshot(guild, roster);
    expect(snap.topMembers.length).toBe(10);
  });

  it('parses non-numeric guildGalacticPower defensively', () => {
    const guild = g('1', 'A', 1, 0); guild.guild.profile.guildGalacticPower = 'NOPE';
    expect(buildGuildSnapshot(guild, new Map()).guildGalacticPower).toBe(0);
  });
});

describe('buildCompareSummary', () => {
  it('reports deltas (a − b)', () => {
    const summary = buildCompareSummary(
      g('1', 'Alpha', 50, 600_000_000), new Map(),
      g('2', 'Beta',  48, 580_000_000), new Map()
    );
    expect(summary.gpDelta).toBe(20_000_000);
    expect(summary.memberDelta).toBe(2);
    expect(summary.glDelta).toBe(0);
  });
});
