# `/gac offence` — live offence-planner command

**Status:** approved (brainstorming complete 2026-05-04), awaiting implementation plan.

## Context

`/gac strategy` is good for pre-round planning but goes stale once the round is live. The team's specific pain point: when a recommended counter loses, the user has no fast way to see the next-best counter for that defence using only the characters they still have available.

`/gac offence` exists to close that gap. It is a live, mid-round companion: pick which of the opponent's currently-placed defences you want to attack, see the top 5 counters from your *currently-available* characters (i.e. excluding everything you've already used in offence this round), then go and take the battle.

The feature is fully dynamic. The bot keeps no per-user "used characters" state. The Comlink bracket payload is the single source of truth: every Discord interaction triggers a fresh fetch, so the displayed counters always reflect what the game itself thinks is available.

## Goals

- One-command surface: `/gac offence` with no flags. The bot resolves your saved ally code, your current opponent, and the bracket format automatically.
- Live opponent defences from Comlink (`playerStatus`), not stale recent-round history.
- Live offence-history from the same payload — characters you've already deployed this round are filtered out of counter suggestions automatically.
- Top 5 counters per chosen defence, ranked using the existing scoring used by `matchCountersAgainstRoster`.
- Single ephemeral Discord message; "back" navigation re-fetches state so subsequent picks reflect the latest game state.
- Fail honestly: if a data source degrades, banner the user — never silently substitute fake state.

## Non-goals (v1)

- **No bot-side persistence.** No DB, no in-memory map keyed on user+round, no Undo/Reset buttons. The game state is the state.
- **No `bracket_opponent` / `allycode` flags.** The live bracket already names your current opponent; scouting is a v2 concern.
- **No "click counter to mark used" affordance.** Marking happens in-game; the bot re-reads it.
- **No image generation.** View B is plain text — Discord embed fields. Reuses no Puppeteer pipeline.
- **No datacron column.** v1 focuses on roster availability only. Datacron-aware counters are a follow-up.
- **No public/shared message.** Ephemeral to the invoker.

## Data sources

| Data | Source | Use |
|---|---|---|
| Your ally code | Existing Discord-user → ally-code binding | Same path `/gac strategy` already uses. |
| Current opponent + bracket format | `gacService.getLiveBracketWithOpponent(allyCode)` | Already in-flight-deduped. Returns opponent player ID and league. |
| Opponent's currently-placed defences | Comlink bracket `playerStatus[]` (currently typed `unknown[]`) | New typed parser. Per-defence: leader baseId + member baseIds. |
| Your offence-used characters this round | Same `playerStatus[]` payload | New typed parser. Set of base IDs you've deployed in any attack so far this round. |
| Counter source per defence leader | `counterClient.getCounterSquads(leaderBaseId, seasonId)` | Same swgoh.gg counters `/gac strategy` uses. |
| Your roster | `swgohGgClient.getFullPlayer(allyCode)` | Same fetch `/gac strategy` uses. Add a 30s in-memory TTL cache scoped to `/gac offence` to absorb consecutive button clicks. |

The `playerStatus` parser is the only piece of new Comlink-shape knowledge in v1. Implementation step zero is to record one real `playerStatus` payload from an active bracket, commit it as a fixture, and confirm it carries both placed-defence and offence-history data. If either is missing, we revisit the design before writing more code (see Failure modes below).

## Slash command surface

```
/gac offence
```

Zero flags. The handler:

1. Resolves invoking Discord user → ally code.
2. Calls `getLiveBracketWithOpponent(allyCode)` — current opponent + format.
3. Calls `parsePlayerStatus(bracket)` — `opponentDefences[]` and `offenceUsedCharacters: Set<string>`.
4. Fetches user's roster (cached 30s).
5. Renders View A.

## UI

Single ephemeral message. Two views, swapped by re-rendering the same message ID.

### View A — Opponent defences

