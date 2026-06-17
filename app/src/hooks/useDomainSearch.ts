import { useRef } from 'react';
import { useIntl } from 'react-intl';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { buildDynamicAgentUrl } from '@/config/dynamic-api';
import { agentFetch } from '@/lib/agent-fetch';
import { appFetch } from '@/lib/gasket-config';
import { logger } from '@/lib/request-context';
import type { DomainSearchResult, Product } from '@/types/domain-purchase';

export interface UseDomainSearchOptions {
  /** Brand name / search query */
  query: string;
  /**
   * Site identifier (typically the appId). When provided, the hook always calls
   * the agent service to fetch LLM-generated brandable seeds before hitting the BFF.
   * When omitted, the hook falls back to today's single-call behavior.
   */
  siteId?: string;
  /**
   * Natural-language prompt for LLM seed generation. When the search query is
   * a sanitized slug (e.g. "mycoffeeshop"), pass the original brand name here.
   */
  seedPrompt?: string;
  /** Maximum number of results to return */
  maxResults?: number;
  /** Whether the query is enabled */
  enabled?: boolean;
  /** Optional ISC (promo code) to pass through to FIND for offer-adjusted pricing */
  isc?: string;
}

const SEED_AGENT_TIMEOUT_MS = 10_000;
const SEED_POSITIVE_CACHE_TTL_MS = 30_000;

/**
 * Decide whether the input warrants LLM seed generation.
 * Single-word short brands skip the LLM and use the buildSpinsQuery path in the BFF.
 */
function shouldRequestSeeds(query: string): boolean {
  const trimmed = query.trim();
  const wordCount = trimmed.split(/\s+/).filter(Boolean).length;
  return wordCount >= 2 || trimmed.length > 20;
}

/**
 * Best-effort agent call: returns up to 4 brandable seeds, or null on
 * any failure (timeout, http error, network error, empty response).
 */
async function fetchDomainSeeds(prompt: string, siteId: string): Promise<string[] | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), SEED_AGENT_TIMEOUT_MS);

  try {
    const inner = async (): Promise<string[] | null> => {
      const url = await buildDynamicAgentUrl('apps/suggest-domain-seeds', siteId);
      const response = await agentFetch(url, {
        method: 'POST',
        siteId,
        body: JSON.stringify({ prompt }),
        signal: controller.signal,
      });

      if (!response.ok) {
        logger.info('domain-search.seeds.fallback', { reason: 'http-error', status: response.status });
        return null;
      }

      const data = await response.json();
      const seeds: unknown = data?.seeds;
      if (!Array.isArray(seeds) || seeds.length === 0) {
        logger.info('domain-search.seeds.fallback', { reason: 'empty' });
        return null;
      }

      return seeds.filter((s): s is string => typeof s === 'string' && s.length >= 3);
    };

    const timeout = new Promise<null>((resolve) => {
      controller.signal.addEventListener('abort', () => resolve(null), { once: true });
    });

    const innerPromise = inner();
    innerPromise.catch(() => {});
    return await Promise.race([innerPromise, timeout]);
  } catch (err) {
    const reason = (err as Error)?.name === 'AbortError' ? 'timeout' : 'network';
    logger.info('domain-search.seeds.fallback', { reason });
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * React Query hook for searching available domains
 *
 * Uses the /api/domains/search endpoint which proxies to GoDaddy Domain Find API.
 * When siteId is provided, fetches LLM-generated brandable seeds from the agent
 * service first and forwards them to the BFF for parallel findSpins fan-out.
 */
export function useDomainSearch({
  query,
  seedPrompt,
  siteId,
  maxResults = 10,
  enabled = true,
  isc,
}: UseDomainSearchOptions): UseQueryResult<DomainSearchResult, Error> {
  const { locale } = useIntl();
  const seedCacheRef = useRef<{ key: string; seeds: string[] | null; at: number } | null>(null);

  return useQuery<DomainSearchResult, Error>({
    queryKey: ['domainSearch', query, maxResults, locale, isc, siteId, seedPrompt],
    queryFn: async (): Promise<DomainSearchResult> => {
      if (!query?.trim()) {
        return { domains: [], products: [] };
      }

      logger.debug('domain-search.fetch.start', { query, maxResults, isc: isc ?? null });

      const effectivePrompt = seedPrompt?.trim() || query;
      const seedCacheKey = `${siteId}:${effectivePrompt}`;

      let seeds: string[] | null = null;
      if (siteId && shouldRequestSeeds(effectivePrompt)) {
        const cached = seedCacheRef.current;
        const cacheHit = cached?.key === seedCacheKey;
        const cacheFresh = cached ? (Date.now() - cached.at <= SEED_POSITIVE_CACHE_TTL_MS) : false;
        const useCached = cacheHit && cacheFresh && cached.seeds.length > 0;

        if (useCached) {
          seeds = cached.seeds;
        } else {
          logger.info('domain-search.seeds.begin', { siteId, promptLength: effectivePrompt.trim().length });
          seeds = await fetchDomainSeeds(effectivePrompt.trim(), siteId);
          if (seeds && seeds.length > 0) {
            seedCacheRef.current = { key: seedCacheKey, seeds, at: Date.now() };
          }
        }
      }

      const response = await appFetch('/api/domains/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          maxResults,
          market: locale,
          ...(isc ? { isc } : {}),
          ...(siteId ? { seedPrompt: effectivePrompt } : {}),
          ...(seeds && seeds.length > 0 ? { seeds } : {}),
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error('domain-search.fetch.error', { status: response.status, error: errorText });
        throw new Error(`Domain search failed: ${response.status}`);
      }

      const data = await response.json();
      logger.info('domain-search.fetch.success', {
        query,
        domainsFound: data.domains?.length || 0,
        seedsUsed: data.meta?.seedsUsed ?? (seeds && seeds.length > 0 ? 'llm' : 'fallback'),
        spinsResultCount: data.meta?.spinsResultCount,
        exactMatchCount: data.meta?.exactMatchCount,
      });

      return {
        domains: data.domains || [],
        products: data.products || [],
        meta: data.meta,
      };
    },
    enabled: enabled && !!query?.trim(),
    staleTime: 30 * 1000,
    retry: 2,
  });
}

/**
 * Get the product/pricing info for a domain
 */
export function getProductForDomain(products: Product[], productId: number): Product | undefined {
  return products.find(p => p.productId === productId);
}

/**
 * Format price for display
 */
export function formatPrice(price: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
  }).format(price);
}
