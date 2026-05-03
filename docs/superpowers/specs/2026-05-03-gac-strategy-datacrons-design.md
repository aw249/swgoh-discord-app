# `/gac strategy` datacron-aware extension

**Status:** approved (brainstorming complete 2026-05-03), awaiting implementation plan.

## Context

`/gac strategy` already produces defense and offense recommendation images. It is *partially* datacron-aware in one direction only: it filters out counter recommendations whose leader needs a datacron the user lacks (`src/services/gacStrategy/utils/datacronUtils.ts`). It does not surface positive datacron guidance — the user has to figure out which of their own datacrons to slot on which squad.

This spec extends `/gac strategy` to:

1. Recommend, per defense and per offense squad, which of the user's available datacrons to slot.
2. Render the recommendation inline in the strategy images, immediately to the right of the last squad member.
3. On offense images, also render the **opponent's actual datacron** for the same defense — scraped from swgoh.gg's GAC battle summary, which surfaces it as a JSON tooltip-app payload.

Two complications motivated the design:
- **GAC lock-in.** Datacrons earned after the season starts are not legal in that GAC — they shouldn't appear in recommendations. Comlink does not expose datacron creation timestamps, so we cannot derive lock-in from a single API call.
- **Squad fit is non-trivial.** A datacron's value depends on whether its tier-9 ability targets a character on the squad, with secondary value from tier-3 / tier-6 faction abilities, and tertiary value from generic stat boosts. The existing tag-only filter loses this nuance.

## Goals

- Datacron recommendations respect GAC lock-in — only crons present at season start.
- Per-squad recommendations reflect actual squad fit, scored using affix tier weighting and target resolution.
- Cron assignments are unique across both defense and offense (matches in-game rule: each squad slot consumes one datacron).
- The new column appears inline in the existing strategy images — no separate panels, no extra Discord attachments.
- The opponent's actual cron is shown alongside your recommended cron on offense — visual confirmation of what they brought.
- Fully dynamic. No hand-curated mappings of cron tags to factions or characters.

## Non-goals (v1)

- **Reroll suggestions.** The bot has no awareness of reroll mat/currency budgets; any "reroll cron X to tier 9" advice would be unactionable.
- **Re-allocation when the user rerolls mid-GAC.** The snapshot governs the season — if mid-season rerolls happen, the cron's identity stays the same but tier metadata may be slightly stale until the season turns. Rerolls are rare in practice.
- **Per-format snapshots.** A single snapshot per `(allyCode, gacSeasonId)` covers both 5v5 and 3v3 — the cron pool is identical, only squads differ.
- **Detailed stat tooltips in the image.** The cron cell shows name, set, primary-tier dots. Stat-by-stat breakdowns are a follow-up.
- **A separate /datacron command surface.** This is a `/gac strategy` enhancement, not a new namespace.

## Data sources

| Data | Source | Use |
|---|---|---|
| Your current datacrons | Comlink `/player` → `datacron[]` (already pulled by `gacStrategyService`) | The unfiltered pool, to compare against the snapshot. |
| GAC season ID + start time | `combinedClient.getCurrentGacInstance()` (already used by `/gac bracket`) | Snapshot key. |
| Lock-in snapshot | New file-backed store: `(allyCode, seasonId) → cronIds[]` | Filter applied to the live pool. |
| Opponent's per-squad cron | swgoh.gg battle-summary DOM → `[data-player-datacron-tooltip-app]` JSON attribute on `.datacron-icon` (extend existing `gacHistoryClient`) | Render on the offense image; informs what cron they actually played. |
| Cron art URLs | swgoh.gg JSON includes full `box_image_url` and `callout_image_url`; the existing `tex.datacron_<a\|b\|c\|d>` pattern is on the swgoh.gg CDN | Inline cron rendering. |
| Empowered character / faction art | Existing `characterPortraitCache` for character IDs; the scraped JSON also provides `scope_icon` URLs for non-character targets | Cron-cell callout overlay. |

### Lock-in snapshot

