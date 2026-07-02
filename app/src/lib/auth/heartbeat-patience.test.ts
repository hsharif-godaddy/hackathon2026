/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let mockSwitchboardValue: boolean | undefined = undefined;
let mockIsReturning: boolean = false;

vi.mock('@/config/switchboard-flags', () => ({
  SWITCHBOARD_APPBUILDER_WAKE_AWARE_VAT_RECOVERY: 'appbuilder-wake-aware-vat-recovery',
}));

vi.mock('@/hooks/useSwitchboard', () => ({
  getSwitchboardFlag: () => mockSwitchboardValue,
}));

vi.mock('@/lib/returningUser', () => ({
  isReturningUser: () => mockIsReturning,
}));

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));
vi.mock('@/lib/request-context', () => ({
  logger: mockLogger,
}));

import {
  awaitHeartbeatRecovery,
  HEARTBEAT_PATIENCE_RELOAD_KEY,
  shouldAttemptHeartbeatPatience,
} from './heartbeat-patience';

describe('shouldAttemptHeartbeatPatience', () => {
  beforeEach(() => {
    mockSwitchboardValue = true;
    mockIsReturning = true;
    sessionStorage.clear();
  });

  it('returns true when flag is on, user is returning, and no marker', () => {
    expect(shouldAttemptHeartbeatPatience()).toBe(true);
  });

  it('returns false when flag is off', () => {
    mockSwitchboardValue = false;
    expect(shouldAttemptHeartbeatPatience()).toBe(false);
  });

  it('returns false when flag is undefined', () => {
    mockSwitchboardValue = undefined;
    expect(shouldAttemptHeartbeatPatience()).toBe(false);
  });

  it('returns false for anonymous visitors (no returning-user cookie)', () => {
    mockIsReturning = false;
    expect(shouldAttemptHeartbeatPatience()).toBe(false);
  });

  it('returns false when sessionStorage marker is set', () => {
    sessionStorage.setItem(HEARTBEAT_PATIENCE_RELOAD_KEY, '1');
    expect(shouldAttemptHeartbeatPatience()).toBe(false);
  });
});

