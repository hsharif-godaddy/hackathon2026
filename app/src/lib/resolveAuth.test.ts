/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/request-context', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const domainRef = vi.hoisted(() => ({ value: 'godaddy.com' }));
vi.mock('@/utils/getRootDomain', () => ({
  getRootDomain: () => domainRef.value,
}));

const AUTH_PROBE_TIMEOUT_MS = 5_000;
const AUTH_PREFLIGHT_TIMEOUT_MS = 5 * 60 * 1000;
const VAT_RECOVERY_DELAY_MS = 2_000;
const VAT_RECOVERY_MAX_ATTEMPTS = 3;

function response401(body: unknown = { authReason: 2 }) {
  return new Response(
    typeof body === 'string' ? body : JSON.stringify(body),
    { status: 401, headers: { 'Content-Type': typeof body === 'string' ? 'text/html' : 'application/json' } }
  );
}

function response200() {
  return new Response(null, { status: 200 });
}

describe('resolveAuth', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    domainRef.value = 'godaddy.com';
    (globalThis as unknown as { __gasketConfigCache?: unknown; __gasketConfigPromise?: unknown }).__gasketConfigCache = undefined;
    (globalThis as unknown as { __gasketConfigCache?: unknown; __gasketConfigPromise?: unknown }).__gasketConfigPromise = undefined;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('returns valid without opening modal when probe is ok', async () => {
    const { resolveAuth } = await import('@/lib/gasket-config');
    const { useAuthUIStore } = await import('@/stores/useAuthUIStore');

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response200()));

    const result = await resolveAuth({ level: 3 });

    expect(result).toEqual({ kind: 'valid' });
    expect(useAuthUIStore.getState().isSsoLoginOpen).toBe(false);
  });

  it('returns reauthed after probe→modal→verify success', async () => {
    const { resolveAuth } = await import('@/lib/gasket-config');
    const { useAuthUIStore } = await import('@/stores/useAuthUIStore');

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response401())
      .mockResolvedValueOnce(response200());
    vi.stubGlobal('fetch', fetchMock);

    const promise = resolveAuth({ level: 3 });
    await vi.advanceTimersByTimeAsync(0);
    expect(useAuthUIStore.getState().isSsoLoginOpen).toBe(true);

    useAuthUIStore.getState().closeSsoLogin('success');

    await expect(promise).resolves.toEqual({ kind: 'reauthed' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('returns dismissed when user closes modal', async () => {
    const { resolveAuth } = await import('@/lib/gasket-config');
    const { useAuthUIStore } = await import('@/stores/useAuthUIStore');

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response401()));

    const promise = resolveAuth({ level: 3 });
    await vi.advanceTimersByTimeAsync(0);

    useAuthUIStore.getState().closeSsoLogin('dismiss');

    await expect(promise).resolves.toEqual({ kind: 'dismissed' });
  });

  it('recovers a stale-vat 401 via spaced re-probe without opening the modal', async () => {
    const { resolveAuth } = await import('@/lib/gasket-config');
    const { useAuthUIStore } = await import('@/stores/useAuthUIStore');

    // Initial probe 401 (vat stale, authReason 3); the browser ui_heartbeat
    // refreshes the cookie out-of-band, so the next spaced re-probe succeeds.
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response401({ authReason: 3 }))
      .mockResolvedValueOnce(response200());
    vi.stubGlobal('fetch', fetchMock);

    const promise = resolveAuth({ level: 2 });
    await vi.advanceTimersByTimeAsync(VAT_RECOVERY_DELAY_MS);

    await expect(promise).resolves.toEqual({ kind: 'valid' });
    expect(useAuthUIStore.getState().isSsoLoginOpen).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('opens the modal once the stale-vat re-probe budget is exhausted', async () => {
    const { resolveAuth } = await import('@/lib/gasket-config');
    const { useAuthUIStore } = await import('@/stores/useAuthUIStore');

    // vat stays stale across the initial probe and every re-probe.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response401({ authReason: 3 })));

    const promise = resolveAuth({ level: 2 });
    // Drive all spaced re-probes to exhaust the budget.
    await vi.advanceTimersByTimeAsync(VAT_RECOVERY_DELAY_MS * VAT_RECOVERY_MAX_ATTEMPTS);

    expect(useAuthUIStore.getState().isSsoLoginOpen).toBe(true);

    useAuthUIStore.getState().closeSsoLogin('dismiss');
    await expect(promise).resolves.toEqual({ kind: 'dismissed' });
  });

  it('treats a re-probe network error as a failed attempt and keeps retrying', async () => {
    const { resolveAuth } = await import('@/lib/gasket-config');
    const { useAuthUIStore } = await import('@/stores/useAuthUIStore');

    // A transient blip (the just-online window this targets) must not abort
    // recovery / reject resolveAuth — it counts as a failed attempt.
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response401({ authReason: 3 }))    // initial probe
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))  // re-probe 1 throws
      .mockResolvedValueOnce(response200());                    // re-probe 2 ok
    vi.stubGlobal('fetch', fetchMock);

    const promise = resolveAuth({ level: 2 });
    await vi.advanceTimersByTimeAsync(VAT_RECOVERY_DELAY_MS * 2);

    await expect(promise).resolves.toEqual({ kind: 'valid' });
    expect(useAuthUIStore.getState().isSsoLoginOpen).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('falls through to the modal when every stale-vat re-probe times out', async () => {
    const { resolveAuth } = await import('@/lib/gasket-config');
    const { useAuthUIStore } = await import('@/stores/useAuthUIStore');

    // Guards the `probe !== 'timeout' && probe.ok` predicate: a hung validate
    // ('timeout') must never count as recovery.
    let call = 0;
    const fetchMock = vi.fn().mockImplementation(function (_url: string, init?: RequestInit) {
      call += 1;
      if (call === 1) return Promise.resolve(response401({ authReason: 3 }));
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'));
        });
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const promise = resolveAuth({ level: 2 });
    // Each attempt is a 2s delay + a 5s probe timeout.
    await vi.advanceTimersByTimeAsync(
      (VAT_RECOVERY_DELAY_MS + AUTH_PROBE_TIMEOUT_MS) * VAT_RECOVERY_MAX_ATTEMPTS
    );

    expect(useAuthUIStore.getState().isSsoLoginOpen).toBe(true);

    useAuthUIStore.getState().closeSsoLogin('dismiss');
    await expect(promise).resolves.toEqual({ kind: 'dismissed' });
  });

  it('does not re-probe (no delay) for non-vat 401s', async () => {
    const { resolveAuth } = await import('@/lib/gasket-config');
    const { useAuthUIStore } = await import('@/stores/useAuthUIStore');

    // authReason 2 (HBI) can't be self-refreshed by the heartbeat — modal
    // should open immediately, with no spaced re-probe.
    const fetchMock = vi.fn().mockResolvedValue(response401({ authReason: 2 }));
    vi.stubGlobal('fetch', fetchMock);

    const promise = resolveAuth({ level: 3 });
    await vi.advanceTimersByTimeAsync(0);

    expect(useAuthUIStore.getState().isSsoLoginOpen).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    useAuthUIStore.getState().closeSsoLogin('dismiss');
    await expect(promise).resolves.toEqual({ kind: 'dismissed' });
  });

  it('drives authReason from probe body so HBI failures route to /hbi', async () => {
    const { resolveAuth } = await import('@/lib/gasket-config');
    const { useAuthUIStore } = await import('@/stores/useAuthUIStore');

    // Probe returns level-3 HBI failure (authReason: 2)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response401({ authReason: 2 })));

    const promise = resolveAuth({ level: 3 });
    await vi.advanceTimersByTimeAsync(0);

    expect(useAuthUIStore.getState().ssoAuthReason).toBe(2);

    useAuthUIStore.getState().closeSsoLogin('dismiss');
    await expect(promise).resolves.toEqual({ kind: 'dismissed' });
  });

  it('opens modal with null authReason when probe body is not parseable JSON', async () => {
    const { resolveAuth } = await import('@/lib/gasket-config');
    const { useAuthUIStore } = await import('@/stores/useAuthUIStore');

    // WAF / proxy returns HTML 401 — JSON parse fails
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response401('<html>401</html>')));

    const promise = resolveAuth({ level: 3 });
    await vi.advanceTimersByTimeAsync(0);

    expect(useAuthUIStore.getState().isSsoLoginOpen).toBe(true);
    expect(useAuthUIStore.getState().ssoAuthReason).toBeNull();

    useAuthUIStore.getState().closeSsoLogin('dismiss');
    await expect(promise).resolves.toEqual({ kind: 'dismissed' });
  });

  it('returns failed for non-401 probe responses without opening modal', async () => {
    const { resolveAuth } = await import('@/lib/gasket-config');
    const { useAuthUIStore } = await import('@/stores/useAuthUIStore');

    const probeResp = new Response('boom', { status: 503 });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(probeResp));

    const result = await resolveAuth({ level: 3 });

    expect(result).toEqual({ kind: 'failed', response: probeResp, authReason: null });
    expect(useAuthUIStore.getState().isSsoLoginOpen).toBe(false);
  });

  it('returns failed when verify after SSO returns non-ok', async () => {
    const { resolveAuth } = await import('@/lib/gasket-config');
    const { useAuthUIStore } = await import('@/stores/useAuthUIStore');

    const verifyResp = response401();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response401())
      .mockResolvedValueOnce(verifyResp);
    vi.stubGlobal('fetch', fetchMock);

    const promise = resolveAuth({ level: 3 });
    await vi.advanceTimersByTimeAsync(0);
    useAuthUIStore.getState().closeSsoLogin('success');

    const result = await promise;
    expect(result).toEqual({ kind: 'failed', response: verifyResp, authReason: 2 });
  });

  it('opens modal with /login fallback when probe times out', async () => {
    const { resolveAuth } = await import('@/lib/gasket-config');
    const { useAuthUIStore } = await import('@/stores/useAuthUIStore');

    const fetchMock = vi.fn().mockImplementation(function (_url: string, init?: RequestInit) {
      // Hang the probe forever; AbortController will abort it after timeout
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'));
        });
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const promise = resolveAuth({ level: 3 });

    // Advance past probe timeout
    await vi.advanceTimersByTimeAsync(AUTH_PROBE_TIMEOUT_MS + 1);

    // Modal should now be open with null authReason (fallback to /login)
    expect(useAuthUIStore.getState().isSsoLoginOpen).toBe(true);
    expect(useAuthUIStore.getState().ssoAuthReason).toBeNull();

    useAuthUIStore.getState().closeSsoLogin('dismiss');
    await expect(promise).resolves.toEqual({ kind: 'dismissed' });
  });

  it('returns reauthed optimistically when verify times out after successful SSO', async () => {
    const { resolveAuth } = await import('@/lib/gasket-config');
    const { useAuthUIStore } = await import('@/stores/useAuthUIStore');

    let callCount = 0;
    const fetchMock = vi.fn().mockImplementation(function (_url: string, init?: RequestInit) {
      callCount += 1;
      if (callCount === 1) return Promise.resolve(response401());
      // Verify hangs until aborted
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'));
        });
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const promise = resolveAuth({ level: 3 });
    await vi.advanceTimersByTimeAsync(0);
    useAuthUIStore.getState().closeSsoLogin('success');

    // Advance past verify timeout
    await vi.advanceTimersByTimeAsync(AUTH_PROBE_TIMEOUT_MS + 1);

    await expect(promise).resolves.toEqual({ kind: 'reauthed' });
  });

  it('single-flights concurrent callers: one probe, one modal, one verify', async () => {
    const { resolveAuth } = await import('@/lib/gasket-config');
    const { useAuthUIStore } = await import('@/stores/useAuthUIStore');

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response401())
      .mockResolvedValueOnce(response200());
    vi.stubGlobal('fetch', fetchMock);

    const openSpy = vi.spyOn(useAuthUIStore.getState(), 'openSsoLogin');

    const p1 = resolveAuth({ level: 3 });
    const p2 = resolveAuth({ level: 3 });
    const p3 = resolveAuth({ level: 3 });

    await vi.advanceTimersByTimeAsync(0);

    expect(openSpy).toHaveBeenCalledTimes(1);

    useAuthUIStore.getState().closeSsoLogin('success');

    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
    expect(r1).toEqual({ kind: 'reauthed' });
    expect(r2).toEqual({ kind: 'reauthed' });
    expect(r3).toEqual({ kind: 'reauthed' });

    // Probe + verify only — concurrent callers shared the same in-flight resolution
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('clears pendingResolution after completion so a later 401 starts a fresh flow', async () => {
    const { resolveAuth } = await import('@/lib/gasket-config');
    const { useAuthUIStore } = await import('@/stores/useAuthUIStore');

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response401())
      .mockResolvedValueOnce(response200())
      .mockResolvedValueOnce(response401())
      .mockResolvedValueOnce(response200());
    vi.stubGlobal('fetch', fetchMock);

    const p1 = resolveAuth({ level: 3 });
    await vi.advanceTimersByTimeAsync(0);
    useAuthUIStore.getState().closeSsoLogin('success');
    await expect(p1).resolves.toEqual({ kind: 'reauthed' });

    // Reset close reason so the second flow sees a fresh state
    useAuthUIStore.setState({ ssoCloseReason: null });

    const p2 = resolveAuth({ level: 3 });
    await vi.advanceTimersByTimeAsync(0);
    useAuthUIStore.getState().closeSsoLogin('success');
    await expect(p2).resolves.toEqual({ kind: 'reauthed' });

    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('sets inFlightReauth when it opens the modal, and closeSsoLogin clears it', async () => {
    const { resolveAuth } = await import('@/lib/gasket-config');
    const { useAuthUIStore } = await import('@/stores/useAuthUIStore');

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response401())
      .mockResolvedValueOnce(response200());
    vi.stubGlobal('fetch', fetchMock);

    const promise = resolveAuth({ level: 3 });
    await vi.advanceTimersByTimeAsync(0);

    expect(useAuthUIStore.getState().isSsoLoginOpen).toBe(true);
    expect(useAuthUIStore.getState().inFlightReauth).toBe(true);

    useAuthUIStore.getState().closeSsoLogin('success');

    await expect(promise).resolves.toEqual({ kind: 'reauthed' });
    expect(useAuthUIStore.getState().inFlightReauth).toBe(false);
  });

  it('does NOT set inFlightReauth when the modal is already open from another caller', async () => {
    const { resolveAuth } = await import('@/lib/gasket-config');
    const { useAuthUIStore } = await import('@/stores/useAuthUIStore');

    // Simulate an explicit caller (useSsoSignIn / sso-debug) opening the modal first.
    useAuthUIStore.getState().openSsoLogin();
    expect(useAuthUIStore.getState().inFlightReauth).toBe(false);

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response401())
      .mockResolvedValueOnce(response200());
    vi.stubGlobal('fetch', fetchMock);

    const openSpy = vi.spyOn(useAuthUIStore.getState(), 'openSsoLogin');

    const promise = resolveAuth({ level: 3 });
    await vi.advanceTimersByTimeAsync(0);

    // Preflight must NOT flip the explicit-open modal into in-flight mode,
    // and must not call openSsoLogin again (already a no-op, but guarded so
    // intent is explicit at the call site).
    expect(useAuthUIStore.getState().inFlightReauth).toBe(false);
    expect(openSpy).not.toHaveBeenCalled();

    useAuthUIStore.getState().closeSsoLogin('success');
    await expect(promise).resolves.toEqual({ kind: 'reauthed' });
  });

  it('returns failed with the original probe response when modal wait times out', async () => {
    const { resolveAuth } = await import('@/lib/gasket-config');
    const { useAuthUIStore } = await import('@/stores/useAuthUIStore');

    const probeResp = response401();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(probeResp));

    const promise = resolveAuth({ level: 3 });
    await vi.advanceTimersByTimeAsync(0);
    expect(useAuthUIStore.getState().isSsoLoginOpen).toBe(true);

    await vi.advanceTimersByTimeAsync(AUTH_PREFLIGHT_TIMEOUT_MS + 1);

    const result = await promise;
    // authPreflight relies on response identity to forward the original 401
    // back to its caller; lock that contract here.
    expect(result).toEqual({ kind: 'failed', response: probeResp, authReason: 2 });
    expect(useAuthUIStore.getState().isSsoLoginOpen).toBe(false);
  });
});
