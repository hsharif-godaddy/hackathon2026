---
title: "TanStack Query v5 bounded polling for async-provisioning races"
date: 2026-05-28
last_updated: 2026-06-01
category: design-patterns
module: "app / useConversionEvent"
problem_type: design_pattern
component: frontend_stimulus
severity: medium
applies_when:
  - "a hook must poll a TanStack query until an async backend state lands (provisioning lag, DNS propagation, spend reconciliation)"
  - "a one-shot read-at-mount loses a race and only succeeds after a full page reload"
  - "you need polling to stop on success AND give up after a bound"
  - "you need a side effect (log/metric) on the poll-stop transition"
  - "you are adding a poller to a query key that already has other consumers"
related_components:
  - frontend_stimulus
tags:
  - tanstack-query
  - react-query
  - refetchinterval
  - polling
  - provisioning-race
  - per-observer
  - bounded-polling
  - error-logging
  - deduplication
  - module-level-set
---

# TanStack Query v5 bounded polling for async-provisioning races

## Context

A brand-new account hits `/develop` before mgmt-airo finishes provisioning its trial subscription and the free-plan `orderId`. A one-shot read on mount races the backend and loses: the subscription list returns `active: null`, or the trial is visible but its `free-plan`/`orderId` attribute lands a beat later. The conversion event only fired after a full page reload (confirmed in prod). The fix: poll until the async state lands, then stop, then fire once.

The repo had two competing idioms for this same "wait for the backend to provision" shape:

- **Wall-clock `useState`/`useRef`** (`app/src/hooks/useSubscriptionWithPolling.ts`): a `needsPolling` boolean plus a `pollingStartTime` ref, driven by a `useEffect` that diffs `Date.now()` against a max-duration constant. `refetchInterval` is just `needsPolling ? INTERVAL : false`.
- **Functional `refetchInterval`** (`app/src/hooks/useDkimStatusQuery.ts`, `useCreditGrants.ts`): a single `refetchInterval: (query) => number | false` predicate over `query.state`.

`useConversionEvent` follows the functional idiom and pushes it further: pure exported predicates, per-instance time bounding, per-observer reasoning, and a logged stop-transition. The gotchas below each cost real debugging time — one of them shipped a latent bug that the polling never actually ran.

## Guidance

### 1. Bound the poll by per-instance elapsed time, NOT `query.state.dataUpdateCount`

This is the load-bearing lesson. `dataUpdateCount` (and `errorUpdateCount`) live on the **shared `QueryState`** — the cache entry keyed by the query key, initialized to 0 only at Query construction and incremented on every successful fetch by **any** observer (verified in `@tanstack/query-core@5.100.9` `src/query.ts`: `dataUpdateCount` is a `QueryState` field, bumped via `state.dataUpdateCount + 1` on the `success` action). It is not per-observer and is not reset when a new observer mounts; it persists for the life of the cache entry (`gcTime`).

For a poll on a **shared** key like `['subscriptions']` (which has ~6 other consumers plus several `invalidateQueries(['subscriptions'])` call sites), capping on `dataUpdateCount + errorUpdateCount >= N` means: on a develop page that has been open a while, the shared count is **already past the cap before the poll starts**, so the predicate returns `false` on its first evaluation and **the poll never runs** — silently defeating the fix for exactly the long-lived-session case.

Bound by **wall-clock elapsed time per hook instance** instead. Anchor the start in a `useRef` set on the first interval evaluation; the predicate takes `elapsedMs` as an argument and stays pure:

```ts
export const CONVERSION_POLL_INTERVAL_MS = 5000;
export const MAX_CONVERSION_POLL_DURATION_MS = 2 * 60 * 1000;

export function gateRefetchInterval(query: Query<SubscriptionQueryData>, elapsedMs: number): number | false {
  if (elapsedMs >= MAX_CONVERSION_POLL_DURATION_MS) return false;
  return query.state.data?.active ? false : CONVERSION_POLL_INTERVAL_MS;
}
```

