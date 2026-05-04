# `/gac offence` — counter-planner command

**Status:** approved (revised 2026-05-04 after Comlink probe ruled out live placements; awaiting implementation plan).

## Context

`/gac strategy` is good for pre-round planning but goes stale once the round is live. The team's specific pain point: when a recommended counter loses, the user has no fast way to see the next-best counter for that defence using only the characters they still have available.

`/gac offence` exists to close that gap.

### What we tried first, and why we pivoted

The original design intended to read both the opponent's currently-placed defences AND the user's offence-used characters live from Comlink's bracket `playerStatus` payload. A go/no-go probe (commit `f372d61`-era investigation) confirmed Comlink does not expose this data on any endpoint we can reach: the bracket leaderboard returns empty `squadUnit[]` arrays for every player, and `/player` / `/playerArena` carry only Squad Arena and Fleet Arena placements, not GAC. The SWGOH game client uses an RPC that the public Comlink server doesn't proxy.

The current design abandons "live" and substitutes:
- **Opponent defences:** swgoh.gg's recent-GAC defensive history — the same source `/gac strategy` already uses. These are from previous rounds, not the current round, so the UI is explicit about that.
- **User's offence-used characters:** bot-side state, persistent on disk, auto-clearing across rounds.

This is the trade-off: explicit, honest staleness on the opponent side; explicit user marking on the offence side.

## Goals

- One-command surface: `/gac offence` with no flags. Auto-resolve current opponent from the live bracket.
- Show the opponent's recent defensive squads (per `/gac strategy`'s existing source) as a pickable list.
- Display top 5 counters per chosen defence, filtered by what the user *hasn't* used in offence yet.
- Persistent used-character state per `(allyCode, eventInstanceId, currentRound)`. Round change silently clears.
- Clear UI affordances for manual marking, undo, and full reset.
- Single ephemeral Discord message; "back" navigation re-renders without re-fetching upstream.

## Non-goals (v1)

- **Live current-round defences.** Not available without scraping or reverse-engineering the SWGOH game RPC. Out of scope; the banner is honest.
- **Auto-detection of in-game offence usage.** No data source supplies this. The user marks counters used after they actually play them.
- **`bracket_opponent` / `allycode` flags.** Auto-derived only.
- **No image generation.** View B is plain text.
- **No datacron column.** v1 is roster availability only.
- **No public/shared message.** Ephemeral to the invoker.

## Data sources

| Data | Source | Use |
|---|---|---|
| Your ally code | Existing Discord-user → ally-code binding | Same path `/gac strategy` already uses. |
| Current opponent + bracket coordinates + round | `gacService.getLiveBracketWithOpponent(allyCode)` | Already in-flight-deduped. Returns `currentRound`, `currentOpponent`, `season_id`, `event_id`. |
| Opponent's recent defensive squads | `gacStrategyService.getOpponentDefensiveSquads(opponentAllyCode, format, ...)` | Same scrape `/gac strategy` uses. Cached at the strategy-service layer. |
| Counter source per defence leader | `counterClient.getCounterSquads(leaderBaseId, seasonId)` | Same swgoh.gg counters `/gac strategy` uses. |
| User's roster | `swgohGgClient.getFullPlayer(allyCode)` | Same fetch `/gac strategy` uses. 30s in-memory TTL cache scoped to `/gac offence` to absorb consecutive button clicks. |
| User's used-character set | **NEW** file-backed store at `app/data/offence-used-characters.json`. Schema: `{ [allyCode]: { eventInstanceId: string, currentRound: number, usedCharacters: string[], history: Array<{ counterLeader: string, addedChars: string[] }> } }` | Persistent across restarts. Auto-cleared on round change at load time. `history` is a stack supporting Undo. |

## Slash command surface

```
/gac offence
```

No flags. The handler:

1. Resolves invoking Discord user → ally code.
2. Calls `getLiveBracketWithOpponent(allyCode)` — current opponent, format, season, round.
3. Loads the used-character store for `(allyCode, eventInstanceId, currentRound)`. If the stored round/event differs from current, silently clear and write a fresh entry.
4. Fetches the opponent's recent defensive squads (cached at strategy service).
5. Fetches the user's roster (30s cache).
6. Renders View A.

## UI

Single ephemeral message. Two views, swapped by editing the same message.

### View A — Opponent defences

```
You vs OpponentName · Round 2 · 5v5
Used so far: 12/250 GAC-eligible chars

⚠️ Showing recent-round defences — your opponent may have placed differently this round.

Pick a defence to counter:
[ Queen Amidala ]  [ GLRey ]  [ Stranger ]  [ Master Kenobi ]  [ Rey ]

[ ↺ Undo last ]   [ ↻ Reset all used ]   [ ⟳ Refresh ]
```

