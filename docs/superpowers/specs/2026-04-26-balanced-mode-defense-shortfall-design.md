# Balanced Mode: Defense Shortfall & Score-Based Allocation

## Problem

In the `/gac strategy` command's `balanced` mode, defence allocation can fall short of the league target (e.g. 9 defence squads delivered when 11 were requested for KYBER 5v5).

Root cause, traced from `app/logs/bot-out.log:34250-34320` (run at 2026-04-25 17:59):

1. `balanced` mode runs the offense-first allocator (`balanceStrategy.ts:828`) in lockstep with `offensive` mode.
2. Offense greedily picks each opponent slot's primary counter and marks every member as `usedCharacters`.
3. By the time defence runs, the user's strongest leaders (LORDVADER, JABBATHEHUTT, BOBAFETT, JEDIMASTERKENOBI, GLLEIA, GREATMOTHERS, etc.) are already on offense.
4. 11 candidate defence squads are skipped; only 9 land.
5. Worse: 5 of the offense placements that consumed those leaders had `winPercentage = N/A` — speculative matches with no data.

Two related bugs surfaced during diagnosis:

- **Lenient defence-vs-defence character sharing** (`balanceStrategy.ts:631-672`): a leader can be a member of one defence squad and the leader of another. Caused the `JABBA leader of Squad 3` + `BOBA's Squad 5 has JABBA as member` duplication observed in `app/logs/bot-out.log:33005,33007`. This is illegal in-game (each unit can only be assigned to one slot).
- **GL Safety Net** (`balanceStrategy.ts:1419,1450`): places leftover GLs onto defence without checking whether they're already members of an existing defence squad. Same root duplication risk.

## Goal

Make `balanced` mode produce the GAC allocation it advertises: defence anchored by your strongest holds, offense scoring full points where data supports it, and intelligently choosing between competing claims rather than mechanically letting offense run first.

### Acceptance Criteria

1. For runs where the candidate pool is sufficient, `balanced` fills `maxDefenseSquads` (the league target).
2. No character appears in more than one squad in the final output (offense-vs-defence or defence-vs-defence).
3. When defence claims a leader the user's offense was planning to use, the offense pass walks the existing `alternatives` list and picks the best non-conflicting alternative.
4. The allocation decision is data-driven: a leader stays on offense iff their primary offense placement is more valuable than the best defence use of that leader, accounting for win rate, banner yield, and seen-count confidence.
5. `defensive` and `offensive` modes are unchanged in behaviour.

## Design

### A. Counter and defence "viability" scores

For each `MatchedCounterSquad`, compute:

```
offenseViability(c) =
    winPercentage
  × (avgBanners / maxBannersForFormat)
  × confidenceMultiplier(seenCount)
```

`maxBannersForFormat` from the GAC banner reference (`https://swgoh.wiki/wiki/Grand_Arena_Championships`). Per-battle theoretical max with first-attempt bonus, all units surviving full HP/protection:
- 5v5: 69 banners
- 3v3: scales with team size; conservatively use ~63 (5v5 max minus the contribution from 2 fewer surviving units). Confirm exact figure by re-fetching the wiki at implementation time and adjusting the constant.

Both values live as named constants in code so they're trivially adjusted later.

`confidenceMultiplier` (log-scaled with a floor for missing data):

```
MAX_SEEN_OFFENSE = 10000

confidenceMultiplier(seen) =
    if seen is null or seen <= 0:    0.30
    else:                             0.30 + 0.70 × log10(seen + 1) / log10(MAX_SEEN_OFFENSE + 1)
```

Sample curve (sanity-check anchors):

| seenCount | multiplier |
|---|---|
| null / 0 | 0.30 |
| 10 | 0.48 |
| 100 | 0.65 |
| 1,000 | 0.83 |
| 5,000 | 0.95 |
| 10,000+ | 1.00 |

`MAX_SEEN_OFFENSE` lives as a single named constant in `balanceStrategy.ts` (or a sibling constants module if it grows) so future tuning is one line.

For each `DefenseSuggestion`, compute the analogous score:

```
defenseViability(d) =
    holdPercentage
  × confidenceMultiplier(seenCount)
```

Banner yield on defence is paid by the *opponent's* offense, not the user, so it's omitted from the user-side defence viability. (The existing `avgBanners` field on `DefenseSuggestion` is irrelevant to *our* score.)

