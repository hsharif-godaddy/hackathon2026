/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';

import { buildDynamicApiUrl } from '@/config/dynamic-api';
import { agentFetch } from '@/lib/agent-fetch';
import { appFetch } from '@/lib/gasket-config';
import { logger } from '@/lib/request-context';
import { useInboxAccount } from './useInboxAccount';

vi.mock('@/config/dynamic-api', () => ({
  buildDynamicApiUrl: vi.fn(),
}));

vi.mock('@/lib/agent-fetch', () => ({
  agentFetch: vi.fn(),
}));

vi.mock('@/lib/gasket-config', () => ({
  appFetch: vi.fn(),
}));

vi.mock('@/lib/request-context', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const INBOX_ACCOUNT_URL = 'https://agent.example/apps/app-123/inbox-account';
const BRAND_URL = 'https://brand.reamaze.example/brand-1';
const ACCOUNT_URL = 'https://account.reamaze.example/account-1';

function mockResponse(init: { ok: boolean; status?: number; statusText?: string; json?: unknown }) {
  return {
    ok: init.ok,
    status: init.status ?? (init.ok ? 200 : 500),
    statusText: init.statusText ?? '',
    json: async () => init.json ?? {},
  } as unknown as Response;
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

/** agentFetch mock that returns the given inbox-account GET payload, and 200 for the POST backfill. */
function mockAgentFetch(getPayload: { brandId: string | null; accountId: string | null }) {
  vi.mocked(agentFetch).mockImplementation(async (_url, options) => {
    if (options?.method === 'POST') {
      return mockResponse({ ok: true, json: { accountId: ACCOUNT_URL } });
    }
    return mockResponse({ ok: true, json: getPayload });
  });
}

describe('useInboxAccount backfill', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(buildDynamicApiUrl).mockResolvedValue(INBOX_ACCOUNT_URL);
  });

  it('discovers and persists accountId when brandId exists but accountId is null', async () => {
    mockAgentFetch({ brandId: BRAND_URL, accountId: null });
    vi.mocked(appFetch).mockResolvedValue(
      mockResponse({ ok: true, json: { status: 200, data: { accounts: [{ accountUrl: ACCOUNT_URL, brandUrl: BRAND_URL }] } } }),
    );

    renderHook(() => useInboxAccount('app-123'), { wrapper: createWrapper() });

    // Lists accounts via the BFF (browser SSO → Reamaze).
    await waitFor(() => {
      expect(appFetch).toHaveBeenCalledWith(
        '/api/inbox',
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ operation: 'list_accounts' }) }),
      );
    });

    // Persists the matched accountUrl back to the agents memory route.
    await waitFor(() => {
      expect(agentFetch).toHaveBeenCalledWith(
        INBOX_ACCOUNT_URL,
        expect.objectContaining({ siteId: 'app-123', method: 'POST', body: JSON.stringify({ accountId: ACCOUNT_URL }) }),
      );
    });
  });

  it('does not discover when accountId is already present', async () => {
    mockAgentFetch({ brandId: BRAND_URL, accountId: ACCOUNT_URL });

    const { result } = renderHook(() => useInboxAccount('app-123'), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.accountId).toBe(ACCOUNT_URL);
    });

    expect(appFetch).not.toHaveBeenCalled();
    expect(agentFetch).not.toHaveBeenCalledWith(INBOX_ACCOUNT_URL, expect.objectContaining({ method: 'POST' }));
  });

  it('does not persist (and does not loop) when no account matches the brandId', async () => {
    mockAgentFetch({ brandId: BRAND_URL, accountId: null });
    vi.mocked(appFetch).mockResolvedValue(
      mockResponse({ ok: true, json: { status: 200, data: { accounts: [{ accountUrl: 'other', brandUrl: 'different-brand' }] } } }),
    );

    renderHook(() => useInboxAccount('app-123'), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(appFetch).toHaveBeenCalledTimes(1);
    });

    // No persist call, and the ref guard prevents re-attempting list_accounts.
    expect(agentFetch).not.toHaveBeenCalledWith(INBOX_ACCOUNT_URL, expect.objectContaining({ method: 'POST' }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(appFetch).toHaveBeenCalledTimes(1);
  });

  // The mutation retries transient failures (retry: 2 with backoff), so onError fires only
  // after the initial attempt plus two retries — hence the extended waitFor / per-test timeout.
  it('retries, then logs an error and does not persist when list_accounts keeps failing', async () => {
    mockAgentFetch({ brandId: BRAND_URL, accountId: null });
    vi.mocked(appFetch).mockResolvedValue(mockResponse({ ok: false, status: 502, statusText: 'Bad Gateway' }));

    renderHook(() => useInboxAccount('app-123'), { wrapper: createWrapper() });

    await waitFor(
      () => {
        expect(logger.error).toHaveBeenCalledWith(
          'inbox-account.backfill.error',
          expect.objectContaining({ appId: 'app-123', error: expect.stringContaining('502') }),
        );
      },
      { timeout: 8000 },
    );

    // list_accounts attempted 3 times (initial + 2 retries); the list failed every time, so
    // nothing is persisted back to agents memory.
    expect(appFetch).toHaveBeenCalledTimes(3);
    expect(agentFetch).not.toHaveBeenCalledWith(INBOX_ACCOUNT_URL, expect.objectContaining({ method: 'POST' }));
  }, 15000);

  it('retries, then logs an error when persisting the resolved accountId keeps failing', async () => {
    // GET resolves brandId/null; the persist POST fails on every attempt.
    vi.mocked(agentFetch).mockImplementation(async (_url, options) => {
      if (options?.method === 'POST') {
        return mockResponse({ ok: false, status: 500, statusText: 'Internal Server Error' });
      }
      return mockResponse({ ok: true, json: { brandId: BRAND_URL, accountId: null } });
    });
    vi.mocked(appFetch).mockResolvedValue(
      mockResponse({ ok: true, json: { status: 200, data: { accounts: [{ accountUrl: ACCOUNT_URL, brandUrl: BRAND_URL }] } } }),
    );

    renderHook(() => useInboxAccount('app-123'), { wrapper: createWrapper() });

    await waitFor(
      () => {
        expect(logger.error).toHaveBeenCalledWith(
          'inbox-account.backfill.error',
          expect.objectContaining({ appId: 'app-123', error: expect.stringContaining('500') }),
        );
      },
      { timeout: 8000 },
    );

    // The persist POST is attempted 3 times (initial + 2 retries) before onError fires.
    const persistCalls = vi.mocked(agentFetch).mock.calls.filter(
      ([url, options]) => url === INBOX_ACCOUNT_URL && options?.method === 'POST',
    );
    expect(persistCalls).toHaveLength(3);
  }, 15000);

  it('refetches and surfaces the new accountId after a successful backfill', async () => {
    // GET returns a null accountId until the backfill persists, then the invalidated
    // refetch surfaces the resolved accountId.
    let persisted = false;
    vi.mocked(agentFetch).mockImplementation(async (_url, options) => {
      if (options?.method === 'POST') {
        persisted = true;
        return mockResponse({ ok: true, json: { accountId: ACCOUNT_URL } });
      }
      return mockResponse({ ok: true, json: { brandId: BRAND_URL, accountId: persisted ? ACCOUNT_URL : null } });
    });
    vi.mocked(appFetch).mockResolvedValue(
      mockResponse({ ok: true, json: { status: 200, data: { accounts: [{ accountUrl: ACCOUNT_URL, brandUrl: BRAND_URL }] } } }),
    );

    const { result } = renderHook(() => useInboxAccount('app-123'), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.accountId).toBe(ACCOUNT_URL);
    });
  });
});