describe('awaitHeartbeatRecovery', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  let reloadSpy: ReturnType<typeof vi.fn>;
  let dispatchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.clearAllMocks();
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    // Heartbeat refresh is delegated to heartbeat-js dispatch() (window.heartbeat),
    // not a hand-rolled ui_heartbeat POST. dispatch never rejects — it resolves a
    // { status, serviceCode } result — so the recovery loop only depends on the probe.
    dispatchSpy = vi.fn().mockResolvedValue({ status: 201, serviceCode: 1 });
    vi.stubGlobal('heartbeat', { dispatch: dispatchSpy });
    reloadSpy = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, reload: reloadSpy },
    });
    // Reset onLine each test: vi.unstubAllGlobals does not revert
    // Object.defineProperty, so an onLine=false test would otherwise leak into
    // the next and push it down the 5s offline-wait branch.
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('dispatches heartbeat then waits 2s then probes — reloads on 200', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('{}', { status: 200 }));
    const controller: AbortController = new AbortController();

    const promise = awaitHeartbeatRecovery(controller.signal);

    await vi.advanceTimersByTimeAsync(2_000);
    const result = await promise;

    expect(result).toEqual({ recovered: true });
    expect(dispatchSpy).toHaveBeenCalledWith({ redirectOn401: false });
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/auth/validate?level=1',
      expect.objectContaining({ credentials: 'include' }),
    );
    expect(sessionStorage.getItem(HEARTBEAT_PATIENCE_RELOAD_KEY)).toBe('1');
    expect(reloadSpy).toHaveBeenCalled();
    expect(mockLogger.info).toHaveBeenCalledWith(
      'auth.heartbeat-patience.recovered',
      { attempt: 0 },
    );
  });

  it('retries on 401 and recovers on second attempt', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('{}', { status: 401 }));
    fetchSpy.mockResolvedValueOnce(new Response('{}', { status: 200 }));
    const controller: AbortController = new AbortController();

    const promise = awaitHeartbeatRecovery(controller.signal);

    // Initial 2s delay
    await vi.advanceTimersByTimeAsync(2_000);
    // 1s retry interval
    await vi.advanceTimersByTimeAsync(1_000);
    const result = await promise;

    expect(result).toEqual({ recovered: true });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(mockLogger.info).toHaveBeenCalledWith(
      'auth.heartbeat-patience.recovered',
      { attempt: 1 },
    );
  });

  it('returns recovered=false when all retries exhausted', async () => {
    fetchSpy.mockResolvedValue(new Response('{}', { status: 401 }));
    const controller: AbortController = new AbortController();

    const promise = awaitHeartbeatRecovery(controller.signal);

    // 2s initial + 3 retry intervals (1s each)
    await vi.advanceTimersByTimeAsync(2_000 + 3_000);
    const result = await promise;

    expect(result).toEqual({ recovered: false });
    // 4 probes (dispatch is not a fetch)
    expect(fetchSpy).toHaveBeenCalledTimes(4);
    expect(reloadSpy).not.toHaveBeenCalled();
    expect(mockLogger.warn).toHaveBeenCalledWith('auth.heartbeat-patience.exhausted');
  });

  it('logs warning on probe network error and continues retrying', async () => {
    fetchSpy.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    fetchSpy.mockResolvedValueOnce(new Response('{}', { status: 200 }));
    const controller: AbortController = new AbortController();

    const promise = awaitHeartbeatRecovery(controller.signal);

    await vi.advanceTimersByTimeAsync(2_000);
    await vi.advanceTimersByTimeAsync(1_000);
    const result = await promise;

    expect(result).toEqual({ recovered: true });
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'auth.heartbeat-patience.probe-error',
      expect.objectContaining({ attempt: 0, error: 'Failed to fetch' }),
    );
  });

  it('returns immediately when signal is already aborted', async () => {
    const controller: AbortController = new AbortController();
    controller.abort();

    const result = await awaitHeartbeatRecovery(controller.signal);

    expect(result).toEqual({ recovered: false });
    expect(dispatchSpy).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('stops probing when aborted mid-retry', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('{}', { status: 401 }));
    const controller: AbortController = new AbortController();

    const promise = awaitHeartbeatRecovery(controller.signal);

    // Advance past initial delay, first probe fires (401)
    await vi.advanceTimersByTimeAsync(2_000);

    // Abort during retry interval
    controller.abort();
    await vi.advanceTimersByTimeAsync(1_000);

    const result = await promise;

    expect(result).toEqual({ recovered: false });
    // 1 probe (dispatch is not a fetch)
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(reloadSpy).not.toHaveBeenCalled();
  });

  it('waits for online event when navigator.onLine is false then dispatches heartbeat', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    fetchSpy.mockResolvedValueOnce(new Response('{}', { status: 200 }));
    const controller: AbortController = new AbortController();

    const promise = awaitHeartbeatRecovery(controller.signal);

    // Nothing should happen yet — waiting for online
    await vi.advanceTimersByTimeAsync(1_000);
    expect(dispatchSpy).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();

    // Simulate WiFi reconnect
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    window.dispatchEvent(new Event('online'));

    // Flush the online-handler resolution so execution reaches the dispatch call
    await Promise.resolve();
    await Promise.resolve();

    expect(dispatchSpy).toHaveBeenCalledWith({ redirectOn401: false });

    await vi.advanceTimersByTimeAsync(2_000);
    const result = await promise;

    expect(result).toEqual({ recovered: true });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('dispatches heartbeat directly when navigator.onLine is true', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    fetchSpy.mockResolvedValueOnce(new Response('{}', { status: 200 }));
    const controller: AbortController = new AbortController();

    const promise = awaitHeartbeatRecovery(controller.signal);

    await Promise.resolve();
    expect(dispatchSpy).toHaveBeenCalledWith({ redirectOn401: false });

    await vi.advanceTimersByTimeAsync(2_000);
    const result = await promise;

    expect(result).toEqual({ recovered: true });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('continues to probe loop even if heartbeat dispatch reports failure', async () => {
    // Fire-and-forget: a failed refresh must not block or reject recovery.
    dispatchSpy.mockResolvedValue({ status: 0, error: true });
    fetchSpy.mockResolvedValueOnce(new Response('{}', { status: 200 }));
    const controller: AbortController = new AbortController();

    const promise = awaitHeartbeatRecovery(controller.signal);

    await vi.advanceTimersByTimeAsync(2_000);
    const result = await promise;

    expect(result).toEqual({ recovered: true });
  });

  it('skips heartbeat dispatch when window.heartbeat is absent and still probes', async () => {
    // Release-ordering guard: heartbeat-js dispatch() may not yet be on the CDN.
    vi.stubGlobal('heartbeat', undefined);
    fetchSpy.mockResolvedValueOnce(new Response('{}', { status: 200 }));
    const controller: AbortController = new AbortController();

    const promise = awaitHeartbeatRecovery(controller.signal);

    await vi.advanceTimersByTimeAsync(2_000);
    const result = await promise;

    expect(result).toEqual({ recovered: true });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('recovers when dispatch throws synchronously (malformed info_idp cookie)', async () => {
    // dispatch() runs synchronously up to a cookie decode that can throw URIError.
    // The try/catch guard must contain it so the probe loop + markAttempted still run.
    // function form dodges vitest arrow/constructor mock quirks.
    dispatchSpy.mockImplementation(function throwingDispatch(): never {
      throw new URIError('URI malformed');
    });
    fetchSpy.mockResolvedValueOnce(new Response('{}', { status: 200 }));
    const controller: AbortController = new AbortController();

    const promise = awaitHeartbeatRecovery(controller.signal);

    await vi.advanceTimersByTimeAsync(2_000);
    const result = await promise;

    expect(result).toEqual({ recovered: true });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(reloadSpy).toHaveBeenCalled();
    expect(sessionStorage.getItem(HEARTBEAT_PATIENCE_RELOAD_KEY)).toBe('1');
  });

  it('proceeds after network wait timeout if online never fires', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    fetchSpy.mockResolvedValue(new Response('{}', { status: 401 }));
    const controller: AbortController = new AbortController();

    const promise = awaitHeartbeatRecovery(controller.signal);

    // 5s network wait timeout + 2s initial delay + 3s retries
    await vi.advanceTimersByTimeAsync(5_000 + 2_000 + 3_000);
    const result = await promise;

    expect(result).toEqual({ recovered: false });
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  });
});
