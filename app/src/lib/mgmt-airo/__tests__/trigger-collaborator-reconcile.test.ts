// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/request-context', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { startReconcilePolling, stopReconcilePolling } from '../trigger-collaborator-reconcile';

const APP = 'app-poll-01';
const POLL_INTERVAL_MS = 30_000;
const POLL_MAX_DURATION_MS = 5 * 60 * 1000;

const fetchMock = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ granted: 1, revoked: 0, grantFailures: 0 }) });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  // Cancel any loop so it can't leak across tests, then restore real timers.
  stopReconcilePolling(APP);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('startReconcilePolling', () => {
  it('reconciles immediately on a fresh start, then on every tick (no early-exit on granted > 0)', async () => {
    startReconcilePolling(APP);
    await vi.advanceTimersByTimeAsync(0); // flush the immediate reconcile
    expect(fetchMock).toHaveBeenCalledTimes(1); // immediate, on start

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(fetchMock).toHaveBeenCalledTimes(2); // tick 1 — granted:1 must NOT stop the loop

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(fetchMock).toHaveBeenCalledTimes(3); // tick 2

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('stops once the 5-minute deadline passes', async () => {
    startReconcilePolling(APP);
    await vi.advanceTimersByTimeAsync(POLL_MAX_DURATION_MS + POLL_INTERVAL_MS);
    const callsAtExpiry = fetchMock.mock.calls.length;
    expect(callsAtExpiry).toBeGreaterThan(0);

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3);
    expect(fetchMock.mock.calls.length).toBe(callsAtExpiry); // no further ticks
  });

  it('dedups: re-entry resets the single loop without stacking or re-firing immediately', async () => {
    startReconcilePolling(APP);
    await vi.advanceTimersByTimeAsync(0); // immediate reconcile (1)
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS / 2); // mid-interval, before first tick
    startReconcilePolling(APP); // loop active → reset deadline, NO extra immediate
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    // One immediate + one tick from the single (reset) loop — a stacked loop would over-count.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('stopReconcilePolling cancels future ticks', async () => {
    startReconcilePolling(APP);
    await vi.advanceTimersByTimeAsync(0); // immediate reconcile (1)
    stopReconcilePolling(APP);
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 4);
    expect(fetchMock).toHaveBeenCalledTimes(1); // only the immediate; no ticks after stop
  });

  it('does NOT resurrect the loop when stopped while a tick fetch is in-flight (race)', async () => {
    startReconcilePolling(APP);
    await vi.advanceTimersByTimeAsync(0); // immediate reconcile (1), resolves via default mock
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Make tick 1's fetch hang so we can call stop while it is in-flight.
    let releaseTick: (() => void) | undefined;
    const pending = new Promise((resolve) => {
      releaseTick = () => resolve({ ok: true, json: async () => ({ granted: 0 }) });
    });
    fetchMock.mockReturnValueOnce(pending);

    // Fire tick 1: the callback runs, passes the deadline check, and parks on the
    // hanging fetch inside doReconcileAndReport.
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(fetchMock).toHaveBeenCalledTimes(2); // tick 1 fetch started, in-flight

    // Panel unmounts / app changes mid-flight → clears activePolls.
    stopReconcilePolling(APP);

    // The in-flight fetch now resolves. The unguarded code would re-arm here;
    // the guard must see the loop was stopped and NOT schedule another tick.
    releaseTick!();
    await pending;

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 4);
    expect(fetchMock).toHaveBeenCalledTimes(2); // no ticks after the stopped in-flight one
  });

  it('keeps polling through the window even when a tick fails (non-ok response)', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    startReconcilePolling(APP);
    await vi.advanceTimersByTimeAsync(0); // immediate (1)
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(fetchMock).toHaveBeenCalledTimes(2); // a 500 does not stop the loop
  });
});
