// src/services/__tests__/offenceSmoke.test.ts

import { handleOffenceCommand, handleOffenceButton } from '../../commands/gac/offenceHandler';
import { OffenceUsedStore } from '../../storage/offenceUsedStore';
import { OffenceUsedService } from '../offenceUsedService';
import { OffenceRosterCache } from '../../commands/gac/offenceRosterCache';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('/gac offence — end-to-end smoke', () => {
  it('slash → pick defence → mark used → undo restores state', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'offence-smoke-'));
    const store = new OffenceUsedStore(join(dir, 'used.json'));
    const used = new OffenceUsedService(store);

    const captured: unknown[] = [];
    const baseInteraction = () => ({
      user: { id: 'discord-1' },
      deferReply: jest.fn(), deferUpdate: jest.fn(),
      editReply: (p: unknown) => { captured.push(p); },
      reply: (p: unknown) => { captured.push(p); },
      deferred: false, replied: false,
      isChatInputCommand: () => true, isButton: () => false,
    });

    const counterPool = [{
      leader: { baseId: 'GLREY', relicLevel: 6, portraitUrl: null },
      members: [
        { baseId: 'EZRA',    relicLevel: 6, portraitUrl: null },
        { baseId: 'REY',     relicLevel: 6, portraitUrl: null },
        { baseId: 'BENSOLO', relicLevel: 6, portraitUrl: null },
        { baseId: 'BB8',     relicLevel: 6, portraitUrl: null },
      ],
      winPercentage: 75, seenCount: 100, avgBanners: 60,
    }];

    const deps = {
      playerService: { getAllyCode: async () => '111' },
      gacService: { getLiveBracketWithOpponent: async () => ({
        currentRound: 1, season_id: 'CW21', event_id: 'O1', league: 'KYBER',
        currentOpponent: { ally_code: '999', player_name: 'Reefer' },
      }) },
      strategyService: { getOpponentDefensiveSquads: async () => [
        { leader: { baseId: 'QUEEN_AMIDALA' }, members: [
          { baseId: 'A' }, { baseId: 'B' }, { baseId: 'C' }, { baseId: 'D' },
        ] },
      ] },
      counterClient: { getCounterSquads: async () => counterPool },
      swgohGgClient: { getFullPlayer: async () => ({
        units: [
          { data: { base_id: 'GLREY',   rarity: 7, gear_level: 13, relic_tier: 8, combat_type: 1 } },
          { data: { base_id: 'EZRA',    rarity: 7, gear_level: 13, relic_tier: 8, combat_type: 1 } },
          { data: { base_id: 'REY',     rarity: 7, gear_level: 13, relic_tier: 8, combat_type: 1 } },
          { data: { base_id: 'BENSOLO', rarity: 7, gear_level: 13, relic_tier: 8, combat_type: 1 } },
          { data: { base_id: 'BB8',     rarity: 7, gear_level: 13, relic_tier: 8, combat_type: 1 } },
        ],
      }) },
      rosterCache: new OffenceRosterCache({ ttlMs: 30_000 }),
      usedService: used,
      formatFromLeague: (_l: string) => '5v5' as const,
      displayName: (id: string) => id,
    };

    // 1) Slash → View A
    await handleOffenceCommand(baseInteraction() as never, deps as never);
    expect(JSON.stringify(captured.at(-1))).toMatch(/Reefer/);

    // 2) Pick defence → View B
    await handleOffenceButton({
      ...baseInteraction(),
      customId: 'gac:offence:pickdef:QUEEN_AMIDALA',
      isChatInputCommand: () => false, isButton: () => true,
    } as never, deps as never);
    expect(JSON.stringify(captured.at(-1))).toMatch(/Top 5 counters/);

    // 3) Mark used
    await handleOffenceButton({
      ...baseInteraction(),
      customId: 'gac:offence:used:QUEEN_AMIDALA:0',
      isChatInputCommand: () => false, isButton: () => true,
    } as never, deps as never);
    expect((await used.getUsed('111', 'CW21:O1', 1)).size).toBe(5);

    // 4) Undo restores
    await handleOffenceButton({
      ...baseInteraction(),
      customId: 'gac:offence:undo',
      isChatInputCommand: () => false, isButton: () => true,
    } as never, deps as never);
    expect((await used.getUsed('111', 'CW21:O1', 1)).size).toBe(0);

    await fs.rm(dir, { recursive: true, force: true });
  });
});
