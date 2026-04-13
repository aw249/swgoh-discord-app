# SWGOH Discord Bot — Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement all improvements from `IMPROVEMENTS.md` in three PRs ordered by effort: small quick-wins first, then medium architectural changes, then large systemic improvements.

**Architecture:** Work is split into three feature branches (`improvements/pr1-small`, `improvements/pr2-medium`, `improvements/pr3-large`). Each PR is self-contained — PR2 may build on PR1 where noted. All code lives under `app/src/`.

**Tech Stack:** TypeScript 5.3, Node.js 18+, discord.js v14, Puppeteer, Jest/ts-jest, PM2, bash.

---

## PR 1 — Small Quick Wins

Branch: `improvements/pr1-small`

### File map

| Action | Path |
|--------|------|
| Create | `app/src/config/imageConstants.ts` |
| Create | `app/src/config/apiEndpoints.ts` |
| Modify | `app/src/services/gacStrategy/utils/rosterUtils.ts` |
| Modify | `app/src/services/gacStrategy/imageGeneration/defenseStrategyHtml.ts` |
| Modify | `app/src/services/gacStrategy/imageGeneration/offenseStrategyHtml.ts` |
| Modify | `app/src/services/gacStrategy/imageGeneration/balancedStrategyHtml.ts` |
| Modify | `app/src/integrations/swgohGg/playerClient.ts` |
| Modify | `app/src/integrations/swgohGg/defenseSquadsClient.ts` |
| Modify | `app/src/integrations/swgohGg/gacHistoryClient.ts` |
| Modify | `app/src/integrations/swgohGg/countersClient.ts` |
| Modify | `app/src/config/gacConstants.ts` |
| Modify | `app/src/services/gacStrategyService.ts` |
| Modify | `app/src/commands/gac.ts` |
| Modify | `app/src/commands/register.ts` |
| Modify | `app/src/types/archetypeTypes.ts` |
| Modify | `app/ecosystem.config.cjs` |
| Modify | `app/deploy.sh` |
| Modify | `app/.env.example` |

---

### Task 1.1 — Create `imageConstants.ts` (base64 icons + STAT_IDS)

**Files:**
- Create: `app/src/config/imageConstants.ts`

The three base64 icon strings (`SPEED_ICON`, `HEALTH_ICON`, `PROTECTION_ICON`) are copy-pasted into `defenseStrategyHtml.ts`, `offenseStrategyHtml.ts`, and `balancedStrategyHtml.ts`. Stat keys `'5'`, `'1'`, `'28'` are magic numbers used across the codebase. Centralise both here.

- [ ] **Step 1: Create `app/src/config/imageConstants.ts`**

```typescript
/** Base64-encoded stat icons used in HTML image generation. */
export const SPEED_ICON =
  'data:image/webp;base64,UklGRh4CAABXRUJQVlA4TBICAAAvH8AHEJVAbCRJkbT+Ox0PvbP3YEA9Qx1ESAIAsIykrm3b9v5s27Zt27Zt27Zt28b51pmAvKIQYCJCg50EY77S1Bhz7EIRuiW4BBhxE6dU49W2O/+AfbOIVuARYcFPsjpDFmx66irnlREsVFT40WKlwJqf+UnuoUS4R2XkESTUJ/4JauhLUPG5bmtPOlmU2h85whTsTrVRSKDhpMJGgFwNuo04AUYfRhW59uxAB8FEKVBRCVQcVNnwl6/H7Gfrtx1fbevTf5cysSVEvQIOUWcXDDRVrTAoVBV7bVvf3jxopKa3/c8iOvt1hiC5+vVo1znGFcg4uFFMoqqjj0FyDoJDiYv92+CFDnPD/gGese1Ax0ntIluzaadefXRWvkEBh0ec8OzCJcFeiHK9Zm0492vyh8gGnRQ2CjzaJrX/p0lQuR38J7BBJwQLDSEa7KqAUV0OwiXKkp9sNQZsuPMfGL3gO0SSMR+Fuiw68OB70r1Bx/+RJTARUfE4XZViOYLBg5+ScSQifQP1y7+29cgT7pocoPVbLhNHrXfWNC32sQkKSxeV/re9tVUNcYOQ8HLVtl7V4F0IRGbOb0DbT3QblASLQp9AW7eCYO4lZ0b6HAFlskEzKQNe29YS5YUkCAWIzSK9M9BWzFoClTC1Pw48RMhSol6jcmtAawXuGhjoqAnSZMqBtzDp6nQbsWI19lzR3qBXEQ==';

export const HEALTH_ICON =
  'data:image/webp;base64,UklGRswAAABXRUJQVlA4TMAAAAAvH8AHEIXjRpIUqfx3Opau4egdATXbtmXZg7tFG8CzL8BBsi8yxHuQiFQGcKju0ojMQHJ3T/x6T0Doi1rBs9Q/QEhHR0dHucEHAGDwzcRr7i/9Ffj9gpOZmcILaEsxe4IuWajYUzIBBYLQhn+QCNV74G1YHCq/h1pV0y+Au3OrLAkA8nA3Co2KAgDGscDpA4CFFpjsAbDQFJmsrKwxABYao4E7FlqyCr2T3JKJYKhLhMPhcAIvPMSIQ5tsivShrwo=';

export const PROTECTION_ICON =
  'data:image/webp;base64,UklGRsYAAABXRUJQVlA4TLoAAAAvH8AHEFU4bhvJkTb/pHm2u8++a3Yi3AYAQDbRpguSKaNHfGFfkDMwp1y78gGvbj/gAbYxAfmxBI2T+Aqkkq//mYWaQkjczofZiAmI0Nq/uIWrRTXzb4ZaI+mdg/qkiqn/aCq6M6koz6QimhFXuDOpYGd2BWQ3YQ+qRH1ipyyYWDWoc29Da1HsKaaJ9upkdSLtyBxAG2FVy+6F7FlZlEzSfJ6tnVm6yyMXeqYxJncrBzAPYuobZB/Afwk=';

/**
 * Numeric keys used to look up unit stats from the swgoh.gg stats object.
 * These are the raw stat IDs from the game data.
 */
export const STAT_IDS = {
  HEALTH: '1',
  SPEED: '5',
  PROTECTION: '28',
} as const;
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/alexwoodbridge/Documents/GitHub/swgoh-discord-app/app && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/src/config/imageConstants.ts
git commit -m "feat: centralise base64 stat icons and STAT_IDS constants"
```

---

### Task 1.2 — Replace duplicated icons & stat keys in image generators

**Files:**
- Modify: `app/src/services/gacStrategy/imageGeneration/defenseStrategyHtml.ts`
- Modify: `app/src/services/gacStrategy/imageGeneration/offenseStrategyHtml.ts`
- Modify: `app/src/services/gacStrategy/imageGeneration/balancedStrategyHtml.ts`

- [ ] **Step 1: Update `defenseStrategyHtml.ts` — replace local icon constants with import and use STAT_IDS**

At the top of the file, replace the three `const SPEED_ICON = ...` / `HEALTH_ICON` / `PROTECTION_ICON` declarations with:

```typescript
import { SPEED_ICON, HEALTH_ICON, PROTECTION_ICON, STAT_IDS } from '../../../config/imageConstants';
```

Then in the `characterStatsMap` building loop, replace the magic string keys:

```typescript
// Before:
const speed = Math.round(stats['5'] || 0);
const health = (stats['1'] || 0) / 1000;
const protection = (stats['28'] || 0) / 1000;

// After:
const speed = Math.round(stats[STAT_IDS.SPEED] || 0);
const health = (stats[STAT_IDS.HEALTH] || 0) / 1000;
const protection = (stats[STAT_IDS.PROTECTION] || 0) / 1000;
```

- [ ] **Step 2: Update `offenseStrategyHtml.ts` — same change**

Replace the three icon constant declarations with the same import line as above, and replace magic stat keys with `STAT_IDS.*` in all stats map building loops (there are two: `characterStatsMap` for the user and `opponentStatsMap` for the opponent).

- [ ] **Step 3: Update `balancedStrategyHtml.ts` — icons only (it already uses `createCharacterMaps` for some stats)**

Replace the three icon constant declarations with the import. For any remaining inline `stats['5']`/`stats['1']`/`stats['28']` references, replace with `STAT_IDS.*`.

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd /Users/alexwoodbridge/Documents/GitHub/swgoh-discord-app/app && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add app/src/services/gacStrategy/imageGeneration/
git commit -m "refactor: import shared icon constants and STAT_IDS in image generators"
```

---

### Task 1.3 — Extract `buildCharacterStatsMap` utility into `rosterUtils.ts`

**Files:**
- Modify: `app/src/services/gacStrategy/utils/rosterUtils.ts`
- Modify: `app/src/services/gacStrategy/imageGeneration/defenseStrategyHtml.ts`
- Modify: `app/src/services/gacStrategy/imageGeneration/offenseStrategyHtml.ts`

The `characterStatsMap` building loop (iterates `userRoster.units`, extracts speed/health/protection/relic/gear/levelLabel into a `Map`) is copy-pasted in `defenseStrategyHtml.ts` and `offenseStrategyHtml.ts`. `rosterUtils.ts` already has `createCharacterMaps` but it returns a simpler type. We need the extended version.

- [ ] **Step 1: Add `buildCharacterStatsMap` to `rosterUtils.ts`**

```typescript
// Add after existing imports, at the bottom of rosterUtils.ts
import { getDisplayRelicLevel, getUnitLevelDisplay } from '../../../utils/unitLevelUtils';
import { STAT_IDS } from '../../../config/imageConstants';

export interface CharacterStatEntry {
  speed: number;
  health: number;
  protection: number;
  relic: number | null;
  gearLevel: number;
  levelLabel: string;
}

/**
 * Build a map of character stats from a full player roster.
 * Used by all image generation functions to avoid duplicated iteration logic.
 */
