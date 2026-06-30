/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('@/lib/request-context', () => ({
  logger: mockLogger,
}));

const mockStoreState = vi.hoisted(() => ({
  isSsoLoginOpen: false,
  openSsoLogin: vi.fn(),
  closeSsoLogin: vi.fn(),
  setSsoAuthReason: vi.fn(),
  setRedirectUrl: vi.fn(),
  setInFlightReauth: vi.fn(),
  redirectUrl: null,
  ssoCloseReason: null as string | null,
}));

vi.mock('@/stores/useAuthUIStore', () => ({
  useAuthUIStore: Object.assign(
    (selector?: (s: typeof mockStoreState) => unknown) =>
      selector ? selector(mockStoreState) : mockStoreState,
    {
      getState: () => mockStoreState,
      subscribe: vi.fn(() => vi.fn()),
    },
  ),
}));

vi.mock('@/utils/getRootDomain', () => ({
  getRootDomain: () => 'godaddy.com',
}));

vi.mock('./features', () => ({
  auth: { authType: 'jwt' },
}));

vi.mock('./customer-auth', () => ({
  SHOPPER_AUTH_FAILURE_MESSAGE: 'auth_failure',
}));

let mockSwitchboardValue: boolean | undefined = undefined;
vi.mock('@/hooks/useSwitchboard', () => ({
  getSwitchboardFlag: () => mockSwitchboardValue,
  useSwitchboard: () => mockSwitchboardValue,
}));

vi.mock('@/config/switchboard-flags', () => ({
  SWITCHBOARD_APPBUILDER_WAKE_AWARE_VAT_RECOVERY: 'appbuilder-wake-aware-vat-recovery',
}));

vi.mock('@airo/shared/auth', () => ({
  SUPPORTED_AUTH_TYPES: ['jwt'],
}));

vi.mock('@/utils/common', () => ({
  sleep: vi.fn(() => Promise.resolve()),
}));

function make401(authReason: number = 3): Response {
  return new Response(JSON.stringify({ authReason }), { status: 401 });
}

function make200(): Response {
  return new Response('{}', { status: 200 });
}

