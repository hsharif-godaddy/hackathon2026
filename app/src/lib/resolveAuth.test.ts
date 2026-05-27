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

    expect(result).toEqual({ kind: 'failed', response: probeResp });
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
    expect(result).toEqual({ kind: 'failed', response: verifyResp });
  });

  it('opens modal with /login fallback when probe times out', async () => {
    const { resolveAuth } = await import('@/lib/gasket-config');
    const { useAuthUIStore } = await import('@/stores/useAuthUIStore');

    const fetchMock = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
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
    const fetchMock = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
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
    expect(result).toEqual({ kind: 'failed', response: probeResp });
    expect(useAuthUIStore.getState().isSsoLoginOpen).toBe(false);
  });
});
