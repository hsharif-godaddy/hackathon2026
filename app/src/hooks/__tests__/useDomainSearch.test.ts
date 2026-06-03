/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { waitFor } from '@testing-library/react';

import { renderHookWithProviders } from '@/tests/test-utils';
import { formatPrice, getProductForDomain, useDomainSearch } from '../useDomainSearch';

vi.mock('@/lib/gasket-config', () => ({
  appFetch: vi.fn(),
}));

vi.mock('@/lib/agent-fetch', () => ({
  agentFetch: vi.fn(),
}));

vi.mock('@/config/dynamic-api', () => ({
  buildDynamicAgentUrl: vi.fn(async (endpoint: string, siteId: string) =>
    `https://agent.test/${siteId}/${endpoint}`
  ),
}));

vi.mock('@/lib/request-context', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const { appFetch } = await import('@/lib/gasket-config');
const { agentFetch } = await import('@/lib/agent-fetch');
const { buildDynamicAgentUrl } = await import('@/config/dynamic-api');
const mockAppFetch = vi.mocked(appFetch);
const mockAgentFetch = vi.mocked(agentFetch);
const mockBuildDynamicAgentUrl = vi.mocked(buildDynamicAgentUrl);

describe('useDomainSearch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should not fetch when query is empty string', () => {
    renderHookWithProviders(() => useDomainSearch({ query: '', enabled: true }));
    expect(mockAppFetch).not.toHaveBeenCalled();
  });

  it('should not fetch when disabled', () => {
    renderHookWithProviders(() => useDomainSearch({ query: 'mybrand', enabled: false }));
    expect(mockAppFetch).not.toHaveBeenCalled();
  });

  it('should fetch domains when query is provided', async () => {
    mockAppFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        domains: [{ fqdn: 'mybrand.com', productId: 1 }],
        products: [{ productId: 1, priceInfo: { currentPrice: 9.99 } }],
      }),
    } as Response);

    const { result } = renderHookWithProviders(() =>
      useDomainSearch({ query: 'mybrand', enabled: true })
    );

    await waitFor(() => {
      expect(result.current.data).toBeDefined();
    });

    expect(result.current.data?.domains).toHaveLength(1);
    expect(result.current.data?.domains[0].fqdn).toBe('mybrand.com');
    expect(result.current.data?.products).toHaveLength(1);
  });

  it('should call appFetch with correct error path', async () => {
    mockAppFetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'Internal error',
    } as Response);

    renderHookWithProviders(() =>
      useDomainSearch({ query: 'mybrand', enabled: true })
    );

    await waitFor(() => {
      expect(mockAppFetch).toHaveBeenCalledWith(
        '/api/domains/search',
        expect.objectContaining({ method: 'POST' })
      );
    });
  });

  it('should pass maxResults to the API', async () => {
    mockAppFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ domains: [], products: [] }),
    } as Response);

    renderHookWithProviders(() =>
      useDomainSearch({ query: 'mybrand', maxResults: 5, enabled: true })
    );

    await waitFor(() => {
      expect(mockAppFetch).toHaveBeenCalled();
    });

    const fetchCall = mockAppFetch.mock.calls[0];
    const body = JSON.parse((fetchCall[1] as any).body);
    expect(body.maxResults).toBe(5);
  });

  it('should send locale as market in request body', async () => {
    mockAppFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ domains: [], products: [] }),
    } as Response);

    renderHookWithProviders(
      () => useDomainSearch({ query: 'mybrand', enabled: true }),
      { locale: 'fr-FR' }
    );

    await waitFor(() => {
      expect(mockAppFetch).toHaveBeenCalled();
    });

    const body = JSON.parse((mockAppFetch.mock.calls[0][1] as any).body);
    expect(body.market).toBe('fr-FR');
  });

  it('should include locale in queryKey so cache differs per locale', async () => {
    mockAppFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ domains: [{ fqdn: 'a.com' }], products: [] }),
    } as Response);

    const sharedClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });

    renderHookWithProviders(
      () => useDomainSearch({ query: 'mybrand', enabled: true }),
      { locale: 'en-US', queryClient: sharedClient }
    );

    await waitFor(() => {
      expect(mockAppFetch).toHaveBeenCalledTimes(1);
    });

    mockAppFetch.mockClear();

    renderHookWithProviders(
      () => useDomainSearch({ query: 'mybrand', enabled: true }),
      { locale: 'es-MX', queryClient: sharedClient }
    );

    await waitFor(() => {
      expect(mockAppFetch).toHaveBeenCalledTimes(1);
    });
  });
});