describe('recoverStaleVat wake-aware extension', function vatRecoveryWakeTests() {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(function setup() {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.clearAllMocks();
    mockSwitchboardValue = undefined;
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    vi.resetModules();
  });

  afterEach(function teardown() {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('uses default 3-attempt budget when flag is off', async function defaultBudget() {
    mockSwitchboardValue = false;

    const { resolveAuth } = await import('@/lib/gasket-config');

    fetchSpy.mockResolvedValueOnce(make401());
    fetchSpy.mockResolvedValue(make401());

    const promise = resolveAuth({ level: 2 });
    // Advance past all sleep() calls (mocked to resolve immediately, but
    // microtasks need flushing).
    await vi.advanceTimersByTimeAsync(100);

    expect(mockLogger.warn).toHaveBeenCalledWith(
      'app-fetch.auth-resolve.vat-recovery-exhausted',
      expect.objectContaining({ attempts: 3, wakeExtended: false }),
    );

    // Promise is now waiting on SSO modal — abandon cleanly.
    void promise.catch(() => {});
  });

  it('uses extended 7-attempt budget when flag is on and within wake window', async function extendedBudget() {
    mockSwitchboardValue = true;

    const { resolveAuth, wakeTracker } = await import('@/lib/gasket-config');
    wakeTracker.mark();

    fetchSpy.mockResolvedValueOnce(make401());
    for (let i = 0; i < 6; i++) {
      fetchSpy.mockResolvedValueOnce(make401());
    }
    fetchSpy.mockResolvedValueOnce(make200());

    const result = await resolveAuth({ level: 2 });

    expect(result).toEqual({ kind: 'valid' });
    expect(mockLogger.info).toHaveBeenCalledWith(
      'app-fetch.auth-resolve.vat-recovered',
      expect.objectContaining({ attempts: 7, wakeExtended: true }),
    );
  });

  it('does not extend budget when flag is on but NOT in wake window', async function noExtensionOutsideWake() {
    mockSwitchboardValue = true;

    const { resolveAuth } = await import('@/lib/gasket-config');
    // No wakeTracker.mark() — timestamp stays at 0, outside 15s window.

    fetchSpy.mockResolvedValueOnce(make401());
    fetchSpy.mockResolvedValue(make401());

    const promise = resolveAuth({ level: 2 });
    await vi.advanceTimersByTimeAsync(100);

    expect(mockLogger.warn).toHaveBeenCalledWith(
      'app-fetch.auth-resolve.vat-recovery-exhausted',
      expect.objectContaining({ attempts: 3, wakeExtended: false }),
    );

    void promise.catch(() => {});
  });

  it('recovers after a probe throws (network error in just-online window)', async function probeThrowRecovery() {
    mockSwitchboardValue = true;

    const { resolveAuth, wakeTracker } = await import('@/lib/gasket-config');
    wakeTracker.mark();

    // Initial probe: 401
    fetchSpy.mockResolvedValueOnce(make401());
    // Attempt 1: network error (fetch rejects)
    fetchSpy.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    // Attempt 2: network error again
    fetchSpy.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    // Attempt 3: success
    fetchSpy.mockResolvedValueOnce(make200());

    const result = await resolveAuth({ level: 2 });

    expect(result).toEqual({ kind: 'valid' });
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'app-fetch.auth-resolve.vat-recovery-probe-error',
      expect.objectContaining({ level: 2, attempt: 1 }),
    );
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'app-fetch.auth-resolve.vat-recovery-probe-error',
      expect.objectContaining({ level: 2, attempt: 2 }),
    );
    expect(mockLogger.info).toHaveBeenCalledWith(
      'app-fetch.auth-resolve.vat-recovered',
      expect.objectContaining({ attempts: 3, wakeExtended: true }),
    );
  });

  it('does not throw when all recovery probes reject (graceful exhaustion)', async function allProbesThrowExhaustion() {
    mockSwitchboardValue = true;

    const { resolveAuth, wakeTracker } = await import('@/lib/gasket-config');
    wakeTracker.mark();

    // Initial probe: 401 with VAT authReason (3) to enter recoverStaleVat
    fetchSpy.mockResolvedValueOnce(make401());
    // All subsequent probes in recoverStaleVat throw network errors
    fetchSpy.mockRejectedValue(new TypeError('Failed to fetch'));

    const promise = resolveAuth({ level: 2 });
    await vi.advanceTimersByTimeAsync(100);

    // recoverStaleVat returned false — resolveAuth proceeds to SSO modal (does NOT reject)
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'app-fetch.auth-resolve.vat-recovery-exhausted',
      expect.objectContaining({ lastOutcome: 'error', wakeExtended: true }),
    );

    // Promise is now waiting on SSO modal — abandon cleanly.
    void promise.catch(() => {});
  });

  it('still extends budget at 14,999ms since wake (inside boundary)', async function wakeWindowEdgeInside() {
    mockSwitchboardValue = true;

    const { resolveAuth, wakeTracker } = await import('@/lib/gasket-config');
    wakeTracker.mark();

    // Advance to 14,999ms — just inside the 15s window (strict < comparison)
    vi.advanceTimersByTime(14_999);

    fetchSpy.mockResolvedValueOnce(make401());
    for (let i = 0; i < 6; i++) {
      fetchSpy.mockResolvedValueOnce(make401());
    }
    fetchSpy.mockResolvedValueOnce(make200());

    const result = await resolveAuth({ level: 2 });

    expect(result).toEqual({ kind: 'valid' });
    expect(mockLogger.info).toHaveBeenCalledWith(
      'app-fetch.auth-resolve.vat-recovered',
      expect.objectContaining({ attempts: 7, wakeExtended: true }),
    );
  });

  it('falls back to default budget at 15,001ms since wake (outside boundary)', async function wakeWindowEdgeOutside() {
    mockSwitchboardValue = true;

    const { resolveAuth, wakeTracker } = await import('@/lib/gasket-config');
    wakeTracker.mark();

    // Advance to 15,001ms — just outside the 15s window
    vi.advanceTimersByTime(15_001);

    fetchSpy.mockResolvedValueOnce(make401());
    fetchSpy.mockResolvedValue(make401());

    const promise = resolveAuth({ level: 2 });
    await vi.advanceTimersByTimeAsync(100);

    // Should fall back to default 3 attempts since we're outside the window
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'app-fetch.auth-resolve.vat-recovery-exhausted',
      expect.objectContaining({ attempts: 3, wakeExtended: false }),
    );

    void promise.catch(() => {});
  });

  it('responds to visibilitychange trigger', async function visibilityChangeTrigger() {
    mockSwitchboardValue = true;

    const { resolveAuth } = await import('@/lib/gasket-config');

    // Simulate visibilitychange → visible
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });
    document.dispatchEvent(new Event('visibilitychange'));

    fetchSpy.mockResolvedValueOnce(make401());
    for (let i = 0; i < 6; i++) {
      fetchSpy.mockResolvedValueOnce(make401());
    }
    fetchSpy.mockResolvedValueOnce(make200());

    const result = await resolveAuth({ level: 2 });

    expect(result).toEqual({ kind: 'valid' });
    expect(mockLogger.info).toHaveBeenCalledWith(
      'app-fetch.auth-resolve.vat-recovery-wake-extended',
      expect.objectContaining({ maxAttempts: 7 }),
    );
  });

  it('does not extend budget when flag is undefined (Switchboard unavailable)', async function flagUndefined() {
    mockSwitchboardValue = undefined;

    const { resolveAuth, wakeTracker } = await import('@/lib/gasket-config');
    wakeTracker.mark();

    fetchSpy.mockResolvedValueOnce(make401());
    fetchSpy.mockResolvedValue(make401());

    const promise = resolveAuth({ level: 2 });
    await vi.advanceTimersByTimeAsync(100);

    expect(mockLogger.warn).toHaveBeenCalledWith(
      'app-fetch.auth-resolve.vat-recovery-exhausted',
      expect.objectContaining({ attempts: 3, wakeExtended: false }),
    );

    void promise.catch(() => {});
  });
});

