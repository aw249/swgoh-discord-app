# Phase 1: Quick Wins & Housekeeping

## Overview

Extract shared utilities, centralise constants and configuration, and clean up minor housekeeping items across the SWGOH Discord bot codebase. This phase reduces duplication, improves maintainability, and lays groundwork for subsequent refactoring phases.

## Scope

IMPROVEMENTS.md sections: 1.4, 1.5, 5.2, 7.2, 10.2, 10.4, 11 (partial).

Items explicitly excluded (not matching current codebase state):
- 10.1 (excessive debug logging) — not found in current code
- 10.3 (commented-out autocomplete) — autocomplete is implemented and active
- Portrait URL construction — already centralised via `getCharacterPortraitUrl()`

---

## 1. Shared `buildCharacterStatsMap()` Utility

### Problem

Identical stats map construction logic is duplicated in 4 locations:
- `src/services/gacStrategy/imageGeneration/defenseStrategyHtml.ts` (lines 32-55)
- `src/services/gacStrategy/imageGeneration/offenseStrategyHtml.ts` (lines 34-57, 60-82)
- `src/services/gacStrategy/imageGeneration/balancedStrategyHtml.ts` (lines 39-55)
- `src/services/gacStrategy/utils/rosterUtils.ts` `createCharacterMaps()` (lines 36-54)

Each loops over `roster.units`, filters for `combat_type === 1`, extracts stats using magic numbers, and builds a Map.

### Solution

Add `buildCharacterStatsMap(roster)` to `src/services/gacStrategy/utils/rosterUtils.ts`.

```typescript
interface CharacterStats {
  speed: number;
  health: number;
  protection: number;
  relic: number | null;
  gearLevel: number;
  levelLabel: string;
}

function buildCharacterStatsMap(roster: PlayerRoster): Map<string, CharacterStats>
```

- Returns `Map<baseId, CharacterStats>`
- Uses `STAT_ID` constants (see section 3) instead of magic numbers
- Handles null/missing roster gracefully (returns empty Map)
- Update `createCharacterMaps()` to use this internally
- Replace all 4 inline implementations with calls to this function

### Files Changed

- `src/services/gacStrategy/utils/rosterUtils.ts` — add function, update `createCharacterMaps()`
- `src/services/gacStrategy/imageGeneration/defenseStrategyHtml.ts` — replace inline logic with import
- `src/services/gacStrategy/imageGeneration/offenseStrategyHtml.ts` — replace inline logic with import (both user and opponent maps)
- `src/services/gacStrategy/imageGeneration/balancedStrategyHtml.ts` — replace inline logic with import

---

## 2. Shared Image Constants

### Problem

Base64 icon strings (~300 chars each) are copy-pasted across 3 files:
- `defenseStrategyHtml.ts` (lines 13-15): SPEED_ICON, HEALTH_ICON, PROTECTION_ICON
- `offenseStrategyHtml.ts` (lines 14-16): same 3 icons
- `htmlGeneration.ts` (lines 445-451): same 3 + TENACITY_ICON, POTENCY_ICON

### Solution

Create `src/config/imageConstants.ts` exporting all 5 icon constants:

```typescript
export const SPEED_ICON = 'data:image/webp;base64,...';
export const HEALTH_ICON = 'data:image/webp;base64,...';
export const PROTECTION_ICON = 'data:image/webp;base64,...';
export const TENACITY_ICON = 'data:image/webp;base64,...';
export const POTENCY_ICON = 'data:image/webp;base64,...';
```

Delete inline definitions in all 3 consuming files, replace with imports.

### Files Changed

- `src/config/imageConstants.ts` — new file
- `src/services/gacStrategy/imageGeneration/defenseStrategyHtml.ts` — replace inline icons with import
- `src/services/gacStrategy/imageGeneration/offenseStrategyHtml.ts` — replace inline icons with import
- `src/services/playerComparison/htmlGeneration.ts` — replace inline icons with import

---

## 3. Stat ID Constants

### Problem

Character stats accessed by magic number strings (`stats['5']`, `stats['1']`, `stats['28']`) in 4+ files with no documentation.

### Solution

Add `STAT_ID` constant to `src/config/imageConstants.ts`:

```typescript
export const STAT_ID = {
  HEALTH: '1',
  SPEED: '5',
  PROTECTION: '28',
} as const;
```

Replace all magic number usages:
- `stats['5']` → `stats[STAT_ID.SPEED]`
- `stats['1']` → `stats[STAT_ID.HEALTH]`
- `stats['28']` → `stats[STAT_ID.PROTECTION]`

### Files Changed

- `src/config/imageConstants.ts` — add STAT_ID
- `src/services/gacStrategy/imageGeneration/defenseStrategyHtml.ts`
- `src/services/gacStrategy/imageGeneration/offenseStrategyHtml.ts`
- `src/services/gacStrategy/imageGeneration/balancedStrategyHtml.ts`
- `src/services/gacStrategy/utils/rosterUtils.ts`

