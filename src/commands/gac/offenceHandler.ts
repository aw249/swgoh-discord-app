import { ChatInputCommandInteraction, ButtonInteraction, InteractionEditReplyOptions } from 'discord.js';
import { selectTopCountersAvailable } from '../../services/gacStrategy/squadMatching/selectTopCountersAvailable';
import { OffenceRosterCache } from './offenceRosterCache';
import {
  buildOpponentListView, buildCounterListView, buildResetConfirmView, buildErrorView,
  CUSTOM_IDS,
} from './offenceViews';

// The view builders return InteractionReplyOptions (which includes ephemeral).
// editReply only accepts InteractionEditReplyOptions. Discord actually honours the
// ephemeral flag on edits too but the typings disagree; cast away the mismatch.
function asEditPayload(v: ReturnType<typeof buildErrorView>): InteractionEditReplyOptions {
  return v as unknown as InteractionEditReplyOptions;
}

export interface OffenceDeps {
  playerService:    { getAllyCode(discordUserId: string): Promise<string | null> };
  gacService:       {
    getLiveBracketWithOpponent(allyCode: string): Promise<{
      currentRound: number; season_id: string; event_id: string; league: string;
      currentOpponent: { ally_code: string | number; player_name: string } | null;
    }>;
  };
  strategyService:  { getOpponentDefensiveSquads(allyCode: string, format: string): Promise<unknown[]> };
  counterClient:    { getCounterSquads(leaderBaseId: string, seasonId?: string): Promise<unknown[]> };
  swgohGgClient:    { getFullPlayer(allyCode: string): Promise<unknown> };
  rosterCache:      OffenceRosterCache;
  usedService:      {
    getUsed(allyCode: string, eventInstanceId: string, currentRound: number): Promise<Set<string>>;
    markUsed(allyCode: string, eventInstanceId: string, currentRound: number, counterLeader: string, chars: string[]): Promise<void>;
    undoLast(allyCode: string, eventInstanceId: string, currentRound: number): Promise<void>;
    resetAll(allyCode: string, eventInstanceId: string, currentRound: number): Promise<void>;
    historyDepth(allyCode: string, eventInstanceId: string, currentRound: number): Promise<number>;
  };
  formatFromLeague: (league: string) => '5v5' | '3v3';
  displayName:      (baseId: string) => string;
}

interface State {
  allyCode: string;
  eventInstanceId: string;
  currentRound: number;
  format: '5v5' | '3v3';
  league: string;
  opponentName: string;
  opponentAllyCode: string;
  used: Set<string>;
  historyDepth: number;
  defences: unknown[];
  roster: unknown;
  eligibleCount: number;
  errorBanner: string | null;
}

async function loadState(discordUserId: string, deps: OffenceDeps): Promise<State | { error: string }> {
  const allyCode = await deps.playerService.getAllyCode(discordUserId);
  if (!allyCode) return { error: 'You need to register your ally code first. Use `/register` to link your account.' };

  const live = await deps.gacService.getLiveBracketWithOpponent(allyCode);
  if (!live.currentOpponent) return { error: 'You\'re between rounds — no opponent to counter yet.' };

  const eventInstanceId = `${live.season_id}:${live.event_id}`;
  const format = deps.formatFromLeague(live.league);

  const used = await deps.usedService.getUsed(allyCode, eventInstanceId, live.currentRound);
  const historyDepth = await deps.usedService.historyDepth(allyCode, eventInstanceId, live.currentRound);

  let defences: unknown[] = [];
  let errorBanner: string | null = null;
  try {
    defences = await deps.strategyService.getOpponentDefensiveSquads(String(live.currentOpponent.ally_code), format);
  } catch {
    errorBanner = 'Couldn\'t fetch opponent\'s recent defences — try Refresh in a moment.';
  }

  const roster = await deps.rosterCache.get(allyCode, () => deps.swgohGgClient.getFullPlayer(allyCode));

  return {
    allyCode, eventInstanceId, currentRound: live.currentRound, format, league: live.league,
    opponentName: live.currentOpponent.player_name,
    opponentAllyCode: String(live.currentOpponent.ally_code),
    used, historyDepth,
    defences, roster,
    eligibleCount: countEligibleChars(roster),
    errorBanner,
  };
}

function countEligibleChars(roster: unknown): number {
  const r = roster as { units?: Array<{ data: { rarity: number; combat_type: number } }> };
  return (r.units ?? []).filter(u => u.data.rarity >= 7 && u.data.combat_type === 1).length;
}

function renderViewA(s: State, deps: OffenceDeps) {
  return buildOpponentListView({
    opponentName: s.opponentName, round: s.currentRound, format: s.format,
    usedCount: s.used.size, eligibleCount: s.eligibleCount,
    opponentDefences: s.defences as never,
    historyDepth: s.historyDepth,
    errorBanner: s.errorBanner,
    displayName: deps.displayName,
  });
}

