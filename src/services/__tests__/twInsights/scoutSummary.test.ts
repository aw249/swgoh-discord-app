import sampleGuild from '../fixtures/sampleGuild.json';
import { ComlinkGuildData } from '../../../integrations/comlink/comlinkClient';
import { buildScoutSnapshot } from '../../twInsights/scoutSummary';

const guild = sampleGuild as unknown as ComlinkGuildData;

describe('buildScoutSnapshot', () => {
  it('embeds the GuildSnapshot from Plan 2', () => {
    const snap = buildScoutSnapshot(guild, new Map());
    expect(snap.guild.id).toBe(guild.guild.profile.id);
    expect(snap.guild.name).toBe(guild.guild.profile.name);
  });

  it('returns twAvailable=false and empty pattern when payload has no TW field', () => {
    const stripped: ComlinkGuildData = JSON.parse(JSON.stringify(guild));
    delete (stripped.guild as Record<string, unknown>).recentTerritoryWarResult;
    const snap = buildScoutSnapshot(stripped, new Map());
    expect(snap.twAvailable).toBe(false);
    expect(snap.recentTwPattern).toEqual([]);
  });

  it('derives win/loss from score vs opponentScore (no outcome field in real payload)', () => {
    const tw: ComlinkGuildData = JSON.parse(JSON.stringify(guild));
    (tw.guild as Record<string, unknown>).recentTerritoryWarResult = [
      { territoryWarId: 'tw1', score: '1500', opponentScore: '1000', endTimeSeconds: '0', startTime: '0', power: 0, opponentGuildProfile: { id: 'x', name: 'X', guildGalacticPower: '0' } },
      { territoryWarId: 'tw2', score: '500',  opponentScore: '900',  endTimeSeconds: '0', startTime: '0', power: 0, opponentGuildProfile: { id: 'y', name: 'Y', guildGalacticPower: '0' } },
      { territoryWarId: 'tw3', score: '700',  opponentScore: '700',  endTimeSeconds: '0', startTime: '0', power: 0, opponentGuildProfile: { id: 'z', name: 'Z', guildGalacticPower: '0' } },
    ];
    const snap = buildScoutSnapshot(tw, new Map());
    expect(snap.twAvailable).toBe(true);
    expect(snap.recentTwPattern).toEqual(['win', 'loss', 'unknown']);
  });

  it('caps the pattern at 10 entries', () => {
    const tw: ComlinkGuildData = JSON.parse(JSON.stringify(guild));
    (tw.guild as Record<string, unknown>).recentTerritoryWarResult = Array.from({ length: 25 }, () => ({
      territoryWarId: 'x', score: '10', opponentScore: '5', endTimeSeconds: '0', startTime: '0',
      power: 0, opponentGuildProfile: { id: 'a', name: 'A', guildGalacticPower: '0' },
    }));
    expect(buildScoutSnapshot(tw, new Map()).recentTwPattern.length).toBe(10);
  });

  it('uses the real fixture (8 TW results)', () => {
    // sampleGuild.json was captured from a live probe with 8 TW results.
    // Confirm the parser walks them without crashing and returns a non-empty pattern.
    const snap = buildScoutSnapshot(guild, new Map());
    expect(snap.twAvailable).toBe(true);
    expect(snap.recentTwPattern.length).toBeGreaterThan(0);
    expect(snap.recentTwPattern.length).toBeLessThanOrEqual(10);
  });
});
