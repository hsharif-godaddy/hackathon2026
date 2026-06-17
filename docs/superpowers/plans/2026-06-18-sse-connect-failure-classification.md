# SSE Connect-Failure Classification (AIROBUILD-2628 extension) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Classify `useSSEChat` connect-time failures so a deterministic app-unavailable failure gives up immediately and stops the composer sending into a dead stream, a provisioning race retries until ready, and opaque network failures keep today's behavior.

**Why:** AIROBUILD-2628 comment 7565315 (2026-06-18) distribution of `connect.failed` (n=201/6h): deterministic app-unavailable ~40% (`agent-token 4xx`, `SITE_NOT_FOUND`), transient network ~57% (`Failed to fetch`/`Load failed`), provisioning race ~2% (`agent is not ready yet`). The merged PR already caps the EventSource reconnect *storm* (opaque network at `SSETransport.onerror`). The remaining SSE-specific gap: when init succeeds but the agent token 4xx's, `useSSEChat` retries/dead-ends silently and the user's next send hits the transport's raw `Not connected` (the `send_message.failed` "Not connected" 64%). The deterministic UI for `SITE_NOT_FOUND` is already handled by `useInitialization` → `<AppNotFound />`, so no new screen is needed.

**Scope guard:** Changes live in `app/src/hooks/useSSEChat.ts` plus a tiny pure classifier (+ tests). No new UI component (init owns the app-not-found screen). No `SSETransport` changes.

## Classification (pure helper)

Add `classifyConnectError(err: unknown): 'deterministic' | 'provisioning' | 'network'` (exported from `app/src/hooks/shared/classifyConnectError.ts`):
- **deterministic** — message contains `SITE_NOT_FOUND`, or matches `/Failed to get agent token: (403|404)/`. (403/404 = app/agent gone or forbidden — retrying cannot succeed. 401/5xx are NOT deterministic: 401 is auth/SSO, 5xx is transient.)
- **provisioning** — message contains `is not ready yet` (the `dynamic-api.ts` "agent is not ready yet" throw).
- **network** — anything else (`Failed to fetch`, `Load failed`, 401/5xx token errors, timeouts).

## Behavior per class (in `useSSEChat` connect() catch)