export function buildCharacterStatsMap(
  roster: SwgohGgFullPlayerResponse
): Map<string, CharacterStatEntry> {
  const map = new Map<string, CharacterStatEntry>();
  for (const unit of roster.units || []) {
    if (unit.data?.base_id && unit.data.combat_type === 1) {
      const stats = unit.data.stats || {};
      const speed = Math.round(stats[STAT_IDS.SPEED] || 0);
      const health = (stats[STAT_IDS.HEALTH] || 0) / 1000;
      const protection = (stats[STAT_IDS.PROTECTION] || 0) / 1000;
      const relic = getDisplayRelicLevel(unit.data.gear_level, unit.data.relic_tier);
      const levelDisplay = getUnitLevelDisplay(unit.data);
      map.set(unit.data.base_id, {
        speed,
        health,
        protection,
        relic,
        gearLevel: unit.data.gear_level,
        levelLabel: levelDisplay.label,
      });
    }
  }
  return map;
}
```

- [ ] **Step 2: Replace inline map-building in `defenseStrategyHtml.ts`**

Remove the entire `characterStatsMap` construction loop (lines ~33–55). Import and call the utility instead:

```typescript
import { buildCharacterStatsMap } from '../utils/rosterUtils';

// Inside generateDefenseStrategyHtml, replace the loop with:
const characterStatsMap = userRoster ? buildCharacterStatsMap(userRoster) : new Map();
logger.info(`[Defense Image] Built stats map for ${characterStatsMap.size} characters from full roster`);
```

- [ ] **Step 3: Replace inline map-building in `offenseStrategyHtml.ts`**

Do the same for `characterStatsMap` (user stats). Keep the `opponentStatsMap` loop in place — it builds from `opponentRoster` which is a different parameter, so a second call to `buildCharacterStatsMap(opponentRoster)` covers it:

```typescript
import { buildCharacterStatsMap } from '../utils/rosterUtils';

const characterStatsMap = userRoster ? buildCharacterStatsMap(userRoster) : new Map();
const opponentStatsMap = opponentRoster ? buildCharacterStatsMap(opponentRoster) : new Map();
```

Remove the two duplicate loops that were building these maps.

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd /Users/alexwoodbridge/Documents/GitHub/swgoh-discord-app/app && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add app/src/services/gacStrategy/utils/rosterUtils.ts \
        app/src/services/gacStrategy/imageGeneration/defenseStrategyHtml.ts \
        app/src/services/gacStrategy/imageGeneration/offenseStrategyHtml.ts
git commit -m "refactor: extract buildCharacterStatsMap into rosterUtils"
```

---

### Task 1.4 — Create `apiEndpoints.ts` and centralise external URLs

**Files:**
- Create: `app/src/config/apiEndpoints.ts`
- Modify: `app/src/integrations/swgohGg/playerClient.ts`
- Modify: `app/src/integrations/swgohGg/defenseSquadsClient.ts`
- Modify: `app/src/integrations/swgohGg/gacHistoryClient.ts`
- Modify: `app/src/integrations/swgohGg/countersClient.ts`

- [ ] **Step 1: Create `app/src/config/apiEndpoints.ts`**

```typescript
/** All external URL bases used by integration clients. */
export const API_ENDPOINTS = {
  SWGOH_GG_API: 'https://swgoh.gg/api',
  SWGOH_GG_PROFILE: 'https://swgoh.gg/player',
  SWGOH_GG_GAC_SQUADS: 'https://swgoh.gg/gac/squads/',
  SWGOH_GG_GAC_HISTORY: 'https://swgoh.gg/p',
  SWGOH_GG_COUNTERS: 'https://swgoh.gg/gac/counters/',
} as const;
```

- [ ] **Step 2: Update `playerClient.ts`**

Remove the two private `baseUrl` and `profileBaseUrl` fields. Import and use `API_ENDPOINTS`:

```typescript
import { API_ENDPOINTS } from '../../config/apiEndpoints';

// Replace this.baseUrl with API_ENDPOINTS.SWGOH_GG_API
// Replace this.profileBaseUrl with API_ENDPOINTS.SWGOH_GG_PROFILE
// e.g.:
const url = `${API_ENDPOINTS.SWGOH_GG_API}/player/${allyCode}/`;
const profileUrl = `${API_ENDPOINTS.SWGOH_GG_PROFILE}/${allyCode}/`;
```

- [ ] **Step 3: Update `defenseSquadsClient.ts`**

Replace the inline `'https://swgoh.gg'` and hardcoded `'/gac/squads/'` strings:

```typescript
import { API_ENDPOINTS } from '../../config/apiEndpoints';

// Replace:
// const baseUrl = 'https://swgoh.gg';
// let url = `${baseUrl}/gac/squads/`;
// With:
let url = API_ENDPOINTS.SWGOH_GG_GAC_SQUADS;
```

- [ ] **Step 4: Update `gacHistoryClient.ts`**

Replace the hardcoded history URL template:

```typescript
import { API_ENDPOINTS } from '../../config/apiEndpoints';

// Replace:
// const historyUrl = `https://swgoh.gg/p/${allyCode}/gac-history/`;
// With:
const historyUrl = `${API_ENDPOINTS.SWGOH_GG_GAC_HISTORY}/${allyCode}/gac-history/`;
```

- [ ] **Step 5: Check `countersClient.ts` for any hardcoded swgoh.gg URLs and update similarly using `API_ENDPOINTS.SWGOH_GG_COUNTERS`**

- [ ] **Step 6: Verify TypeScript compiles**

```bash
cd /Users/alexwoodbridge/Documents/GitHub/swgoh-discord-app/app && npx tsc --noEmit
```

- [ ] **Step 7: Commit**

```bash
git add app/src/config/apiEndpoints.ts \
        app/src/integrations/swgohGg/
git commit -m "refactor: centralise external URLs in apiEndpoints.ts"
```

---

### Task 1.5 — Add `normaliseLeague` and `normaliseAllyCode` helpers

**Files:**
- Modify: `app/src/config/gacConstants.ts`
- Modify: `app/src/services/gacStrategyService.ts`
- Modify: `app/src/commands/gac.ts`
- Modify: `app/src/commands/register.ts`

The pattern `league.charAt(0).toUpperCase() + league.slice(1).toLowerCase()` exists in both `gacConstants.ts:59` and in `gacStrategyService.ts`. Ally code normalisation (stripping dashes) happens inconsistently.

- [ ] **Step 1: Add helpers to `gacConstants.ts`**

```typescript
/**
 * Normalise a league name to title case (e.g. 'kyber' → 'Kyber').
 */
export function normaliseLeague(league: string): string {
  return league.charAt(0).toUpperCase() + league.slice(1).toLowerCase();
}

/**
 * Normalise an ally code to digits-only (e.g. '123-456-789' → '123456789').
 */
export function normaliseAllyCode(allyCode: string): string {
  return allyCode.replace(/-/g, '').trim();
}
```

- [ ] **Step 2: Update `gacConstants.ts:getMaxSquadsForLeague`**

Replace the inline normalisation with the helper:

```typescript
// Before:
const normalizedLeague = league.charAt(0).toUpperCase() + league.slice(1).toLowerCase();
// After:
const normalizedLeague = normaliseLeague(league);
```

- [ ] **Step 3: Find and replace inline league normalisation in `gacStrategyService.ts`**

Search for `charAt(0).toUpperCase()` in the file. Replace each occurrence with a call to `normaliseLeague` (import it from `../config/gacConstants`).

- [ ] **Step 4: Apply `normaliseAllyCode` at command input boundary in `gac.ts` and `register.ts`**

In `gac.ts`, wherever ally code is read from the interaction option (e.g. `interaction.options.getString('allycode')`), wrap it:

```typescript
import { normaliseAllyCode } from '../config/gacConstants';

const rawAllyCode = interaction.options.getString('allycode') ?? '';
const allyCode = normaliseAllyCode(rawAllyCode);
```

Do the same in `register.ts`.

- [ ] **Step 5: Verify TypeScript compiles**

```bash
cd /Users/alexwoodbridge/Documents/GitHub/swgoh-discord-app/app && npx tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add app/src/config/gacConstants.ts \
        app/src/services/gacStrategyService.ts \
        app/src/commands/gac.ts \
        app/src/commands/register.ts
git commit -m "refactor: add normaliseLeague and normaliseAllyCode helpers"
```

---

### Task 1.6 — Add `shortDescription` field to archetype ability types

**Files:**
- Modify: `app/src/types/archetypeTypes.ts`

The warning truncation in `defenseStrategyHtml.ts` uses fragile string splitting (`.split(' - ')[0]` etc.) instead of a purpose-built short label.

- [ ] **Step 1: Add `shortDescription` to `AbilityRequirement` in `archetypeTypes.ts`**

```typescript
export interface AbilityRequirement {
  unitBaseId: string;
  abilityId: string;
  abilityType: AbilityType;
  modeGates?: GameMode[];
  reason: string;
  displayName?: string;
  /**
   * Short label for display in images (max ~30 chars).
   * If omitted, the image renderer falls back to truncating `reason`.
   * Example: "Piett GAC omicron" instead of the full reason sentence.
   */
  shortDescription?: string;
}
```

- [ ] **Step 2: Update warning rendering in `defenseStrategyHtml.ts`**

Replace the fragile `shortReason` truncation logic with:

```typescript
const shortReason = m.shortDescription 
  ?? reason.split(' - ')[0].split(' massively')[0].split(' provides')[0];
```

This keeps the fallback for any existing archetypes that don't have `shortDescription` yet, while using the purpose-built field when present.

- [ ] **Step 3: Do the same in `offenseStrategyHtml.ts` if it has equivalent truncation logic**

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd /Users/alexwoodbridge/Documents/GitHub/swgoh-discord-app/app && npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add app/src/types/archetypeTypes.ts \
        app/src/services/gacStrategy/imageGeneration/defenseStrategyHtml.ts \
        app/src/services/gacStrategy/imageGeneration/offenseStrategyHtml.ts
git commit -m "feat: add shortDescription field to archetype ability requirements"
```

