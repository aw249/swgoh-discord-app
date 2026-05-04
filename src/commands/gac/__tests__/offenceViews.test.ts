import {
  buildOpponentListView, buildCounterListView, buildResetConfirmView, buildErrorView,
  CUSTOM_IDS,
} from '../offenceViews';
import { UniqueDefensiveSquad } from '../../../types/gacStrategyTypes';
import { GacCounterSquad } from '../../../types/swgohGgTypes';

function defence(leader: string): UniqueDefensiveSquad {
  return {
    leader: { baseId: leader, gearLevel: 13, relicLevel: 6, portraitUrl: null },
    members: [
      { baseId: 'A', gearLevel: 13, relicLevel: 6, portraitUrl: null },
      { baseId: 'B', gearLevel: 13, relicLevel: 6, portraitUrl: null },
      { baseId: 'C', gearLevel: 13, relicLevel: 6, portraitUrl: null },
      { baseId: 'D', gearLevel: 13, relicLevel: 6, portraitUrl: null },
    ],
  };
}

function counter(leader: string, members: string[]): GacCounterSquad {
  return {
    leader: { baseId: leader, relicLevel: 6, portraitUrl: null },
    members: members.map(m => ({ baseId: m, relicLevel: 6, portraitUrl: null })),
    winPercentage: 75, seenCount: 100, avgBanners: 60,
  };
}

const displayName = (id: string) => id;

function flatComponents(view: { components?: readonly unknown[] | unknown[] }) {
  return (view.components ?? []).flatMap(r => (r as { components: unknown[] }).components);
}

describe('buildOpponentListView', () => {
  it('renders one button per defence + Undo + Reset + Refresh', () => {
    const view = buildOpponentListView({
      opponentName: 'TestOpp', round: 2, format: '5v5',
      usedCount: 12, eligibleCount: 250,
      opponentDefences: [defence('QUEEN_AMIDALA'), defence('GLREY')],
      historyDepth: 2, errorBanner: null, displayName,
    });
    const ids = flatComponents(view).map((c: unknown) => (c as { data?: { custom_id?: string } }).data?.custom_id);
    expect(ids.filter((id?: string) => id?.startsWith(CUSTOM_IDS.PICK_DEFENCE_PREFIX))).toHaveLength(2);
    expect(ids).toContain(CUSTOM_IDS.UNDO);
    expect(ids).toContain(CUSTOM_IDS.RESET);
    expect(ids).toContain(CUSTOM_IDS.REFRESH);
  });

  it('always shows the recent-rounds banner', () => {
    const view = buildOpponentListView({
      opponentName: 'X', round: 1, format: '5v5',
      usedCount: 0, eligibleCount: 250,
      opponentDefences: [defence('GLREY')],
      historyDepth: 0, errorBanner: null, displayName,
    });
    expect(JSON.stringify(view.embeds)).toMatch(/Showing recent-round defences/);
  });

  it('disables Undo when historyDepth=0 and Reset when usedCount=0', () => {
    const view = buildOpponentListView({
      opponentName: 'X', round: 1, format: '5v5',
      usedCount: 0, eligibleCount: 250,
      opponentDefences: [defence('GLREY')],
      historyDepth: 0, errorBanner: null, displayName,
    });
    const flat = flatComponents(view);
    const undo = flat.find((c: unknown) => (c as { data?: { custom_id?: string } }).data?.custom_id === CUSTOM_IDS.UNDO);
    const reset = flat.find((c: unknown) => (c as { data?: { custom_id?: string } }).data?.custom_id === CUSTOM_IDS.RESET);
    expect((undo as { data: { disabled?: boolean } }).data.disabled).toBe(true);
    expect((reset as { data: { disabled?: boolean } }).data.disabled).toBe(true);
  });

  it('shows "no recent defences" message when list is empty', () => {
    const view = buildOpponentListView({
      opponentName: 'X', round: 1, format: '5v5',
      usedCount: 0, eligibleCount: 250,
      opponentDefences: [], historyDepth: 0, errorBanner: null, displayName,
    });
    expect(JSON.stringify(view.embeds)).toMatch(/No recent defences found/);
  });

  it('renders an error banner when errorBanner is set', () => {
    const view = buildOpponentListView({
      opponentName: 'X', round: 1, format: '5v5',
      usedCount: 0, eligibleCount: 250,
      opponentDefences: [defence('GLREY')],
      historyDepth: 0, errorBanner: 'Couldn\'t fetch opponent.', displayName,
    });
    expect(JSON.stringify(view.embeds)).toMatch(/Couldn.t fetch opponent/);
  });
});

describe('buildCounterListView', () => {
  it('renders top counters with one Used #N button per row + Back + Undo + Reset', () => {
    const view = buildCounterListView({
      defenceLeader: 'QUEEN_AMIDALA', defenceLeaderDisplay: 'Queen Amidala',
      counters: [
        counter('GLREY', ['EZRA', 'REY', 'BENSOLO', 'BB8']),
        counter('JKL',   ['HERMIT', 'GAS', 'CT5555', 'CT7567']),
      ],
      historyDepth: 1, hasUsed: true, displayName,
    });
    const ids = flatComponents(view).map((c: unknown) => (c as { data?: { custom_id?: string } }).data?.custom_id);
    expect(ids.filter((id?: string) => id?.startsWith(CUSTOM_IDS.MARK_USED_PREFIX))).toHaveLength(2);
    expect(ids).toContain(CUSTOM_IDS.BACK);
    expect(ids).toContain(CUSTOM_IDS.UNDO);
    expect(ids).toContain(CUSTOM_IDS.RESET);
  });

  it('shows "no counters available" when list is empty', () => {
    const view = buildCounterListView({
      defenceLeader: 'X', defenceLeaderDisplay: 'X',
      counters: [], historyDepth: 0, hasUsed: false, displayName,
    });
    expect(JSON.stringify(view.embeds)).toMatch(/No counters available/);
  });

  it('always shows the recent-rounds banner', () => {
    const view = buildCounterListView({
      defenceLeader: 'X', defenceLeaderDisplay: 'X',
      counters: [counter('GLREY', ['EZRA','REY','BENSOLO','BB8'])],
      historyDepth: 0, hasUsed: false, displayName,
    });
    expect(JSON.stringify(view.embeds)).toMatch(/Showing recent-round defences/);
  });
});

describe('buildResetConfirmView', () => {
  it('renders Confirm + Cancel buttons', () => {
    const view = buildResetConfirmView();
    const ids = flatComponents(view).map((c: unknown) => (c as { data?: { custom_id?: string } }).data?.custom_id);
    expect(ids).toContain(CUSTOM_IDS.RESET_CONFIRM);
    expect(ids).toContain(CUSTOM_IDS.RESET_CANCEL);
  });
});

describe('buildErrorView', () => {
  it('returns an ephemeral message with the error text', () => {
    const view = buildErrorView('You are between rounds.');
    expect(view.ephemeral).toBe(true);
    expect(JSON.stringify(view.embeds)).toMatch(/between rounds/);
  });
});