- **deterministic** → log `sse.connect.failed` with `classification`; `setConnectionError(err)`; `setTransportState('error')`; set `connectUnavailableRef.current = true`. Do NOT retry. `sendMessage` then short-circuits (below) with a clear error instead of the dead-stream `Not connected`.
- **provisioning** → log with `classification`; schedule a bounded retry-until-ready: bump `reconnectNonce` after a backoff, up to `MAX_PROVISIONING_RETRIES` (3) at 2s/4s/8s, tracked in `provisioningRetryRef`. Reset the counter on a successful connect.
- **network** → unchanged: `setConnectionError(err)` (init's `PAGE_DATA_FAILED` covers UI; the conversation-create loop already retries network create failures).

`connectUnavailableRef` and `provisioningRetryRef` reset to clean state at the start of each `connect()` and on reaching `'connected'`.

---

### Task 1: `classifyConnectError` pure helper

**Files:**
- Create: `app/src/hooks/shared/classifyConnectError.ts`
- Test: `app/src/hooks/shared/__tests__/classifyConnectError.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { classifyConnectError } from '../classifyConnectError'

describe('classifyConnectError', () => {
  it('classifies SITE_NOT_FOUND as deterministic', () => {
    expect(classifyConnectError(new Error('SITE_NOT_FOUND'))).toBe('deterministic')
  })
  it('classifies agent-token 404/403 as deterministic', () => {
    expect(classifyConnectError(new Error('Failed to get agent token: 404'))).toBe('deterministic')
    expect(classifyConnectError(new Error('Failed to get agent token: 403'))).toBe('deterministic')
  })
  it('classifies agent-token 401/500 as network (not deterministic)', () => {
    expect(classifyConnectError(new Error('Failed to get agent token: 401'))).toBe('network')
    expect(classifyConnectError(new Error('Failed to get agent token: 503'))).toBe('network')
  })
  it('classifies "agent is not ready yet" as provisioning', () => {
    expect(classifyConnectError(new Error('Site app_1 agent is not ready yet. Status: creating'))).toBe('provisioning')
  })
  it('classifies opaque network strings as network', () => {
    expect(classifyConnectError(new Error('Failed to fetch'))).toBe('network')
    expect(classifyConnectError(new Error('Load failed'))).toBe('network')
    expect(classifyConnectError('weird non-error')).toBe('network')
  })
})
```

- [ ] **Step 2: Run it, expect FAIL** — `pnpm --filter website test src/hooks/shared/__tests__/classifyConnectError.test.ts` → module not found.

- [ ] **Step 3: Implement**

```ts
export type ConnectErrorClass = 'deterministic' | 'provisioning' | 'network'

/**
 * Classify a useSSEChat connect-time failure so the caller can branch:
 * deterministic app-unavailable → give up immediately; provisioning race →
 * bounded retry-until-ready; network → existing behavior. (AIROBUILD-2628)
 */
export function classifyConnectError(err: unknown): ConnectErrorClass {
  const message = err instanceof Error ? err.message : String(err)
  if (message.includes('SITE_NOT_FOUND')) return 'deterministic'
  const tokenStatus = message.match(/Failed to get agent token: (\d{3})/)
  if (tokenStatus && (tokenStatus[1] === '403' || tokenStatus[1] === '404')) return 'deterministic'
  if (message.includes('is not ready yet')) return 'provisioning'
  return 'network'
}
```

- [ ] **Step 4: Run it, expect PASS.**
- [ ] **Step 5: Commit** — `feat(sse): add connect-failure classifier (AIROBUILD-2628)`

---

### Task 2: Branch on classification in `useSSEChat` connect() + gate sends

**Files:**
- Modify: `app/src/hooks/useSSEChat.ts`
- Test: `app/src/hooks/__tests__/useSSEChat.test.ts`

- [ ] **Step 1: Add refs** near the other refs in `useSSEChat` (after `appNotFoundRetryRef`):

```ts
  const connectUnavailableRef = useRef(false)
  const provisioningRetryRef = useRef<{ count: number; timer: ReturnType<typeof setTimeout> | null }>({ count: 0, timer: null })
```

- [ ] **Step 2: Import the classifier** (with the other `./shared/*` imports):

```ts
import { classifyConnectError } from './shared/classifyConnectError'
```

- [ ] **Step 3: Reset state at the top of `connect()`** (right after `async function connect() {`'s `try {`), so a fresh attempt is clean:

```ts
        connectUnavailableRef.current = false
```

- [ ] **Step 4: Reset provisioning counter on success.** In the `onStateChange` callback where `state === 'connected'` is handled, reset the retry counter:

```ts
                if (state === 'connected' && currentAppId) {
                  connectUnavailableRef.current = false
                  if (provisioningRetryRef.current.timer) clearTimeout(provisioningRetryRef.current.timer)
                  provisioningRetryRef.current = { count: 0, timer: null }
                  void requestInitialHistoryLoad(getConversationIdFromCookie(currentAppId))
                }
```

- [ ] **Step 5: Replace the connect() catch** (currently logs `sse.connect.failed` + `setConnectionError`) with the classified branch:

```ts
      } catch (err) {
        if (cancelled) return
        const classification = classifyConnectError(err)
        logger.error('sse.connect.failed', {
          appId: currentAppId,
          classification,
          error: err instanceof Error ? err.message : String(err),
        })
        if (classification === 'deterministic') {
          // App/agent is gone — retrying cannot succeed. Surface a terminal
          // state and gate sends so the composer does not post into a dead
          // stream (the send_message "Not connected" case). The SITE_NOT_FOUND
          // app-unavailable screen is owned by useInitialization. (AIROBUILD-2628)
          connectUnavailableRef.current = true
          setConnectionError(err)
          setTransportState('error')
        } else if (classification === 'provisioning') {
          // Newly created app whose agent isn't up yet — bounded retry-until-ready.
          const retry = provisioningRetryRef.current
          if (retry.count < 3) {
            retry.count += 1
            const delay = 2000 * 2 ** (retry.count - 1)
            if (retry.timer) clearTimeout(retry.timer)
            retry.timer = setTimeout(() => {
              retry.timer = null
              setReconnectNonce((n) => n + 1)
            }, delay)
          } else {
            setConnectionError(err)
          }
        } else {
          setConnectionError(err)
        }
      }
```

- [ ] **Step 6: Gate `sendMessage`.** Near the top of `sendMessage`, after the `if (!t) { ... return }` guard and `activeAppId` resolution but before `store.startNewStream(...)`, add:

```ts
    if (connectUnavailableRef.current) {
      logger.warn('sse.send_message.app_unavailable', { appId: activeAppId })
      const s = useStreamingConversationStore.getState()
      s.startNewStream(options.content, options.selectedAssets, options.customContext?.referencedFiles as Array<{ path: string; content: string }> | undefined)
      s.markUpstreamError({
        message: tRef.current('builder_sse_app_unavailable', undefined, 'This app is currently unavailable. Please reload the page.'),
        type: 'APP_NOT_FOUND',
      })
      s.finalizeStream()
      s.setIsLoading(false)
      return
    }
```

(`tRef` is the existing localized-translations ref. Create the i18n key `builder_sse_app_unavailable` in the AAB i18n tool; the literal fallback keeps it working before the key lands.)

- [ ] **Step 7: Clear the provisioning timer in the unmount cleanup.** In the existing unmount `useEffect` cleanup (the one calling `clearAppNotFoundRetry()`), add:

```ts
      if (provisioningRetryRef.current.timer) {
        clearTimeout(provisioningRetryRef.current.timer)
        provisioningRetryRef.current.timer = null
      }
```

- [ ] **Step 8: Add hook tests** in `app/src/hooks/__tests__/useSSEChat.test.ts`. Use the existing harness (`setupHook`, `lastTransport`, the mocked `getAgentToken`/`getConfigForSite`). Cover:
  1. Deterministic connect failure (mock `getAgentToken` to reject with `Failed to get agent token: 404`) → `connection.status === 'error'`; a subsequent `actions.send(...)` does NOT call `lastTransport.sendMessage` and triggers `markUpstreamError` with `type: 'APP_NOT_FOUND'`.
  2. Provisioning failure (`agent is not ready yet`) → schedules a retry (assert a second connect attempt via fake timers / `reconnectNonce` re-run) and does NOT set `connectUnavailableRef` (send still attempts the transport).
  3. Network failure (`Failed to fetch`) → `setConnectionError` set, sends still reach the transport (no gating).

  Match the file's existing mock structure for `@/lib/agent-fetch` and `@/config/dynamic-api`; assert via the store-action mocks already present (`mockMarkUpstreamError` etc. — reuse whatever the file already exposes, or add a spy consistent with its style).

- [ ] **Step 9: Run** `pnpm --filter website test src/hooks/__tests__/useSSEChat.test.ts` → PASS.
- [ ] **Step 10: Typecheck** `pnpm --filter website typecheck` → no new errors (pre-existing `ChatInput.tsx` / `media-slot-fork.ts` excepted).
- [ ] **Step 11: Commit** — `feat(sse): classify connect failures — give up on app-unavailable, retry provisioning (AIROBUILD-2628)`

---

## Self-Review

- **Spec coverage:** deterministic→give-up+gate sends (Task 2 S5,S6); provisioning→bounded retry (S5); network→unchanged (S5); classifier (Task 1). Storm + dormant already merged. AC2 app-unavailable UI = init's `<AppNotFound />` (SITE_NOT_FOUND) + the gated-send clear error (token-4xx).
- **Placeholders:** none.
- **Type consistency:** `classifyConnectError`/`ConnectErrorClass`, `connectUnavailableRef`, `provisioningRetryRef`, `'APP_NOT_FOUND'` used consistently; `setTransportState`/`setReconnectNonce`/`setConnectionError` already exist in the hook.
- **Out of scope:** no `SSETransport` change; no new UI component; no change to the conversation-create retry loop (it already handles network create failures).