async function renderViewB(s: State, defenceLeader: string, deps: OffenceDeps) {
  const def = (s.defences as Array<{ leader: { baseId: string } }>).find(d => d.leader.baseId === defenceLeader);
  if (!def) return renderViewA(s, deps);

  let counters: unknown[];
  try {
    counters = await deps.counterClient.getCounterSquads(defenceLeader, s.eventInstanceId);
  } catch {
    return buildCounterListView({
      defenceLeader, defenceLeaderDisplay: deps.displayName(defenceLeader),
      counters: [], historyDepth: s.historyDepth, hasUsed: s.used.size > 0,
      displayName: deps.displayName,
    });
  }

  const top = selectTopCountersAvailable(
    counters as never, def as never, s.roster as never, s.used, s.format,
  );
  return buildCounterListView({
    defenceLeader, defenceLeaderDisplay: deps.displayName(defenceLeader),
    counters: top, historyDepth: s.historyDepth, hasUsed: s.used.size > 0,
    displayName: deps.displayName,
  });
}

export async function handleOffenceCommand(
  interaction: ChatInputCommandInteraction,
  deps: OffenceDeps,
): Promise<void> {
  await interaction.deferReply({ ephemeral: true });
  const state = await loadState(interaction.user.id, deps);
  if ('error' in state) { await interaction.editReply(asEditPayload(buildErrorView(state.error))); return; }
  await interaction.editReply(asEditPayload(renderViewA(state, deps)));
}

export async function handleOffenceButton(
  interaction: ButtonInteraction,
  deps: OffenceDeps,
): Promise<void> {
  const customId = interaction.customId;

  // Invalidate roster cache before deferring so that the subsequent loadState
  // re-fetches fresh roster data.
  if (customId === CUSTOM_IDS.REFRESH) {
    const ally = await deps.playerService.getAllyCode(interaction.user.id);
    if (ally) deps.rosterCache.invalidate(ally);
  }

  await interaction.deferUpdate();

  const state = await loadState(interaction.user.id, deps);
  if ('error' in state) { await interaction.editReply(asEditPayload(buildErrorView(state.error))); return; }

  // Reset confirmation:
  if (customId === CUSTOM_IDS.RESET) { await interaction.editReply(asEditPayload(buildResetConfirmView())); return; }
  if (customId === CUSTOM_IDS.RESET_CONFIRM) {
    await deps.usedService.resetAll(state.allyCode, state.eventInstanceId, state.currentRound);
    const fresh = await loadState(interaction.user.id, deps);
    if ('error' in fresh) { await interaction.editReply(asEditPayload(buildErrorView(fresh.error))); return; }
    await interaction.editReply(asEditPayload(renderViewA(fresh, deps)));
    return;
  }
  if (customId === CUSTOM_IDS.RESET_CANCEL) { await interaction.editReply(asEditPayload(renderViewA(state, deps))); return; }

  // Undo:
  if (customId === CUSTOM_IDS.UNDO) {
    await deps.usedService.undoLast(state.allyCode, state.eventInstanceId, state.currentRound);
    const fresh = await loadState(interaction.user.id, deps);
    if ('error' in fresh) { await interaction.editReply(asEditPayload(buildErrorView(fresh.error))); return; }
    await interaction.editReply(asEditPayload(renderViewA(fresh, deps)));
    return;
  }

  // Pick defence → View B:
  if (customId.startsWith(CUSTOM_IDS.PICK_DEFENCE_PREFIX)) {
    const leader = customId.slice(CUSTOM_IDS.PICK_DEFENCE_PREFIX.length);
    await interaction.editReply(asEditPayload(await renderViewB(state, leader, deps)));
    return;
  }

  // Mark used → mutate then re-render View B:
  if (customId.startsWith(CUSTOM_IDS.MARK_USED_PREFIX)) {
    const [defenceLeader, counterLeader] = customId.slice(CUSTOM_IDS.MARK_USED_PREFIX.length).split(':');
    const def = (state.defences as Array<{ leader: { baseId: string } }>).find(d => d.leader.baseId === defenceLeader);
    if (def) {
      const counters = await deps.counterClient.getCounterSquads(defenceLeader, state.eventInstanceId).catch(() => [] as unknown[]);
      const top = selectTopCountersAvailable(
        counters as never, def as never, state.roster as never, state.used, state.format,
      );
      const picked = top.find(c => c.leader.baseId === counterLeader);
      if (picked) {
        const chars = [picked.leader.baseId, ...picked.members.map(m => m.baseId)];
        await deps.usedService.markUsed(state.allyCode, state.eventInstanceId, state.currentRound, counterLeader, chars);
      }
    }
    const fresh = await loadState(interaction.user.id, deps);
    if ('error' in fresh) { await interaction.editReply(asEditPayload(buildErrorView(fresh.error))); return; }
    await interaction.editReply(asEditPayload(await renderViewB(fresh, defenceLeader, deps)));
    return;
  }

  // Back → View A:
  if (customId === CUSTOM_IDS.BACK) { await interaction.editReply(asEditPayload(renderViewA(state, deps))); return; }

  // Refresh → re-render View A (cache already invalidated above).
  if (customId === CUSTOM_IDS.REFRESH) { await interaction.editReply(asEditPayload(renderViewA(state, deps))); return; }

  // Unknown — fall back to View A.
  await interaction.editReply(asEditPayload(renderViewA(state, deps)));
}