---

## 4. Centralised API URLs

### Problem

Hardcoded URLs scattered across 6+ integration files:
- `https://swgoh.gg/api` in `playerClient.ts`, `gacBracketClient.ts`
- `https://swgoh.gg` in `defenseSquadsClient.ts`, `countersClient.ts`, `gacHistoryClient.ts`
- `https://game-assets.swgoh.gg` in `characterPortraitCache.ts`
- `http://localhost:3200` as Comlink default in `combinedClient.ts`, `comlinkClient.ts`

### Solution

Create `src/config/apiEndpoints.ts`:

```typescript
export const API_ENDPOINTS = {
  SWGOH_GG_API: process.env.SWGOH_GG_API_URL || 'https://swgoh.gg/api',
  SWGOH_GG_BASE: process.env.SWGOH_GG_BASE_URL || 'https://swgoh.gg',
  GAME_ASSETS_BASE: process.env.GAME_ASSETS_BASE_URL || 'https://game-assets.swgoh.gg',
  COMLINK_DEFAULT: process.env.COMLINK_URL || 'http://localhost:3200',
} as const;
```

Replace all hardcoded URLs with imports from this file. Update `.env.example` with these optional overrides.

For Comlink clients specifically: remove the inline `process.env.COMLINK_URL` fallback from `combinedClient.ts` and `comlinkClient.ts`. The env var read is now centralised in `API_ENDPOINTS.COMLINK_DEFAULT`. Client config objects still take priority: `config.url ?? API_ENDPOINTS.COMLINK_DEFAULT`.

### Files Changed

- `src/config/apiEndpoints.ts` — new file
- `src/integrations/swgohGg/playerClient.ts` — replace `baseUrl`
- `src/integrations/swgohGg/gacBracketClient.ts` — replace `baseUrl`
- `src/integrations/swgohGg/defenseSquadsClient.ts` — replace inline URL
- `src/integrations/swgohGg/countersClient.ts` — replace inline URL
- `src/integrations/swgohGg/gacHistoryClient.ts` — replace inline URL
- `src/integrations/comlink/combinedClient.ts` — replace default URL
- `src/integrations/comlink/comlinkClient.ts` — replace default URL
- `src/storage/characterPortraitCache.ts` — replace inline URL
- `.env.example` — add optional URL overrides

---

## 5. Housekeeping Helpers

### 5a. League Normalisation

**Problem:** `league.charAt(0).toUpperCase() + league.slice(1).toLowerCase()` duplicated in `gacStrategyService.ts` (line 59) and `gacConstants.ts` (line 60).

**Solution:** Export `normaliseLeague(league: string): string` from `gacConstants.ts`. Use it in both `gacConstants.ts` (`getMaxSquadsForLeague`) and `gacStrategyService.ts`.

### 5b. Ally Code Normalisation

**Problem:** No consistent handling of ally code formats (dashes vs plain digits).

**Solution:** Add `normaliseAllyCode(input: string): string` to `src/utils/allyCodeUtils.ts` (new file). Strips dashes, validates 9-digit format, throws descriptive error on invalid input. Use at the command input boundary in `gac.ts` and `register.ts` (the `execute` handlers where ally codes are first received from Discord).

### Files Changed

- `src/config/gacConstants.ts` — add `normaliseLeague()`, use internally
- `src/services/gacStrategyService.ts` — import and use `normaliseLeague()`
- `src/utils/allyCodeUtils.ts` — new file with `normaliseAllyCode()`
- `src/commands/gac.ts` — use `normaliseAllyCode()` at input boundary
- `src/commands/register.ts` — use `normaliseAllyCode()` at input boundary

---

## 6. Developer Experience Cleanup

### 6a. `.env.example` Documentation

Add inline comments to `.env.example` explaining:
- What each variable does
- Which are required vs optional
- Where to obtain values (e.g. Discord Developer Portal link)
- The new optional URL override variables from section 4

### 6b. `matchCounters.ts` TODO Cleanup

**Problem:** Two async IIFEs wrap placeholder returns, making the code confusing:
```typescript
const counterDefenseStats = await (async () => { /* TODO */ return { holdPercentage: null, seenCount: null }; })()
```

**Solution:** Replace with direct assignment and a clear comment:
```typescript
// Defense stats for counter squads not yet implemented — always returns null.
// See IMPROVEMENTS.md section 10.4 for design notes.
const counterDefenseStats = { holdPercentage: null, seenCount: null };
```

### Files Changed

- `.env.example` — add descriptive comments
- `src/services/gacStrategy/squadMatching/matchCounters.ts` — simplify TODO placeholders

---

## Testing

- Run `npm run build` to verify TypeScript compilation after all changes
- Run `npm test` to verify existing tests still pass
- Verify no behaviour change — these are pure refactoring extractions

## Dependencies

None. This phase is standalone and does not depend on any other phase.
