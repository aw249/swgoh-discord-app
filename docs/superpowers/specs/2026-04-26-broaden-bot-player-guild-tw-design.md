# Broaden the bot: `/player`, `/guild`, `/tw` namespaces

## Context

The bot today is GAC-focused. It uses a small slice of the swgoh-comlink surface — `getPlayer`, `getPlayerArena`, GAC-specific endpoints, `getGameData`, `getEvents` (filtered to GAC). Comlink exposes substantially more, notably `getGuild` (with `includeRecentActivity`) and `searchGuilds`, neither of which the bot uses today.

This spec broadens the bot from "GAC tool" to a general-purpose SWGOH utility for the server, by adding three top-level slash-command namespaces: `/player`, `/guild`, `/tw`. Existing commands (`/register`, `/help`, `/gac`, `/archetype`) are not touched in this iteration; namespace migration can happen later.

## Goals

- Open up the unused comlink surface — guild data and deeper player reads.
- Match the existing `/gac` command-namespace pattern so the bot's surface stays coherent.
- Reuse existing infrastructure (browser service for image rendering, error-ID system, Jest test setup) — no new rendering tech.

## Non-goals

- Persistent state / snapshot diffing across runs (rejected during brainstorming as too much storage growth for the value).
- Push notifications, scheduled posts, or event reminders.
- Reference catalogue (`/unit <name>`, `/datacron <id>`).
- Migration of existing root commands into namespaces.
- Datacron reroll suggestions (read-only display only in v1).
- Event-readiness mapping for `/player ready` (needs an event→requirement table we don't have).
- Per-member roll-ups for `/guild compare` and `/tw scout` (would require N×getPlayer per opponent guild).
- Territory Battles (`/tb`) — possible future namespace.

## Namespace map

Three new top-level commands. Thirteen subcommands total.

| Namespace | Subcommands |
|---|---|
| `/player` | `roster`, `mods`, `datacrons`, `ready`, `compare` |
| `/guild` | `lookup`, `members`, `activity`, `ready-check`, `compare` |
| `/tw` | `history`, `scout`, `prep` |

Where it makes sense, subcommands default to "the caller's own ally code / guild" so `/player roster` and `/guild members` work with no arguments. Same pattern as `/gac bracket`.

`/tw` is kept as a separate namespace (not folded under `/guild`) for workflow alignment — TW prep is a distinct recurring activity, the short root command surfaces faster in Discord's slash picker, and it leaves room for TW-specific features later.

## `/player` subcommands

| Subcommand | Args | Output | Comlink | Notes |
|---|---|---|---|---|
| `roster` | `[allycode]` | Embed | `getPlayer` | Header (GP, fleet GP, level, last seen), top 5 squads by GP, top fleet, mod count summary (6E/6/5), relic distribution. Defaults to caller. |
| `mods` | `[allycode]` | Embed | `getPlayer` | Top 10 fastest mods, 6E/6/5 totals, count of mismatched primaries (e.g. CC arrow on a tank). |
| `datacrons` | `[allycode]` | Embed | `getPlayer`, `getGameData` | Lists current 9 datacron slots with set, levels, top abilities. v1 = read-only display, no reroll suggestions. |
| `ready` | `<unit>` (autocomplete), `[allycode]` | Embed | `getPlayer`, `getGameData` | Stars/gear/relic/abilities for the unit, plus what's needed for next gear and next relic. |
| `compare` | `<allycode-a> <allycode-b>` | Image | `getPlayer` ×2 | Reuses existing `playerComparisonService`. Both args required — no defaults; for self-views use `roster`. |

### Decisions on this slice

- **Mismatched-primary heuristic** in `mods` starts with the obvious cases (CC/CD on non-DPS, defence% on speed-need units). Implemented as a small config table that can grow over time.
- **`datacrons` scope** — display only. Reroll-suggestion logic is large enough to be its own future feature.
- **`compare` symmetry** — explicit two-ally semantics, no fallback to caller. Self-view goes through `roster`.

## `/guild` subcommands

| Subcommand | Args | Output | Comlink | Notes |
|---|---|---|---|---|
| `lookup` | `<query>` | Embed | `searchGuilds` or `getGuild` | 22-char ID → direct fetch; otherwise name search. Single match → profile. Multi-match → list with IDs (re-run with ID for detail). |
| `members` | `[guild_id]` | Image table | `getPlayer` (self → guildId) → `getGuild` | Sorted member table: name, GP, fleet GP, last seen, relic count. Image because 50 rows exceeds Discord embed field limits. |
| `activity` | `[guild_id]` | Embed | `getGuild(id, includeRecentActivity=true)` | Recent raids (launched, score, top contributors), recent TW results, donation/activity rollups. |
| `ready-check` | `<unit>` (autocomplete), `[guild_id]`, `[min_relic]` (default 5) | Image table | `getGuild` + N × `getPlayer` (cached) | "Who in the guild has unit X at relic ≥ Y". Uses `guildRosterCache` (see below). |
| `compare` | `<guild-a> <guild-b>` | Image | `getGuild` ×2 | Side-by-side: total GP, member count, raid records, last 5 TW results. Guild-level only — no per-member roll-ups in v1. |

### Architectural decision: `ready-check` cost

50 members × 1 `getPlayer` per member = up to 50 comlink calls per invocation. The chosen approach is a **lazy in-memory roster cache** (`guildRosterCache`) keyed by `(guildId, allyCode)` with a ~30-minute TTL and an LRU bound. On first `ready-check`, missed members are fetched concurrently (Promise pool, concurrency 5–10) and stored. Subsequent calls within the TTL are instant. No disk persistence. No proactive warmer — usage drives population.

### Other decisions

- **Permission model**: anyone can `/guild lookup` any public guild. Comlink data is public — no allowlist.
- **Empty guild handling**: `members` defaults assume the caller's player record has `guildId`. If they're guildless, error message points them to pass an explicit ID.
- **Activity payload risk**: if `recentActivity` doesn't actually contain TW results in usable shape, those move to `/tw history` only and `/guild activity` is just raids + donations. Verify payload shape during implementation before locking the layout.

## `/tw` subcommands

| Subcommand | Args | Output | Comlink | Notes |
|---|---|---|---|---|
| `history` | `[guild_id]` | Embed | `getGuild(id, true)` | Last 5–10 TW results (W/L, our score, opponent name, opponent score, date). Defaults to caller's guild. Depends on `recentActivity` payload — same risk as `/guild activity`. |
| `scout` | `<guild>` (name or ID) | Image | `searchGuilds` → `getGuild` | Reuses `/guild lookup`'s name/ID detection. Multi-match → list embed with IDs (option A); user re-runs with chosen ID. Output: GP, member count, recent TW W/L pattern, top 10 members by GP. Guild-level only in v1. |
| `prep` | `[guild_id]`, `<units>` (comma-separated, autocomplete) | Image table | `getGuild` + N × `getPlayer` (cached) | Rows = members, columns = each requested unit, cells = relic / "N/A". Reuses `guildRosterCache`. **Cap at 6 units per call** for image readability and cache cost. |

### Decisions

- **No "current TW opponent" auto-detection.** Comlink doesn't expose live TW matchmaking. `scout` always takes an explicit target.
- **`prep` vs `ready-check`** — both use the same cache infrastructure but are kept as separate commands. `ready-check` is single-unit, casual; `prep` is multi-unit officer planning grid.
- **Multi-match on `scout`** — show list with IDs and have the user re-run, never silently auto-pick.

## Cross-cutting concerns

### New shared infrastructure

| Component | Purpose |
|---|---|
| `guildRosterCache` (in-memory, LRU, ~30 min TTL) | Caches per-member `getPlayer` results keyed by `(guildId, allyCode)`. Used by `/guild ready-check`, `/guild members`, `/tw prep`. |
| `guildService` | Wraps `getGuild` / `searchGuilds`, handles ID-vs-name detection, orchestrates fan-out roster fetch with the cache. Mirrors `gacService` pattern. |
| `playerInsightsService` | Pure functions over a `getPlayer` payload — top squads, mod summaries, mismatched-primary detection, datacron parsing, unit ready-state. |
| Unit autocomplete helper | Extracted from `gameDataService` (already loaded via `getGameData`). Used by `/player ready`, `/guild ready-check`, `/tw prep`. |

### Image rendering

All new image outputs go through the existing `browserService` (Puppeteer). New HTML templates per output. Honours the screenshot-duplication fix from commit `4e8cc48`.

### Output style

- UK English throughout (matches existing convention).
- Discord embeds for outputs that fit in ~25 fields; image tables when exceeding that or when the layout is genuinely tabular.
- All replies default to non-ephemeral (visible in channel) to match `/gac` behaviour.

### Error handling

- Comlink unreachable → user-facing error referencing the existing error-ID system.
- Player or guild not found → friendly message suggesting verification on swgoh.gg.
- Caller has no registered ally code on a default-to-self command → prompt to `/register` first.
- Caller has no guild and called `/guild members` with no ID → prompt for an explicit `guild_id`.
- Partial fan-out failures (e.g. 3 of 50 members fail in `ready-check`) → render the result with a footer noting partial results.

### Testing

- Service-level unit tests with fixture comlink payloads (no live calls). Fixtures under `src/services/__tests__/fixtures/`.
- Integration test for the cache fan-out logic in `guildService` (concurrency, partial failures).
- Mocked Discord interactions, same as existing command tests. No live Discord in CI.

### Documentation

- `README.md` gets new sections per namespace mirroring the existing `/gac` style.
- `RASPBERRY_PI_SETUP.md` gets a brief note on the new in-memory cache footprint.

## Risks

- **`recentActivity` payload shape** — `/guild activity` and `/tw history` depend on what comlink actually returns. Verify the payload before locking layouts; the `/tw history` command may degrade to a stub if the data isn't there.
- **Comlink fan-out load** — `/guild ready-check` and `/tw prep` can each issue up to ~50 concurrent player fetches per cold call. Concurrency cap (5–10) and the 30-min cache mitigate this, but worth watching during early use.
- **Cache memory footprint on Pi** — slim per-player projections plus an LRU bound keep this small, but the Pi has tight memory headroom (commit `529b5cb`). The bound needs sizing once we have a representative payload.
