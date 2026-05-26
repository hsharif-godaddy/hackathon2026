# DPP Hydration Race — Client-Only Creation-Handoff Bypass

**Status:** Implementation
**Date:** 2026-05-25
**Author:** John Gaffney
**Scope:** `app/src/app/[market]/develop/hooks/useInitialization.ts`
**Branch:** `fix/dpp-hydration-race-server-confirmation-v2`
**Supersedes:** an earlier server-authoritative `no_prior_conversation` design (deleted) — abandoned in favor of a client-only fix

## Problem

PR #4074 re-landed the DPP handoff with a site-aware hydration effect that fires `HYDRATE_APP` when the user lands on a fresh DPP redirect, so the agent receives the initial prompt without a manual send. The gate predicate, after the first round of fixes, was a strict:

```ts
function shouldFireSiteAwareHydration(
  historyLoadingComplete: boolean,
  hasMessages: boolean,
): boolean {
  if (hasMessages) return false
  return historyLoadingComplete
}
```

This is correct on the **cookie-less existing-app reload** path the strict gate was added for: the BFF `/api/sites/:id` fetch can win the race against the conversation cookie write, so the only safe rule is "wait until the history layer says we're done before deciding the app is fresh."

But it deadlocks the **in-session DPP creation handoff**:

1. Initial URL is `/develop/{statusJobId}?type=job`. Single non-reconnecting WebSocket connects, server emits `agents_available`, `AgentsAvailableHandler` calls `emitLoadHistoryIfNeeded` which (no cookie → no history) flips `historyLoadingComplete=true`. So far so good.
2. Creation completes; `useInitialization` records `jobIdToRealAppIdRef.current = { jobId, realAppId }` and the URL flips to `/develop/{realAppId}`.
3. The `appId` change calls `setCurrentAppId(realAppId)` in the store, which **unconditionally resets `historyLoadingComplete: false`** (`useStreamingConversationStore.ts:1252`). That's correct in general — a different app means we don't yet know whether *its* history is loaded.
4. But the WebSocket is the same connection, so there's no second `agents_available` to re-flip the gate. The strict predicate stays closed for this `appId` until the 15s × 3 = 45s `StreamingMessageList` safety timer eventually forces it.

User-visible symptom: "thinking hangs + bare app, no Building Site overlay" for 45 s after a DPP creation finishes.

## Why not the server-authoritative `no_prior_conversation` approach

The earlier plan (see superseded doc) proposed a server-authoritative `no_prior_conversation` event so the client could open the gate without inferring "fresh app" from cookie absence. That works, but:

- Requires shipping `agents` (the DPP test backend in this case) before the client fix is testable.
- Adds a new wire-format event, a handler, registry wiring, integration coverage, and an error-path on `getLatestConversationForApp` — ~250 LOC and seven files.
- The fix is overbroad: the cookie-less existing-app reload case the server signal targets is already handled by the strict gate; the only remaining failure is in-session creation handoff, which the *client already knows about* via `jobIdToRealAppIdRef`.

## Approach

In-session creation handoff is the only path that needs the bypass, and it's locally observable on the client. There are two markers, both already set by the existing creation flow; either is sufficient and they cover different lifetimes:

1. **`jobIdToRealAppIdRef.current.realAppId === appId`** — set in `useInitialization.ts:961` when `creationPhase === 'complete'` lands the real appId. Lives for the current `useInitialization` mount.
2. **`sessionStorage.getItem('initial-job-id-${appId}') !== null`** — set in `useInitialization.ts:974` immediately before `router.replace`, so it is durable across the develop-page remount that the URL flip causes (see *Why the ref alone is not enough* below).

Add a third arg to `shouldFireSiteAwareHydration` and OR it in:

```ts
export function shouldFireSiteAwareHydration(
  historyLoadingComplete: boolean,
  hasMessages: boolean,
  fromCreationHandoff: boolean = false,
): boolean {
  if (hasMessages) return false
  if (fromCreationHandoff) return true
  if (!historyLoadingComplete) return false
  return true
}
```

Call site checks both markers:

```ts
const fromCreationHandoff =
  jobIdToRealAppIdRef.current?.realAppId === appId ||
  (typeof window !== 'undefined' && sessionStorage.getItem(`initial-job-id-${appId}`) !== null)
if (!shouldFireSiteAwareHydration(historyLoadingComplete, messages.length > 0, fromCreationHandoff)) return
if (!shouldHydrateInitialPromptFromSite(appId, state.context.hasInitialPrompt, site, realAppId)) return
send({ type: 'HYDRATE_APP', appId, isJobId, hasInitialPrompt: true })
```

## Why the ref alone is not enough