The existing defence scoring formula in `defenseGeneration.ts:154-170` (hold + log-seen + GL bonus + leader frequency) is kept for the *suggestion* phase. The new `defenseViability` above is purely the contention-decision score for the *balance* phase.

### B. Contention rule

When defence wants leader L and L is also the primary offense leader for some opponent slot O (call its counter `primaryC` and its alternative list `primaryC.alternatives`):

1. `primaryOffenseV = offenseViability(primaryC)`
2. `bestAltV = max( offenseViability(alt) )` over `primaryC.alternatives` whose leader and members do not collide with already-claimed defence units. If no eligible alt exists, `bestAltV = 0`.
3. `offenseSwapCost = primaryOffenseV − bestAltV` (how many "viability points" offense loses if forced to the alternative).
4. If `defenseViability(L) ≥ offenseSwapCost` → claim L for defence; offense slot O gets reassigned to its best alternative.
5. Otherwise → leave L on offense; defence skips this candidate and tries the next defence suggestion.

This naturally produces the behaviours from the brainstorm:
- High-hold leader with strong alt available: defence wins.
- High-hold leader with N/A primary offense (low confidence): defence wins easily because `primaryOffenseV` is small.
- Low-hold defence option vs high-confidence primary offense with no alt: offense wins.

### C. Order of operations (balanced mode)

1. Pre-compute `offenseViability` for every counter+alternative tuple, and `defenseViability` for every defence suggestion. One pass each, cached for the rest of the allocation.
2. Sort defence suggestions by `defenseViability` descending.
3. **GL pass** — same as today's defensive flow, with the contention rule applied per leader.
4. **Non-GL defence pass** — strict conflict checking (no lenient path); contention rule applied per leader.
5. **Offense pass** — walk `[primary, ...alternatives]` per opponent slot, pick the first whose leader and members don't collide with already-claimed defence or earlier offense.
6. **GL Safety Net** — strict member dedup guard added (see section D step 5).
7. Final audit (existing block at `balanceStrategy.ts:~1700+`).

### D. Code-level shape

Primary file: `balanceStrategy.ts`. New scoring helpers may live alongside or in a small sibling `balanceScoring.ts` if the parent file growth pushes us past comfort — implementer's call at PR time.

1. **Introduce a local boolean** at the top of the balance function:
   ```typescript
   const defenseFirst = strategyPreference === 'defensive' || strategyPreference === 'balanced';
   ```
   Replace direct comparisons at lines 250, 404, 566, 699, 723, 808, 1059 with `defenseFirst`. **Exception:** line 682's early-exit at `maxOffenseNeeded` stays gated to `'defensive'` only — `balanced` continues to fill every offense slot it can.

2. **New helper functions** (top of the file or in a sibling `balanceScoring.ts` module if file size grows):
   - `confidenceMultiplier(seen: number | null): number`
   - `offenseViability(counter: MatchedCounterSquad, format: string): number`
   - `defenseViability(suggestion: DefenseSuggestion): number`
   - `bestAvailableAlt(counter: MatchedCounterSquad, claimedChars: Set<string>, format: string): { alt: MatchedCounterSquad | null, viability: number }`

3. **New decision helper**: `shouldDefenseClaim(leaderId, defenseV, offenseSlots, claimedChars, format) → { claim: boolean, replacementCounter?: MatchedCounterSquad }`. Encapsulates the contention rule. Returns whether defence claims the leader, and (if yes) which alt counter offense should swap to.

4. **Lenient-conflict path harden** (lines 631-672): replace the `< 50%` lenient branch with a strict `continue;`. Always mark all squad characters as used. Removes defence-vs-defence character sharing.

5. **GL Safety Net guards** (lines 1419, 1450): before logging "Placing unused GL X on defence", verify both leader and members are absent from `usedCharacters`. If any collide, skip and emit `[GL Safety Net] Skipped X — collides with already-placed defence squad Y`.

6. **Educational logging**: when balanced mode swaps an offense slot to its alternative due to defence claim, emit:
   ```
   [Balanced] Offense slot N swapped: L → A vs O. Leader L reserved for defence (hold {h}%). Alt {A} viability {v}.
   ```

### E. Audit trail surfaced to the user

When `chunkInfo` is the last chunk, render an "Allocation notes" section at the bottom of the offense embed describing any swaps. (Optional — discuss in plan phase if footer space too cramped.)

## Edge Cases

