# SSE Billing/Shared Gating Parity

Date: 2026-05-25
PR: 7 of 8 in WebSocket-to-SSE replacement sequence

## Problem

Two BMS gating inconsistencies between WebSocket and SSE:

1. **Client dual-flag gap**: The agent-token route resolves BMS eligibility using both `app-builder-budget-service` (new users) and `app-builder-bms-existing` (migrated existing users). But client hooks (`useBudgetUpdate`, `useGrantContext`, `useSSEChat`) only check `app-builder-budget-service`. An existing migrated user with only `bmsExistingEnabled=true` gets `budgetServiceEnabled=true` in their JWT, but the client runs grant logic instead of budget logic.

2. **SSE server grant recovery predicate**: WebSocket decides grant recovery with `subscriptionId && !budgetServiceEnabled`. SSE uses `!bmsBudgetId && !budgetSessionId && !!subscriptionId`. When `budgetServiceEnabled=true` but the budget precheck returns no result (budget doesn't exist yet, race condition, or transient failure), SSE activates grant recovery while WebSocket would not.

## Design

### 1. Shared `usesBms` client predicate

Create a hook that encapsulates the dual-flag check, matching the server's `shouldCheckBmsMigration` logic.

**New file: `app/src/hooks/usesBms.ts`**

```typescript
import { useSwitchboard } from '@/hooks/useSwitchboard';

export function usesBms(): boolean {
  const budgetServiceEnabled = useSwitchboard('app-builder-budget-service') ?? false;
  const bmsExistingEnabled = useSwitchboard('app-builder-bms-existing') ?? false;
  return budgetServiceEnabled || bmsExistingEnabled;
}
```

Consumers replace their inline `useSwitchboard('app-builder-budget-service')` calls with `usesBms()`.

### 2. SSE server grant recovery predicate alignment

Replace the triple-condition check with logic matching WebSocket semantics. The JWT's `budgetServiceEnabled` is authoritative — if the token route resolved BMS eligibility, grants should not be used regardless of whether the precheck found a budget.

**In `MessageExecutionService.execute()` (~line 1202):**

```typescript
// Before:
const useGrantRecovery = !bmsBudgetId && !budgetSessionId && !!subscriptionId

// After:
const budgetServiceEnabled = agentCtx?.budgetServiceEnabled === true
const useGrantRecovery = !budgetServiceEnabled && !!subscriptionId
```

This matches WebSocket's `subscriptionId && !budgetServiceEnabled` (same semantics, inverted for clarity). The `bmsBudgetId`/`budgetSessionId` checks become unnecessary because `budgetServiceEnabled` already encompasses the decision from the token route.

### 3. Hook relocation

Move billing hooks out of `app/src/hooks/websocket/` since they serve both transports:

| From | To |
|------|-----|
| `app/src/hooks/websocket/useBudgetUpdate.ts` | `app/src/hooks/useBudgetUpdate.ts` |
| `app/src/hooks/websocket/useGrantContext.ts` | `app/src/hooks/useGrantContext.ts` |

Update imports in `useSSEChat.ts` (relative `./useBudgetUpdate`), `useStreamingWebSocket.ts` (from `./websocket/`), and `websocket/index.ts` (remove re-exports). No logic changes in this step.

### 4. useSSEChat alignment

Replace `useSwitchboard('app-builder-budget-service')` at line 166 with `usesBms()`. The ref becomes `isBmsEnabledRef`. The field sent to the server in POST body stays `budgetServiceEnabled` (server expects this field name).

### 5. Tests

| Test target | What to verify |
|-------------|---------------|
| `usesBms` hook | Returns `true` when either flag is true; `false` when both false |
| `useBudgetUpdate` | Only `bmsExistingEnabled=true` → hook activates (currently would not) |
| `useGrantContext` | Only `bmsExistingEnabled=true` → hook disabled (currently would not be) |
| `MessageExecutionService` | `budgetServiceEnabled=true` + no budget precheck result → grant recovery NOT activated |
| `useSSEChat` | `budgetServiceEnabled` field in POST body reflects `usesBms()` result |

## Files to modify

| File | Change |
|------|--------|
| `app/src/hooks/usesBms.ts` | New: shared dual-flag predicate hook |
| `app/src/hooks/useBudgetUpdate.ts` | Moved from `websocket/`; replace inline flag check with `usesBms()` |
| `app/src/hooks/useGrantContext.ts` | Moved from `websocket/`; replace inline flag check with `usesBms()` |
| `app/src/hooks/useSSEChat.ts` | Replace `useSwitchboard` call with `usesBms()` |
| `agents/src/server/sse/MessageExecutionService.ts` | Simplify grant recovery predicate to match WS |
| `app/src/hooks/websocket/index.ts` | Update re-exports if present |
| All files importing from `@/hooks/websocket/useBudgetUpdate` or `useGrantContext` | Update import paths |
| Test files for each of the above | Add/update coverage per Section 5 |

## Scope exclusions

- No changes to `ai-lib-websocket-server.ts` (WS is the reference, not the target)
- No changes to server-side `performBudgetPreCheck` or `bms-migration/` logic (already correct)
- No changes to the credits route (it already checks both flags via `shouldCheckBmsMigration`)
- No changes to the agent-token route (already correct)