---

### Task 1.7 — Improve `.env.example` documentation

**Files:**
- Modify: `app/.env.example`

- [ ] **Step 1: Rewrite `app/.env.example` with inline explanations**

```bash
# SWGOH Discord Bot — Environment Configuration
# Copy this file to .env and fill in your values.
# Lines starting with # are comments. Required fields must be set before starting.

# ===========================================
# Discord Configuration (Required)
# ===========================================

# Your Discord bot token from https://discord.com/developers/applications
# Required. Without this the bot cannot connect to Discord.
DISCORD_BOT_TOKEN=your_discord_bot_token_here

# Your Discord application client ID (shown on the application page, not the bot token)
# Required. Used to register slash commands.
DISCORD_CLIENT_ID=your_discord_client_id_here

# ===========================================
# SWGOH API Configuration
# ===========================================

# swgoh.gg API key — obtain from https://swgoh.gg/api/
# Optional. If omitted, the bot uses Puppeteer scraping for swgoh.gg endpoints.
SWGOH_API_KEY=your_swgoh_api_key_here

# ===========================================
# Comlink Configuration (Optional but recommended)
# ===========================================

# URL of your running SWGoH Comlink instance (local or remote).
# Defaults to http://localhost:3200 if not set.
# Comlink gives real-time player data directly from Capital Games servers.
COMLINK_URL=http://localhost:3200

# Comlink access and secret keys — only required if your Comlink instance
# is configured with authentication. Leave commented out for unauthenticated Comlink.
# COMLINK_ACCESS_KEY=your_comlink_access_key
# COMLINK_SECRET_KEY=your_comlink_secret_key

# ===========================================
# Puppeteer / Chromium Configuration
# ===========================================

# Required on Raspberry Pi (ARM64 Linux) where bundled Chromium won't run.
# Set to the path of your system Chromium: usually /usr/bin/chromium-browser
# On macOS/Windows leave commented out — Puppeteer uses its bundled browser.
# PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

# Set to 'true' on Raspberry Pi to prevent Puppeteer downloading its own Chromium.
# PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

# ===========================================
# Logging / Runtime (Optional)
# ===========================================

# Set to 'development' to enable verbose debug logging. Default: production.
NODE_ENV=production

# Log level override. Accepts: debug, info, warn, error. Default: info.
# LOG_LEVEL=info
```

- [ ] **Step 2: Commit**

```bash
git add app/.env.example
git commit -m "docs: add inline explanations to .env.example"
```

---

### Task 1.8 — Raspberry Pi: increase PM2 memory limit

**Files:**
- Modify: `app/ecosystem.config.cjs`

- [ ] **Step 1: Update `max_memory_restart` in `ecosystem.config.cjs`**

```javascript
// Before:
max_memory_restart: '500M',

// After:
max_memory_restart: '750M',
```

Also add `node_args` to the `swgoh-bot` app entry to cap the Node heap below the PM2 limit, allowing Node to OOM gracefully rather than PM2 hard-killing a hung process:

```javascript
node_args: '--max-old-space-size=512',
```

- [ ] **Step 2: Commit**

```bash
git add app/ecosystem.config.cjs
git commit -m "fix(pi): increase PM2 memory limit to 750M and cap Node heap at 512M"
```

---

### Task 1.9 — Raspberry Pi: remove `--disable-dev-shm-usage`, add tmpfs guidance

**Files:**
- Modify: `app/src/integrations/swgohGg/browser.ts`
- Modify: `app/RASPBERRY_PI_SETUP.md`

- [ ] **Step 1: Remove `--disable-dev-shm-usage` from Puppeteer launch args in `browser.ts`**

```typescript
// Before:
args: [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-accelerated-2d-canvas',
  '--no-first-run',
  '--no-zygote',
  '--disable-gpu'
]

// After:
args: [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-accelerated-2d-canvas',
  '--no-first-run',
  '--no-zygote',
  '--disable-gpu'
]
```

- [ ] **Step 2: Add `/dev/shm` tmpfs setup to `RASPBERRY_PI_SETUP.md`**

Find the deployment/setup section and add:

```markdown
### Shared Memory (important for Puppeteer performance)

By default Raspberry Pi OS mounts `/dev/shm` too small for Chromium rendering.
Add the following to `/etc/fstab` to allocate 256 MB:

```
tmpfs /dev/shm tmpfs defaults,size=256M 0 0
```

Then remount: `sudo mount -a`

Without this, Chromium writes rendering data to the SD card (slow). With it,
screenshots stay in RAM and respond ~3× faster.
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /Users/alexwoodbridge/Documents/GitHub/swgoh-discord-app/app && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add app/src/integrations/swgohGg/browser.ts app/RASPBERRY_PI_SETUP.md
git commit -m "fix(pi): remove --disable-dev-shm-usage and document tmpfs setup"
```

---

### Task 1.10 — Raspberry Pi: orphaned Chromium cleanup in deploy script

**Files:**
- Modify: `app/deploy.sh`

- [ ] **Step 1: Add Chromium cleanup before `pm2 start` in `deploy.sh`**

Find the `pm2 start ecosystem.config.cjs` line and add cleanup immediately before it:

```bash
# Kill any orphaned chromium processes left from a previous crash
echo -e "${BLUE}🧹 Cleaning up orphaned Chromium processes...${NC}"
pkill -f chromium-browser 2>/dev/null || true
echo -e "${GREEN}✅ Chromium cleanup complete${NC}"
echo ""
```

- [ ] **Step 2: Commit**

```bash
git add app/deploy.sh
git commit -m "fix(pi): kill orphaned chromium processes on deploy"
```

---

### Task 1.11 — Raspberry Pi: use symlink for Comlink binary in deploy script

**Files:**
- Modify: `app/deploy.sh`

- [ ] **Step 1: Replace hardcoded binary check with symlink check in `deploy.sh`**

```bash
# Replace this block:
if [ ! -f "./bin/swgoh-comlink-4.0.0" ]; then
    echo -e "${RED}❌ Error: Comlink binary not found!${NC}"
    echo "   Download the ARM64 Linux version from:"
    echo "   https://github.com/swgoh-utils/swgoh-comlink/releases"
    echo "   Save as: ./bin/swgoh-comlink-4.0.0"
    exit 1
fi

if [ ! -x "./bin/swgoh-comlink-4.0.0" ]; then
    echo -e "${YELLOW}⚠️  Making Comlink binary executable...${NC}"
    chmod +x ./bin/swgoh-comlink-4.0.0
fi

# With:
if [ ! -L "./bin/swgoh-comlink" ] && [ ! -f "./bin/swgoh-comlink" ]; then
    echo -e "${RED}❌ Error: Comlink binary/symlink not found at ./bin/swgoh-comlink${NC}"
    echo "   Download the ARM64 Linux binary from:"
    echo "   https://github.com/swgoh-utils/swgoh-comlink/releases"
    echo "   Then create a symlink: ln -s swgoh-comlink-X.Y.Z ./bin/swgoh-comlink"
    exit 1
fi

if [ ! -x "./bin/swgoh-comlink" ]; then
    echo -e "${YELLOW}⚠️  Making Comlink binary executable...${NC}"
    chmod +x ./bin/swgoh-comlink
fi

# Verify the binary runs on this architecture
echo -e "${BLUE}🔍 Verifying Comlink binary...${NC}"
if ! ./bin/swgoh-comlink --version &>/dev/null; then
    echo -e "${YELLOW}⚠️  Comlink binary may not be compatible with this architecture${NC}"
    echo "   Download the correct ARM64 Linux version from:"
    echo "   https://github.com/swgoh-utils/swgoh-comlink/releases"
fi
```

- [ ] **Step 2: Commit**

```bash
git add app/deploy.sh
git commit -m "fix(pi): use symlink for Comlink binary, add architecture check"
```

---

### Task 1.12 — Open PR for all small changes

- [ ] **Step 1: Push branch**

```bash
git push -u origin improvements/pr1-small
```

- [ ] **Step 2: Create PR on GitHub**

Title: `improvements: PR1 — small quick wins (constants, helpers, Pi fixes, docs)`

Body: Reference each IMPROVEMENTS.md section covered: 1.4, 1.5, 3.2, 4.1, 4.2, 4.4, 4.7, 5.2, 7.2, 10.2, 11.

---

## PR 2 — Medium Changes

Branch: `improvements/pr2-medium`  
Base: `main` (or `improvements/pr1-small` if not yet merged)

### File map

| Action | Path |
|--------|------|
| Create | `app/src/commands/handlers/bracketHandler.ts` |
| Create | `app/src/commands/handlers/opponentHandler.ts` |
| Create | `app/src/commands/handlers/strategyHandler.ts` |
| Create | `app/src/commands/commandUtils.ts` |
| Create | `app/src/errors/gacErrors.ts` |
| Create | `.github/workflows/ci.yml` |
| Modify | `app/src/commands/gac.ts` |
| Modify | `app/src/services/gacStrategyService.ts` |
| Modify | `app/src/services/gacStrategy/imageGeneration/defenseStrategyHtml.ts` |
| Modify | `app/src/services/gacStrategy/imageGeneration/offenseStrategyHtml.ts` |
| Modify | `app/src/services/gacStrategy/imageGeneration/balancedStrategyHtml.ts` |
| Modify | `app/src/services/gacStrategy/squadMatching/matchCounters.ts` |
| Modify | `app/src/services/archetypeValidation/archetypeValidator.ts` |
| Modify | `app/src/integrations/swgohGg/browser.ts` |
| Modify | `app/src/bot/index.ts` |

---

### Task 2.1 — Custom error classes