- Up to 5 in 5v5 / 10 in 3v3 — fits Discord's 5×5 button grid.
- The orange recent-rounds banner is always visible — non-negotiable, this is the design's explicit honesty about staleness.
- `Undo last` reverses the most recent "Mark used" action. Disabled if `history` is empty.
- `Reset all used` clears the entire used set after a confirmation prompt.
- `Refresh` re-fetches opponent defences and roster (clears the 30s roster cache, re-pulls history scrape).

### View B — Counters for the selected defence

```
Top 5 counters for Queen Amidala (filtered by your available characters)

⚠️ Showing recent-round defences — your opponent may have placed differently this round.

1. GLRey · Ezra · Rey · Ben Solo · BB-8                [ Used #1 ]
2. Boba Fett SoJ · Hondo · Cad Bane · Krrsantan · Bossk [ Used #2 ]
3. Veers · Range Trooper · Snowtrooper · DT · DET       [ Used #3 ]
4. …                                                     [ Used #4 ]
5. …                                                     [ Used #5 ]

[ ← Back ]   [ ↺ Undo last ]   [ ↻ Reset all used ]
```

- Each counter is a row with a `Used #N` button. Clicking it: (a) appends to the used-set store with `counterLeader = N`'s leader baseId and `addedChars = [leader, ...members]`, (b) re-renders View B with that counter removed and the next-best counter promoted into the slot if available, (c) increments the View A "Used so far" count next time the user navigates back.
- `Back` returns to View A. No re-fetch — same opponent defence list, but updated used-count and possibly different "Reset all"/"Undo last" enablement.
- Same `Undo last` and `Reset all used` controls as View A — same backing actions.

### Edge cases

- Opponent has 0 recent defences in their history (new account, first GAC) → View A: "No recent defences found for {opponent}. They may not have a public GAC history yet."
- Picked defence has 0 viable counters → View B: "No counters available — your remaining roster can't field a complete team for this defence."
- User has no live opponent (between rounds) → "You're between rounds — no opponent to counter yet."
- `Reset all used` with an empty set → button disabled.
- `Undo last` with empty history → button disabled.

## Components

| Component | Status | Path | Notes |
|---|---|---|---|
| `offenceUsedStore` | new | `src/storage/offenceUsedStore.ts` | File-backed JSON store mirroring `datacronSnapshotStore` pattern. CRUD per `(allyCode, eventInstanceId, currentRound)`. Atomic write via tmp+rename. |
| `OffenceUsedService` | new | `src/services/offenceUsedService.ts` | Wraps the store with round-change auto-clear and Undo/Reset semantics. Exposes `getUsed(allyCode, season, round) → Set<string>`, `markUsed(...)`, `undoLast(...)`, `resetAll(...)`. |
| `selectTopCountersAvailable` | new | `src/services/gacStrategy/squadMatching/selectTopCountersAvailable.ts` | Per-defence top-5 counter selector with used-character filter. Reuses scoring helpers from `matchCounters.ts`. Pure. |
| `scoringHelpers` | new (refactor) | `src/services/gacStrategy/squadMatching/scoringHelpers.ts` | Extracted shared scoring used by both `matchCountersAgainstRoster` and `selectTopCountersAvailable`. |
| `offenceHandler` | new | `src/commands/gac/offenceHandler.ts` | Slash entrypoint + button-interaction handlers. Owns view rendering and used-state mutations. |
| `offenceViews` | new | `src/commands/gac/offenceViews.ts` | Pure view builders. |
| `offenceRosterCache` | new | `src/commands/gac/offenceRosterCache.ts` | 30s TTL roster cache scoped to `/gac offence`. |
| Live bracket fetch | reused | `gacService.getLiveBracketWithOpponent` | Already in-flight-deduped. Returns `currentRound`, `currentOpponent`, `season_id`, `event_id`. |
| Opponent defence source | reused | `gacStrategyService.getOpponentDefensiveSquads` | Same swgoh.gg scrape `/gac strategy` uses. |
| Counter source | reused | `counterClient.getCounterSquads` | Same as `/gac strategy`. |
| Roster fetch | reused | `swgohGgClient.getFullPlayer` | Wrapped in `offenceRosterCache`. |
| Slash subcommand | new | `src/commands/gac.ts` | 4th subcommand alongside `bracket`, `opponent`, `strategy`. |
| Button dispatch | new | `src/bot/index.ts` | Adds `interaction.isButton()` branch routing `gac:offence:*` custom IDs to `gacCommand.handleButton(...)`. |

## Data flow per interaction

1. Resolve invoking user → ally code.
2. `getLiveBracketWithOpponent(allyCode)` → opponent ally code, format, season+event, currentRound.
3. `OffenceUsedService.getUsed(allyCode, eventInstanceId, currentRound)`:
   - If store has an entry for this ally with a different `eventInstanceId` or `currentRound`, silently overwrite with a fresh empty entry (round-change auto-clear).
   - Return the `Set<string>`.