On every `/gac strategy` invocation:

1. Fetch the current GAC instance via `combinedClient.getCurrentGacInstance()` (cached anyway).
2. Look up `(allyCode, seasonId)` in `datacronSnapshotStore`.
3. If absent → save the player's *current* `datacron[]` IDs as the snapshot for this season; flag the run as "first observation" so the UI can note that mid-season-acquired crons may have been included if the user has been playing without the bot until now.
4. If present → use the snapshot's ID list as a filter. Only crons whose IDs are in the snapshot are eligible candidates for the allocator.
5. Between seasons (no active GAC instance) → no filtering. All current crons are eligible. Snapshots are not written outside an active season.

Snapshots persist across bot restarts (file-backed). Storage footprint is trivial — ~30 IDs × ~24 bytes per ally code per season = under 1 KB per active player.

## Scoring (cron, squad)

### Tier weights

| Tier | Affix kind | Base weight |
|---|---|---|
| 1, 2, 4, 5, 7, 8 | Stat boost | 1 each |
| 3 | Primary 1 (faction/role) | 6 |
| 6 | Primary 2 (faction/role) | 10 |
| 9 | Primary 3 (character-specific) | 25 |

A cron at the user's current `derived.tier` contributes only weights for tiers `<= derived.tier`. Unfocused crons cap at tier 6.

### Leader bonus

If the resolved tier-9 character target is the squad's **leader**, multiply that tier's contribution by **1.5**. Reasoning: a Krrsantan cron is most impactful in a squad built *around* Krrsantan.

### Scope resolution

For each tier with a non-empty `target_rule_id` and `derived.scope_target_name`, the scoring module asks the **scope resolver** what that target means:

```
resolveScopeTarget("Krrsantan")  → { kind: 'character', baseId: 'KRRSANTAN' }
resolveScopeTarget("Dark Side")  → { kind: 'category', categoryId: 'alignment_dark' }
resolveScopeTarget("Scoundrel")  → { kind: 'category', categoryId: 'Scoundrel' }
resolveScopeTarget("Unknown Faction X") → { kind: 'unknown' }
```

The resolver builds reverse indexes once at first use:

- `lower(unit_display_name) → baseId` (from `gameDataService.getUnitName(...)` over all units)
- `lower(category_display_name) → categoryId` (from CG localised category names)

For each lookup, the unit-name index is consulted first; if no match, the category-name index. Both indexes derive entirely from `gameDataService` — no hand-coded mappings.

A tier whose target resolves to `unknown` contributes only its base weight (it lands as a stat boost rather than a faction/character bonus). The tier is still counted; we never silently underrate a cron.

### Score calculation

```
score(cron, squad):
  total = 0
  for tier_index in 1..min(cron.derived.tier, 9):
    tier = cron.derived.tiers[tier_index - 1]
    target = resolveScopeTarget(tier.derived.scope_target_name)

    if target.kind == 'character':
      if target.baseId in squad.memberBaseIds:
        weight = tierBaseWeight(tier_index)
        if target.baseId == squad.leaderBaseId and tier_index == 9:
          weight *= 1.5
        total += weight

    elif target.kind == 'category':
      if any squad member has target.categoryId in their categories:
        total += tierBaseWeight(tier_index)

    else:  # generic stat boost OR unknown target
      total += tierBaseWeight(tier_index)
  return total
```

Score is non-negative. Pure stat-boost crons score ~6 on every squad; high-fit crons (matching tier-9 character + faction tiers below) reach the high 30s.

## Allocation

### Problem

Squads = defense squads ∪ offense battle plans (typical: ~5 each, ~10 total). Each squad slot consumes a datacron (per game rule). Crons cannot be reused across slots within the same GAC.

### Algorithm

Hungarian algorithm on the value matrix `rows = squads, cols = eligible crons`, padded to handle the rectangular case (more crons than squads is the common case). ~80 LOC, no external dependency.

