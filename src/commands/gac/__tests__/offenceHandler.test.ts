import { handleOffenceCommand, handleOffenceButton, OffenceDeps } from '../offenceHandler';

function makeFakeInteraction(overrides: Partial<{ customId: string; isCommand: boolean }> = {}) {
  const replies: unknown[] = [];
  return {
    user: { id: 'discord-user-1' },
    customId: overrides.customId,
    deferReply: jest.fn().mockResolvedValue(undefined),
    deferUpdate: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockImplementation((p: unknown) => { replies.push(p); }),
    reply:     jest.fn().mockImplementation((p: unknown) => { replies.push(p); }),
    deferred: false, replied: false,
    isChatInputCommand: () => overrides.isCommand ?? false,
    isButton: () => !!overrides.customId,
    _capturedReplies: replies,
  };
}

function makeFakeDeps(o: Partial<{
  allyCode: string | null;
  liveBracket: unknown;
  defences: unknown[];
  counters: unknown[];
  roster: unknown;
  initialUsed: string[];
  initialHistory: { counterLeader: string; addedChars: string[] }[];
}> = {}) {
  const used = new Set<string>(o.initialUsed ?? []);
  const history = [...(o.initialHistory ?? [])];
  return {
    playerService: { getAllyCode: jest.fn().mockResolvedValue(o.allyCode !== undefined ? o.allyCode : '111') },
    gacService: {
      getLiveBracketWithOpponent: jest.fn().mockResolvedValue(o.liveBracket ?? {
        currentRound: 2, season_id: 'CW21', event_id: 'O1', league: 'KYBER',
        currentOpponent: { ally_code: '999', player_name: 'Reefer' },
      }),
    },
    strategyService: {
      getOpponentDefensiveSquads: jest.fn().mockResolvedValue(o.defences ?? [
        { leader: { baseId: 'QUEEN_AMIDALA' }, members: [{ baseId: 'A' }, { baseId: 'B' }, { baseId: 'C' }, { baseId: 'D' }] },
      ]),
    },
    counterClient: { getCounterSquads: jest.fn().mockResolvedValue(o.counters ?? []) },
    swgohGgClient: { getFullPlayer: jest.fn().mockResolvedValue(o.roster ?? { units: [] }) },
    rosterCache: { get: (_k: string, f: () => Promise<unknown>) => f(), invalidate: jest.fn() } as unknown as OffenceDeps['rosterCache'],
    usedService: {
      getUsed: jest.fn().mockImplementation(async () => new Set(used)),
      markUsed: jest.fn().mockImplementation(async (_a: string, _e: string, _r: number, leader: string, chars: string[]) => {
        chars.forEach(c => used.add(c));
        history.push({ counterLeader: leader, addedChars: chars });
      }),
      undoLast: jest.fn().mockImplementation(async () => {
        const last = history.pop();
        last?.addedChars.forEach(c => used.delete(c));
      }),
      resetAll: jest.fn().mockImplementation(async () => { used.clear(); history.length = 0; }),
      historyDepth: jest.fn().mockImplementation(async () => history.length),
    },
    formatFromLeague: (_league: string) => '5v5' as const,
    displayName: (id: string) => id,
  };
}

describe('handleOffenceCommand — slash entrypoint', () => {
  it('refuses with an error view when the user is not registered', async () => {
    const deps = makeFakeDeps({ allyCode: null });
    const i = makeFakeInteraction({ isCommand: true });
    await handleOffenceCommand(i as never, deps as never);
    expect(JSON.stringify(i._capturedReplies[0])).toMatch(/register/i);
  });

  it('renders View A with opponent + recent-rounds banner', async () => {
    const deps = makeFakeDeps();
    const i = makeFakeInteraction({ isCommand: true });
    await handleOffenceCommand(i as never, deps as never);
    expect(JSON.stringify(i._capturedReplies.at(-1))).toMatch(/Reefer/);
    expect(JSON.stringify(i._capturedReplies.at(-1))).toMatch(/Showing recent-round defences/);
  });

  it('refuses if no live opponent (between rounds)', async () => {
    const deps = makeFakeDeps({ liveBracket: { currentRound: 0, season_id: 'X', event_id: 'Y', league: 'KYBER', currentOpponent: null } });
    const i = makeFakeInteraction({ isCommand: true });
    await handleOffenceCommand(i as never, deps as never);
    expect(JSON.stringify(i._capturedReplies.at(-1))).toMatch(/between rounds/i);
  });
});

