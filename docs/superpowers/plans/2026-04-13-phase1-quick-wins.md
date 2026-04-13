# Phase 1: Quick Wins & Housekeeping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract shared utilities, centralise constants and API URLs, add housekeeping helpers, and clean up minor DX issues — all pure refactoring with no behaviour change.

**Architecture:** New shared config/utility files (`imageConstants.ts`, `apiEndpoints.ts`, `allyCodeUtils.ts`) export constants and helpers. Existing files replace inline duplications with imports. The `rosterUtils.ts` file gains a `buildCharacterStatsMap()` function that replaces 4 copies of the same logic.

**Tech Stack:** TypeScript 5.3, Node.js 18+, Jest 29.7 (ts-jest)

---

## File Structure

**New files:**
- `src/config/imageConstants.ts` — Base64 stat icons (5) and `STAT_ID` constant
- `src/config/apiEndpoints.ts` — Centralised external URLs with env var overrides
- `src/utils/allyCodeUtils.ts` — `normaliseAllyCode()` helper

**Modified files:**
- `src/services/gacStrategy/utils/rosterUtils.ts` — Add `buildCharacterStatsMap()`, `CharacterStats` interface
- `src/services/gacStrategy/imageGeneration/defenseStrategyHtml.ts` — Use shared icons, stats map, STAT_ID
- `src/services/gacStrategy/imageGeneration/offenseStrategyHtml.ts` — Use shared icons, stats map, STAT_ID
- `src/services/gacStrategy/imageGeneration/balancedStrategyHtml.ts` — Use shared stats map, STAT_ID
- `src/services/playerComparison/htmlGeneration.ts` — Use shared icons
- `src/config/gacConstants.ts` — Add `normaliseLeague()` export
- `src/services/gacStrategyService.ts` — Use `normaliseLeague()` from gacConstants
- `src/services/playerService.ts` — Use `normaliseAllyCode()` from allyCodeUtils
- `src/integrations/swgohGg/playerClient.ts` — Use `API_ENDPOINTS`
- `src/integrations/swgohGg/gacBracketClient.ts` — Use `API_ENDPOINTS`
- `src/integrations/swgohGg/defenseSquadsClient.ts` — Use `API_ENDPOINTS`
- `src/integrations/swgohGg/countersClient.ts` — Use `API_ENDPOINTS`
- `src/integrations/swgohGg/gacHistoryClient.ts` — Use `API_ENDPOINTS`
- `src/integrations/comlink/combinedClient.ts` — Use `API_ENDPOINTS`
- `src/integrations/comlink/comlinkClient.ts` — Use `API_ENDPOINTS`
- `src/storage/characterPortraitCache.ts` — Use `API_ENDPOINTS`
- `src/services/gacStrategy/squadMatching/matchCounters.ts` — Clean up TODO placeholders
- `.env.example` — Add descriptive comments and optional URL overrides

**Test files:**
- `src/config/__tests__/imageConstants.test.ts` — Verify icon and STAT_ID exports
- `src/services/gacStrategy/utils/__tests__/rosterUtils.test.ts` — Test `buildCharacterStatsMap()`
- `src/utils/__tests__/allyCodeUtils.test.ts` — Test `normaliseAllyCode()`
- `src/config/__tests__/gacConstants.test.ts` — Test `normaliseLeague()`

---

### Task 1: Create image constants file (icons + STAT_ID)

**Files:**
- Create: `src/config/imageConstants.ts`
- Create: `src/config/__tests__/imageConstants.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/config/__tests__/imageConstants.test.ts`:

```typescript
import { SPEED_ICON, HEALTH_ICON, PROTECTION_ICON, TENACITY_ICON, POTENCY_ICON, STAT_ID } from '../imageConstants';

describe('imageConstants', () => {
  describe('stat icons', () => {
    it('should export all 5 icon constants as base64 webp strings', () => {
      const icons = [SPEED_ICON, HEALTH_ICON, PROTECTION_ICON, TENACITY_ICON, POTENCY_ICON];
      for (const icon of icons) {
        expect(icon).toMatch(/^data:image\/webp;base64,/);
        expect(icon.length).toBeGreaterThan(50);
      }
    });
  });

  describe('STAT_ID', () => {
    it('should map stat names to their numeric string IDs', () => {
      expect(STAT_ID.HEALTH).toBe('1');
      expect(STAT_ID.SPEED).toBe('5');
      expect(STAT_ID.PROTECTION).toBe('28');
    });

    it('should be readonly', () => {
      // TypeScript enforces this at compile time via `as const`,
      // but verify the values are strings at runtime
      expect(typeof STAT_ID.HEALTH).toBe('string');
      expect(typeof STAT_ID.SPEED).toBe('string');
      expect(typeof STAT_ID.PROTECTION).toBe('string');
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/config/__tests__/imageConstants.test.ts --no-cache`
Expected: FAIL — `Cannot find module '../imageConstants'`

- [ ] **Step 3: Write the implementation**

Create `src/config/imageConstants.ts`:

```typescript
/**
 * Shared constants for image generation — stat icons and stat ID mappings.
 * Used by defense, offense, balanced strategy HTML and player comparison HTML.
 */

// Base64-encoded WebP stat icons from swgoh.gg
export const SPEED_ICON = 'data:image/webp;base64,UklGRh4CAABXRUJQVlA4TBICAAAvH8AHEJVAbCRJkbT+Ox0PvbP3YEA9Qx1ESAIAsIykrm3b9v5s27Zt27Zt27Zt28b51pmAvKIQYCJCg50EY77S1Bhz7EIRuiW4BBhxE6dU49W2O/+AfbOIVuARYcFPsjpDFmx66irnlREsVFT40WKlwJqf+UnuoUS4R2XkESTUJ/4JauhLUPG5bmtPOlmU2h85whTsTrVRSKDhpMJGgFwNuo04AUYfRhW59uxAB8FEKVBRCVQcVNnwl6/H7Gfrtx1fbevTf5cysSVEvQIOUWcXDDRVrTAoVBV7bVvf3jxopKa3/c8iOvt1hiC5+vVo1znGFcg4uFFMoqqjj0FyDoJDiYv92+CFDnPD/gGese1Ax0ntIluzaadefXRWvkEBh0ec8OzCJcFeiHK9Zm0492vyh8gGnRQ2CjzaJrX/p0lQuR38J7BBJwQLDSEa7KqAUV0OwiXKkp9sNQZsuPMfGL3gO0SSMR+Fuiw68OB70r1Bx/+RJTARUfE4XZViOYLBg5+ScSQifQP1y7+29cgT7pocoPVbLhNHrXfWNC32sQkKSxeV/re9tVUNcYOQ8HLVtl7V4F0IRGbOb0DbT3QblASLQp9AW7eCYO4lZ0b6HAFlskEzKQNe29YS5YUkCAWIzSK9M9BWzFoClTC1Pw48RMhSol6jcmtAawXuGhjoqAnSZMqBtzDp6nQbsWI19lzR3qBXEQ==';
export const HEALTH_ICON = 'data:image/webp;base64,UklGRswAAABXRUJQVlA4TMAAAAAvH8AHEIXjRpIUqfx3Opau4egdATXbtmXZg7tFG8CzL8BBsi8yxHuQiFQGcKju0ojMQHJ3T/x6T0Doi1rBs9Q/QEhHR0dHucEHAGDwzcRr7i/9Ffj9gpOZmcILaEsxe4IuWajYUzIBBYLQhn+QCNV74G1YHCq/h1pV0y+Au3OrLAkA8nA3Co2KAgDGscDpA4CFFpjsAbDQFJmsrKwxABYao4E7FlqyCr2T3JKJYKhLhMPhcAIvPMSIQ5tsivShrwo=';
export const PROTECTION_ICON = 'data:image/webp;base64,UklGRsYAAABXRUJQVlA4TLoAAAAvH8AHEFU4bhvJkTb/pHm2u8++a3Yi3AYAQDbRpguSKaNHfGFfkDMwp1y78gGvbj/gAbYxAfmxBI2T+Aqkkq//mYWaQkjczofZiAmI0Nq/uIWrRTXzb4ZaI+mdg/qkiqn/aCq6M6koz6QimhFXuDOpYGd2BWQ3YQ+qRH1ipyyYWDWoc29Da1HsKaaJ9upkdSLtyBxAG2FVy+6F7FlZlEzSfJ6tnVm6yyMXeqYxJncrBzAPYuobZB/Afwk=';
export const TENACITY_ICON = 'data:image/webp;base64,UklGRsABAABXRUJQVlA4TLQBAAAvH8AHEJVIbCPJkaT132me7Jn7fwPqVd9i4kSEJAAAy0iybdu2bdu2nrZt27Zt79m2fWM7EzC/UBHOtPN7Gy+BfEDPm+Z5XIPqi0yo7gs/y15wKFjkh5BMUqzO8QjI4viE9u7fmM0y62MksI9IP7izA8BTOAhl45hdP0XNjOIKxxVEXIS6ordGHqH8kEdmKDqzPl6iAk4/wQGXa9JCruCNEJ/hFUyM2Zb9NVO58SwoxDI6VkLxYhyWwCXMPgGmR1MVGlUPSwgBIG9nmRUAl/ShKV6uBHp/SOoGIWYBSMaa2q6UDd55XQv4O5Y1LwJFEm0o7ThudL/v3MnPzOCiwWzJQGD++R9Cvgr7dDt4b53qkkjf3hpm74C/cOAg/pdRrPp60ZtZpx3CN+je35Apphv43mCZOTCygtjP08yla2//U3VknALfe+/vjHHs2iDgCTpEtvt1XSWUdoh/QXKA+dB8dEHAWWUwI8tnmHzHdqM7TggMCdZvNZJN2jHuA2o0b3RnegmA+NdzmKTMmRg8b7/8H43cKePpa3c46ud4/BrSH7LneAm8Dk/kHBuQvrwM5SmOc35W';
export const POTENCY_ICON = 'data:image/webp;base64,UklGRi4BAABXRUJQVlA4TCEBAAAvH8AHEDVAbiPJkdT+O80TPV3TJ/6ZEW5ra28TVbbJoc5hiQyttQd5AeQJoMOroJLcuiT3SpXDBHyK3LZt5FOS7jqfyCAuHe4iV6KhuaNt/zBKVvg3uJXSOziYGB4S86ReoOEJdTb7xswZGo0RFaK+JttCzCIx8QVCZaoKwF1+kQRlyCySyLmBQOqMDfgpnM9RX8COKEv89ad76lWifMIaHOd3KlifcADTDRZfKOJ3wxTwh1Ng0+YXe2hrO5yG7kP5QvhNFklOpznAvIRBu0PmGdglOZ1mHCI6DrlfaPgXvQnd4V+Cgc/dv0bKA9zkTn0j51bPyXo61NNX2XxF6ozvoOkJdTSFtnE8+HIo8i59nUTJeu+LKP3XvszeN3egJTMQAA==';

// Numeric stat IDs used in swgoh.gg and Comlink API responses
export const STAT_ID = {
  HEALTH: '1',
  SPEED: '5',
  PROTECTION: '28',
} as const;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/config/__tests__/imageConstants.test.ts --no-cache`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/config/imageConstants.ts src/config/__tests__/imageConstants.test.ts
git commit -m "feat: add shared image constants for stat icons and STAT_ID"
```

---

### Task 2: Add `buildCharacterStatsMap()` to rosterUtils

**Files:**
- Modify: `src/services/gacStrategy/utils/rosterUtils.ts`
- Create: `src/services/gacStrategy/utils/__tests__/rosterUtils.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/services/gacStrategy/utils/__tests__/rosterUtils.test.ts`:

```typescript
import { buildCharacterStatsMap, CharacterStats } from '../rosterUtils';