Solving defense and offense **together** (one combined matrix) is the right move — splitting them would burn the user's best cron on the wrong side. With ~10 squads × ~26 crons the solver runs in well under 1 ms.

### Edge cases

- **Snapshot empty** (first observation, before persist): allocator runs with all current crons; the result for that single run may include not-yet-snapshotted crons. We accept this since the snapshot is written immediately and subsequent runs will be correct.
- **Fewer eligible crons than squads**: assignment-side rows for unmet squads get `null` from the solver (returned as "no recommendation").
- **All-zero row** (a squad where no cron can offer more than stat-boost weight): allocator still picks the highest cell (a stat-boost cron). The image renders such cells with a "(filler)" annotation so the user knows the cron has no specific synergy.
- **Tied cells**: solver picks deterministically based on stable cron ID ordering.

### Output

```
type AllocationResult = {
  defense: Map<DefenseSquadKey, AssignedCron | null>;
  offense: Map<OffenseBattleKey, AssignedCron | null>;
  scoreMatrix: number[][]; // for debugging / future tuning telemetry
};

type AssignedCron = {
  candidate: DatacronCandidate;
  score: number;
  filler: boolean; // true if score reflects only stat tiers
};
```

## Image layout

### Defense image

Existing row layout: `[char1][char2][char3][char4][char5]`.
New row layout: `[char1][char2][char3][char4][char5]  [CRON]`.

Cron cell (~120 px wide × matched to row height):

- Square base image from `box_image_url` (or constructed CDN URL for crons sourced from Comlink).
- Empowered character / faction icon overlaid bottom-right (40% size, anchored to corner).
- Cron name in small text below the square (`derived.name` if scraped, else `gameDataService` localised set name + lead character).
- 3 small "primary tier" dots indicating which of tiers 3 / 6 / 9 are unlocked.
- Filler crons: muted with a lighter border + "(filler)" footnote.
- Empty / `null`: a placeholder rectangle with "no cron available" text — fixed-width so rows still align.

Total image width grows by ~120 px (≈8% on a 1400 px image).

### Offense image

Existing battle row: `[your squad of 5] vs [opponent's squad of 5]`.
New battle row: `[your squad of 5][YOUR CRON]   vs   [opponent's squad of 5][OPP CRON]`.

Same cron cell rendering on both sides. Distinguishing visual: friendly border colour for YOUR CRON, opponent border colour for OPP CRON, matching the existing strategy image's faction palette.

Total image width grows by ~240 px.

Both new widths comfortably stay under Chromium's 16384 device-px limit (the DSF-aware fix from earlier this session covers it).

### URL pattern for your own crons

Your crons come from Comlink, which does not include image URLs. We construct the URLs from `setId`:

- `setId` maps to one of `a / b / c / d` via `datacronSet[setId].icon` (e.g. `tex.datacron_b`).
- Final URL: `https://game-assets.swgoh.gg/textures/<icon>_max.png` (when the cron is at tier 9) or `https://game-assets.swgoh.gg/textures/<icon>.png` for lower tiers.

The `_max` suffix availability for non-tier-9 crons is **not yet verified** — see Risks. Fallback if the pattern doesn't hold cleanly: scrape the user's own datacrons from swgoh.gg via the same tooltip-app mechanism. One extra scrape on first call, identical rendering downstream. Decision deferred to the implementation probe step.

## File / module layout

### New