```ts
const gateStartRef = useRef<number | null>(null);
const { data: subscription } = useSubscription({
  refetchInterval: (query) => {
    if (gateStartRef.current === null) gateStartRef.current = Date.now();
    const elapsedMs = Date.now() - gateStartRef.current;
    const next = gateRefetchInterval(query, elapsedMs);
    logPollExhaustion(next, elapsedMs, 'gate', query.state.data?.active != null, undefined);
    return next;
  },
});
```

A per-instance ref is immune to the shared-count problem and bounds the thing you actually care about ("give up after ~2 min"), not "number of fetches anyone made against this key."

### 2. The `refetchInterval` TIMER is per-observer — adding a poller to a shared key is safe

Do not conflate the timer with the count. In TanStack v5 each observer owns its own interval timer (`QueryObserver`'s private `#refetchIntervalId`, set/cleared per instance — `src/queryObserver.ts`). Mounting a polling observer on a shared query key does **not** change the refetch cadence for other consumers of that key, and there is no "shortest interval wins across observers" coalescing. So you can safely attach a dedicated poller to a key that already has non-polling consumers. (The bug in gotcha 1 is about the shared *count*; the *timer* genuinely is per-observer — both facts are true and must not be swapped.)

### 3. Log the stop-transition by wrapping the predicate at the call site — NOT in a `useEffect`

To emit a side effect (warn/metric) when polling stops *because it hit the bound* (vs. resolved), wrap the pure predicate at the `useQuery` call site and run the side effect there, where the live state/elapsed is in hand (see the wrapper in gotcha 1). The helper is guarded and deduped:

```ts
function logPollExhaustion(next, elapsedMs, layer, resolved, subscriptionId): void {
  if (next !== false) return;
  if (resolved) return;
  if (elapsedMs < MAX_CONVERSION_POLL_DURATION_MS) return;
  const key = subscriptionId ? `${layer}:${subscriptionId}` : layer;
  if (exhaustionLogged.has(key)) return;     // module-level Set, once per tab
  exhaustionLogged.add(key);
  logger.warn('conversion.poll.exhausted', { layer, subscriptionId, elapsedMs });
}
```

**Do NOT** do this from a `useEffect` reading update counts off the query result. That approach was tried first and shipped **zero logs**: the state change that crosses the bound does not reliably reach an effect-running re-render, and it is especially invisible under fake timers. The `refetchInterval` wrapper sees every interval evaluation including the terminal one; the effect does not.

### 4. Keep predicates pure and exported; test them directly

The predicates read only their arguments (`query`, `elapsedMs`, `subscriptionId`) and return only the interval — no enclosing-scope reads. That makes the stop logic trivially unit-testable with a minimal stand-in, no render and no timers:

```ts
function fakeQuery<T>(data: T | undefined): Query<T> {
  return { state: { data } } as unknown as Query<T>;
}
expect(gateRefetchInterval(fakeQuery({ subscriptions: [], active: null }), 0)).toBe(CONVERSION_POLL_INTERVAL_MS);
expect(gateRefetchInterval(fakeQuery({ subscriptions: [], active: null }), MAX_CONVERSION_POLL_DURATION_MS)).toBe(false);
```

### 5. Integration/wiring test: fake timers + mid-poll mock swap, then assert fetches FREEZE

Unit tests on pure predicates prove the logic; they do not prove the two `useQuery` configs are wired. Drive the real hook with `vi.useFakeTimers()` and swap the `mockAppFetch` implementation across ticks to simulate provisioning landing mid-poll (no subscription → trial → orderId), all in one `renderHook` lifecycle. `Date.now()` is controlled by fake timers, so the per-instance elapsed bound is deterministic.

```ts
let listActive: AiroSubscription | null = null;
let attrsValue: Record<string, unknown> = {};
mockAppFetch.mockImplementation((url, init) => { /* reads listActive / attrsValue per tick */ });

vi.useFakeTimers();
renderHook(() => useConversionEvent(), { wrapper });
// Phase 1: trial provisions; gate poll observes it, enables attributes query.
// Two intervals per phase: one to refetch the gate, one for the subscriptionId-change
// re-render -> attributes enable -> fetch chain. Single-tick assertions flake.
listActive = makeSubscription({ id });
await vi.advanceTimersByTimeAsync(CONVERSION_POLL_INTERVAL_MS);
await vi.advanceTimersByTimeAsync(CONVERSION_POLL_INTERVAL_MS);
// Phase 2: orderId lands -> fires once.
attrsValue = { orderId: `order-${id}`, conversionEventDate: null };
await vi.advanceTimersByTimeAsync(CONVERSION_POLL_INTERVAL_MS);
await vi.advanceTimersByTimeAsync(CONVERSION_POLL_INTERVAL_MS);
expect(mockFireConversionEvent).toHaveBeenCalledTimes(1);
// Phase 3: counts must FREEZE — catches a regression that returns the interval on success.
const after = countAttrFetches();
await vi.advanceTimersByTimeAsync(CONVERSION_POLL_INTERVAL_MS * 3);
expect(countAttrFetches()).toBe(after);
```

The exhaustion test advances `ceil(MAX_DURATION / INTERVAL) + 1` ticks and asserts exactly one `conversion.poll.exhausted` warn for that layer — which only passes because the log lives in the wrapper, not an effect (gotcha 3).

### 6. Dedup an error-logging `useEffect` with a module-level Set — `refetchInterval` throws a FRESH error instance every tick

This is the inverse of gotcha 3. There, an effect keyed on a poll *count* under-logs (zero). Here, an effect keyed on the query *error object* over-logs: a `queryFn` that throws on failure produces a **new** `HttpError`/`Error` instance on every failed poll, so `attrsError` changes identity each ~5s tick and a `useEffect([attrsError, ...])` re-fires up to ~24x before the time cap. The spam buries the genuine "attributes fetch is failing" signal — which matters here because the conversion fire path only logs on failure, so this warn is a primary observability breadcrumb.

Guard it with a module-level `Set` keyed by the error's **distinguishing state**, check-before-log — the same shape as `exhaustionLogged` in gotcha 3:

```ts
const attributesErrorLogged = new Set<string>();   // module-level, once per tab

useEffect(() => {
  if (!attrsError) return;
  const status = attrsError instanceof HttpError ? attrsError.status : undefined;
  const key = `${subscriptionId}:${status}`;        // entity + distinguishing state
  if (attributesErrorLogged.has(key)) return;
  attributesErrorLogged.add(key);
  logger.warn('conversion.attributes.error', { subscriptionId, status, error: attrsError instanceof Error ? attrsError.message : 'Unknown error' });
}, [attrsError, subscriptionId]);
```

Key granularity is the real decision: too coarse (`subscriptionId` alone) silently swallows a genuine state transition like 403 → 500; the error instance itself is too fine and defeats the guard (every tick is distinct). `${subscriptionId}:${status}` re-logs on a status change (intentional — it's a new failure mode) but suppresses identical-status spam. Verified by a fake-timer test: 6 failing 5s ticks → exactly 1 warn (the un-deduped effect logged 6).

## Why This Matters

- **Shared-count bounding (gotcha 1)** is a silent correctness bug: the poll appears implemented and tested, but never runs on a long-open page, so the race it was built to fix stays broken in production for that session. It was caught only by tracing where `dataUpdateCount` is stored in query-core source. The trap is seductive because "read the count off query state, no ref needed" looks cleaner than a wall-clock ref.
- **Per-observer timer fact (gotcha 2)** prevents the opposite error: refusing a needed second observer for fear it changes cadence for everyone (it does not).
- **Wrapper-vs-effect (gotcha 3)** is the expensive observability bug: the effect approach shipped zero exhaustion logs. For a revenue event whose fire path only logs on failure, the exhaustion warn is the only client signal distinguishing "never provisioned" from "fired silently."
- **Pure exported predicates (gotcha 4)** turn the hard part into trivial unit tests, leaving only the wiring for the timer-heavy integration test.
- **Error-log dedup (gotcha 6)** is the symmetric trap to gotcha 3: the same effect-keyed-on-changing-query-state mistake that under-logs an exhaustion breadcrumb over-logs an error when the key is a fresh-per-tick error object. Both are fixed by moving the dedup decision into a module-level Set keyed on stable state, and the key's granularity must re-log real transitions while suppressing identical repeats.

## When to Apply

- Any hook polling a TanStack query until an async backend state lands.
- Any time you bound a poll on a **shared** query key — bound by per-instance elapsed time, never by `dataUpdateCount`. (A per-instance attempt counter in a `useRef` is also fine; the shared `query.state` count is the thing to avoid.)
- Any time you need a side effect on the poll-stop transition — wrap the predicate, never use an effect on the count.
- Any time a polled query's `queryFn` throws on failure AND an effect or callback logs/acts on that error — dedup with a module-level Set keyed on the error's distinguishing state, not the error object (gotcha 6).
- When adding a poller to a query key that already has consumers — rely on per-observer timers; do not refactor everyone to share one interval.
- Prefer this over the wall-clock `useState`/`useRef`-toggle idiom (`useSubscriptionWithPolling.ts`) for new pollers; that hook is the contrast case (it bounds correctly by wall-clock, but carries more mutable state and splits the stop logic across an effect).

## Examples

**Anti-pattern A — cap on the shared count (silently never polls on a long-open page):**

```ts
// dataUpdateCount is on the SHARED ['subscriptions'] cache entry, already past the
// cap from other consumers + invalidations -> returns false on first evaluation.
export function gateRefetchInterval(query) {
  if (query.state.dataUpdateCount + query.state.errorUpdateCount >= 24) return false;
  return query.state.data?.active ? false : 5000;
}
```

**Anti-pattern B — exhaustion log in a useEffect (ships zero logs):**

```ts
const { data, dataUpdateCount } = useSubscription({ refetchInterval: gateRefetchInterval });
useEffect(() => {
  if (dataUpdateCount >= 24 && !data?.active) {
    logger.warn('conversion.poll.exhausted', { layer: 'gate' }); // never fires
  }
}, [dataUpdateCount, data]);
```

**Anti-pattern C — error log in a useEffect keyed on the error object (spams ~24x):**

```ts
// fetchSubscriptionWithAttributes throws a NEW HttpError every failed poll, so
// attrsError changes identity each tick -> the effect re-fires ~24x before the cap.
useEffect(() => {
  if (attrsError) {
    logger.warn('conversion.attributes.error', { subscriptionId, error: attrsError.message });
  }
}, [attrsError, subscriptionId]);
```

**Correct — per-instance elapsed bound + wrapper-logged exhaustion (gotcha 1, 3) + Set-deduped error log (gotcha 6):** see the snippets in Guidance 1, 3, and 6. Source: `app/src/hooks/useConversionEvent.ts` (PR #4270).

## Related

- `docs/solutions/design-patterns/signalsdatalayer-conversion-event-pattern-2026-04-23.md` — the specific conversion-event consumer (dedup, payload, single wiring point). Its R3/R4 "stale-cache-refresh is the reliable trigger" narrative predates this polling fix and is a refresh candidate.
- `docs/solutions/best-practices/cds-purchase-callback-reliability-patterns-2026-04-15.md` — imperative-polling sibling (guard before polling, propagate timeout).
- `docs/solutions/integration-issues/conversion-event-wrong-schema-2026-05-01.md` — the "client push never errors" silent-failure that motivates exhaustion logging.
- `docs/solutions/workflow-issues/testing-mgmt-airo-dependent-features-2026-04-24.md` — how to reproduce the provisioning race with a brand-new test account.
- `app/src/hooks/useSubscriptionWithPolling.ts` — the wall-clock `useState`/`useRef` contrast idiom.
- PR #4270 — the fix this pattern was extracted from.