describe('handleOffenceButton — flows', () => {
  it('pickdef:<leader> renders View B with top counters', async () => {
    const deps = makeFakeDeps({
      counters: [{ leader: { baseId: 'GLREY', relicLevel: 6, portraitUrl: null }, members: [
        { baseId: 'EZRA', relicLevel: 6, portraitUrl: null },
        { baseId: 'REY', relicLevel: 6, portraitUrl: null },
        { baseId: 'BENSOLO', relicLevel: 6, portraitUrl: null },
        { baseId: 'BB8', relicLevel: 6, portraitUrl: null },
      ], winPercentage: 75, seenCount: 100, avgBanners: 60 }] as never,
    });
    const i = makeFakeInteraction({ customId: 'gac:offence:pickdef:QUEEN_AMIDALA' });
    await handleOffenceButton(i as never, deps as never);
    expect(JSON.stringify(i._capturedReplies.at(-1))).toMatch(/Top 5 counters/);
  });

  it('used:<defence>:<leader> calls markUsed with the right chars', async () => {
    const makeUnit = (base_id: string) => ({
      data: { base_id, rarity: 7, gear_level: 13, relic_tier: 9, combat_type: 1 },
    });
    const deps = makeFakeDeps({
      roster: { units: ['GLREY', 'EZRA', 'REY', 'BENSOLO', 'BB8'].map(makeUnit) },
      counters: [{ leader: { baseId: 'GLREY', relicLevel: 6, portraitUrl: null }, members: [
        { baseId: 'EZRA', relicLevel: 6, portraitUrl: null },
        { baseId: 'REY', relicLevel: 6, portraitUrl: null },
        { baseId: 'BENSOLO', relicLevel: 6, portraitUrl: null },
        { baseId: 'BB8', relicLevel: 6, portraitUrl: null },
      ], winPercentage: 75, seenCount: 100, avgBanners: 60 }] as never,
    });
    const i = makeFakeInteraction({ customId: 'gac:offence:used:QUEEN_AMIDALA:GLREY' });
    await handleOffenceButton(i as never, deps as never);
    expect(deps.usedService.markUsed).toHaveBeenCalledWith(
      '111', 'CW21:O1', 2, 'GLREY',
      ['GLREY', 'EZRA', 'REY', 'BENSOLO', 'BB8'],
    );
  });

  it('back returns to View A', async () => {
    const deps = makeFakeDeps();
    const i = makeFakeInteraction({ customId: 'gac:offence:back' });
    await handleOffenceButton(i as never, deps as never);
    expect(JSON.stringify(i._capturedReplies.at(-1))).toMatch(/Round 2/);
  });

  it('undo calls undoLast', async () => {
    const deps = makeFakeDeps({
      initialUsed: ['GLREY', 'EZRA'],
      initialHistory: [{ counterLeader: 'GLREY', addedChars: ['GLREY', 'EZRA'] }],
    });
    const i = makeFakeInteraction({ customId: 'gac:offence:undo' });
    await handleOffenceButton(i as never, deps as never);
    expect(deps.usedService.undoLast).toHaveBeenCalled();
  });

  it('reset shows confirm view', async () => {
    const deps = makeFakeDeps({ initialUsed: ['A'], initialHistory: [{ counterLeader: 'A', addedChars: ['A'] }] });
    const i = makeFakeInteraction({ customId: 'gac:offence:reset' });
    await handleOffenceButton(i as never, deps as never);
    expect(JSON.stringify(i._capturedReplies.at(-1))).toMatch(/Reset all used characters/);
  });

  it('resetConfirm calls resetAll', async () => {
    const deps = makeFakeDeps({ initialUsed: ['A'], initialHistory: [{ counterLeader: 'A', addedChars: ['A'] }] });
    const i = makeFakeInteraction({ customId: 'gac:offence:resetConfirm' });
    await handleOffenceButton(i as never, deps as never);
    expect(deps.usedService.resetAll).toHaveBeenCalled();
  });

  it('resetCancel returns to View A without calling resetAll', async () => {
    const deps = makeFakeDeps({ initialUsed: ['A'] });
    const i = makeFakeInteraction({ customId: 'gac:offence:resetCancel' });
    await handleOffenceButton(i as never, deps as never);
    expect(deps.usedService.resetAll).not.toHaveBeenCalled();
  });

  it('refresh invalidates the roster cache', async () => {
    const deps = makeFakeDeps();
    const i = makeFakeInteraction({ customId: 'gac:offence:refresh' });
    await handleOffenceButton(i as never, deps as never);
    expect(deps.rosterCache.invalidate).toHaveBeenCalledWith('111');
  });
});
