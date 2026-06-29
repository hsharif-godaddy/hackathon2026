/**
 * @vitest-environment jsdom
 *
 * Integration test: getAgentToken routes agent-token 401s through appFetch's
 * handle401 recovery (SSO modal + retry).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/request-context', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/stores/useBillingModeStore', () => ({
  useBillingModeStore: {
    getState: () => ({
      setMode: vi.fn(),
      clearMode: vi.fn(),
    }),
  },
}));

const domainRef = vi.hoisted(() => ({ value: 'godaddy.com' }));
vi.mock('@/utils/getRootDomain', () => ({
  getRootDomain: () => domainRef.value,
}));

function response401(body: unknown = { authReason: 1 }) {
  return new Response(
    typeof body === 'string' ? body : JSON.stringify(body),
    { status: 401, headers: { 'Content-Type': 'application/json' } }
  );
}

function response200(body: unknown = { ok: true }) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('getAgentToken handle401 integration', function integration() {
  beforeEach(function setup() {
    vi.resetModules();
    vi.useFakeTimers();
    domainRef.value = 'godaddy.com';
    (globalThis as unknown as { __gasketConfigCache?: unknown; __gasketConfigPromise?: unknown }).__gasketConfigCache = undefined;
    (globalThis as unknown as { __gasketConfigCache?: unknown; __gasketConfigPromise?: unknown }).__gasketConfigPromise = undefined;
  });

  afterEach(function teardown() {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('retries agent-token after successful SSO re-auth', async function retryAfterReauth() {
    const expires = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response401())
      .mockResolvedValueOnce(response401())
      .mockResolvedValueOnce(response200())
      .mockResolvedValueOnce(response200({
        token: 'fresh-agent-token',
        expires,
        siteId: 'app-123',
        type: 'jwt',
        budgetServiceEnabled: false,
      }));
    vi.stubGlobal('fetch', fetchMock);

    const { getAgentToken } = await import('@/lib/agent-fetch');
    const { useAuthUIStore } = await import('@/stores/useAuthUIStore');

    const promise = getAgentToken('app-123');
    await vi.advanceTimersByTimeAsync(0);
    expect(useAuthUIStore.getState().isSsoLoginOpen).toBe(true);

    useAuthUIStore.getState().closeSsoLogin('success');

    await expect(promise).resolves.toBe('fresh-agent-token');
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});
