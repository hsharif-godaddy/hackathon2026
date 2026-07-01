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

vi.mock('@/lib/gasket-config', () => ({
  getSsoHost: () => Promise.resolve('sso.godaddy.com'),
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

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.clearAllMocks();
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    reloadSpy = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, reload: reloadSpy },
    });
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('POSTs heartbeat then waits 2s then probes — reloads on 200', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('{"message":"Ok","code":1}', { status: 201 }));
    fetchSpy.mockResolvedValueOnce(new Response('{}', { status: 200 }));
    const controller: AbortController = new AbortController();

    const promise = awaitHeartbeatRecovery(controller.signal);

    await vi.advanceTimersByTimeAsync(2_000);
    const result = await promise;

    expect(result).toEqual({ recovered: true });
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://sso.godaddy.com/v1/api/token/ui_heartbeat',
      expect.objectContaining({ method: 'POST', credentials: 'include', signal: expect.any(AbortSignal) }),
    );
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
    fetchSpy.mockResolvedValueOnce(new Response('{"message":"Ok","code":1}', { status: 201 }));
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
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(mockLogger.info).toHaveBeenCalledWith(
      'auth.heartbeat-patience.recovered',
      { attempt: 1 },
    );
  });

  it('returns recovered=false when all retries exhausted', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('{"message":"Ok","code":1}', { status: 201 }));
    fetchSpy.mockResolvedValue(new Response('{}', { status: 401 }));
    const controller: AbortController = new AbortController();

    const promise = awaitHeartbeatRecovery(controller.signal);

    // 2s initial + 3 retry intervals (1s each)
    await vi.advanceTimersByTimeAsync(2_000 + 3_000);
    const result = await promise;

    expect(result).toEqual({ recovered: false });
    // 1 heartbeat + 4 probes = 5
    expect(fetchSpy).toHaveBeenCalledTimes(5);
    expect(reloadSpy).not.toHaveBeenCalled();
    expect(mockLogger.warn).toHaveBeenCalledWith('auth.heartbeat-patience.exhausted');
  });

  it('logs warning on network error and continues retrying', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('{"message":"Ok","code":1}', { status: 201 }));
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
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('stops probing when aborted mid-retry', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('{"message":"Ok","code":1}', { status: 201 }));
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
    // 1 heartbeat + 1 probe = 2
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(reloadSpy).not.toHaveBeenCalled();
  });

  it('waits for online event when navigator.onLine is false then POSTs heartbeat', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    fetchSpy.mockResolvedValueOnce(new Response('{"message":"Ok","code":1}', { status: 201 }));
    fetchSpy.mockResolvedValueOnce(new Response('{}', { status: 200 }));
    const controller: AbortController = new AbortController();

    const promise = awaitHeartbeatRecovery(controller.signal);

    // Nothing should happen yet — waiting for online
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetchSpy).not.toHaveBeenCalled();

    // Simulate WiFi reconnect
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    window.dispatchEvent(new Event('online'));

    // Two microticks: one for online handler, one for await getSsoHost()
    await Promise.resolve();
    await Promise.resolve();

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://sso.godaddy.com/v1/api/token/ui_heartbeat',
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    );

    await vi.advanceTimersByTimeAsync(2_000);
    const result = await promise;

    expect(result).toEqual({ recovered: true });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('POSTs heartbeat directly when navigator.onLine is true', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    fetchSpy.mockResolvedValueOnce(new Response('{"message":"Ok","code":1}', { status: 201 }));
    fetchSpy.mockResolvedValueOnce(new Response('{}', { status: 200 }));
    const controller: AbortController = new AbortController();

    const promise = awaitHeartbeatRecovery(controller.signal);

    await Promise.resolve();
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://sso.godaddy.com/v1/api/token/ui_heartbeat',
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    );

    await vi.advanceTimersByTimeAsync(2_000);
    const result = await promise;

    expect(result).toEqual({ recovered: true });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('continues to probe loop even if heartbeat POST fails', async () => {
    fetchSpy.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    fetchSpy.mockResolvedValueOnce(new Response('{}', { status: 200 }));
    const controller: AbortController = new AbortController();

    const promise = awaitHeartbeatRecovery(controller.signal);

    await Promise.resolve();
    await Promise.resolve();

    await vi.advanceTimersByTimeAsync(2_000);
    const result = await promise;

    expect(result).toEqual({ recovered: true });
  });

  it('proceeds after network wait timeout if online never fires', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    fetchSpy.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    fetchSpy.mockResolvedValue(new Response('{}', { status: 401 }));
    const controller: AbortController = new AbortController();

    const promise = awaitHeartbeatRecovery(controller.signal);

    // 5s network wait timeout + heartbeat POST attempt + 2s initial delay + 3s retries
    await vi.advanceTimersByTimeAsync(5_000 + 2_000 + 3_000);
    const result = await promise;

    expect(result).toEqual({ recovered: false });
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  });

  it('logs warning when heartbeat POST returns non-ok status', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('{}', { status: 401 }));
    fetchSpy.mockResolvedValueOnce(new Response('{}', { status: 200 }));
    const controller: AbortController = new AbortController();

    const promise = awaitHeartbeatRecovery(controller.signal);

    await vi.advanceTimersByTimeAsync(2_000);
    const result = await promise;

    expect(result).toEqual({ recovered: true });
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'auth.heartbeat-patience.heartbeat-error',
      { status: 401 },
    );
  });

  it('logs warning when heartbeat POST throws network error', async () => {
    fetchSpy.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    fetchSpy.mockResolvedValueOnce(new Response('{}', { status: 200 }));
    const controller: AbortController = new AbortController();

    const promise = awaitHeartbeatRecovery(controller.signal);

    await Promise.resolve();
    await Promise.resolve();

    await vi.advanceTimersByTimeAsync(2_000);
    const result = await promise;

    expect(result).toEqual({ recovered: true });
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'auth.heartbeat-patience.heartbeat-error',
      { error: 'Failed to fetch' },
    );
  });

  it('aborts heartbeat POST when signal fires during fetch', async () => {
    fetchSpy.mockImplementationOnce((_url: string, opts: { signal: AbortSignal }) => {
      return new Promise((_resolve, reject) => {
        opts.signal.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        });
      });
    });
    const controller: AbortController = new AbortController();

    const promise = awaitHeartbeatRecovery(controller.signal);

    // Let the heartbeat POST start
    await Promise.resolve();
    controller.abort();
    await Promise.resolve();
    await Promise.resolve();

    const result = await promise;

    expect(result).toEqual({ recovered: false });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(reloadSpy).not.toHaveBeenCalled();
  });
});
