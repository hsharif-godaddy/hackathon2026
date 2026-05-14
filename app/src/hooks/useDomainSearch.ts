import { useIntl } from 'react-intl';
import { useQuery } from '@tanstack/react-query';

import { appFetch } from '@/lib/gasket-config';
import { logger } from '@/lib/request-context';
import type { Product } from '@/types/domain-purchase';

/**
 * Raw result from the API — products stored as array to avoid Map churn on each query
 */
interface DomainSearchRawResult {
  domains: any[];
  products: Product[];
}

/**
 * Configuration for domain search hook
 */
export interface UseDomainSearchOptions {
  /** Brand name / search query */
  query: string;
  /** Maximum number of results to return */
  maxResults?: number;
  /** Whether the query is enabled */
  enabled?: boolean;
  /** Optional ISC (promo code) to pass through to FIND for offer-adjusted pricing */
  isc?: string;
}

/**
 * React Query hook for searching available domains
 *
 * Uses the /api/domains/search endpoint which proxies to GoDaddy Domain Find API.
 * Returns domain availability and pricing information.
 *
 * @param options - Search configuration options
 * @returns Query result with domains and products
 *
 * @example
 * ```typescript
 * const { data, isLoading, error } = useDomainSearch({
 *   query: 'mybrand',
 *   maxResults: 10,
 *   enabled: true
 * });
 * ```
 */
export function useDomainSearch({
  query,
  maxResults = 10,
  enabled = true,
  isc,
}: UseDomainSearchOptions) {
  const { locale } = useIntl();

  return useQuery({
    queryKey: ['domainSearch', query, maxResults, locale, isc],
    queryFn: async (): Promise<DomainSearchRawResult> => {
      if (!query?.trim()) {
        return { domains: [], products: [] };
      }

      logger.debug('domain-search.fetch.start', {
        query,
        maxResults,
        isc: isc ?? null,
      });

      const response = await appFetch('/api/domains/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          maxResults,
          market: locale,
          ...(isc ? { isc } : {}),
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error('domain-search.fetch.error', {
          status: response.status,
          error: errorText,
        });
        throw new Error(`Domain search failed: ${response.status}`);
      }

      const data = await response.json();

      logger.info('domain-search.fetch.success', {
        query,
        domainsFound: data.domains?.length || 0,
      });

      return {
        domains: data.domains || [],
        products: data.products || [],
      };
    },
    enabled: enabled && !!query?.trim(),
    staleTime: 30 * 1000, // 30 seconds - domain availability can change
    retry: 2,
  });
}

/**
 * Get the product/pricing info for a domain
 *
 * @param products - Products array from search result
 * @param productId - Product ID to look up
 * @returns Product with pricing info, or undefined if not found
 */
export function getProductForDomain(
  products: Product[],
  productId: number
): Product | undefined {
  return products.find(p => p.productId === productId);
}

/**
 * Format price for display
 *
 * @param price - Price value
 * @param currency - Currency code (default: USD)
 * @returns Formatted price string
 */
export function formatPrice(price: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
  }).format(price);
}