4. Roster fetch (cached 30s).
5. Opponent defence fetch (cached at strategy-service layer).
6. If interaction is "pick defence" / "Used #N" / "back" / "undo" / "reset" / "refresh": route accordingly, mutate store as needed, re-render.

Steps 1–2 happen on every interaction. Steps 3–5 happen on every interaction except pure UI navigations (e.g. plain `Back`) where state is already in scope.

## Failure modes & graceful degradation

| Failure | Detection | Behaviour |
|---|---|---|
| swgoh.gg history scrape fails | Throws | View A: "⚠️ Couldn't fetch opponent's recent defences — try Refresh in a moment." Refresh button visible. |
| swgoh.gg counter source fails for a leader | Throws inside View B render | "Counter data temporarily unavailable for {leader}." Other defences still pickable from View A. |
| `getLiveBracketWithOpponent` fails | Throws | Same error path `/gac strategy` already has. |
| User has zero viable counters for a chosen defence | `selectTopCountersAvailable` returns `[]` | View B: "No counters available — your remaining roster can't field a complete team for this defence." |
| Used-character store file corrupt / unreadable | JSON parse / FS error | Log warn, treat as empty for this ally. Next `markUsed` writes a clean entry. Don't crash the command. |
| Discord interaction window expired (>15 min) | Button click → `Unknown interaction` | Caught and ignored; user re-invokes. |
| Two rapid `Used #N` clicks before re-render | Race | Each handler reads fresh state, computes new entry, atomic-writes. Last write wins. Client-side double-click is rare; the impact (one extra entry, easily undone) is bounded. |
| `Reset all used` mis-click | User error | Confirmation prompt: "This will clear all used characters for the current round. Confirm?" Two-step button before destructive action. |

## Testing

| Test | Layer | What it verifies |
|---|---|---|
| `offenceUsedStore` round-change clear | unit | Stored entry with `eventInstanceId=A` is overwritten when caller passes `B`. |
| `offenceUsedStore` atomic write | unit | Two concurrent writes don't corrupt the file (same pattern as `datacronSnapshotStore`'s tests). |
| `OffenceUsedService.markUsed` adds to set + history | unit | Set grows by added chars; history stack grows. |
| `OffenceUsedService.undoLast` reverses last `markUsed` | unit | Set returns to pre-`markUsed` size; history pops. Idempotent on empty history. |
| `OffenceUsedService.resetAll` clears set + history | unit | Both empty after reset. |
| `selectTopCountersAvailable` filter | unit | Counter pool of 20 with 5 containing used characters → returns top 5 from unfiltered 15. |
| `selectTopCountersAvailable` undersized roster | unit | Counter requiring an unowned character is excluded. |
| `selectTopCountersAvailable` no viable counters | unit | Returns `[]` when every candidate is filtered. |
| `selectTopCountersAvailable` 3v3 | unit | Respects format size constraint. |
| `offenceViews.buildOpponentListView` | unit | Renders 5 buttons + Undo + Reset + Refresh; banner present; "0 placed" message when empty. |
| `offenceViews.buildCounterListView` | unit | Renders 5 counter rows with `Used #N` buttons; "no counters" branch; banner present. |
| `offenceViews.buildResetConfirmView` | unit | Two-button "Confirm reset / Cancel" view. |
| `offenceHandler` slash entrypoint | unit | Unregistered user → error view. Registered → opponent list with current-round-cleared state. |
| `offenceHandler` Used #N flow | unit | Mock service; verify `markUsed` called with the right counter; verify View B re-renders with that counter dropped. |
| `offenceHandler` Undo / Reset flows | unit | Mock service; verify the right service methods called; UI updates. |
| `offenceHandler` Reset confirmation gate | unit | First click renders confirm view; second click (Confirm) actually resets; Cancel returns. |
| `offenceHandler` round-change clear | integration | Pre-seed store with old `eventInstanceId`; invoke handler; assert store now has fresh entry for current round. |
| End-to-end smoke | integration | Mocks all upstreams (live bracket, history scrape, counters, roster). Slash → pick defence → Used #1 → Back → Undo. Asserts message payload at each step. |

## Open risks

- **Recent-defence staleness.** This is the design's largest user-facing limitation. The banner is the mitigation. If the team finds it unacceptable in practice, the path forward is investigating swgoh.gg's live-bracket page (separate spec).
- **Counter ranking parity.** `selectTopCountersAvailable` reuses scoring via `scoringHelpers.ts` to prevent drift from `matchCountersAgainstRoster`. Maintained as a refactor invariant; reviewed at PR time.
- **Misclick discoverability.** The Undo button must be visible enough that users don't despair after a wrong "Used" click. Design choice: persistent toolbar button on every view (not transient prompt).