**Files:**
- Create: `app/src/errors/gacErrors.ts`
- Modify: `app/src/integrations/swgohGg/defenseSquadsClient.ts`
- Modify: `app/src/integrations/swgohGg/gacHistoryClient.ts`
- Modify: `app/src/integrations/swgohGg/gacBracketClient.ts`
- Modify: `app/src/integrations/swgohGg/playerClient.ts`
- Modify: `app/src/commands/gac.ts`

- [ ] **Step 1: Create `app/src/errors/gacErrors.ts`**

```typescript
/** Thrown when Cloudflare blocks a request to swgoh.gg. */
export class CloudflareBlockError extends Error {
  constructor(context?: string) {
    super(context ? `Cloudflare challenge not resolved (${context})` : 'Cloudflare challenge not resolved');
    this.name = 'CloudflareBlockError';
  }
}

/** Thrown when no active GAC bracket is found for the player. */
export class NoActiveBracketError extends Error {
  constructor() {
    super('No active GAC bracket found for this player');
    this.name = 'NoActiveBracketError';
  }
}

/** Thrown when a player cannot be found by ally code. */
export class PlayerNotFoundError extends Error {
  constructor(allyCode: string) {
    super(`Player not found for ally code: ${allyCode}`);
    this.name = 'PlayerNotFoundError';
  }
}

/** Thrown when a player has no GAC history data. */
export class NoGacHistoryError extends Error {
  constructor(allyCode: string) {
    super(`No GAC history found for ally code: ${allyCode}`);
    this.name = 'NoGacHistoryError';
  }
}
```

- [ ] **Step 2: Update `defenseSquadsClient.ts` — throw typed errors instead of string-matching**

Replace:
```typescript
if (error.message?.includes('Cloudflare')) {
  throw new Error('Cloudflare challenge could not be resolved...');
}
```
With:
```typescript
import { CloudflareBlockError } from '../../errors/gacErrors';

if (error.message?.includes('Cloudflare') || error.message?.includes('Just a moment')) {
  throw new CloudflareBlockError('top defense squads');
}
```

Also throw `CloudflareBlockError` from the inline `title.includes('Just a moment')` check:
```typescript
if (title.includes('Just a moment') || title.toLowerCase().includes('error')) {
  throw new CloudflareBlockError('top defense squads page');
}
```

- [ ] **Step 3: Update `gacHistoryClient.ts` with the same Cloudflare check and add `NoGacHistoryError`**

```typescript
import { CloudflareBlockError, NoGacHistoryError } from '../../errors/gacErrors';

// Replace Cloudflare string checks:
if (title.includes('Just a moment')) throw new CloudflareBlockError('gac history');
if (error.message?.includes('Cloudflare')) throw new CloudflareBlockError('gac history');

// Replace 'No GAC history' text throw:
throw new NoGacHistoryError(allyCode);
```

- [ ] **Step 4: Update `playerClient.ts` — throw `PlayerNotFoundError`**

```typescript
import { PlayerNotFoundError } from '../../errors/gacErrors';

if (error.message?.includes('404') || error.message?.includes('not found')) {
  throw new PlayerNotFoundError(allyCode);
}
```

- [ ] **Step 5: Update `gac.ts` — replace string matching with `instanceof`**

Find the error classification block (around line 285–292) and replace:

```typescript
import { CloudflareBlockError, NoActiveBracketError, PlayerNotFoundError, NoGacHistoryError } from '../errors/gacErrors';

// Replace:
if (err.message?.includes('Cloudflare')) { ... }
if (err.message?.includes('No active GAC bracket')) { ... }

// With:
if (err instanceof CloudflareBlockError) {
  await safeEditStatusMessage(interaction, '⚠️ Cloudflare blocked the request. Please try again in a moment.');
  return;
}
if (err instanceof NoActiveBracketError) {
  await safeEditStatusMessage(interaction, '📭 No active GAC bracket found. Check back when a new round starts.');
  return;
}
if (err instanceof PlayerNotFoundError) {
  await safeEditStatusMessage(interaction, `❌ Player not found. Double-check your ally code.`);
  return;
}
```

- [ ] **Step 6: Verify TypeScript compiles**

```bash
cd /Users/alexwoodbridge/Documents/GitHub/swgoh-discord-app/app && npx tsc --noEmit
```

- [ ] **Step 7: Commit**

```bash
git add app/src/errors/ \
        app/src/integrations/swgohGg/defenseSquadsClient.ts \
        app/src/integrations/swgohGg/gacHistoryClient.ts \
        app/src/integrations/swgohGg/playerClient.ts \
        app/src/commands/gac.ts
git commit -m "refactor: replace string-matched errors with typed error classes"
```

---

### Task 2.2 — Split `gac.ts` into per-subcommand handlers

**Files:**
- Create: `app/src/commands/commandUtils.ts`
- Create: `app/src/commands/handlers/bracketHandler.ts`
- Create: `app/src/commands/handlers/opponentHandler.ts`
- Create: `app/src/commands/handlers/strategyHandler.ts`
- Modify: `app/src/commands/gac.ts`

`gac.ts` is ~1000 lines handling four very different concerns. Split into handler files; `gac.ts` becomes a thin router.

- [ ] **Step 1: Create `app/src/commands/commandUtils.ts`**

Move the `safeEditStatusMessage` helper and the `gacCommandQueue` declaration here:

```typescript
import { ChatInputCommandInteraction } from 'discord.js';
import { RequestQueue } from '../utils/requestQueue';
import { logger } from '../utils/logger';

/**
 * Queue for API-only GAC commands (bracket, opponent).
 * Higher concurrency than the Puppeteer queue since these are lightweight.
 */
export const gacApiQueue = new RequestQueue({ maxConcurrency: 2 });

/**
 * Queue for Puppeteer-heavy GAC commands (strategy).
 * Single concurrency to avoid overwhelming Chromium on Raspberry Pi.
 */
export const gacPuppeteerQueue = new RequestQueue({ maxConcurrency: 1 });

/** Edit or follow-up on a deferred reply without throwing if it fails. */
export async function safeEditStatusMessage(
  interaction: ChatInputCommandInteraction,
  content: string
): Promise<void> {
  try {
    await interaction.editReply({ content });
  } catch (err) {
    logger.warn('Failed to edit status message:', err);
  }
}
```

- [ ] **Step 2: Create `app/src/commands/handlers/bracketHandler.ts`**

Move the bracket subcommand handler logic from `gac.ts` into this file. It should export a single function:

```typescript
import { ChatInputCommandInteraction } from 'discord.js';
import { GacApiClient } from '../gac'; // re-export the interface
import { PlayerService } from '../../services/playerService';
import { safeEditStatusMessage, gacApiQueue } from '../commandUtils';
import { logger } from '../../utils/logger';

export async function handleBracketCommand(
  interaction: ChatInputCommandInteraction,
  playerService: PlayerService,
  apiClient: GacApiClient
): Promise<void> {
  // Move the bracket handling code here from gac.ts
}
```

- [ ] **Step 3: Create `app/src/commands/handlers/opponentHandler.ts`**

Same pattern — move opponent subcommand logic:

```typescript
export async function handleOpponentCommand(
  interaction: ChatInputCommandInteraction,
  playerService: PlayerService,
  apiClient: GacApiClient,
  comparisonService: PlayerComparisonService
): Promise<void> {
  // Move the opponent handling code here
}
```

- [ ] **Step 4: Create `app/src/commands/handlers/strategyHandler.ts`**

Move the strategy subcommand logic (the large `handleStrategyCommand` function):

```typescript
export async function handleStrategyCommand(
  interaction: ChatInputCommandInteraction,
  playerService: PlayerService,
  apiClient: GacApiClient,
  strategyService: GacStrategyService
): Promise<void> {
  // Move handleStrategyCommand body here, using gacPuppeteerQueue
}
```

- [ ] **Step 5: Reduce `gac.ts` to a thin router**

```typescript
// gac.ts after refactor — just wires up command definition and routes subcommands
export const gacCommand = {
  data: new SlashCommandBuilder()
    // ... (keep existing command definition unchanged)
    ,

  async execute(
    interaction: ChatInputCommandInteraction,
    services: { playerService: PlayerService; apiClient: GacApiClient; comparisonService: PlayerComparisonService; strategyService: GacStrategyService }
  ): Promise<void> {
    const subcommand = interaction.options.getSubcommand();
    if (subcommand === 'bracket') {
      await handleBracketCommand(interaction, services.playerService, services.apiClient);
    } else if (subcommand === 'opponent') {
      await handleOpponentCommand(interaction, services.playerService, services.apiClient, services.comparisonService);
    } else if (subcommand === 'strategy') {
      await handleStrategyCommand(interaction, services.playerService, services.apiClient, services.strategyService);
    }
  }
};
```

- [ ] **Step 6: Verify TypeScript compiles and that `bot/index.ts` still connects correctly**

```bash
cd /Users/alexwoodbridge/Documents/GitHub/swgoh-discord-app/app && npx tsc --noEmit
```

- [ ] **Step 7: Commit**

```bash
git add app/src/commands/
git commit -m "refactor: split gac.ts into per-subcommand handler files"
```

---

### Task 2.3 — Separate queues for API-only vs Puppeteer-heavy commands

**Files:**
- Modify: `app/src/commands/handlers/bracketHandler.ts`
- Modify: `app/src/commands/handlers/opponentHandler.ts`
- Modify: `app/src/commands/handlers/strategyHandler.ts`

(This task follows Task 2.2 — the queues were created in `commandUtils.ts` in that task.)

- [ ] **Step 1: In `bracketHandler.ts`, wrap the handler body with `gacApiQueue`**

```typescript
import { gacApiQueue } from '../commandUtils';

export async function handleBracketCommand(...): Promise<void> {
  await gacApiQueue.add(async () => {
    // ... bracket handler body
  });
}
```