```
You vs OpponentName · Round 2 · 5v5
Used so far: 12/250 GAC-eligible chars

Opponent's defences (pick one to counter):
[ Queen Amidala ]  [ GLRey ]  [ Stranger ]  [ Master Kenobi ]  [ Rey ]

Last refreshed: just now            [ ⟳ Refresh ]
```

- One button per placed defence, labelled with leader display name. Up to 5 in 5v5 / 10 in 3v3 — fits in Discord's 5×5 grid.
- `Refresh` button re-runs the data flow without changing view, used when the user just attacked and wants the used-set to update without picking a new defence.

### View B — Counters for the selected defence

```
Top 5 counters for Queen Amidala  (filtered by your available characters)

1. GLRey · Ezra · Rey · Ben Solo · BB-8
2. Boba Fett SoJ · Hondo · Cad Bane · Krrsantan · Bossk
3. Veers · Range Trooper · Snowtrooper · Dark Trooper · Death Trooper
4. …
5. …

[ ← Back to opponents ]   [ ⟳ Refresh ]
```

- Counters are text-only (Discord embed fields). Not clickable. Going `Back` and picking the next defence is what triggers the re-fetch — that's the dynamic mechanism.
- `Refresh` here re-fetches and re-renders View B for the same defence.

### Edge cases inside the same UI

- Opponent has placed 0 defences yet → View A: "Opponent hasn't placed any defences yet — try again once they do."
- Picked defence has 0 viable counters → View B: "No counters available — your remaining roster can't field a complete team for this defence."
- Bracket has no live opponent (between rounds) → command refuses with "You're between rounds — no opponent to counter yet."

## Components

| Component | Status | Path | Notes |
|---|---|---|---|
| Slash subcommand `offence` | new | `src/commands/gac.ts` | 4th subcommand alongside `bracket`, `opponent`, `strategy`. |
| Handler `handleOffenceCommand` | new | `src/commands/gac/offenceHandler.ts` | Slash entrypoint + Discord component (button) interaction handlers. Owns view rendering. |
| `parsePlayerStatus` | new | `src/integrations/comlink/playerStatusParser.ts` | Typed reader. Input: raw `playerStatus[]`. Output: `{ opponentDefences: UniqueDefensiveSquad[], offenceUsedCharacters: Set<string> \| null }`. `null` distinguishes "feature absent in payload" from "empty set". |
| `selectTopCountersAvailable` | new | `src/services/gacStrategy/squadMatching/selectTopCountersAvailable.ts` | Per-defence top-N selector. Input: one defensive squad + roster + used-chars set. Output: top 5 ranked counters. Reuses scoring helpers from `matchCounters.ts`, skips the across-defence dedup. |
| Live bracket fetch | reused | `gacService.getLiveBracketWithOpponent` | In-flight-deduped. |
| Counter source | reused | `counterClient.getCounterSquads` | Same swgoh.gg counters `/gac strategy` uses. |
| Roster fetch | reused | `swgohGgClient.getFullPlayer` | Adds a 30s TTL cache scoped to this handler. |

Two genuinely new modules, one new handler, one subcommand registration. Everything else is glue.

## Data flow per interaction

Every interaction (initial slash, every button click) follows this sequence:

1. Resolve invoking user → ally code.
2. `getLiveBracketWithOpponent(allyCode)` → current opponent + format.
3. `parsePlayerStatus(bracket)` → `{ opponentDefences, offenceUsedCharacters }`.
4. Roster fetch (cached 30s).
5. If the interaction is "pick defence" or "refresh on view B": call `getCounterSquads(leaderBaseId, seasonId)` and `selectTopCountersAvailable(...)` to compute the top 5.
6. Render the appropriate view back to the same message ID.

Steps 1–4 happen on every interaction; 5 only when entering View B (or refreshing it); 6 always.

## Failure modes & graceful degradation

