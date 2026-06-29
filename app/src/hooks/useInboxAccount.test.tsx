/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';

import { buildDynamicApiUrl } from '@/config/dynamic-api';
import { agentFetch } from '@/lib/agent-fetch';
import { appFetch } from '@/lib/gasket-config';
import { logger } from '@/lib/request-context';
import { POLL_WINDOW_MS, pollBackoffMs, useInboxAccount } from './useInboxAccount';

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

describe('pollBackoffMs', () => {
  it('polls fastest in the first 30s', () => {
    expect(pollBackoffMs(0)).toBe(3_000);
    expect(pollBackoffMs(29_999)).toBe(3_000);
  });

  it('eases to 7s between 30s and 90s', () => {
    expect(pollBackoffMs(30_000)).toBe(7_000);
    expect(pollBackoffMs(89_999)).toBe(7_000);
  });

  it('settles at 15s after 90s', () => {
    expect(pollBackoffMs(90_000)).toBe(15_000);
    expect(pollBackoffMs(POLL_WINDOW_MS)).toBe(15_000);
  });
});

const APP_ID = 'app-123';
const INBOX_ACCOUNT_URL = 'https://agent.example/apps/app-123/inbox-account';
const BRAND_URL = 'https://brand.reamaze.example/brand-1';
const BRAND_URL_2 = 'https://brand.reamaze.example/brand-2';
const ACCOUNT_URL = 'https://account.reamaze.example/account-1';

/** The JSON body the hook POSTs to persist both resolved pointers (key order is significant). */
const PERSIST_BODY = JSON.stringify({ accountId: ACCOUNT_URL, brandId: BRAND_URL });

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

/** A Reamaze account as returned by list_accounts; defaults to one linked to APP_ID. */
function account(
  overrides: Partial<{ accountUrl: string; brandUrl: string; aabAppId: string | null }> = {},
): { accountUrl: string; brandUrl: string; aabAppId: string | null } {
  return { accountUrl: ACCOUNT_URL, brandUrl: BRAND_URL, aabAppId: APP_ID, ...overrides };
}

function listAccountsResponse(accounts: unknown[]): Response {
  return mockResponse({ ok: true, json: { status: 200, data: { accounts } } });
}

/** agentFetch mock: returns the given inbox-account GET payload, and 200 for the POST persist. */
function mockAgentFetch(getPayload: {
  brandId: string | null;
  accountId: string | null;
  embeddableId?: number | null;
  categoryId?: number | string | null;
}): void {
  vi.mocked(agentFetch).mockImplementation(async (_url, options) => {
    if (options?.method === 'POST') {
      return mockResponse({ ok: true, json: { accountId: ACCOUNT_URL, brandId: BRAND_URL } });
    }
    return mockResponse({ ok: true, json: getPayload });
  });
}

/** Count of list_accounts (discovery read) calls. */
function listCallCount(): number {
  return vi.mocked(appFetch).mock.calls.filter(([url]) => url === '/api/inbox').length;
}

/** Count of persist POST calls to the agents memory route. */
function persistCallCount(): number {
  return vi.mocked(agentFetch).mock.calls.filter(
    ([url, options]) => url === INBOX_ACCOUNT_URL && options?.method === 'POST',
  ).length;
}

const persistPost = () =>
  expect(agentFetch).toHaveBeenCalledWith(
    INBOX_ACCOUNT_URL,
    expect.objectContaining({ siteId: APP_ID, method: 'POST', body: PERSIST_BODY }),
  );