describe('useDomainSearch — LLM seed pre-call', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAppFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ domains: [], products: [] }),
    } as Response);
  });

  function agentJson(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  it('does NOT call agentFetch for a single-word, short query', async () => {
    mockAgentFetch.mockResolvedValue(agentJson({ seeds: ['ignored'] }));

    renderHookWithProviders(() =>
      useDomainSearch({ query: 'cafe', siteId: 'site-1', enabled: true })
    );
    await waitFor(() => expect(mockAppFetch).toHaveBeenCalled());

    expect(mockAgentFetch).not.toHaveBeenCalled();
    const body = JSON.parse((mockAppFetch.mock.calls[0][1] as any).body);
    expect(body.seeds).toBeUndefined();
  });

  it('calls agentFetch when query has 2+ words and forwards seeds to BFF', async () => {
    mockAgentFetch.mockResolvedValue(agentJson({ seeds: ['coffeeshop', 'javabrew', 'beancafe', 'roastbar'] }));

    renderHookWithProviders(() =>
      useDomainSearch({ query: 'My coffee shop', siteId: 'site-1', enabled: true })
    );
    await waitFor(() => expect(mockAppFetch).toHaveBeenCalled());

    expect(mockBuildDynamicAgentUrl).toHaveBeenCalledWith('apps/suggest-domain-seeds', 'site-1');
    expect(mockAgentFetch).toHaveBeenCalledWith(
      'https://agent.test/site-1/apps/suggest-domain-seeds',
      expect.objectContaining({ method: 'POST', siteId: 'site-1' })
    );
    const body = JSON.parse((mockAppFetch.mock.calls[0][1] as any).body);
    expect(body.seeds).toEqual(['coffeeshop', 'javabrew', 'beancafe', 'roastbar']);
    expect(body.seedPrompt).toBe('My coffee shop');
  });

  it('calls agentFetch when query length > 20 chars (single token)', async () => {
    mockAgentFetch.mockResolvedValue(agentJson({ seeds: ['xx', 'yy'] }));

    renderHookWithProviders(() =>
      useDomainSearch({ query: 'superlongbrandnameneverends', siteId: 'site-1', enabled: true })
    );
    await waitFor(() => expect(mockAgentFetch).toHaveBeenCalled());
  });

  it('omits seeds when agent returns empty array', async () => {
    mockAgentFetch.mockResolvedValue(agentJson({ seeds: [] }));

    renderHookWithProviders(() =>
      useDomainSearch({ query: 'My coffee shop', siteId: 'site-1', enabled: true })
    );
    await waitFor(() => expect(mockAppFetch).toHaveBeenCalled());

    const body = JSON.parse((mockAppFetch.mock.calls[0][1] as any).body);
    expect(body.seeds).toBeUndefined();
  });

  it('omits seeds when agent returns non-2xx', async () => {
    mockAgentFetch.mockResolvedValue(agentJson({ error: 'oops' }, 500));

    renderHookWithProviders(() =>
      useDomainSearch({ query: 'My coffee shop', siteId: 'site-1', enabled: true })
    );
    await waitFor(() => expect(mockAppFetch).toHaveBeenCalled());

    const body = JSON.parse((mockAppFetch.mock.calls[0][1] as any).body);
    expect(body.seeds).toBeUndefined();
  });

  it('omits seeds when agentFetch throws (network error)', async () => {
    mockAgentFetch.mockRejectedValue(new Error('network'));

    renderHookWithProviders(() =>
      useDomainSearch({ query: 'My coffee shop', siteId: 'site-1', enabled: true })
    );
    await waitFor(() => expect(mockAppFetch).toHaveBeenCalled());

    const body = JSON.parse((mockAppFetch.mock.calls[0][1] as any).body);
    expect(body.seeds).toBeUndefined();
  });

  it('skips agentFetch when siteId is missing (existing behavior preserved)', async () => {
    mockAgentFetch.mockResolvedValue(agentJson({ seeds: ['aa', 'bb'] }));

    renderHookWithProviders(() =>
      useDomainSearch({ query: 'My coffee shop', enabled: true } as any)
    );
    await waitFor(() => expect(mockAppFetch).toHaveBeenCalled());

    expect(mockAgentFetch).not.toHaveBeenCalled();
    const body = JSON.parse((mockAppFetch.mock.calls[0][1] as any).body);
    expect(body.seeds).toBeUndefined();
    expect(body.seedPrompt).toBeUndefined();
  });

  it('aborts the agent call on timeout and falls through without seeds', async () => {
    // agentFetch never resolves on its own; relies on AbortController via signal.
    mockAgentFetch.mockImplementation((_url, opts: any) =>
      new Promise((_resolve, reject) => {
        opts?.signal?.addEventListener('abort', () => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      })
    );

    vi.useFakeTimers();

    renderHookWithProviders(() =>
      useDomainSearch({ query: 'My coffee shop', siteId: 'site-1', enabled: true })
    );

    // Advance past SEED_AGENT_TIMEOUT_MS (10_000) to fire the abort.
    await vi.advanceTimersByTimeAsync(10_100);

    vi.useRealTimers();

    await waitFor(() => expect(mockAppFetch).toHaveBeenCalled());

    expect(mockAgentFetch).toHaveBeenCalled();
    const body = JSON.parse((mockAppFetch.mock.calls[0][1] as any).body);
    expect(body.seeds).toBeUndefined();
  });
});

describe('getProductForDomain', () => {
  it('should find product by productId', () => {
    const products = [
      { productId: 1, priceInfo: { currentPrice: 9.99 } },
      { productId: 2, priceInfo: { currentPrice: 14.99 } },
    ] as any;

    expect(getProductForDomain(products, 2)?.priceInfo.currentPrice).toBe(14.99);
  });

  it('should return undefined for missing productId', () => {
    const products = [{ productId: 1, priceInfo: { currentPrice: 9.99 } }] as any;
    expect(getProductForDomain(products, 999)).toBeUndefined();
  });
});

describe('formatPrice', () => {
  it('should format USD price', () => {
    expect(formatPrice(9.99)).toBe('$9.99');
  });

  it('should format zero', () => {
    expect(formatPrice(0)).toBe('$0.00');
  });
});