- [ ] **Step 2: In `opponentHandler.ts`, wrap with `gacApiQueue`**

Same pattern as bracket — this command only makes API calls, no Puppeteer.

- [ ] **Step 3: In `strategyHandler.ts`, wrap with `gacPuppeteerQueue`**

```typescript
import { gacPuppeteerQueue } from '../commandUtils';

export async function handleStrategyCommand(...): Promise<void> {
  await gacPuppeteerQueue.add(async () => {
    // ... strategy handler body
  });
}
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd /Users/alexwoodbridge/Documents/GitHub/swgoh-discord-app/app && npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add app/src/commands/handlers/
git commit -m "refactor: separate API-only and Puppeteer command queues"
```

---

### Task 2.4 — Parallelise independent API calls in strategy flow

**Files:**
- Modify: `app/src/commands/handlers/strategyHandler.ts`

In `handleStrategyCommand`, the opponent defensive squads, user roster, and top defense squads are fetched sequentially. These are independent and can run with `Promise.all`.

- [ ] **Step 1: Find all sequential `await` API calls in `strategyHandler.ts` that are independent**

Look for patterns like:
```typescript
const opponentHistory = await apiClient.getPlayerRecentGacDefensiveSquads(...);
const userRoster = await apiClient.getFullPlayer(...);
const topDefense = await apiClient.getTopDefenseSquads(...);
```

- [ ] **Step 2: Replace with `Promise.all`**

```typescript
const [opponentHistory, userRoster, topDefense] = await Promise.all([
  apiClient.getPlayerRecentGacDefensiveSquads(opponentAllyCode, format),
  apiClient.getFullPlayer(userAllyCode),
  apiClient.getTopDefenseSquads('count', undefined, format),
]);
```

Note: only parallelise calls that genuinely don't depend on each other. If `topDefense` fetch requires knowing the season (which may depend on bracket data), keep it sequential.

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /Users/alexwoodbridge/Documents/GitHub/swgoh-discord-app/app && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add app/src/commands/handlers/strategyHandler.ts
git commit -m "perf: parallelise independent API calls in strategy handler"
```

---

### Task 2.5 — Make missing required archetype abilities a hard filter

**Files:**
- Modify: `app/src/services/gacStrategy/squadMatching/matchCounters.ts`

Currently non-viable counters get a -50 penalty but still appear in results. They should be excluded from primary results.

- [ ] **Step 1: In `matchCounters.ts`, find the penalty block (~line 525–539)**

```typescript
// Current code:
if (!archetypeValidation.viable) {
  archetypePenalty = -50;
}
```

- [ ] **Step 2: Replace with a hard filter that moves non-viable counters to a separate list**

```typescript
// After computing archetypeValidation for each counter, separate viable from non-viable:

const viableCounters: Array<{ counter: GacCounterSquad; score: number }> = [];
const nonViableCounters: Array<{ counter: GacCounterSquad; score: number; archetypeValidation: ArchetypeValidationResult }> = [];

// In the counter scoring loop:
if (!archetypeValidation.viable) {
  // Hard filter: missing required abilities means this counter cannot work
  // Store separately to surface as "alternatives" with explicit warnings
  nonViableCounters.push({ counter, score: totalScore - 50, archetypeValidation });
} else {
  const archetypePenalty = archetypeValidation.confidence < 1.0
    ? -((1 - archetypeValidation.confidence) * 15)
    : 0;
  const finalScore = totalScore + archetypePenalty;
  viableCounters.push({ counter, score: finalScore });
}
```

Then select from `viableCounters` first, falling back to `nonViableCounters` if there are no viable options:

```typescript
viableCounters.sort((a, b) => b.score - a.score);
const primaryCounters = viableCounters.slice(0, MAX_ALTERNATIVES);

// If no viable counters, use non-viable as fallback (clearly marked)
const selectedCounters = primaryCounters.length > 0
  ? primaryCounters
  : nonViableCounters.sort((a, b) => b.score - a.score).slice(0, MAX_ALTERNATIVES);
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /Users/alexwoodbridge/Documents/GitHub/swgoh-discord-app/app && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add app/src/services/gacStrategy/squadMatching/matchCounters.ts
git commit -m "fix: make non-viable archetype counters a hard filter, not a penalty"
```

---

### Task 2.6 — Archetype inheritance integrity check on startup

**Files:**
- Modify: `app/src/services/archetypeValidation/archetypeValidator.ts`

- [ ] **Step 1: Add a `validateArchetypeIntegrity` function to `archetypeValidator.ts`**

```typescript
/**
 * Run at startup to verify all archetype inheritance chains are valid.
 * Logs warnings for any broken references or contradictions.
 * Does not throw — integrity issues are surfaced as warnings, not crashes.
 */
export function validateArchetypeIntegrity(config: ArchetypeConfig): void {
  const archetypeMap = new Map<string, ArchetypeDefinition>(
    config.archetypes.map(a => [a.id, a])
  );

  for (const archetype of config.archetypes) {
    if (!archetype.extends) continue;

    const parent = archetypeMap.get(archetype.extends);
    if (!parent) {
      logger.warn(
        `[Archetype Integrity] Child archetype "${archetype.id}" extends "${archetype.extends}" which does not exist`
      );
      continue;
    }

    // Check for contradictions: a unit cannot be both required and excluded
    const requiredUnits = new Set([
      ...(archetype.squadComposition?.requiredUnits ?? []),
      ...(parent.squadComposition?.requiredUnits ?? []),
    ]);
    const excludedUnits = new Set([
      ...(archetype.squadComposition?.excludedUnits ?? []),
      ...(parent.squadComposition?.excludedUnits ?? []),
    ]);
    for (const unit of requiredUnits) {
      if (excludedUnits.has(unit)) {
        logger.warn(
          `[Archetype Integrity] Archetype "${archetype.id}": unit "${unit}" is both required and excluded after merging with parent "${archetype.extends}"`
        );
      }
    }
  }

  logger.info(`[Archetype Integrity] Checked ${config.archetypes.length} archetypes`);
}
```

- [ ] **Step 2: Call `validateArchetypeIntegrity` during bot startup in `bot/index.ts`**

Find where archetypes are loaded (look for `loadArchetypes` or `archetypeManager`) and add the call right after loading:

```typescript
import { validateArchetypeIntegrity } from '../services/archetypeValidation/archetypeValidator';

// After loading archetypes:
validateArchetypeIntegrity(archetypeConfig);
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /Users/alexwoodbridge/Documents/GitHub/swgoh-discord-app/app && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add app/src/services/archetypeValidation/archetypeValidator.ts app/src/bot/index.ts
git commit -m "feat: add archetype inheritance integrity check on startup"
```

---

### Task 2.7 — Reduce Puppeteer `deviceScaleFactor` for Pi performance

**Files:**
- Modify: `app/src/services/gacStrategyService.ts`

- [ ] **Step 1: Find `deviceScaleFactor` in `gacStrategyService.ts`**

Search for `deviceScaleFactor` — it is set during page viewport configuration before screenshots.

- [ ] **Step 2: Reduce to 1.5**

```typescript
// Before:
await page.setViewport({ width: ..., height: ..., deviceScaleFactor: 2 });

// After:
await page.setViewport({ width: ..., height: ..., deviceScaleFactor: 1.5 });
```

- [ ] **Step 3: Commit**

```bash
git add app/src/services/gacStrategyService.ts
git commit -m "perf(pi): reduce deviceScaleFactor from 2 to 1.5 for lower memory usage"
```

---

### Task 2.8 — Add health check / watchdog with Puppeteer timeout

**Files:**
- Modify: `app/src/services/gacStrategyService.ts`
- Modify: `app/src/bot/index.ts`

- [ ] **Step 1: Add a `PUPPETEER_TIMEOUT_MS` constant and apply it to all `page.goto` calls in `gacStrategyService.ts`**

Search for `page.goto` calls that don't already have a timeout, or whose timeout exceeds 30 seconds. Apply a consistent 30-second cap:

```typescript
const PUPPETEER_TIMEOUT_MS = 30_000;

// Every page.goto call should use:
await page.goto(url, { waitUntil: 'networkidle2', timeout: PUPPETEER_TIMEOUT_MS });
```

- [ ] **Step 2: Add a simple HTTP health endpoint in `bot/index.ts`**

```typescript
import http from 'http';

// After bot login, start a lightweight health server:
const healthServer = http.createServer((_req, res) => {
  // If the bot is logged in and not crashed, report healthy
  const isHealthy = client.isReady();
  res.writeHead(isHealthy ? 200 : 503);
  res.end(isHealthy ? 'OK' : 'UNHEALTHY');
});

const HEALTH_PORT = parseInt(process.env.HEALTH_PORT ?? '3001', 10);
healthServer.listen(HEALTH_PORT, () => {
  logger.info(`Health check server listening on port ${HEALTH_PORT}`);
});
```

- [ ] **Step 3: Add `HEALTH_PORT` to `.env.example`**

```bash
# Port for the internal health check HTTP server (used by PM2/systemd watchdog). Default: 3001.
# HEALTH_PORT=3001
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd /Users/alexwoodbridge/Documents/GitHub/swgoh-discord-app/app && npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add app/src/services/gacStrategyService.ts app/src/bot/index.ts app/.env.example
git commit -m "feat: add Puppeteer timeouts and HTTP health check endpoint"
```

---

### Task 2.9 — Improve 3v3 image layouts

**Files:**
- Modify: `app/src/services/gacStrategy/imageGeneration/defenseStrategyHtml.ts`
- Modify: `app/src/services/gacStrategy/imageGeneration/offenseStrategyHtml.ts`
- Modify: `app/src/services/gacStrategy/imageGeneration/balancedStrategyHtml.ts`

- [ ] **Step 1: Fix `defenseStrategyHtml.ts` — dynamic container width and single-column layout for 3v3**

Replace the hardcoded width calculation:

```typescript
// Before:
const singleSquadWidth = format === '3v3' ? 680 : 920;
const containerWidth = singleSquadWidth * 2 + 40;