// Minimal mock that matches the SwgohGgFullPlayerResponse shape
function makeRoster(units: Array<{
  base_id: string;
  combat_type: number;
  stats?: Record<string, number>;
  gear_level?: number;
  relic_tier?: number | null;
  name?: string;
}>) {
  return {
    units: units.map(u => ({
      data: {
        base_id: u.base_id,
        combat_type: u.combat_type,
        stats: u.stats || {},
        gear_level: u.gear_level ?? 13,
        relic_tier: u.relic_tier ?? 9,
        name: u.name || u.base_id,
        power: 30000,
      }
    }))
  } as any;
}

describe('buildCharacterStatsMap', () => {
  it('should build a stats map from a roster with characters', () => {
    const roster = makeRoster([
      { base_id: 'VADER', combat_type: 1, stats: { '5': 210, '1': 65000, '28': 120000 }, gear_level: 13, relic_tier: 9 },
      { base_id: 'PALPATINE', combat_type: 1, stats: { '5': 305, '1': 48000, '28': 89000 }, gear_level: 13, relic_tier: 7 },
    ]);

    const result = buildCharacterStatsMap(roster);

    expect(result.size).toBe(2);

    const vader = result.get('VADER')!;
    expect(vader.speed).toBe(210);
    expect(vader.health).toBe(65); // 65000 / 1000
    expect(vader.protection).toBe(120); // 120000 / 1000
    expect(vader.relic).toBe(7); // raw 9 - 2 = 7
    expect(vader.gearLevel).toBe(13);
    expect(vader.levelLabel).toBe('R7');

    const palpatine = result.get('PALPATINE')!;
    expect(palpatine.speed).toBe(305);
    expect(palpatine.relic).toBe(5); // raw 7 - 2 = 5
    expect(palpatine.levelLabel).toBe('R5');
  });

  it('should skip ships (combat_type !== 1)', () => {
    const roster = makeRoster([
      { base_id: 'YOURUNIT', combat_type: 1, stats: { '5': 100 } },
      { base_id: 'YOURSHIP', combat_type: 2, stats: { '5': 50 } },
    ]);

    const result = buildCharacterStatsMap(roster);

    expect(result.size).toBe(1);
    expect(result.has('YOURUNIT')).toBe(true);
    expect(result.has('YOURSHIP')).toBe(false);
  });

  it('should return an empty map for null/undefined roster', () => {
    expect(buildCharacterStatsMap(null as any).size).toBe(0);
    expect(buildCharacterStatsMap(undefined as any).size).toBe(0);
  });

  it('should return an empty map for roster with no units', () => {
    expect(buildCharacterStatsMap({ units: [] } as any).size).toBe(0);
    expect(buildCharacterStatsMap({} as any).size).toBe(0);
  });

  it('should handle missing stats gracefully', () => {
    const roster = makeRoster([
      { base_id: 'NOSTAT', combat_type: 1, stats: {}, gear_level: 10, relic_tier: null },
    ]);

    const result = buildCharacterStatsMap(roster);
    const unit = result.get('NOSTAT')!;

    expect(unit.speed).toBe(0);
    expect(unit.health).toBe(0);
    expect(unit.protection).toBe(0);
    expect(unit.relic).toBeNull();
    expect(unit.gearLevel).toBe(10);
    expect(unit.levelLabel).toBe('G10');
  });

  it('should handle pre-relic G13 units (relic_tier < 3)', () => {
    const roster = makeRoster([
      { base_id: 'FRESHG13', combat_type: 1, stats: { '5': 200 }, gear_level: 13, relic_tier: 1 },
    ]);

    const result = buildCharacterStatsMap(roster);
    const unit = result.get('FRESHG13')!;

    expect(unit.relic).toBe(0); // Pre-relic: raw tier 1 → display 0
    expect(unit.levelLabel).toBe('R0');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/services/gacStrategy/utils/__tests__/rosterUtils.test.ts --no-cache`
Expected: FAIL — `buildCharacterStatsMap is not exported` or `is not a function`

- [ ] **Step 3: Write the implementation**

Edit `src/services/gacStrategy/utils/rosterUtils.ts`. Add the import for `STAT_ID` and the utility functions at the top, then add the new function and export the interface:

At the top of the file, add imports:
```typescript
import { STAT_ID } from '../../../config/imageConstants';
import { getDisplayRelicLevel, getUnitLevelDisplay } from '../../../utils/unitLevelUtils';
```

After the existing `createCharacterMaps` function, add:

```typescript
/**
 * Stats for a single character, used across all image generation.
 */
export interface CharacterStats {
  speed: number;
  health: number;
  protection: number;
  relic: number | null;
  gearLevel: number;
  levelLabel: string;
}

/**
 * Build a map of character base_id to stats from a full player roster.
 * Filters to characters only (combat_type === 1), skips ships.
 * Health and protection are converted to thousands (divided by 1000).
 */
export function buildCharacterStatsMap(roster: SwgohGgFullPlayerResponse): Map<string, CharacterStats> {
  const map = new Map<string, CharacterStats>();
  if (!roster?.units) return map;

  for (const unit of roster.units) {
    if (unit.data?.base_id && unit.data.combat_type === 1) {
      const stats = unit.data.stats || {};
      const speed = Math.round(stats[STAT_ID.SPEED] || 0);
      const health = (stats[STAT_ID.HEALTH] || 0) / 1000;
      const protection = (stats[STAT_ID.PROTECTION] || 0) / 1000;
      const relic = getDisplayRelicLevel(unit.data.gear_level, unit.data.relic_tier);
      const levelDisplay = getUnitLevelDisplay(unit.data);
      map.set(unit.data.base_id, { speed, health, protection, relic, gearLevel: unit.data.gear_level, levelLabel: levelDisplay.label });
    }
  }
  return map;
}
```

Also update `createCharacterMaps` to use `STAT_ID` and `buildCharacterStatsMap` internally:

```typescript
export function createCharacterMaps(roster: SwgohGgFullPlayerResponse): {
  nameMap: Map<string, string>;
  statsMap: Map<string, { speed: number; health: number; protection: number }>;
} {
  const nameMap = new Map<string, string>();
  const fullStatsMap = buildCharacterStatsMap(roster);
  const statsMap = new Map<string, { speed: number; health: number; protection: number }>();

  for (const unit of roster.units || []) {
    if (unit.data?.base_id && unit.data.combat_type === 1) {
      if (unit.data.name) nameMap.set(unit.data.base_id, unit.data.name);
    }
  }
  for (const [key, val] of fullStatsMap) {
    statsMap.set(key, { speed: val.speed, health: val.health, protection: val.protection });
  }
  return { nameMap, statsMap };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/services/gacStrategy/utils/__tests__/rosterUtils.test.ts --no-cache`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/services/gacStrategy/utils/rosterUtils.ts src/services/gacStrategy/utils/__tests__/rosterUtils.test.ts
git commit -m "feat: add shared buildCharacterStatsMap() utility in rosterUtils"
```

---

### Task 3: Replace inline stats map + icons in defenseStrategyHtml.ts

**Files:**
- Modify: `src/services/gacStrategy/imageGeneration/defenseStrategyHtml.ts`

- [ ] **Step 1: Update imports**

At the top of `defenseStrategyHtml.ts`, add these imports and remove the old ones:

Replace:
```typescript
import { getDisplayRelicLevel, getUnitLevelDisplay } from '../../../utils/unitLevelUtils';
```
With:
```typescript
import { buildCharacterStatsMap } from '../utils/rosterUtils';
import { SPEED_ICON, HEALTH_ICON, PROTECTION_ICON } from '../../../config/imageConstants';
```

- [ ] **Step 2: Remove inline icon constants**

Delete lines 12-15 (the three `const SPEED_ICON = ...`, `const HEALTH_ICON = ...`, `const PROTECTION_ICON = ...` declarations and the comment above them).

- [ ] **Step 3: Replace inline stats map construction**

Replace the entire block from `const characterStatsMap = new Map<string, ...` through the closing `}` and logger line (lines 32-55) with:

```typescript
  const characterStatsMap = buildCharacterStatsMap(userRoster!);
  if (userRoster) {
    logger.info(`[Defense Image] Built stats map for ${characterStatsMap.size} characters from full roster`);
  }
```

Note: the `getDisplayRelicLevel` and `getUnitLevelDisplay` imports can be removed since they are no longer directly used in this file (they're used inside `buildCharacterStatsMap`). Check if they are referenced elsewhere in the file before removing — they may be used in the HTML template section for individual unit rendering. If so, keep the import.

- [ ] **Step 4: Verify build compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/services/gacStrategy/imageGeneration/defenseStrategyHtml.ts
git commit -m "refactor: use shared icons and buildCharacterStatsMap in defenseStrategyHtml"
```

---

### Task 4: Replace inline stats map + icons in offenseStrategyHtml.ts

**Files:**
- Modify: `src/services/gacStrategy/imageGeneration/offenseStrategyHtml.ts`

- [ ] **Step 1: Update imports**

Add these imports and remove old ones as needed:

Replace:
```typescript
import { getDisplayRelicLevel, getUnitLevelDisplay } from '../../../utils/unitLevelUtils';
```
With:
```typescript
import { buildCharacterStatsMap } from '../utils/rosterUtils';
import { SPEED_ICON, HEALTH_ICON, PROTECTION_ICON } from '../../../config/imageConstants';
```

- [ ] **Step 2: Remove inline icon constants**

Delete lines 13-16 (the three icon constant declarations and comment).

- [ ] **Step 3: Replace both inline stats map constructions**

Replace the user roster stats map block (lines 34-57) with:
```typescript
  const characterStatsMap = buildCharacterStatsMap(userRoster!);
  if (userRoster) {
    logger.info(`[Offense Image] Built stats map for ${characterStatsMap.size} characters from user roster`);
  }
```

Replace the opponent roster stats map block (lines 60-82) with:
```typescript
  const opponentStatsMap = buildCharacterStatsMap(opponentRoster!);
  if (opponentRoster) {
    logger.info(`[Offense Image] Built stats map for ${opponentStatsMap.size} characters from opponent roster`);
  }
```

As with Task 3, check if `getDisplayRelicLevel` / `getUnitLevelDisplay` are used elsewhere in the file before removing the import entirely.

- [ ] **Step 4: Verify build compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/services/gacStrategy/imageGeneration/offenseStrategyHtml.ts
git commit -m "refactor: use shared icons and buildCharacterStatsMap in offenseStrategyHtml"
```

---

### Task 5: Replace inline stats map in balancedStrategyHtml.ts

**Files:**
- Modify: `src/services/gacStrategy/imageGeneration/balancedStrategyHtml.ts`

- [ ] **Step 1: Update imports**

The file already imports from `rosterUtils`. Update the import to include `buildCharacterStatsMap`:

Replace:
```typescript
import { getTop80CharactersRoster, getGalacticLegendsFromRoster, createCharacterMaps } from '../utils/rosterUtils';
```
With:
```typescript
import { getTop80CharactersRoster, getGalacticLegendsFromRoster, createCharacterMaps, buildCharacterStatsMap } from '../utils/rosterUtils';
```

- [ ] **Step 2: Replace inline stats map construction**

Replace the block at lines 38-55 (the `characterNameMap` and `characterStatsMap` construction) with:

```typescript
    const characterNameMap = new Map<string, string>();
    if (userRoster?.units) {
      for (const unit of userRoster.units) {
        if (unit.data?.base_id && unit.data.combat_type === 1 && unit.data.name) {
          characterNameMap.set(unit.data.base_id, unit.data.name);
        }
      }
    }
    const fullStatsMap = buildCharacterStatsMap(userRoster!);
    // balancedStrategyHtml only uses speed/health/protection (no relic/gear/label)
    const characterStatsMap = new Map<string, { speed: number; health: number; protection: number }>();
    for (const [key, val] of fullStatsMap) {
      characterStatsMap.set(key, { speed: val.speed, health: val.health, protection: val.protection });
    }
```

- [ ] **Step 3: Verify build compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/services/gacStrategy/imageGeneration/balancedStrategyHtml.ts
git commit -m "refactor: use shared buildCharacterStatsMap in balancedStrategyHtml"
```

---

### Task 6: Replace inline icons in htmlGeneration.ts (player comparison)

**Files:**
- Modify: `src/services/playerComparison/htmlGeneration.ts:444-451`

- [ ] **Step 1: Add import**

At the top of `htmlGeneration.ts`, add:
```typescript
import { SPEED_ICON, HEALTH_ICON, PROTECTION_ICON, TENACITY_ICON, POTENCY_ICON } from '../../config/imageConstants';
```

- [ ] **Step 2: Replace inline icon declarations**

Delete the local icon constant declarations at lines 444-451 (the `speedIconBase64`, `healthIconBase64`, `protectionIconBase64`, `tenacityIconBase64`, `potencyIconBase64` assignments).

Then find all references to the old variable names and replace them with the shared constant names:
- `speedIconBase64` → `SPEED_ICON`
- `healthIconBase64` → `HEALTH_ICON`
- `protectionIconBase64` → `PROTECTION_ICON`
- `tenacityIconBase64` → `TENACITY_ICON`
- `potencyIconBase64` → `POTENCY_ICON`

Search the file for these variable names to find all usages (they appear in the HTML template strings later in the file).

- [ ] **Step 3: Verify build compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/services/playerComparison/htmlGeneration.ts
git commit -m "refactor: use shared icon constants in player comparison htmlGeneration"
```

---

### Task 7: Create centralised API endpoints

**Files:**
- Create: `src/config/apiEndpoints.ts`

- [ ] **Step 1: Create the file**

Create `src/config/apiEndpoints.ts`:

```typescript
/**
 * Centralised external API URLs.
 * Each endpoint can be overridden via environment variable.
 */
export const API_ENDPOINTS = {
  /** swgoh.gg REST API base (e.g. /player/{allyCode}/) */
  SWGOH_GG_API: process.env.SWGOH_GG_API_URL || 'https://swgoh.gg/api',

  /** swgoh.gg website base (for scraping GAC pages) */
  SWGOH_GG_BASE: process.env.SWGOH_GG_BASE_URL || 'https://swgoh.gg',

  /** Game asset CDN for character portraits and textures */
  GAME_ASSETS_BASE: process.env.GAME_ASSETS_BASE_URL || 'https://game-assets.swgoh.gg',

  /** Default Comlink server URL */
  COMLINK_DEFAULT: process.env.COMLINK_URL || 'http://localhost:3200',
} as const;
```

- [ ] **Step 2: Verify build compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/config/apiEndpoints.ts
git commit -m "feat: add centralised API endpoints config"
```

---

### Task 8: Replace hardcoded URLs in integration clients

**Files:**
- Modify: `src/integrations/swgohGg/playerClient.ts:9`
- Modify: `src/integrations/swgohGg/gacBracketClient.ts:8`
- Modify: `src/integrations/swgohGg/defenseSquadsClient.ts:72`
- Modify: `src/integrations/swgohGg/countersClient.ts:39`
- Modify: `src/integrations/swgohGg/gacHistoryClient.ts:128`
- Modify: `src/integrations/comlink/combinedClient.ts:56`
- Modify: `src/integrations/comlink/comlinkClient.ts:229`
- Modify: `src/storage/characterPortraitCache.ts:80,91`

- [ ] **Step 1: Update playerClient.ts**

Add import at top:
```typescript
import { API_ENDPOINTS } from '../../config/apiEndpoints';
```

Replace:
```typescript
private readonly baseUrl = 'https://swgoh.gg/api';
```
With:
```typescript
private readonly baseUrl = API_ENDPOINTS.SWGOH_GG_API;
```

- [ ] **Step 2: Update gacBracketClient.ts**

Add import at top:
```typescript
import { API_ENDPOINTS } from '../../config/apiEndpoints';
```

Replace:
```typescript
private readonly baseUrl = 'https://swgoh.gg/api';
```
With:
```typescript
private readonly baseUrl = API_ENDPOINTS.SWGOH_GG_API;
```

- [ ] **Step 3: Update defenseSquadsClient.ts**

Add import at top:
```typescript
import { API_ENDPOINTS } from '../../config/apiEndpoints';
```

Replace the local `baseUrl` declaration inside the method:
```typescript
const baseUrl = 'https://swgoh.gg';
```
With:
```typescript
const baseUrl = API_ENDPOINTS.SWGOH_GG_BASE;
```

- [ ] **Step 4: Update countersClient.ts**

Add import at top:
```typescript
import { API_ENDPOINTS } from '../../config/apiEndpoints';
```

Replace:
```typescript
const baseUrl = 'https://swgoh.gg';
```
With:
```typescript
const baseUrl = API_ENDPOINTS.SWGOH_GG_BASE;
```

- [ ] **Step 5: Update gacHistoryClient.ts**

Add import at top:
```typescript
import { API_ENDPOINTS } from '../../config/apiEndpoints';
```

Replace:
```typescript
const historyUrl = `https://swgoh.gg/p/${allyCode}/gac-history/`;
```
With:
```typescript
const historyUrl = `${API_ENDPOINTS.SWGOH_GG_BASE}/p/${allyCode}/gac-history/`;
```

- [ ] **Step 6: Update combinedClient.ts**

Add import at top:
```typescript
import { API_ENDPOINTS } from '../../config/apiEndpoints';
```

Replace:
```typescript
url: config.comlinkUrl ?? process.env.COMLINK_URL ?? 'http://localhost:3200',
```
With:
```typescript
url: config.comlinkUrl ?? API_ENDPOINTS.COMLINK_DEFAULT,
```

- [ ] **Step 7: Update comlinkClient.ts**

Add import at top:
```typescript
import { API_ENDPOINTS } from '../../config/apiEndpoints';
```

Replace:
```typescript
this.url = config?.url ?? process.env.COMLINK_URL ?? 'http://localhost:3200';
```
With:
```typescript
this.url = config?.url ?? API_ENDPOINTS.COMLINK_DEFAULT;
```

- [ ] **Step 8: Update characterPortraitCache.ts**

Add import at top:
```typescript
import { API_ENDPOINTS } from '../config/apiEndpoints';
```

Replace both occurrences of:
```typescript
return `https://game-assets.swgoh.gg/textures/tex.charui_${baseId.toLowerCase()}.png`;
```
With:
```typescript
return `${API_ENDPOINTS.GAME_ASSETS_BASE}/textures/tex.charui_${baseId.toLowerCase()}.png`;
```

- [ ] **Step 9: Verify build compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 10: Commit**

```bash
git add src/integrations/swgohGg/playerClient.ts src/integrations/swgohGg/gacBracketClient.ts src/integrations/swgohGg/defenseSquadsClient.ts src/integrations/swgohGg/countersClient.ts src/integrations/swgohGg/gacHistoryClient.ts src/integrations/comlink/combinedClient.ts src/integrations/comlink/comlinkClient.ts src/storage/characterPortraitCache.ts
git commit -m "refactor: replace hardcoded URLs with centralised API_ENDPOINTS"
```

---

### Task 9: Add `normaliseLeague()` helper

**Files:**
- Modify: `src/config/gacConstants.ts`
- Modify: `src/services/gacStrategyService.ts:55-65`
- Create: `src/config/__tests__/gacConstants.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/config/__tests__/gacConstants.test.ts`:

```typescript
import { normaliseLeague } from '../gacConstants';

describe('normaliseLeague', () => {
  it('should capitalise first letter and lowercase the rest', () => {
    expect(normaliseLeague('KYBER')).toBe('Kyber');
    expect(normaliseLeague('kyber')).toBe('Kyber');
    expect(normaliseLeague('Kyber')).toBe('Kyber');
    expect(normaliseLeague('AURODIUM')).toBe('Aurodium');
    expect(normaliseLeague('chromium')).toBe('Chromium');
  });

  it('should handle single character strings', () => {
    expect(normaliseLeague('k')).toBe('K');
    expect(normaliseLeague('K')).toBe('K');
  });

  it('should handle empty string', () => {
    expect(normaliseLeague('')).toBe('');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/config/__tests__/gacConstants.test.ts --no-cache`
Expected: FAIL — `normaliseLeague is not exported`

- [ ] **Step 3: Add normaliseLeague to gacConstants.ts**

Add this function before `getMaxSquadsForLeague`:

```typescript
/**
 * Normalise a league name to title case (e.g. 'KYBER' -> 'Kyber').
 */
export function normaliseLeague(league: string): string {
  if (!league) return league;
  return league.charAt(0).toUpperCase() + league.slice(1).toLowerCase();
}
```

Update `getMaxSquadsForLeague` to use it. Replace:
```typescript
const normalizedLeague = league.charAt(0).toUpperCase() + league.slice(1).toLowerCase();
```
With:
```typescript
const normalizedLeague = normaliseLeague(league);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/config/__tests__/gacConstants.test.ts --no-cache`
Expected: PASS (3 tests)

- [ ] **Step 5: Update gacStrategyService.ts**

In `src/services/gacStrategyService.ts`, update the import:

Replace:
```typescript
import { isGalacticLegend, MAX_DEFENSIVE_SQUADS_BY_LEAGUE } from '../config/gacConstants';
```
With:
```typescript
import { isGalacticLegend, MAX_DEFENSIVE_SQUADS_BY_LEAGUE, normaliseLeague } from '../config/gacConstants';
```

In the `getMaxSquadsForLeague` method (line 59), replace:
```typescript
const normalizedLeague = league.charAt(0).toUpperCase() + league.slice(1).toLowerCase();
```
With:
```typescript
const normalizedLeague = normaliseLeague(league);
```

- [ ] **Step 6: Verify build compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add src/config/gacConstants.ts src/config/__tests__/gacConstants.test.ts src/services/gacStrategyService.ts
git commit -m "refactor: extract normaliseLeague() helper and use in both call sites"
```

---

### Task 10: Add `normaliseAllyCode()` utility

**Files:**
- Create: `src/utils/allyCodeUtils.ts`
- Create: `src/utils/__tests__/allyCodeUtils.test.ts`
- Modify: `src/services/playerService.ts`

- [ ] **Step 1: Write the failing test**

Create `src/utils/__tests__/allyCodeUtils.test.ts`:

```typescript
import { normaliseAllyCode } from '../allyCodeUtils';

describe('normaliseAllyCode', () => {
  it('should return a plain 9-digit code unchanged', () => {
    expect(normaliseAllyCode('123456789')).toBe('123456789');
  });

  it('should strip dashes from ally code', () => {
    expect(normaliseAllyCode('123-456-789')).toBe('123456789');
  });

  it('should strip spaces from ally code', () => {
    expect(normaliseAllyCode('123 456 789')).toBe('123456789');
  });

  it('should throw for codes shorter than 9 digits', () => {
    expect(() => normaliseAllyCode('12345')).toThrow('Invalid ally code');
  });

  it('should throw for codes longer than 9 digits', () => {
    expect(() => normaliseAllyCode('1234567890')).toThrow('Invalid ally code');
  });

  it('should throw for non-numeric input', () => {
    expect(() => normaliseAllyCode('abcdefghi')).toThrow('Invalid ally code');
  });

  it('should throw for empty string', () => {
    expect(() => normaliseAllyCode('')).toThrow('Invalid ally code');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/utils/__tests__/allyCodeUtils.test.ts --no-cache`
Expected: FAIL — `Cannot find module '../allyCodeUtils'`

- [ ] **Step 3: Write the implementation**

Create `src/utils/allyCodeUtils.ts`:

```typescript
/**
 * Normalise an ally code to a plain 9-digit string.
 * Accepts formats like '123456789', '123-456-789', or '123 456 789'.
 * Throws if the result is not exactly 9 digits.
 */
export function normaliseAllyCode(input: string): string {
  const stripped = input.replace(/[-\s]/g, '');
  if (!/^\d{9}$/.test(stripped)) {
    throw new Error('Invalid ally code format. Expected 9 digits (e.g., 123456789 or 123-456-789).');
  }
  return stripped;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/utils/__tests__/allyCodeUtils.test.ts --no-cache`
Expected: PASS (7 tests)

- [ ] **Step 5: Update playerService.ts to use normaliseAllyCode**

In `src/services/playerService.ts`, add import:
```typescript
import { normaliseAllyCode } from '../utils/allyCodeUtils';
```

Replace the inline normalisation in `registerPlayer`:
```typescript
const numericAllyCode = allyCode.replace(/-/g, '');
if (!/^\d{9}$/.test(numericAllyCode)) {
  throw new Error('Invalid ally code format. Expected 9 digits (e.g., 123456789 or 123-456-789).');
}
```
With:
```typescript
const numericAllyCode = normaliseAllyCode(allyCode);
```

- [ ] **Step 6: Update gac.ts to normalise user-provided ally codes**

In `src/commands/gac.ts`, add import at the top:
```typescript
import { normaliseAllyCode } from '../utils/allyCodeUtils';
```

At line 185, where ally code is read for the `opponent` subcommand:
```typescript
const directAllyCode = interaction.options.getString('allycode');
```
Replace with:
```typescript
const directAllyCode = interaction.options.getString('allycode');
const normalizedDirectAllyCode = directAllyCode ? normaliseAllyCode(directAllyCode) : null;
```
Then use `normalizedDirectAllyCode` instead of `directAllyCode` in the line:
```typescript
const opponentAllyCode = normalizedDirectAllyCode ?? bracketOpponentAllyCode;
```

At line 197, where ally code is read for the `strategy` subcommand, apply the same pattern:
```typescript
const directAllyCode = interaction.options.getString('allycode');
const normalizedDirectAllyCode = directAllyCode ? normaliseAllyCode(directAllyCode) : null;
const opponentAllyCode = normalizedDirectAllyCode ?? bracketOpponentAllyCode;
```

Note: `bracketOpponentAllyCode` comes from autocomplete (already clean) so does not need normalisation.

- [ ] **Step 7: Run existing playerService tests**

Run: `npx jest src/services/__tests__/playerService.test.ts --no-cache`
Expected: PASS (existing tests still pass — same validation behaviour)

- [ ] **Step 8: Verify build compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 9: Commit**

```bash
git add src/utils/allyCodeUtils.ts src/utils/__tests__/allyCodeUtils.test.ts src/services/playerService.ts src/commands/gac.ts
git commit -m "feat: extract normaliseAllyCode() utility and use at command boundaries"
```

---

### Task 11: Update .env.example with documentation and URL overrides

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Rewrite .env.example**

Replace the full content of `.env.example` with:

```bash
# =============================================
# SWGOH Discord Bot — Environment Configuration
# =============================================
# Copy this file to .env and fill in your values.
# Lines starting with # are comments. Uncomment to enable.

# =============================================
# Discord Configuration (REQUIRED)
# =============================================

# Bot token from Discord Developer Portal → Bot → Token
# https://discord.com/developers/applications
DISCORD_BOT_TOKEN=your_discord_bot_token_here

# Application ID from Discord Developer Portal → General Information
DISCORD_CLIENT_ID=your_discord_client_id_here

# =============================================
# SWGOH API Configuration (REQUIRED for swgoh.gg features)
# =============================================

# swgoh.gg API key — used for player data, GAC brackets, counters
# Obtain from your swgoh.gg account settings
SWGOH_API_KEY=your_swgoh_api_key_here

# =============================================
# Comlink Configuration (Optional — recommended for real-time data)
# =============================================

# URL of your local Comlink server (default: http://localhost:3200)
COMLINK_URL=http://localhost:3200

# Comlink HMAC authentication keys (optional — only if Comlink requires auth)
# COMLINK_ACCESS_KEY=
# COMLINK_SECRET_KEY=

# =============================================
# API URL Overrides (Optional — for testing or custom endpoints)
# =============================================

# Override default swgoh.gg URLs (rarely needed)
# SWGOH_GG_API_URL=https://swgoh.gg/api
# SWGOH_GG_BASE_URL=https://swgoh.gg
# GAME_ASSETS_BASE_URL=https://game-assets.swgoh.gg

# =============================================
# Puppeteer Configuration (Raspberry Pi / ARM64)
# =============================================

# Uncomment these for Raspberry Pi deployment where system Chromium is used
# PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
# PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

# =============================================
# Logging Configuration (Optional)
# =============================================

# 'production' for normal use, 'development' for debug logging
NODE_ENV=production

# Log verbosity: 'error', 'warn', 'info', 'debug'
# LOG_LEVEL=info
```

- [ ] **Step 2: Verify no build impact**

Run: `npx tsc --noEmit`
Expected: No errors (config file changes don't affect compilation)

- [ ] **Step 3: Commit**

```bash
git add .env.example
git commit -m "docs: add descriptive comments and URL overrides to .env.example"
```

---

### Task 12: Clean up matchCounters.ts TODO placeholders

**Files:**
- Modify: `src/services/gacStrategy/squadMatching/matchCounters.ts:352,355`

- [ ] **Step 1: Replace the two async IIFE placeholders**

At line 352, replace:
```typescript
const counterDefenseStats = await (async () => { /* TODO: Extract getDefenseStatsForSquad */ return { holdPercentage: null, seenCount: null }; })() // getDefenseStatsForSquad(counter.leader.baseId, seasonId);
```
With:
```typescript
// Defence stats for counter squads not yet implemented — always returns null.
// See IMPROVEMENTS.md section 10.4 for design notes on getDefenseStatsForSquad.
const counterDefenseStats = { holdPercentage: null, seenCount: null };
```

At line 355 (after the previous edit, the line number will shift), replace:
```typescript
const opponentDefenseStats = await (async () => { /* TODO: Extract getDefenseStatsForSquad */ return { holdPercentage: null, seenCount: null }; })() // getDefenseStatsForSquad(defensiveSquad.leader.baseId, seasonId);
```
With:
```typescript
// Defence stats for opponent squads not yet implemented — always returns null.
const opponentDefenseStats = { holdPercentage: null, seenCount: null };
```

- [ ] **Step 2: Verify build compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/services/gacStrategy/squadMatching/matchCounters.ts
git commit -m "chore: clean up async IIFE TODO placeholders in matchCounters"
```

---

### Task 13: Final verification

- [ ] **Step 1: Run full build**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 2: Run all tests**

Run: `npx jest --no-cache`
Expected: All tests PASS (existing + new)

- [ ] **Step 3: Verify no regressions with git diff**

Run: `git diff HEAD~12 --stat` to review all changes across the 12 commits.
Verify:
- No new files outside the expected set
- No deleted files that shouldn't be deleted
- Line counts look reasonable (mostly deletions from deduplication, modest additions for new files)
