# SSE Billing/Shared Gating Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix BMS migrated-user client gating to check both Switchboard flags, align SSE server grant recovery predicate with WebSocket semantics, and relocate billing hooks out of the websocket/ directory.

**Architecture:** Create a shared `usesBms()` predicate on the client that checks both `app-builder-budget-service` and `app-builder-bms-existing` flags (matching the server's `shouldCheckBmsMigration` logic). Simplify the SSE server's grant recovery decision to use `budgetServiceEnabled` from the JWT (matching WebSocket). Move billing hooks to the shared hooks directory.

**Tech Stack:** TypeScript, React hooks, Vitest, Switchboard feature flags

---

## File Structure

| File | Responsibility |
|------|---------------|
| `app/src/hooks/usesBms.ts` | New shared predicate: returns true when either BMS flag is enabled |
| `app/src/hooks/usesBms.test.ts` | Unit tests for the predicate |
| `app/src/hooks/useBudgetUpdate.ts` | Moved from `websocket/`; uses `usesBms()` |
| `app/src/hooks/useBudgetUpdate.test.ts` | Moved from `websocket/`; updated mock + new test case |
| `app/src/hooks/useGrantContext.ts` | Moved from `websocket/`; uses `usesBms()` |
| `app/src/hooks/useGrantContext.test.tsx` | Moved from `websocket/`; updated mock + new test case |
| `app/src/hooks/useSSEChat.ts` | Uses `usesBms()` instead of direct Switchboard call |
| `app/src/hooks/useStreamingWebSocket.ts` | Updated import path |
| `app/src/hooks/websocket/index.ts` | Remove re-exports of moved hooks |
| `agents/src/server/sse/MessageExecutionService.ts` | Simplified grant recovery predicate |
| `agents/src/server/sse/__tests__/MessageExecutionService.test.ts` | New test: budgetServiceEnabled=true + no budget result |

---

### Task 1: Create `usesBms` predicate and tests

**Files:**
- Create: `app/src/hooks/usesBms.ts`
- Create: `app/src/hooks/usesBms.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
// app/src/hooks/usesBms.test.ts
/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest'

import { renderHookWithProviders } from '@/tests/test-utils'

const mockGetSwitchboardFlag = vi.fn()
vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: (flag: string) => mockGetSwitchboardFlag(flag),
  getSwitchboardFlag: (flag: string) => mockGetSwitchboardFlag(flag),
}))

import { usesBms } from './usesBms'

describe('usesBms', () => {
  it('returns true when app-builder-budget-service is enabled', () => {
    mockGetSwitchboardFlag.mockImplementation((flag: string) => {
      if (flag === 'app-builder-budget-service') return true
      if (flag === 'app-builder-bms-existing') return false
      return undefined
    })

    const { result } = renderHookWithProviders(() => usesBms())
    expect(result.current).toBe(true)
  })

  it('returns true when app-builder-bms-existing is enabled', () => {
    mockGetSwitchboardFlag.mockImplementation((flag: string) => {
      if (flag === 'app-builder-budget-service') return false
      if (flag === 'app-builder-bms-existing') return true
      return undefined
    })

    const { result } = renderHookWithProviders(() => usesBms())
    expect(result.current).toBe(true)
  })

  it('returns true when both flags are enabled', () => {
    mockGetSwitchboardFlag.mockImplementation(() => true)

    const { result } = renderHookWithProviders(() => usesBms())
    expect(result.current).toBe(true)
  })

  it('returns false when both flags are disabled', () => {
    mockGetSwitchboardFlag.mockImplementation(() => false)

    const { result } = renderHookWithProviders(() => usesBms())
    expect(result.current).toBe(false)
  })

  it('returns false when both flags are undefined (no switchboard data)', () => {
    mockGetSwitchboardFlag.mockImplementation(() => undefined)

    const { result } = renderHookWithProviders(() => usesBms())
    expect(result.current).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter website test "usesBms.test"`
Expected: FAIL — module `./usesBms` not found

- [ ] **Step 3: Write the implementation**

```typescript
// app/src/hooks/usesBms.ts
import { useSwitchboard } from '@/hooks/useSwitchboard'

/**
 * Determines whether BMS (Budget Management Service) is enabled for the current user.
 *
 * Checks both Switchboard flags, matching the server's shouldCheckBmsMigration logic:
 * - app-builder-budget-service: enables BMS for NEW users
 * - app-builder-bms-existing: enables BMS for EXISTING migrated users
 */
export function usesBms(): boolean {
  const budgetServiceEnabled = useSwitchboard('app-builder-budget-service') ?? false
  const bmsExistingEnabled = useSwitchboard('app-builder-bms-existing') ?? false
  return budgetServiceEnabled || bmsExistingEnabled
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter website test "usesBms.test"`
Expected: PASS — all 5 tests pass

- [ ] **Step 5: Commit**

```bash
git add app/src/hooks/usesBms.ts app/src/hooks/usesBms.test.ts
git commit -m "feat(billing): add shared usesBms predicate checking both BMS flags"
```

---

### Task 2: Move `useBudgetUpdate` and update to use `usesBms`

**Files:**
- Move: `app/src/hooks/websocket/useBudgetUpdate.ts` → `app/src/hooks/useBudgetUpdate.ts`
- Move: `app/src/hooks/websocket/useBudgetUpdate.test.ts` → `app/src/hooks/useBudgetUpdate.test.ts`
- Modify: `app/src/hooks/websocket/index.ts`

- [ ] **Step 1: Move the source file and update the import**

Move `app/src/hooks/websocket/useBudgetUpdate.ts` to `app/src/hooks/useBudgetUpdate.ts`.

Replace line 5:
```typescript
// Before:
import { useSwitchboard } from '@/hooks/useSwitchboard'

// After:
import { usesBms } from '@/hooks/usesBms'
```

Replace lines 37-39:
```typescript
// Before:
  const queryClient = useQueryClient()
  // BMS mode: this hook is only active when BMS is enabled
  const budgetServiceEnabled = useSwitchboard('app-builder-budget-service') ?? false
  const effectiveEnabled = enabled && budgetServiceEnabled

// After:
  const queryClient = useQueryClient()
  const bmsEnabled = usesBms()
  const effectiveEnabled = enabled && bmsEnabled
```

- [ ] **Step 2: Move the test file and update mock**

Move `app/src/hooks/websocket/useBudgetUpdate.test.ts` to `app/src/hooks/useBudgetUpdate.test.ts`.

Replace the `useSwitchboard` mock (lines 20-23) with:
```typescript
const mockUsesBms = vi.fn()
vi.mock('@/hooks/usesBms', () => ({
  usesBms: () => mockUsesBms(),
}))
```

Update the import at line 9:
```typescript
import { type BudgetUpdateController, useBudgetUpdate } from './useBudgetUpdate'
```

Replace `mockUseSwitchboard.mockReturnValue(true)` in `beforeEach` with:
```typescript
mockUsesBms.mockReturnValue(true) // Default: BMS enabled (this hook only runs in BMS mode)
```

Replace `mockUseSwitchboard.mockReturnValue(false)` in the "does not subscribe when BMS flag is disabled" test with:
```typescript
mockUsesBms.mockReturnValue(false)
```

- [ ] **Step 3: Add test for bmsExistingEnabled-only activation**

Add this test inside the `BMS flag gating` describe block:
```typescript
    it('subscribes when only bmsExistingEnabled is true (via usesBms)', function bmsExistingOnlySubscribes() {
      // usesBms returns true (simulates bmsExistingEnabled=true, budgetServiceEnabled=false)
      mockUsesBms.mockReturnValue(true)
      const { controller, cleanup } = createController()

      const { unmount } = renderHookWithProviders(() =>
        useBudgetUpdate({
          controller,
          subscriptionId: 'sub-1',
          enabled: true,
        })
      )

      unmount()
      expect(cleanup).toHaveBeenCalled()
    })
```

- [ ] **Step 4: Update `websocket/index.ts` to remove the re-export**

In `app/src/hooks/websocket/index.ts`, remove line 7:
```typescript
export * from './useBudgetUpdate'
```

- [ ] **Step 5: Run tests to verify**

Run: `pnpm --filter website test "useBudgetUpdate.test"`
Expected: PASS — all tests pass (including the new one)

- [ ] **Step 6: Commit**

```bash
git add app/src/hooks/useBudgetUpdate.ts app/src/hooks/useBudgetUpdate.test.ts app/src/hooks/websocket/index.ts
git rm app/src/hooks/websocket/useBudgetUpdate.ts app/src/hooks/websocket/useBudgetUpdate.test.ts
git commit -m "refactor(billing): move useBudgetUpdate to shared hooks, use usesBms predicate"
```

---

### Task 3: Move `useGrantContext` and update to use `usesBms`

**Files:**
- Move: `app/src/hooks/websocket/useGrantContext.ts` → `app/src/hooks/useGrantContext.ts`
- Move: `app/src/hooks/websocket/useGrantContext.test.tsx` → `app/src/hooks/useGrantContext.test.tsx`
- Modify: `app/src/hooks/websocket/index.ts`

- [ ] **Step 1: Move the source file and update the import**

Move `app/src/hooks/websocket/useGrantContext.ts` to `app/src/hooks/useGrantContext.ts`.

Replace line 5 (the `useSwitchboard` import):
```typescript
// Before:
import { useSwitchboard } from '@/hooks/useSwitchboard'

// After:
import { usesBms } from '@/hooks/usesBms'
```

Replace lines 65-67:
```typescript
// Before:
  // BMS mode: skip all grant operations - BMS handles cost tracking via x-gocode-budget-* headers
  const budgetServiceEnabled = useSwitchboard('app-builder-budget-service') ?? false
  const effectiveEnabled = enabled && !budgetServiceEnabled

// After:
  const bmsEnabled = usesBms()
  const effectiveEnabled = enabled && !bmsEnabled
```

- [ ] **Step 2: Move the test file and update mock**

Move `app/src/hooks/websocket/useGrantContext.test.tsx` to `app/src/hooks/useGrantContext.test.tsx`.

Replace the `useSwitchboard` mock (lines 37-40) with:
```typescript
const mockUsesBms = vi.fn()
vi.mock('@/hooks/usesBms', () => ({
  usesBms: () => mockUsesBms(),
}))
```

Update the import at line 13:
```typescript
import { useGrantContext } from './useGrantContext'
```

In `beforeEach`, replace any `mockUseSwitchboard.mockReturnValue(false)` with `mockUsesBms.mockReturnValue(false)`. For tests where BMS is enabled (grant context should be disabled), use `mockUsesBms.mockReturnValue(true)`.

- [ ] **Step 3: Add test for bmsExistingEnabled-only disabling**

Add this test in the appropriate describe block (where BMS flag gating is tested):
```typescript
    it('does not send grants when only bmsExistingEnabled is true (via usesBms)', () => {
      mockUsesBms.mockReturnValue(true) // Simulates bmsExistingEnabled=true
      const controller = createController()

      renderHookWithProviders(() =>
        useGrantContext({
          controller,
          subscriptionId: 'sub-1',
          isConnected: true,
          enabled: true,
        })
      )

      expect(controller.emitGrantContext).not.toHaveBeenCalled()
    })
```

- [ ] **Step 4: Update `websocket/index.ts` to remove the re-export**

In `app/src/hooks/websocket/index.ts`, remove the line:
```typescript
export * from './useGrantContext'
```

- [ ] **Step 5: Run tests to verify**

Run: `pnpm --filter website test "useGrantContext.test"`
Expected: PASS — all tests pass

- [ ] **Step 6: Commit**

```bash
git add app/src/hooks/useGrantContext.ts app/src/hooks/useGrantContext.test.tsx app/src/hooks/websocket/index.ts
git rm app/src/hooks/websocket/useGrantContext.ts app/src/hooks/websocket/useGrantContext.test.tsx
git commit -m "refactor(billing): move useGrantContext to shared hooks, use usesBms predicate"
```

---

### Task 4: Update consumer imports

**Files:**
- Modify: `app/src/hooks/useSSEChat.ts`
- Modify: `app/src/hooks/useStreamingWebSocket.ts`

- [ ] **Step 1: Update `useSSEChat.ts` imports and flag usage**

In `app/src/hooks/useSSEChat.ts`:

Replace lines 56-57:
```typescript
// Before:
import { useBudgetUpdate } from './websocket/useBudgetUpdate'
import { useGrantContext } from './websocket/useGrantContext'

// After:
import { useBudgetUpdate } from './useBudgetUpdate'
import { useGrantContext } from './useGrantContext'
```

Add import for `usesBms` (near other hook imports):
```typescript
import { usesBms } from '@/hooks/usesBms'
```

Replace line 169 (the Switchboard call):
```typescript
// Before:
  const isBudgetServiceEnabled = useSwitchboard('app-builder-budget-service') ?? false

// After:
  const isBudgetServiceEnabled = usesBms()
```

Remove the `useSwitchboard` import if it's no longer used elsewhere in the file. Check with:
```bash
grep -n "useSwitchboard" app/src/hooks/useSSEChat.ts
```
If `useSwitchboard` is only used on line 169, remove the import.

- [ ] **Step 2: Update `useStreamingWebSocket.ts` imports**

In `app/src/hooks/useStreamingWebSocket.ts`, replace lines 60-63:
```typescript
// Before:
import {
  useBudgetUpdate,
  useGrantContext,
  useWebSocketHelpers,
} from './websocket'

// After:
import { useBudgetUpdate } from './useBudgetUpdate'
import { useGrantContext } from './useGrantContext'
import { useWebSocketHelpers } from './websocket'
```

- [ ] **Step 3: Run typecheck to verify imports resolve**

Run: `pnpm --filter website typecheck`
Expected: PASS — no import resolution errors

- [ ] **Step 4: Run affected tests**

Run: `pnpm --filter website test "useSSEChat.test|useStreamingWebSocket"`
Expected: PASS (or existing failures unrelated to this change)

- [ ] **Step 5: Commit**

```bash
git add app/src/hooks/useSSEChat.ts app/src/hooks/useStreamingWebSocket.ts
git commit -m "refactor(billing): update consumer imports for relocated billing hooks"
```

---

### Task 5: Align SSE server grant recovery predicate

**Files:**
- Modify: `agents/src/server/sse/MessageExecutionService.ts:1202-1209`
- Modify: `agents/src/server/sse/__tests__/MessageExecutionService.test.ts`

- [ ] **Step 1: Write the new test case**

Add this test inside the `grant budget recovery wiring` describe block in `agents/src/server/sse/__tests__/MessageExecutionService.test.ts`:

```typescript
    it('skips grant registration when budgetServiceEnabled=true even without budget result', async () => {
      const { grantSessionManager } = await import('@airo/ai-grants')
      vi.spyOn(grantSessionManager, 'registerSession').mockImplementation(() => {})
      vi.spyOn(grantSessionManager, 'removeSession').mockImplementation(() => {})

      deps = createMockDeps()
      service = new MessageExecutionService(deps as any)

      await service.execute({
        ...DEFAULT_PARAMS,
        subscriptionId: 'sub-bms-no-budget',
        // No bmsBudgetId or budgetSessionId — but JWT says BMS is enabled
        lifecycleContext: {
          agentContext: {
            budgetServiceEnabled: true,
          },
        },
      })

      expect(grantSessionManager.registerSession).not.toHaveBeenCalled()
      expect(grantSessionManager.removeSession).not.toHaveBeenCalled()
    })
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @airo/agents test:unit "MessageExecutionService" -t "skips grant registration when budgetServiceEnabled=true even without budget result"`
Expected: FAIL — grant session IS registered (current behavior is based on `!bmsBudgetId && !budgetSessionId`)

- [ ] **Step 3: Fix the predicate**

In `agents/src/server/sse/MessageExecutionService.ts`, replace lines 1202-1203:
```typescript
// Before:
    // Budget recovery for grants-mode (non-BMS) sessions
    const useGrantRecovery = !bmsBudgetId && !budgetSessionId && !!subscriptionId

// After:
    // Budget recovery for grants-mode (non-BMS) sessions.
    // Use budgetServiceEnabled from JWT as the authoritative signal (matches WebSocket semantics).
    const budgetServiceEnabled = agentCtx?.budgetServiceEnabled === true
    const useGrantRecovery = !budgetServiceEnabled && !!subscriptionId
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @airo/agents test:unit "MessageExecutionService" -t "skips grant registration when budgetServiceEnabled=true even without budget result"`
Expected: PASS

- [ ] **Step 5: Run the full grant recovery test suite to ensure no regressions**

Run: `pnpm --filter @airo/agents test:unit "MessageExecutionService" -t "grant budget recovery"`
Expected: PASS — all 4 tests pass (3 existing + 1 new)

- [ ] **Step 6: Commit**

```bash
git add agents/src/server/sse/MessageExecutionService.ts agents/src/server/sse/__tests__/MessageExecutionService.test.ts
git commit -m "fix(sse): align grant recovery predicate with WebSocket semantics

Use budgetServiceEnabled from JWT instead of checking bmsBudgetId/budgetSessionId.
When the token route resolves BMS eligibility, grants should not activate
regardless of whether the budget precheck found a budget."
```

---

### Task 6: Final verification

**Files:** None (verification only)

- [ ] **Step 1: Run full typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 2: Run full lint**

Run: `pnpm lint`
Expected: PASS

- [ ] **Step 3: Run all affected test suites**

Run: `pnpm --filter website test "usesBms|useBudgetUpdate|useGrantContext|useSSEChat" && pnpm --filter @airo/agents test:unit "MessageExecutionService"`
Expected: PASS

- [ ] **Step 4: Verify no stale imports remain**

Run:
```bash
grep -rn "from.*hooks/websocket/useBudgetUpdate\|from.*hooks/websocket/useGrantContext" app/src/ --include="*.ts" --include="*.tsx" | grep -v "__tests__" | grep -v ".test."
```
Expected: No output (all imports updated)