| File | Responsibility |
|---|---|
| `src/storage/datacronSnapshotStore.ts` | File-backed `(allyCode, seasonId) → cronIds[]`. Mirrors `filePlayerStore` pattern. |
| `src/services/datacronAllocator/types.ts` | `DatacronCandidate`, `AssignedCron`, `AllocationResult`, `ResolvedScopeTarget`. |
| `src/services/datacronAllocator/normalize.ts` | Pure: `ComlinkDatacron → DatacronCandidate`; `ScrapedCronJson → DatacronCandidate`. |
| `src/services/datacronAllocator/scopeResolver.ts` | Pure: build `name→baseId` and `name→categoryId` reverse indexes from `gameDataService`; resolve `scope_target_name`. |
| `src/services/datacronAllocator/scoring.ts` | Pure: `(cron, squad) → number`. Tier weights, leader bonus, scope resolution. |
| `src/services/datacronAllocator/hungarian.ts` | Pure: generic Hungarian solver. |
| `src/services/datacronAllocator/allocate.ts` | Orchestrates: matrix build + solver + result map. |
| `src/services/datacronAllocator/index.ts` | Barrel. |
| `src/services/__tests__/datacronAllocator/*.test.ts` | One file per pure module. |
| `src/services/__tests__/fixtures/sampleCronTooltip.json` | Real cron tooltip-app JSON captured during brainstorming. |

### Modified

| File | Change |
|---|---|
| `src/integrations/swgohGg/gacHistoryClient.ts` | Capture `data-player-datacron-tooltip-app` JSON per defensive squad. |
| `src/types/swgohGgTypes.ts` | Extend `GacDefensiveSquad` with optional `datacron?: ScrapedCron`. |
| `src/services/gacStrategyService.ts` | Build the snapshot, run the allocator, pipe results into image data. Existing squad-recommendation flow unchanged. |
| `src/services/gacStrategy/imageGeneration/balancedStrategyHtml.ts`, `defenseStrategyHtml.ts`, `defenseOnlyHtml.ts`, `offenseStrategyHtml.ts`, `matchedCountersHtml.ts` | Extend each template to render a cron cell at the right of each squad row (and a second cron cell on offense for the opponent's). Shared cron-cell partial extracted. |

The allocator is self-contained: it doesn't know about HTML templates, storage, or HTTP. Its caller (`gacStrategyService`) does the wiring.

## Risks

| Risk | Mitigation |
|---|---|
| Comlink-sourced crons need a constructed URL pattern that may not be uniform across tiers. | Cheap probe step in implementation: render one of the user's own crons in a temp image; verify both `_max` and bare patterns. If unstable, fallback path is a small extra scrape from swgoh.gg's player datacron page. |
| Tooltip-app JSON shape may differ for unfocused / partially-rerolled opponent crons. | Use defensive parsing — every field has a fallback; tier entries with `derived.has_data: false` skip that tier silently. |
| Swgoh.gg HTML structure changes break the scraper. | Existing risk — already handled with assertion-rich parser failures and `errorRef` reporting. Same pattern extends to the cron capture. |
| First-observation snapshot may include mid-season crons. | Document in the embed footer of the first observation; subsequent runs are correct. Acceptable for v1. |
| Pi memory budget — already tight per `ecosystem.config.cjs:51` (`--max-old-space-size=512`). | New data structures are small (per-player snapshot ~1 KB; in-memory matrix ~10 × 26 × 8 bytes per call). Negligible. |
| Discord rejects oversized images. | Existing 16384-device-px guard covers it; new widths stay well under. |

## Testing

- **Per-pure-module unit tests** (scoring, scopeResolver, hungarian, normalize, allocate). Synthetic inputs.
- **Snapshot store tests** with a temp directory.
- **Scraper test** with a captured HTML fragment fixture (the `gac-counters-battle-summary__datacron-simple` block from the user's session).
- **End-to-end allocator test**: synthetic player + 30 crons + 8 squads → assignment map → assertion on the highest-value matches.
- **Image rendering smoke test** (`PUPPETEER_EXECUTABLE_PATH` gated, like the existing pattern) — renders a strategy image with a fake allocation and asserts PNG output.
- No live Comlink / swgoh.gg in tests; fixtures only.

## Out of scope (future)

- Reroll suggestion engine (cost-aware).
- Per-format (5v5 vs 3v3) snapshot split.
- Showing exact stat values in the cron tooltip.
- Allocating considering set-bonus interactions (3+ crons of same set on same squad — currently not a real GAC mechanic, but worth noting if CG ever adds one).
- A separate `/datacron` command surface (deferred indefinitely; this enhancement is targeted to `/gac strategy` only).