// After — dynamic width per unit count, single column for 3v3:
const cellWidth = format === '3v3' ? 220 : 170;
const squadWidth = expectedSquadSize * cellWidth + (expectedSquadSize - 1) * 8 + 32; // cells + gaps + padding
const containerWidth = format === '3v3' ? squadWidth + 40 : squadWidth * 2 + 40;
```

Update the CSS grid to be single-column for 3v3:

```typescript
const gridColumns = format === '3v3' ? '1fr' : '1fr 1fr';

// In the inline CSS:
`.squads-grid { display: grid; grid-template-columns: ${gridColumns}; gap: 12px; padding: 12px; }`
```

Update the character cell width in CSS:

```typescript
`.character-cell { width: ${cellWidth}px; }`
```

- [ ] **Step 2: Fix `offenseStrategyHtml.ts` — centre 3v3 battle rows**

In the battle row CSS, ensure `squad-side` containers shrink-wrap to their content for 3v3:

```typescript
const squadSideStyle = format === '3v3'
  ? 'display: flex; gap: 6px; justify-content: center;'
  : 'display: flex; gap: 4px;';
```

Apply `squadSideStyle` in the inline HTML for each `squad-side` div.

- [ ] **Step 3: Fix `balancedStrategyHtml.ts` — default to split images for 3v3**

Find where `generateSplitStrategyImages` is called (or not called) for 3v3. Ensure 3v3 always uses the split output path instead of the combined 2600px-wide image:

```typescript
// In the calling code (likely strategyHandler.ts or gacStrategyService.ts):
if (format === '3v3') {
  // Always use split images for 3v3
  const { defenseImage, offenseImage } = await strategyService.generateSplitStrategyImages(...);
  // attach both images to the Discord reply
} else {
  const balancedImage = await strategyService.generateBalancedStrategyImage(...);
  // attach single combined image
}
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd /Users/alexwoodbridge/Documents/GitHub/swgoh-discord-app/app && npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add app/src/services/gacStrategy/imageGeneration/ \
        app/src/commands/handlers/strategyHandler.ts
git commit -m "fix: improve 3v3 image layouts — dynamic sizing and single-column grid"
```

---

### Task 2.10 — Add GitHub Actions CI pipeline

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Create `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  push:
    branches: [main, 'improvements/**']
  pull_request:
    branches: [main]

jobs:
  build-and-test:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - name: Use Node.js 20
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
          cache-dependency-path: app/package-lock.json

      - name: Install dependencies
        run: npm ci
        working-directory: app

      - name: TypeScript compile check
        run: npx tsc --noEmit
        working-directory: app

      - name: Run tests
        run: npm test
        working-directory: app
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add GitHub Actions workflow for TypeScript build and tests"
```

---

### Task 2.11 — Open PR for medium changes

- [ ] **Step 1: Push branch**

```bash
git push -u origin improvements/pr2-medium
```

- [ ] **Step 2: Create PR on GitHub**

Title: `improvements: PR2 — medium architectural changes`

Body: Reference IMPROVEMENTS.md sections 2.1, 2.4, 3.1, 3.4, 4.3, 4.5, 4.6, 5.1, 6.1, 8.2, 9.2.

---

## PR 3 — Large Changes

Branch: `improvements/pr3-large`  
Base: `main` (or latest merged branch)

### File map

| Action | Path |
|--------|------|
| Create | `app/src/services/browserService.ts` |
| Create | `app/src/services/gacStrategy/__tests__/balanceStrategy.test.ts` |
| Create | `app/src/services/gacStrategy/__tests__/defenseEvaluation.test.ts` |
| Create | `app/src/services/gacStrategy/__tests__/matchCounters.test.ts` |
| Create | `app/src/integrations/__tests__/playerClient.test.ts` |
| Modify | `app/src/services/gacStrategyService.ts` |
| Modify | `app/src/services/gacStrategy/squadMatching/matchCounters.ts` |
| Modify | `app/src/integrations/swgohGg/defenseSquadsClient.ts` |
| Modify | `app/src/integrations/comlink/combinedClient.ts` |

---

### Task 3.1 — Extract `BrowserService` (image rendering layer)

**Files:**
- Create: `app/src/services/browserService.ts`
- Modify: `app/src/services/gacStrategyService.ts`

Currently `GacStrategyService` owns the Puppeteer `Browser` instance, mixes infrastructure with business logic, and exposes `closeBrowser()`. Extract this into a dedicated service.

- [ ] **Step 1: Create `app/src/services/browserService.ts`**

```typescript
import puppeteer, { Browser, Page } from 'puppeteer';
import { logger } from '../utils/logger';

export interface RenderOptions {
  width: number;
  height?: number;
  deviceScaleFactor?: number;
}

/**
 * Manages the Puppeteer browser lifecycle and provides HTML→PNG rendering.
 * Keeps one warm browser instance alive between renders with a 5-minute idle timeout.
 */
export class BrowserService {
  private browser: Browser | null = null;
  private idleTimer: NodeJS.Timeout | null = null;
  private readonly idleTimeoutMs: number;
  private readonly renderTimeoutMs: number;

  constructor(options?: { idleTimeoutMs?: number; renderTimeoutMs?: number }) {
    this.idleTimeoutMs = options?.idleTimeoutMs ?? 5 * 60 * 1000; // 5 minutes
    this.renderTimeoutMs = options?.renderTimeoutMs ?? 30_000;
  }

  private resetIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      logger.info('[BrowserService] Idle timeout — closing browser');
      this.close().catch(err => logger.warn('[BrowserService] Error closing on idle:', err));
    }, this.idleTimeoutMs);
  }

  async getBrowser(): Promise<Browser> {
    if (this.browser && !this.browser.connected) {
      logger.warn('[BrowserService] Browser disconnected, clearing stale reference');
      this.browser = null;
    }

    if (!this.browser) {
      logger.info('[BrowserService] Launching new Chromium instance');
      this.browser = await puppeteer.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu',
        ],
      });

      this.browser.on('disconnected', () => {
        logger.warn('[BrowserService] Browser disconnected unexpectedly');
        this.browser = null;
      });
    }

    this.resetIdleTimer();
    return this.browser;
  }

  /**
   * Render an HTML string to a PNG buffer.
   * @param html - Full HTML document string
   * @param options - Viewport dimensions and scale
   */
  async renderHtmlToPng(html: string, options: RenderOptions): Promise<Buffer> {
    const browser = await this.getBrowser();
    const page = await browser.newPage();

    try {
      await page.setViewport({
        width: options.width,
        height: options.height ?? 1,
        deviceScaleFactor: options.deviceScaleFactor ?? 1.5,
      });

      await page.setContent(html, {
        waitUntil: 'networkidle0',
        timeout: this.renderTimeoutMs,
      });

      const screenshot = await page.screenshot({
        type: 'png',
        fullPage: true,
        encoding: 'binary',
      });

      return Buffer.from(screenshot as Uint8Array);
    } finally {
      await page.close();
    }
  }

  async close(): Promise<void> {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}

/** Singleton instance shared across all commands. */
export const browserService = new BrowserService();
```

- [ ] **Step 2: Update `gacStrategyService.ts` to use `BrowserService`**

Remove the `private browser: Browser | null = null` field and all `puppeteer.launch(...)` calls. Replace screenshot-taking code with:

```typescript
import { browserService } from './browserService';

// Before (example):
const browser = await puppeteer.launch({ ... });
const page = await browser.newPage();
await page.setViewport({ width: ..., deviceScaleFactor: 2 });
await page.setContent(html, { waitUntil: 'networkidle0' });
const screenshot = await page.screenshot({ ... });
await page.close();

// After:
const screenshot = await browserService.renderHtmlToPng(html, { width: containerWidth, deviceScaleFactor: 1.5 });
```

Remove the `closeBrowser()` method from `GacStrategyService`. Any caller that used it should call `browserService.close()` instead (or rely on the idle timeout).

- [ ] **Step 3: Update `bot/index.ts` shutdown handler**

```typescript
import { browserService } from '../services/browserService';

// In graceful shutdown:
await browserService.close();
```

- [ ] **Step 4: Remove Puppeteer import from `gacStrategyService.ts`** (it's no longer needed there)

- [ ] **Step 5: Verify TypeScript compiles**

```bash
cd /Users/alexwoodbridge/Documents/GitHub/swgoh-discord-app/app && npx tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add app/src/services/browserService.ts \
        app/src/services/gacStrategyService.ts \
        app/src/bot/index.ts
git commit -m "refactor: extract BrowserService with idle timeout and warm browser reuse"
```

---

### Task 3.2 — Comprehensive test suite for strategy logic

**Files:**
- Create: `app/src/services/gacStrategy/__tests__/balanceStrategy.test.ts`
- Create: `app/src/services/gacStrategy/__tests__/defenseEvaluation.test.ts`
- Create: `app/src/services/gacStrategy/__tests__/matchCounters.test.ts`

- [ ] **Step 1: Write failing tests for `balanceStrategy.ts`**

Create `app/src/services/gacStrategy/__tests__/balanceStrategy.test.ts`:

```typescript
import { balanceOffenseAndDefense } from '../balanceStrategy';
import { MatchedCounterSquad, DefenseSuggestion } from '../../../../types/gacStrategyTypes';

// Helpers to build minimal test fixtures
function makeCounter(leaderId: string, memberIds: string[] = []): MatchedCounterSquad {
  return {
    offense: {
      leader: { baseId: leaderId, relicLevel: 9, portraitUrl: null },
      members: memberIds.map(id => ({ baseId: id, relicLevel: 9, portraitUrl: null })),
    },
    defense: { leader: { baseId: 'ENEMY', relicLevel: null, portraitUrl: null }, members: [] },
    winPercentage: 60,
    adjustedWinPercentage: 60,
    seenCount: 1000,
    avgBanners: 47,
    relicDelta: 0,
    worstCaseRelicDelta: 0,
    bestCaseRelicDelta: 0,
    keyMatchups: null,
    archetypeValidation: { viable: true, confidence: 1.0, warnings: [], missingRequired: [], missingOptional: [] },
  };
}

