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
