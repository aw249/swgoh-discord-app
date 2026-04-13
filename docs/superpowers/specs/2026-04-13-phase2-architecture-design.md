# Phase 2: Architecture Refactor

## Overview

Refactor the command layer and service layer to improve maintainability: split the monolithic gac.ts, extract browser lifecycle management, fix constructor confusion, add custom error classes, and separate command queues.

## Scope

IMPROVEMENTS.md sections: 5.1, 5.3, 5.4, 5.5, 6.1.

---

## 1. Custom Error Classes (6.1)

Replace string-based error classification with typed error classes. Create `src/errors/swgohErrors.ts` with:
- `CloudflareBlockError` — Cloudflare challenge/blocking detected
- `NoActiveBracketError` — Player not in active GAC event
- `PlayerNotFoundError` — Player ally code not found

Throw these from integration clients. Catch with `instanceof` in command handlers.

## 2. Constructor Parameter Fix (5.5)

Change `GacStrategyService` constructor from 4 positional parameters to a single options object:

```typescript
interface GacStrategyServiceOptions {
  historyClient: GacHistoryClient;
  counterClient?: CounterClient;
  defenseClient?: DefenseClient;
  playerClient?: PlayerClient;
}
```

Update all call sites.

## 3. Split gac.ts (5.1)

Split the 1250-line gac.ts into:
- `src/commands/gac.ts` — thin router (~100 lines): command definition, subcommand dispatch, queue management
- `src/commands/gac/bracketHandler.ts` — handleBracketCommand
- `src/commands/gac/opponentHandler.ts` — handleOpponentCommand + shared opponent resolution logic
- `src/commands/gac/strategyHandler.ts` — handleStrategyCommand
- `src/commands/gac/commandUtils.ts` — safeEditStatusMessage, shared status helpers, error classification

## 4. Extract BrowserService (5.3)

Extract Puppeteer browser lifecycle from GacStrategyService into a `BrowserService` class in `src/services/browserService.ts`. The strategy service calls `browserService.renderHtml(html, viewport)` and gets back a `Buffer`. This separates business logic from infrastructure.

## 5. Separate Command Queues (5.4)

Split the single `gacCommandQueue` into two:
- `apiOnlyQueue` (maxConcurrency: 2) — for bracket and opponent commands that don't need Puppeteer
- `strategyQueue` (maxConcurrency: 1) — for strategy commands that use Puppeteer

This allows bracket lookups to proceed while a strategy command is running.

## Testing

- Run `npm run build` after all changes
- Run `npm test` to verify existing tests pass
- Verify no behaviour change

## Dependencies

Depends on Phase 1 being complete (shared utilities already in place).