1. **Roster too thin to fill 11 defence**: same as today. Allocator stops; existing log line `Could only backfill to N/X defense squads` fires. No regression.
2. **All defence candidates conflict with already-claimed offense**: contention rule resolves naturally. If every contention falls in offense's favour, defence shortfall is honest, not silent duplication.
3. **A character is referenced in multiple defence squads** (today's Jabba+Boba bug): rejected at strict conflict check. Debug log: `Defense squad X rejected — char Y already in defense squad Z`.
4. **Primary offense match has `winPercentage = null`**: `offenseViability` evaluates to 0 (the formula multiplies by null-mapped-to-0). Defence claim becomes essentially unconditional. Correct behaviour — we should not preserve speculative offense at the cost of known defence holds.
5. **Alternative list empty**: `bestAvailableAlt` returns `viability = 0`. Defence claim cost equals primary's full viability. Correct — if there's no fallback, offense's value is fully at stake.

## Testing

### Unit tests (jest)

New file: `src/services/gacStrategy/__tests__/balanceScoring.test.ts`

- `confidenceMultiplier`: null → 0.30; 0 → 0.30; 100 → ~0.65; 1000 → ~0.83; 10000 → 1.0; very large (1e6) → 1.0.
- `offenseViability`: cases combining {win=80, banners=60, seen=1000} etc.; null win → 0; null banners → 0.
- `defenseViability`: hold=30, seen=5000 → ~28.5; null hold → 0.
- `bestAvailableAlt`: returns highest-viability alt that doesn't collide with `claimedChars`; returns `{null, 0}` when all collide.
- `shouldDefenseClaim`: scenarios covering each branch in section B (defence wins, offense wins, no-alt edge case, null-stat edge cases).

### Integration tests

Existing test file: `src/services/__tests__/balanceStrategy.test.ts` (or create if absent — verify during implementation).

- Run `balanceStrategy` with synthetic `MatchedCounterSquad[]` and `DefenseSuggestion[]` arrays mirroring the failing 17:59 run shape: 12 offense, 11 defence target, several leaders shared.
- Assert: 11 defence squads in result; no character appears in more than one squad; offense uses alternatives for any battle whose primary leader was claimed by defence.
- Snapshot the order-of-decisions log lines for regression tracking.

### Manual smoke test

After deploy:
1. Re-run the 17:59 ally pair with `strategy: balanced`. Expect 11 defence squads.
2. Re-run with `strategy: defensive`. Expect identical defence count to current behaviour (regression check).
3. Re-run with `strategy: offensive`. Expect identical to current behaviour.
4. Inspect logs for `[Balanced] Offense slot N swapped` lines.

## Risks & Rollback

- **Risk**: viability formula weights produce surprising allocations on edge rosters (e.g. roster with one dominant GL).
  - **Mitigation**: weights are constants in one place; tune without redeploying schema. Add a feature flag env var `BALANCED_USE_VIABILITY=true|false` that falls back to today's offense-first behaviour. Default `true`. Single env-var flip is a 0-downtime rollback via `pm2 restart`.
- **Risk**: lenient-path harden produces fewer total defence squads on very thin rosters.
  - **Mitigation**: this is correct behaviour; the alternative is silent character duplication. Test on KYBER, AURODIUM, and CARBONITE league configs to confirm the strictness is sane across league sizes.
- **Risk**: GL Safety Net guard misfires and refuses to place a legitimate GL.
  - **Mitigation**: the new check is strict equality on character set membership. Easy to log and verify manually. If misfires occur, the log line names exactly which prior squad caused the rejection.

## Out of Scope

- Refactoring `balanceStrategy.ts` into multiple files. The file is large but the changes here are surgical; a structural refactor is its own design.
- Surfacing alternative counters in the Discord output beyond log lines. The footer-rendering "educational" angle is captured as a stretch goal in section E.
- Changes to `defensive` or `offensive` mode behaviour.
- Changes to the offense suggestion phase (`offenseMatching.ts` / `defenseSuggestion.ts`).
- Changes to the underlying defence candidate generation (`defenseGeneration.ts`) — its existing scoring stays.

### Candidate follow-up: historical-season fallback

If after this fix the `Could only backfill to N/X defense squads` log line keeps surfacing for non-thin rosters, the next move is to expand the candidate pool by querying older `seasonId`s via `defenseSquadsClient.ts:22` (already supports the parameter). That's a separate spec; surface it only if monitoring after this deploy shows the contention fix wasn't enough on its own.