The first cut of this plan claimed "the ref lives as long as the develop page mount." That is true for the mount, but it skipped over the URL flip itself: `app/src/app/[market]/develop/[id]/loading.tsx` wraps the page in an automatic Suspense boundary. When `router.replace('/develop/${realAppId}')` changes the dynamic param, App Router suspends the segment, renders `loading.tsx` (`<DevelopSkeleton />`), and **mounts a fresh page instance on the other side**. Two pieces of evidence confirmed this in the dev.log of the failed test:

- `client.funnel.develop_page.loaded` fires twice — once for the jobId, once for the realAppId — even though the firing effect is guarded by a `useRef(false)` (`hasFiredDevelopPageLoaded`) that should prevent duplicates within a single mount.
- `GET /develop/${realAppId} 200 in 3.2s` — a server-rendered request, not an in-place client transition.

So on the second mount, `jobIdToRealAppIdRef.current` is `null` (a fresh `useRef` initial value), `fromCreationHandoff` evaluates `false`, the strict gate stays closed, and the user sees the same 45 s hang.

The sibling `initial-job-id-${realAppId}` sessionStorage key was already being written at `useInitialization.ts:974` (just before `router.replace`) for an unrelated reason (carrying the initial-prompt text across the URL flip). It survives the Suspense remount because sessionStorage is per-tab, not per-mount. Reading it back is the cross-remount marker.

## Why this is safe

- **`hasMessages` always wins.** A user who's typed even one message into the previous app's stream blocks the bypass; the cross-session `shouldHydrateInitialPromptFromSite` localStorage guard still applies.
- **Both markers are set only by this hook, only after creation succeeds.** No external caller writes `initial-job-id-${realAppId}` or sets the ref; the cookie-less reload path of an existing app never enters `creationPhase === 'complete'`, so neither marker is present and the strict gate stays in force — the path PR #4111 was built to protect.
- **Per-tab lifetime, not per-mount.** sessionStorage is scoped to the tab, so on a hard reload (new tab session) both markers are gone and we fall back to the strict gate. Within the same tab, after the bypass has fired once, `state.context.hasInitialPrompt = true` and the durable `initial-prompt-auto-sent-${siteId}` localStorage flag (set in `markInitialPromptSent`) prevent re-fires through `shouldHydrateInitialPromptFromSite` even though the sessionStorage key is still present.
- **Future entry paths come along for free.** Anything that goes through the `creating` phase (PaaS handoff, retry from error, etc.) sets both markers and gets the bypass without further changes.

## Why not a query-param marker (`?useInitialPrompt=true`)

Considered: have DPP append a marker to the redirect URL. Rejected because:

- Requires an external (DPP-side) change to opt in, and each new entry path needs to repeat it.
- The marker vanishes on the first `router.replace` (which we do as soon as creation lands), so the bypass window is brittle and can collide with WebSocket reconnects — the user reported instability with this approach in a prior attempt.
- Doesn't compose with future programmatic creations where there's no URL to decorate.

The ref-based approach is internal, persistent across the URL flip, and doesn't require coordination with any other system.

## Tests

Two new unit tests in `useInitialization.test.ts`:

- `shouldFireSiteAwareHydration(false, false, true) === true` — the bypass opens the gate even when `historyLoadingComplete` is false.
- `shouldFireSiteAwareHydration(false, true, true) === false` and `(true, true, true) === false` — `hasMessages` overrides the bypass.

The existing 100-test `useInitialization.test.ts` suite covers the strict-gate cases and continues to pass; the integration test in `websocket-recovery.integration.test.ts` continues to cover the recovery / `agents_available` flow that the original `historyLoadingComplete` flip relies on.

## Reverted from the prior approach

This branch removes the entire server-authoritative apparatus added in commits `3cfa123ab` and `8bd6a8440`:

- `packages/ai-transport/src/connection-recovery-manager.ts` — the cookie-less lookup error-path + `no_prior_conversation` emit
- `app/src/hooks/websocket/handlers/NoPriorConversationHandler.ts` (+ unit test) — deleted
- `app/src/hooks/websocket/handlers/index.ts` — removed export
- `app/src/services/websocket/TransportSupervisor.ts` — removed registry wiring
- `app/src/services/websocket/__tests__/TransportSupervisor.test.ts` — removed registry wiring guard
- `app/src/hooks/websocket/__tests__/integration/websocket-recovery.integration.test.ts` — removed Scenario 5
- `app/src/hooks/websocket/__tests__/integration/test-utils/recovery-test-harness.ts` — removed unused `setHistoryLoadingComplete` mock

Net change vs. pre-PR-#4111 baseline: +63 / −323 lines across 11 files (most of that is reverting the prior approach's tests).