function makeDefense(leaderId: string): DefenseSuggestion {
  return {
    squad: {
      leader: { baseId: leaderId, gearLevel: 13, relicLevel: 9, portraitUrl: null },
      members: [],
    },
    holdPercentage: 40,
    seenCount: 500,
    archetypeValidation: null,
  };
}

describe('balanceOffenseAndDefense', () => {
  it('assigns a GL to offense and a different GL to defense without conflict', () => {
    const offenseCounters = [
      makeCounter('GLREY', ['RESISTANCETROOPER']),
      makeCounter('GRANDMASTERLUKE', ['HERMITYODA']),
    ];
    const defenseSuggestions = [
      makeDefense('SUPREMELEADERKYLOREN'),
      makeDefense('JEDIMASTERKENOBI'),
    ];
    const availableGLs = new Set(['GLREY', 'GRANDMASTERLUKE', 'SUPREMELEADERKYLOREN', 'JEDIMASTERKENOBI']);

    const result = balanceOffenseAndDefense(offenseCounters, defenseSuggestions, availableGLs, '5v5', 'balanced');

    // Each GL should appear in at most one of offense or defense
    const offenseLeaders = new Set(result.offense.map(c => c.offense.leader.baseId));
    const defenseLeaders = new Set(result.defense.map(d => d.squad.leader.baseId));
    for (const gl of availableGLs) {
      const inOffense = offenseLeaders.has(gl);
      const inDefense = defenseLeaders.has(gl);
      expect(inOffense && inDefense).toBe(false);
    }
  });

  it('returns empty offense when there are no counters', () => {
    const result = balanceOffenseAndDefense([], [makeDefense('GLREY')], new Set(['GLREY']), '5v5', 'balanced');
    expect(result.offense).toHaveLength(0);
    expect(result.defense).toHaveLength(1);
  });

  it('returns empty defense when there are no defense suggestions', () => {
    const result = balanceOffenseAndDefense([makeCounter('GLREY')], [], new Set(['GLREY']), '5v5', 'offensive');
    expect(result.defense).toHaveLength(0);
    expect(result.offense).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail (not yet passing)**

```bash
cd /Users/alexwoodbridge/Documents/GitHub/swgoh-discord-app/app && npx jest balanceStrategy --no-coverage
```

Expected: `FAIL` or type errors if the function signatures don't match.

- [ ] **Step 3: Fix any type mismatches in the test, then run again to confirm meaningful failures**

Adjust fixture helpers to match the actual types in `gacStrategyTypes.ts`. The goal is green tests that fail because logic is wrong, not because of compile errors.

- [ ] **Step 4: Run with passing expectation once logic confirmed correct**

```bash
cd /Users/alexwoodbridge/Documents/GitHub/swgoh-discord-app/app && npx jest balanceStrategy --no-coverage
```

Expected: `PASS`

- [ ] **Step 5: Write failing tests for `defenseEvaluation.ts`**

Create `app/src/services/gacStrategy/__tests__/defenseEvaluation.test.ts`:

```typescript
import { evaluateRosterForDefense } from '../defenseEvaluation';
// Import the real SwgohGgFullPlayerResponse type and minimal fixture
import type { SwgohGgFullPlayerResponse } from '../../../../integrations/swgohGgApi';
import type { GacTopDefenseSquad } from '../../../../types/swgohGgTypes';

function makeRoster(units: Array<{ baseId: string; relicLevel: number; isGL?: boolean }>): SwgohGgFullPlayerResponse {
  return {
    data: { ally_code: 123456789, name: 'TestPlayer', guild_name: '', guild_id: '', url: '', skill_rating: 0 },
    units: units.map(u => ({
      data: {
        base_id: u.baseId,
        name: u.baseId,
        combat_type: 1,
        rarity: 7,
        gear_level: 13,
        relic_tier: u.relicLevel + 2, // swgoh.gg stores relic_tier as relicLevel + 2
        power: 100000,
        stats: { '5': 300, '1': 60000, '28': 50000 },
        zeta_abilities: [],
        omicron_abilities: [],
        is_galactic_legend: u.isGL ?? false,
      }
    })),
  } as unknown as SwgohGgFullPlayerResponse;
}

function makeTopDefense(leaderId: string, holdPct: number): GacTopDefenseSquad {
  return {
    leader: { baseId: leaderId, relicLevel: null, portraitUrl: null },
    members: [],
    holdPercentage: holdPct,
    seenCount: 1000,
    avgBanners: 47,
  };
}

describe('evaluateRosterForDefense', () => {
  it('ranks GL squads higher than non-GL squads when format is 5v5', () => {
    const roster = makeRoster([
      { baseId: 'GLREY', relicLevel: 9, isGL: true },
      { baseId: 'COMMANDERLUKESKYWALKER', relicLevel: 8 },
    ]);
    const topDefense = [
      makeTopDefense('GLREY', 45),
      makeTopDefense('COMMANDERLUKESKYWALKER', 35),
    ];

    const result = evaluateRosterForDefense(roster, topDefense, '5v5', null);

    const glIdx = result.findIndex(s => s.squad.leader.baseId === 'GLREY');
    const nonGlIdx = result.findIndex(s => s.squad.leader.baseId === 'COMMANDERLUKESKYWALKER');
    expect(glIdx).toBeLessThan(nonGlIdx);
  });

  it('returns an empty array when no roster units match top defense squads', () => {
    const roster = makeRoster([{ baseId: 'BOBAFETT', relicLevel: 7 }]);
    const topDefense = [makeTopDefense('GLREY', 45)];

    const result = evaluateRosterForDefense(roster, topDefense, '5v5', null);
    expect(result).toHaveLength(0);
  });
});
```

- [ ] **Step 6: Run defense evaluation tests**

```bash
cd /Users/alexwoodbridge/Documents/GitHub/swgoh-discord-app/app && npx jest defenseEvaluation --no-coverage
```

Expected: `PASS` (confirms logic matches expectations).

- [ ] **Step 7: Write tests for `matchCounters.ts` edge cases**

Create `app/src/services/gacStrategy/__tests__/matchCounters.test.ts`:

```typescript
import { matchCountersAgainstRoster } from '../squadMatching/matchCounters';
import type { UniqueDefensiveSquad } from '../../../../types/gacStrategyTypes';
import type { GacCounterSquad } from '../../../../integrations/swgohGgApi';
import type { RosterAdapter } from '../../archetypeValidation/archetypeValidator';

function makeDefenseSquad(leaderId: string): UniqueDefensiveSquad {
  return {
    leader: { baseId: leaderId, relicLevel: 9, portraitUrl: null },
    members: [],
  };
}

function makeCounter(leaderId: string): GacCounterSquad {
  return {
    leader: { baseId: leaderId, relicLevel: null, portraitUrl: null },
    members: [],
    winPercentage: 70,
    seenCount: 500,
    avgBanners: null,
  };
}

function makeRosterAdapter(availableUnits: string[]): RosterAdapter {
  const unitSet = new Set(availableUnits);
  return {
    hasUnit: (id) => unitSet.has(id),
    getUnit: () => undefined,
    hasZeta: () => true,
    hasOmicron: () => true,
    getRelicLevel: () => 9,
  };
}

describe('matchCountersAgainstRoster', () => {
  it('returns empty result when no counters are provided', async () => {
    const result = await matchCountersAgainstRoster(
      [makeDefenseSquad('GLREY')],
      [],
      makeRosterAdapter(['RESISTANCETROOPER']),
      new Set(['RESISTANCETROOPER']),
      new Set(),
      '5v5',
      'balanced'
    );
    expect(result).toHaveLength(1);
    expect(result[0].offense.leader.baseId).toBe('');
  });

  it('excludes counters whose units are all already allocated', async () => {
    const alreadyUsed = new Set(['GLREY']);
    const result = await matchCountersAgainstRoster(
      [makeDefenseSquad('SUPREMELEADERKYLOREN')],
      [makeCounter('GLREY')],
      makeRosterAdapter(['GLREY']),
      new Set(['GLREY']),
      alreadyUsed,
      '5v5',
      'offensive'
    );
    expect(result[0].offense.leader.baseId).toBe('');
  });
});
```

- [ ] **Step 8: Run counter matching tests**

```bash
cd /Users/alexwoodbridge/Documents/GitHub/swgoh-discord-app/app && npx jest matchCounters --no-coverage
```

Expected: `PASS`

- [ ] **Step 9: Run full test suite**

```bash
cd /Users/alexwoodbridge/Documents/GitHub/swgoh-discord-app/app && npm test
```

Expected: All tests pass including pre-existing `playerService.test.ts` and `requestQueue.test.ts`.

- [ ] **Step 10: Commit**

```bash
git add app/src/services/gacStrategy/__tests__/
git commit -m "test: add unit tests for balanceStrategy, defenseEvaluation, matchCounters"
```

---

### Task 3.3 — Add Zod schema validation for API responses

- [ ] **Step 1: Install Zod**

```bash
cd /Users/alexwoodbridge/Documents/GitHub/swgoh-discord-app/app && npm install zod
```

- [ ] **Step 2: Create schemas for the most critical API responses**

Create `app/src/integrations/swgohGg/schemas.ts`:

```typescript
import { z } from 'zod';

export const SwgohGgUnitDataSchema = z.object({
  base_id: z.string(),
  name: z.string().optional(),
  combat_type: z.number(),
  rarity: z.number(),
  gear_level: z.number(),
  relic_tier: z.number().optional(),
  power: z.number().optional(),
  stats: z.record(z.string(), z.number()).optional().default({}),
  zeta_abilities: z.array(z.string()).default([]),
  omicron_abilities: z.array(z.string()).default([]),
  is_galactic_legend: z.boolean().optional().default(false),
});

export const SwgohGgUnitSchema = z.object({
  data: SwgohGgUnitDataSchema,
});

export const SwgohGgFullPlayerResponseSchema = z.object({
  data: z.object({
    ally_code: z.number(),
    name: z.string(),
    guild_name: z.string().optional().default(''),
    guild_id: z.string().optional().default(''),
    url: z.string().optional().default(''),
    skill_rating: z.number().optional().nullable().default(null),
  }),
  units: z.array(SwgohGgUnitSchema).default([]),
});
```

- [ ] **Step 3: Add validation to `playerClient.ts` after fetching `getFullPlayer`**

```typescript
import { SwgohGgFullPlayerResponseSchema } from './schemas';

// In getFullPlayer, after receiving data:
const parseResult = SwgohGgFullPlayerResponseSchema.safeParse(data);
if (!parseResult.success) {
  logger.warn(`[PlayerClient] API response validation failed for ${allyCode}:`, parseResult.error.issues);
  // Don't throw — return the raw data as a best-effort fallback
  return data as SwgohGgFullPlayerResponse;
}
return parseResult.data as SwgohGgFullPlayerResponse;
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd /Users/alexwoodbridge/Documents/GitHub/swgoh-discord-app/app && npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add app/src/integrations/swgohGg/schemas.ts app/src/integrations/swgohGg/playerClient.ts app/package.json app/package-lock.json
git commit -m "feat: add Zod schema validation for player API responses"
```

---

### Task 3.4 — Dynamic season ID resolution

**Files:**
- Modify: `app/src/integrations/swgohGg/defenseSquadsClient.ts`
- Modify: `app/src/integrations/swgohGg/countersClient.ts`

The hardcoded fallback season IDs (`SEASON_71`, `SEASON_72`) will go stale. Add logic to detect the latest available season dynamically.

- [ ] **Step 1: Add a `fetchLatestSeasonId` method to `DefenseSquadsClient`**

```typescript
/**
 * Attempt to determine the latest available season ID for a given format
 * by examining the season selector on the swgoh.gg/gac/squads/ page.
 * Falls back to hardcoded defaults if the page structure has changed.
 */
async fetchLatestSeasonId(format: '5v5' | '3v3'): Promise<string> {
  return await this.browserManager.queueOperation(async () => {
    const page = await this.browserManager.createPage();
    try {
      await page.goto(API_ENDPOINTS.SWGOH_GG_GAC_SQUADS, {
        waitUntil: 'networkidle2',
        timeout: 30_000,
      });

      const seasonIds: string[] = await page.evaluate(() => {
        const doc = (globalThis as any).document;
        const options = Array.from(doc.querySelectorAll('select[name="season_id"] option')) as any[];
        return options
          .map((o: any) => o.value as string)
          .filter((v: string) => v.includes('SEASON_'));
      });

      // Even seasons = 5v5, odd = 3v3
      const matching = seasonIds.filter(id => {
        const m = id.match(/SEASON_(\d+)/);
        if (!m) return false;
        const n = parseInt(m[1], 10);
        return format === '5v5' ? n % 2 === 0 : n % 2 === 1;
      });

      if (matching.length > 0) {
        // Seasons are expected to be sorted descending on the page
        const latest = matching[0];
        logger.info(`[DefenseSquadsClient] Latest ${format} season ID: ${latest}`);
        return latest;
      }
    } catch (err) {
      logger.warn('[DefenseSquadsClient] Failed to fetch latest season ID, using fallback:', err);
    } finally {
      await page.close();
    }

    // Hardcoded fallbacks — update when new seasons are released
    const FALLBACK_SEASON = { '5v5': 'CHAMPIONSHIPS_GRAND_ARENA_GA2_EVENT_SEASON_72', '3v3': 'CHAMPIONSHIPS_GRAND_ARENA_GA2_EVENT_SEASON_71' };
    logger.warn(`[DefenseSquadsClient] Using hardcoded fallback season ID for ${format}: ${FALLBACK_SEASON[format]}`);
    return FALLBACK_SEASON[format];
  });
}
```

- [ ] **Step 2: In `getTopDefenseSquads`, replace the hardcoded fallback assignment with a call to `fetchLatestSeasonId`**

```typescript
// Before (in the "no season ID provided" branch):
if (format === '3v3') {
  finalSeasonId = 'CHAMPIONSHIPS_GRAND_ARENA_GA2_EVENT_SEASON_71';
} else if (format === '5v5') {
  finalSeasonId = 'CHAMPIONSHIPS_GRAND_ARENA_GA2_EVENT_SEASON_72';
}

// After:
finalSeasonId = await this.fetchLatestSeasonId(format as '5v5' | '3v3');
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /Users/alexwoodbridge/Documents/GitHub/swgoh-discord-app/app && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add app/src/integrations/swgohGg/defenseSquadsClient.ts
git commit -m "feat: dynamically resolve latest season ID instead of hardcoded fallback"
```

---

### Task 3.5 — Implement defense stats for counter squads (remove the TODO)

**Files:**
- Modify: `app/src/services/gacStrategy/squadMatching/matchCounters.ts`
- Modify: `app/src/services/gacStrategy/defenseStats.ts`

The TODO placeholder always returns `{ holdPercentage: null, seenCount: null }` for counter squad defense stats.

- [ ] **Step 1: Read `defenseStats.ts` to understand the existing structure**

```bash
cat /Users/alexwoodbridge/Documents/GitHub/swgoh-discord-app/app/src/services/gacStrategy/defenseStats.ts
```

- [ ] **Step 2: Implement `getDefenseStatsForSquad` in `defenseStats.ts`**

This function looks up pre-fetched top defense data (already available in `matchCounters.ts` via the `topDefenseSquads` parameter) to find stats for a counter squad's leader:

```typescript
import { GacTopDefenseSquad } from '../../../types/swgohGgTypes';

export interface DefenseStats {
  holdPercentage: number | null;
  seenCount: number | null;
}

/**
 * Look up defense hold stats for a given squad leader from the pre-fetched
 * top defense squads list. Returns null stats if the squad isn't in the list.
 */
export function getDefenseStatsForSquad(
  leaderBaseId: string,
  topDefenseSquads: GacTopDefenseSquad[]
): DefenseStats {
  const match = topDefenseSquads.find(
    s => s.leader.baseId === leaderBaseId
  );
  if (!match) return { holdPercentage: null, seenCount: null };
  return {
    holdPercentage: match.holdPercentage,
    seenCount: match.seenCount,
  };
}
```

- [ ] **Step 3: Replace the TODO in `matchCounters.ts`**

```typescript
// Remove:
const counterDefenseStats = await (async () => {
  /* TODO: Extract getDefenseStatsForSquad */
  return { holdPercentage: null, seenCount: null };
})();

// Replace with (assuming topDefenseSquads is available in scope):
import { getDefenseStatsForSquad } from '../defenseStats';
const counterDefenseStats = getDefenseStatsForSquad(
  counter.leader.baseId,
  topDefenseSquads
);
```

Ensure `topDefenseSquads` is passed through as a parameter to the function that contains this code, or accessed from the enclosing scope.

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd /Users/alexwoodbridge/Documents/GitHub/swgoh-discord-app/app && npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add app/src/services/gacStrategy/defenseStats.ts \
        app/src/services/gacStrategy/squadMatching/matchCounters.ts
git commit -m "feat: implement getDefenseStatsForSquad, removing null placeholder"
```

---

### Task 3.6 — Open PR for large changes

- [ ] **Step 1: Run the full test suite one final time**

```bash
cd /Users/alexwoodbridge/Documents/GitHub/swgoh-discord-app/app && npm test
```

Expected: All tests pass.

- [ ] **Step 2: Push branch**

```bash
git push -u origin improvements/pr3-large
```

- [ ] **Step 3: Create PR on GitHub**

Title: `improvements: PR3 — large systemic improvements`

Body: Reference IMPROVEMENTS.md sections 2.2, 5.3, 6.2, 8.1, 10.4.

---

## Notes

- Each PR targets `main` and should be reviewed before the next PR branches from `main`.
- Run `npx tsc --noEmit` after every task — TypeScript errors are cheaper to catch immediately than after several tasks.
- The `archetypes.json` expansion (section 3.3 — adding `shortDescription` to existing entries and expanding coverage) is ongoing data work that can proceed in parallel with code changes on any branch.
- Section 2.3 (defense-first strategy 80% estimate) and 2.5 (unused GL tracking on both images) are not explicitly tasked above because they are closely entangled with the strategy branch refactor in Task 2.2. Address them as part of `strategyHandler.ts` cleanup.
- Section 3.5 (mode gates warning) — when a mode-gated ability is skipped, add an informational warning. Implement this in `archetypeValidator.ts` alongside Task 2.6, by adding a check: if an ability's `modeGates` doesn't include the current mode, push a warning string `"Key omicron only applies in ${requiredMode} — effectiveness may be reduced in ${currentMode}"`.
- Section 6.3 (Puppeteer resource leaks) — covered by BrowserService's idle-timeout auto-close (Task 3.1) and the 30-second page timeout (Task 2.8).
- Section 6.4 (error reference IDs) — add a short `generateErrorRef()` utility: `Math.random().toString(36).slice(2, 6).toUpperCase()`, log it server-side with the error, and include it in user-facing error messages (e.g. "Something went wrong (ref: A3F2). Please try again."). Implement in PR2 alongside Task 2.1.
- Section 9.3 (cache TTLs in config) — move hardcoded `15 * 60 * 1000` bracket cache TTL and any in-memory Map TTLs to `config/cacheConfig.ts` as named constants. Low-risk; can be done in PR1 or PR2.