describe('resolveAuth wake-patience (probe timeout path)', function probeTimeoutTests() {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(function setup() {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.clearAllMocks();
    mockSwitchboardValue = undefined;
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    vi.resetModules();
  });

  afterEach(function teardown() {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('probe timeout during wake → attempts recoverStaleVat → succeeds', async function timeoutWakeRecovery() {
    mockSwitchboardValue = true;

    const { resolveAuth, wakeTracker } = await import('@/lib/gasket-config');
    wakeTracker.mark();

    // Initial probe times out (simulate by making fetch hang then abort)
    fetchSpy.mockImplementationOnce((_url: string, opts: RequestInit) => {
      return new Promise((_resolve, reject) => {
        opts.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      });
    });
    // recoverStaleVat retry probes: first fails, second succeeds
    fetchSpy.mockResolvedValueOnce(make401());
    fetchSpy.mockResolvedValueOnce(make200());

    // Need to advance past the 5s probe timeout
    const promise = resolveAuth({ level: 2 });
    await vi.advanceTimersByTimeAsync(6_000);

    const result = await promise;

    expect(result).toEqual({ kind: 'valid' });
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'app-fetch.auth-resolve.probe-timeout',
      expect.objectContaining({ level: 2, inWakeWindow: true }),
    );
  });

  it('probe timeout outside wake → goes straight to modal (no recovery)', async function timeoutNoWakeModal() {
    mockSwitchboardValue = true;

    const { resolveAuth } = await import('@/lib/gasket-config');
    // No wakeTracker.mark() — outside wake window

    fetchSpy.mockImplementationOnce((_url: string, opts: RequestInit) => {
      return new Promise((_resolve, reject) => {
        opts.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      });
    });

    const promise = resolveAuth({ level: 2 });
    await vi.advanceTimersByTimeAsync(6_000);

    expect(mockLogger.warn).toHaveBeenCalledWith(
      'app-fetch.auth-resolve.probe-timeout',
      expect.objectContaining({ level: 2, inWakeWindow: false }),
    );
    // Modal opened without attempting recovery
    expect(mockStoreState.openSsoLogin).toHaveBeenCalled();
    // Only the single probe call — no recoverStaleVat retries
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    void promise.catch(() => {});
  });

  it('probe timeout with flag OFF → goes straight to modal (matches main behavior)', async function timeoutFlagOffModal() {
    mockSwitchboardValue = false;

    const { resolveAuth, wakeTracker } = await import('@/lib/gasket-config');
    wakeTracker.mark(); // Even within wake window, flag OFF means no recovery

    fetchSpy.mockImplementationOnce((_url: string, opts: RequestInit) => {
      return new Promise((_resolve, reject) => {
        opts.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      });
    });

    const promise = resolveAuth({ level: 2 });
    await vi.advanceTimersByTimeAsync(6_000);

    expect(mockLogger.warn).toHaveBeenCalledWith(
      'app-fetch.auth-resolve.probe-timeout',
      expect.objectContaining({ level: 2, inWakeWindow: false }),
    );
    // Flag OFF: inWakeWindow is always false regardless of wakeTracker state
    expect(mockStoreState.openSsoLogin).toHaveBeenCalled();
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    void promise.catch(() => {});
  });
});

describe('resolveAuth wake-patience (null authReason path)', function nullAuthReasonTests() {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(function setup() {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.clearAllMocks();
    mockSwitchboardValue = undefined;
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    vi.resetModules();
  });

  afterEach(function teardown() {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('null authReason during wake → attempts recoverStaleVat → succeeds', async function nullReasonWakeRecovery() {
    mockSwitchboardValue = true;

    const { resolveAuth, wakeTracker } = await import('@/lib/gasket-config');
    wakeTracker.mark();

    // Initial probe: 401 with unparseable body (simulates WAF/proxy HTML)
    fetchSpy.mockResolvedValueOnce(
      new Response('<html>Access Denied</html>', {
        status: 401,
        headers: { 'Content-Type': 'text/html' },
      }),
    );
    // recoverStaleVat probes: first still 401, second succeeds
    fetchSpy.mockResolvedValueOnce(make401());
    fetchSpy.mockResolvedValueOnce(make200());

    const result = await resolveAuth({ level: 2 });

    expect(result).toEqual({ kind: 'valid' });
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'app-fetch.auth-resolve.body-parse-failed',
      expect.objectContaining({ level: 2 }),
    );
    expect(mockLogger.info).toHaveBeenCalledWith(
      'app-fetch.auth-resolve.vat-recovered',
      expect.objectContaining({ wakeExtended: true }),
    );
  });

  it('null authReason outside wake → goes straight to modal (no recovery)', async function nullReasonNoWakeModal() {
    mockSwitchboardValue = true;

    const { resolveAuth } = await import('@/lib/gasket-config');
    // No wakeTracker.mark() — outside wake window

    // 401 with HTML body → authReason null
    fetchSpy.mockResolvedValueOnce(
      new Response('<html>Access Denied</html>', {
        status: 401,
        headers: { 'Content-Type': 'text/html' },
      }),
    );

    const promise = resolveAuth({ level: 2 });
    await vi.advanceTimersByTimeAsync(100);

    // Should open SSO modal without attempting recovery
    expect(mockStoreState.openSsoLogin).toHaveBeenCalled();

    void promise.catch(() => {});
  });

  it('non-null non-VAT authReason during wake → goes to modal (not recoverable)', async function nonVatReasonDuringWake() {
    mockSwitchboardValue = true;

    const { resolveAuth, wakeTracker } = await import('@/lib/gasket-config');
    wakeTracker.mark();

    // 401 with authReason=1 (login required, NOT stale VAT)
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ authReason: 1 }), { status: 401 }),
    );

    const promise = resolveAuth({ level: 2 });
    await vi.advanceTimersByTimeAsync(100);

    // authReason 1 (login) is not recoverable — modal should open
    expect(mockStoreState.openSsoLogin).toHaveBeenCalled();

    void promise.catch(() => {});
  });

  it('null authReason with flag OFF → goes straight to modal (matches main behavior)', async function nullReasonFlagOffModal() {
    mockSwitchboardValue = false;

    const { resolveAuth, wakeTracker } = await import('@/lib/gasket-config');
    wakeTracker.mark(); // Within wake window but flag is OFF

    // 401 with unparseable body
    fetchSpy.mockResolvedValueOnce(
      new Response('<html>Access Denied</html>', {
        status: 401,
        headers: { 'Content-Type': 'text/html' },
      }),
    );

    const promise = resolveAuth({ level: 2 });
    await vi.advanceTimersByTimeAsync(100);

    // Flag OFF: null authReason always goes to modal, no recovery attempted
    expect(mockStoreState.openSsoLogin).toHaveBeenCalled();
    // Only the initial probe — no recoverStaleVat retries
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    void promise.catch(() => {});
  });

  it('null authReason at 14,999ms since wake → attempts recovery (inside boundary)', async function nullReasonWakeEdgeInside() {
    mockSwitchboardValue = true;

    const { resolveAuth, wakeTracker } = await import('@/lib/gasket-config');
    wakeTracker.mark();

    // Advance to 14,999ms — just inside the 15s window
    vi.advanceTimersByTime(14_999);

    // 401 with unparseable body
    fetchSpy.mockResolvedValueOnce(
      new Response('<html>Access Denied</html>', {
        status: 401,
        headers: { 'Content-Type': 'text/html' },
      }),
    );
    // recoverStaleVat: first retry succeeds
    fetchSpy.mockResolvedValueOnce(make200());

    const result = await resolveAuth({ level: 2 });

    expect(result).toEqual({ kind: 'valid' });
    expect(mockLogger.info).toHaveBeenCalledWith(
      'app-fetch.auth-resolve.vat-recovered',
      expect.objectContaining({ wakeExtended: true }),
    );
  });

  it('null authReason at 15,001ms since wake → goes straight to modal (outside boundary)', async function nullReasonWakeEdgeOutside() {
    mockSwitchboardValue = true;

    const { resolveAuth, wakeTracker } = await import('@/lib/gasket-config');
    wakeTracker.mark();

    // Advance to 15,001ms — just outside the 15s window
    vi.advanceTimersByTime(15_001);

    // 401 with unparseable body
    fetchSpy.mockResolvedValueOnce(
      new Response('<html>Access Denied</html>', {
        status: 401,
        headers: { 'Content-Type': 'text/html' },
      }),
    );

    const promise = resolveAuth({ level: 2 });
    await vi.advanceTimersByTimeAsync(100);

    // Outside wake window: null authReason goes directly to modal
    expect(mockStoreState.openSsoLogin).toHaveBeenCalled();
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    void promise.catch(() => {});
  });
});