| Failure | Detection | Behaviour |
|---|---|---|
| `playerStatus` missing offence-used data | Parser returns `offenceUsedCharacters = null` | View A banner: "⚠️ Couldn't read your in-round offence history — counters below are unfiltered." Counters still generated, just without availability filter. **Never** silently substitute bot-side state. |
| `playerStatus` missing placed-defence data | Parser returns `opponentDefences = []` | Fall back to `getOpponentDefensiveSquads` (swgoh.gg recent history) and add banner: "⚠️ Showing recent-round defences — Comlink didn't return live placements." |
| Comlink unreachable | `getLiveBracketWithOpponent` throws | Same error path `/gac strategy` already has. Friendly retry message. |
| swgoh.gg counter source unreachable | `getCounterSquads` throws | Per-defence: View B shows "Counter data temporarily unavailable for {leader}" + Refresh button. Other defences in View A still pickable. |
| User has zero viable counters | `selectTopCountersAvailable` returns `[]` | View B: "No counters available — your remaining roster can't field a complete team for this defence." |
| Discord interaction window expired (>15 min) | Button click receives `Unknown interaction` | Caught and ignored. User re-invokes `/gac offence`. |
| Two button clicks in flight at once | Race in handler | Each handler call independent — last render wins. State is API-derived, so no inconsistency. |
| User invokes between rounds | `getLiveBracketWithOpponent` reports no current opponent | Refuse with "You're between rounds — no opponent to counter yet." |

The deliberate stance: **never silently substitute a degraded data source.** If something is missing, banner it. The team's trust in `/gac offence` depends on it not lying about live state.

## Testing

| Test | Layer | What it verifies |
|---|---|---|
| `parsePlayerStatus` happy-path | unit | Recorded real `playerStatus[]` fixture → expected `opponentDefences` + `offenceUsedCharacters`. |
| `parsePlayerStatus` partial payloads | unit | Missing offence-history → `offenceUsedCharacters = null`. Missing placements → `opponentDefences = []`. Doesn't throw. |
| `parsePlayerStatus` malformed entries | unit | Unknown unit IDs, empty squads, duplicates — drop bad data, surface what's parseable. |
| `selectTopCountersAvailable` filter | unit | Pool of 20 counter squads, 5 contain a used character → returns top 5 from the unfiltered 15. Order matches `matchCountersAgainstRoster` scoring. |
| `selectTopCountersAvailable` undersized roster | unit | Counter requiring an unowned character is excluded. Same rules as `matchCountersAgainstRoster`. |
| `selectTopCountersAvailable` no viable counters | unit | Returns `[]` when every candidate is filtered. |
| `offenceHandler` View A render | unit | Parsed live state with N defences + used-set → expected button row + header. |
| `offenceHandler` View B render | unit | Defence + counter list → expected text block + back/refresh buttons. |
| `offenceHandler` degraded banners | unit | Asserts the warning banners fire when parser returns `null` / `[]`. |
| End-to-end smoke | integration | Mocks Comlink (recorded payload) + swgoh.gg counter+roster, runs full slash invocation through to a Discord-message-payload assertion. Same shape as `datacronStrategySmoke.test.ts`. |
| `playerStatus` recording | manual / one-off | Run a Comlink `getLeaderboard` query against an active bracket once; redact and commit JSON to `src/services/__tests__/fixtures/livePlayerStatus.json`. Validates the design's core assumption before any other code. |

Notable non-tests: no Discord embed snapshot tests (churn), no live-GAC round-progression tests (would be flaky). The recorded-fixture approach is the cheapest way to catch shape regressions.

## Open risks

- **`playerStatus` shape unknown until recorded.** The whole design depends on the field carrying both placed defences AND offence-used characters. The very first implementation task is to record a real payload and validate. If only one half is present, we revisit (likely route the missing half to a fallback per Failure modes table; bigger gaps trigger a return to brainstorming).
- **Counter ranking parity.** `selectTopCountersAvailable` reuses the scoring used by `matchCountersAgainstRoster` but takes a different code path. Risk that the two drift over time and produce different rankings for the same inputs. Mitigation: extract the shared scoring into a helper imported by both.
- **Roster cache TTL.** 30s is a guess. If users find counters drifting from reality after they re-roll/level up mid-session, we'll tune down or invalidate on Refresh.