describe('useInboxAccount backfill', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(buildDynamicApiUrl).mockResolvedValue(INBOX_ACCOUNT_URL);
  });

  it('discovers and persists both pointers on the first poll when the account already exists', async () => {
    mockAgentFetch({ brandId: BRAND_URL, accountId: null });
    vi.mocked(appFetch).mockResolvedValue(listAccountsResponse([account()]));

    renderHook(() => useInboxAccount(APP_ID), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(appFetch).toHaveBeenCalledWith(
        '/api/inbox',
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ operation: 'list_accounts' }) }),
      );
    });
    await waitFor(persistPost);
  });

  it('discovers when brandId is missing but accountId is present', async () => {
    mockAgentFetch({ brandId: null, accountId: ACCOUNT_URL });
    vi.mocked(appFetch).mockResolvedValue(listAccountsResponse([account()]));

    renderHook(() => useInboxAccount(APP_ID), { wrapper: createWrapper() });

    await waitFor(persistPost);
  });

  it('discovers when both pointers are missing', async () => {
    mockAgentFetch({ brandId: null, accountId: null });
    vi.mocked(appFetch).mockResolvedValue(listAccountsResponse([account()]));

    renderHook(() => useInboxAccount(APP_ID), { wrapper: createWrapper() });

    await waitFor(persistPost);
  });

  it('matches the account by aabAppId, not brandUrl', async () => {
    mockAgentFetch({ brandId: null, accountId: null });
    vi.mocked(appFetch).mockResolvedValue(
      listAccountsResponse([
        account({ accountUrl: 'https://account.reamaze.example/wrong', aabAppId: 'other-app' }),
        account({ brandUrl: BRAND_URL_2, aabAppId: APP_ID }),
      ]),
    );

    renderHook(() => useInboxAccount(APP_ID), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(agentFetch).toHaveBeenCalledWith(
        INBOX_ACCOUNT_URL,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ accountId: ACCOUNT_URL, brandId: BRAND_URL_2 }),
        }),
      );
    });
  });

  it('does not poll when both pointers are already present', async () => {
    mockAgentFetch({ brandId: BRAND_URL, accountId: ACCOUNT_URL });

    const { result } = renderHook(() => useInboxAccount(APP_ID), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.accountId).toBe(ACCOUNT_URL);
    });
    expect(appFetch).not.toHaveBeenCalled();
    expect(persistCallCount()).toBe(0);
  });

  it('surfaces embeddableId and categoryId from the account fetch', async () => {
    mockAgentFetch({ brandId: BRAND_URL, accountId: ACCOUNT_URL, embeddableId: 789, categoryId: 'support' });

    const { result } = renderHook(() => useInboxAccount(APP_ID), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.embeddableId).toBe(789);
    });
    expect(result.current.categoryId).toBe('support');
  });

  it('defaults embeddableId and categoryId to null when absent from the payload', async () => {
    mockAgentFetch({ brandId: BRAND_URL, accountId: ACCOUNT_URL });

    const { result } = renderHook(() => useInboxAccount(APP_ID), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.accountId).toBe(ACCOUNT_URL);
    });
    expect(result.current.embeddableId).toBeNull();
    expect(result.current.categoryId).toBeNull();
  });

  it('does not poll until the account fetch resolves', async () => {
    vi.mocked(agentFetch).mockImplementation((_url, options) => {
      if (options?.method === 'POST') {
        return Promise.resolve(mockResponse({ ok: true, json: { accountId: ACCOUNT_URL, brandId: BRAND_URL } }));
      }
      return new Promise<Response>(() => {}); // GET never resolves
    });
    vi.mocked(appFetch).mockResolvedValue(listAccountsResponse([account()]));

    renderHook(() => useInboxAccount(APP_ID), { wrapper: createWrapper() });

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(appFetch).not.toHaveBeenCalled();
  });

  it('treats a match missing brandUrl as not-found (no persist)', async () => {
    mockAgentFetch({ brandId: null, accountId: null });
    vi.mocked(appFetch).mockResolvedValue(listAccountsResponse([account({ brandUrl: '' })]));

    renderHook(() => useInboxAccount(APP_ID), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(listCallCount()).toBeGreaterThanOrEqual(1);
    });
    expect(persistCallCount()).toBe(0);
  });

  it('stops polling permanently after a successful persist', async () => {
    mockAgentFetch({ brandId: null, accountId: null });
    let persisted = false;
    vi.mocked(agentFetch).mockImplementation(async (_url, options) => {
      if (options?.method === 'POST') {
        persisted = true;
        return mockResponse({ ok: true, json: { accountId: ACCOUNT_URL, brandId: BRAND_URL } });
      }
      return mockResponse({ ok: true, json: { brandId: BRAND_URL, accountId: persisted ? ACCOUNT_URL : null } });
    });
    vi.mocked(appFetch).mockResolvedValue(listAccountsResponse([account()]));

    const { result } = renderHook(() => useInboxAccount(APP_ID), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.accountId).toBe(ACCOUNT_URL);
    });
    const callsAfterResolve = listCallCount();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(listCallCount()).toBe(callsAfterResolve);
  });

  it('polls until the worker account appears, then persists', async () => {
    vi.useFakeTimers();
    try {
      mockAgentFetch({ brandId: null, accountId: null });
      vi.mocked(appFetch)
        .mockResolvedValueOnce(listAccountsResponse([])) // first poll: not ready
        .mockResolvedValue(listAccountsResponse([account()])); // later polls: ready

      renderHook(() => useInboxAccount(APP_ID), { wrapper: createWrapper() });

      // Flush GET + the first discovery poll (no match).
      await act(async () => {
        await vi.advanceTimersByTimeAsync(50);
      });
      expect(persistCallCount()).toBe(0);
      expect(listCallCount()).toBeGreaterThanOrEqual(1);

      // Advance past the first backoff (3s) → second poll finds the account → persist fires.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3_500);
      });
      expect(persistCallCount()).toBe(1);
      persistPost();
    } finally {
      vi.useRealTimers();
    }
  });

  it('gives up after the poll window and logs once', async () => {
    vi.useFakeTimers();
    try {
      mockAgentFetch({ brandId: null, accountId: null });
      vi.mocked(appFetch).mockResolvedValue(listAccountsResponse([])); // never ready

      renderHook(() => useInboxAccount(APP_ID), { wrapper: createWrapper() });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(POLL_WINDOW_MS + 20_000);
      });

      expect(logger.info).toHaveBeenCalledWith(
        'inbox-account.backfill.give-up',
        expect.objectContaining({ appId: APP_ID }),
      );
      expect(persistCallCount()).toBe(0);

      const callsAtGiveUp = listCallCount();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });
      expect(listCallCount()).toBe(callsAtGiveUp); // no polling after give-up
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps polling through a transient list_accounts failure', async () => {
    vi.useFakeTimers();
    try {
      mockAgentFetch({ brandId: null, accountId: null });
      vi.mocked(appFetch)
        .mockResolvedValueOnce(mockResponse({ ok: false, status: 502, statusText: 'Bad Gateway' }))
        .mockResolvedValue(listAccountsResponse([account()]));

      renderHook(() => useInboxAccount(APP_ID), { wrapper: createWrapper() });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(50);
      });
      expect(logger.warn).toHaveBeenCalledWith(
        'inbox-account.backfill.poll.error',
        expect.objectContaining({ appId: APP_ID, error: expect.stringContaining('502') }),
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(3_500);
      });
      expect(persistCallCount()).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('retries a failing persist up to the mutation limit, then logs an error', async () => {
    vi.useFakeTimers();
    try {
      mockAgentFetch({ brandId: null, accountId: null });
      vi.mocked(agentFetch).mockImplementation(async (_url, options) => {
        if (options?.method === 'POST') {
          return mockResponse({ ok: false, status: 500, statusText: 'Internal Server Error' });
        }
        return mockResponse({ ok: true, json: { brandId: null, accountId: null } });
      });
      vi.mocked(appFetch).mockResolvedValue(listAccountsResponse([account()]));

      renderHook(() => useInboxAccount(APP_ID), { wrapper: createWrapper() });

      // Drive the match, then the mutation's retry backoffs (retry: 2 → 3 attempts).
      await act(async () => {
        await vi.advanceTimersByTimeAsync(20_000);
      });

      expect(logger.error).toHaveBeenCalledWith(
        'inbox-account.backfill.error',
        expect.objectContaining({ appId: APP_ID, error: expect.stringContaining('500') }),
      );
      expect(persistCallCount()).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });
});
