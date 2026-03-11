import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { waitFor } from '@testing-library/react';

import { renderHookWithProviders } from '@/tests/test-utils';
import { formatPrice, getProductForDomain, useDomainSearch } from '../useDomainSearch';

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

const { appFetch } = await import('@/lib/gasket-config');
const mockAppFetch = vi.mocked(appFetch);

describe('useDomainSearch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should not fetch when query is empty', () => {
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