describe('wakeTracker onlineManager gate', function onlineManagerGateTests() {
  beforeEach(function setup() {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.clearAllMocks();
    mockSwitchboardValue = undefined;
    vi.stubGlobal('fetch', vi.fn());
    vi.resetModules();
  });

  afterEach(function teardown() {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('delays setOnline by 1s when flag is ON (heartbeat head start)', async function delayWhenFlagOn() {
    mockSwitchboardValue = true;
    const mockSetEventListener: ReturnType<typeof vi.fn> = vi.fn();

    vi.doMock('@tanstack/react-query', () => ({
      onlineManager: { setEventListener: mockSetEventListener },
    }));

    await import('@/lib/gasket-config');
    // Flush the dynamic import's .then() microtask
    await vi.advanceTimersByTimeAsync(0);

    expect(mockSetEventListener).toHaveBeenCalledTimes(1);
    const listenerSetup: (setOnline: (online: boolean) => void) => () => void =
      mockSetEventListener.mock.calls[0][0];

    const mockSetOnline: ReturnType<typeof vi.fn> = vi.fn();
    listenerSetup(mockSetOnline);

    // Dispatch online event — triggers the handler registered by listenerSetup
    window.dispatchEvent(new Event('online'));

    // setOnline should NOT be called immediately (1s delay pending)
    expect(mockSetOnline).not.toHaveBeenCalled();

    // After 1s, setOnline fires
    await vi.advanceTimersByTimeAsync(1_000);
    expect(mockSetOnline).toHaveBeenCalledWith(true);
  });

  it('calls setOnline immediately when flag is OFF (no delay)', async function immediateWhenFlagOff() {
    mockSwitchboardValue = false;
    const mockSetEventListener: ReturnType<typeof vi.fn> = vi.fn();

    vi.doMock('@tanstack/react-query', () => ({
      onlineManager: { setEventListener: mockSetEventListener },
    }));

    await import('@/lib/gasket-config');
    await vi.advanceTimersByTimeAsync(0);

    expect(mockSetEventListener).toHaveBeenCalledTimes(1);
    const listenerSetup: (setOnline: (online: boolean) => void) => () => void =
      mockSetEventListener.mock.calls[0][0];

    const mockSetOnline: ReturnType<typeof vi.fn> = vi.fn();
    listenerSetup(mockSetOnline);

    window.dispatchEvent(new Event('online'));

    // Flag OFF: setOnline called immediately, no setTimeout delay
    expect(mockSetOnline).toHaveBeenCalledWith(true);
  });

  it('calls setOnline(false) on offline event', async function offlineHandler() {
    mockSwitchboardValue = true;
    const mockSetEventListener: ReturnType<typeof vi.fn> = vi.fn();

    vi.doMock('@tanstack/react-query', () => ({
      onlineManager: { setEventListener: mockSetEventListener },
    }));

    await import('@/lib/gasket-config');
    await vi.advanceTimersByTimeAsync(0);

    const listenerSetup: (setOnline: (online: boolean) => void) => () => void =
      mockSetEventListener.mock.calls[0][0];

    const mockSetOnline: ReturnType<typeof vi.fn> = vi.fn();
    listenerSetup(mockSetOnline);

    window.dispatchEvent(new Event('offline'));

    expect(mockSetOnline).toHaveBeenCalledWith(false);
  });
});
