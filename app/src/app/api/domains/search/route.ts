/**
 * Domain Search API Route
 *
 * SECURITY POSTURE:
 * ✅ Authentication required (withCustomerAuth middleware)
 * ✅ Per-customer in-memory rate limiting (30 req/min)
 * ✅ Upstream rate limiting enforced by GoDaddy APIs
 * ✅ API keys managed server-side (not exposed to client)
 * ✅ Input sanitization (strip invalid chars, collapse dots, length check)
 */

import { NextRequest, NextResponse } from 'next/server';
import { DomainServices } from '@site/domain-services';

import { type CustomerAuthContext, withCustomerAuth } from '@/lib/customer-auth';
import { normalizeIsc } from '@/lib/domain-offers/isc-config';
import { logger } from '@/lib/request-context';
import { checkSwitchboardFlag } from '@/lib/switchboard/server';
import { detectTranslationLocale } from '@/lib/translations';

export const dynamic = 'force-dynamic';

/**
 * Per-customer rate limiter (in-memory, resets on deploy)
 * Allows RATE_LIMIT_MAX requests per RATE_LIMIT_WINDOW_MS per customer.
 */
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 30;
const LOCALE_RE = /^[a-z]{2}-[A-Z]{2}$/;
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function isRateLimited(customerId: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(customerId);

  if (!entry || now >= entry.resetAt) {
    rateLimitMap.set(customerId, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }

  entry.count++;
  return entry.count > RATE_LIMIT_MAX;
}

/**
 * Get DomainServices environment from ENVIRONMENT_NAME
 */
function getDomainServicesEnv(): 'dev' | 'test' | 'prod' {
  const environmentName = process.env.ENVIRONMENT_NAME || 'production';

  // Map ENVIRONMENT_NAME to DomainServices env
  if (environmentName === 'production') return 'prod';
  if (environmentName === 'test') return 'test';
  if (environmentName === 'development' ||
    environmentName === 'pre-development' ||
    environmentName.startsWith('dev-')) {
    return 'dev';
  }

  return process.env.NODE_ENV === 'development' ? 'dev' : 'prod';
}

const MAX_SEEDS = 4;
const MAX_SEED_LENGTH = 24;
const MIN_SEED_LENGTH = 3;
// Mandatory for Entourage FIND context; the *_idp/isc/actpro/mbr/xpnes group drives shopper-aware pricing.
const ENTOURAGE_FORWARD_COOKIES = [
  'q',
  'key',
  'req_id',
  'market',
  'currency',
  'visitor',
  'auth_idp',
  'info_idp',
  'info_cust_idp',
  'isc',
  'actpro',
  'mbr',
  'xpnes',
] as const;
const ENTOURAGE_FORWARD_COOKIES_SET = new Set<string>(ENTOURAGE_FORWARD_COOKIES);
// Queries longer than this are multi-word concatenations
// Spins are surfaced first so brandable alternatives appear before the ungainly exact match.
const LONG_QUERY_THRESHOLD = 20;

interface FormattedSearchDomain {
  fqdn: string;
  sld: string;
  tld: string;
  availabilityCode: number;
  productId: number;
  isPremium: boolean;
  isExactMatch: boolean;
  priceDisplay?: string;
  _raw: unknown;
}

/**
 * Round-robin interleave N arrays so that each source gets equal representation
 * before the downstream maxResults cap is applied. Without this, a flat concat
 * would let the first seed consume all available slots when results-per-seed ≥ cap.
 */
function interleaveArrays(groups: any[][]): any[] {
  const result: any[] = [];
  const maxLen = Math.max(0, ...groups.map(g => g.length));
  for (let i = 0; i < maxLen; i++) {
    for (const group of groups) {
      if (i < group.length) result.push(group[i]);
    }
  }
  return result;
}

/**
 * Validate and sanitize a seeds[] array from the request body.
 * Returns at most 4 alphanumeric-only seeds, each 3–24 chars.
 * Threshold matches the agent service's parseSeeds floor so a future
 * caller passing too-short tokens cannot fan out to useless findSpins calls.
 */
function validateSeeds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const cleaned = item.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, MAX_SEED_LENGTH);
    if (cleaned.length >= MIN_SEED_LENGTH) out.push(cleaned);
    if (out.length === MAX_SEEDS) break;
  }
  return out;
}

/**
 * Condense a multi-word business name into a short brandable seed for findSpins.
 * findSpins generates good variations from short inputs but degrades badly with
 * long concatenated strings (e.g. "Sandbagger Steakhouse Lounge" sanitizes to
 * "sandbaggersteakhouselounge" and the API returns SandbaggerSteakhouseLounge.com
 * as the exact-looking suggestion). Take the first two words from the original
 * (pre-sanitize) input, sanitize, cap at 24 chars. Fall back to sanitizedQuery
 * if the seed is empty so single-word inputs and edge cases still work.
 */
function buildSpinsQuery(original: string, sanitized: string): string {
  const words: string[] = original.trim().split(/\s+/).filter(Boolean);
  if (words.length <= 1) return sanitized;
  const seed: string = words.slice(0, 2).join('')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 24);
  return seed.length >= MIN_SEED_LENGTH ? seed : sanitized;
}

// findExact/findSpins pass `options` through to fetch (see @site/domain-services Fetcher.js).
function filterEntourageCookies(cookieHeader: string): string {
  if (!cookieHeader) return '';

  return cookieHeader
    .split(';')
    .map(c => c.trim())
    .filter(c => ENTOURAGE_FORWARD_COOKIES_SET.has(c.split('=')[0]))
    .join('; ');
}

function getEntourageFetchOptions(request: NextRequest): { options?: { headers: { Cookie: string } } } {
  const forwarded = filterEntourageCookies(request.headers.get('cookie') || '');
  return forwarded ? { options: { headers: { Cookie: forwarded } } } : {};
}

function getDomainServices(market: string): DomainServices {
  const env = getDomainServicesEnv();

  // Key NAME (e.g. "domain-search-api-key-local-dummy-dev"), not the secret value.
  // @site/domain-services uses this name to look up the actual key server-side.
  const apiKeyName = process.env.DOMAIN_FIND_API_KEY;

  if (!apiKeyName) {
    logger.error('domains.search.missing-api-key', { message: 'DOMAIN_FIND_API_KEY not configured' });
    throw new Error('DOMAIN_FIND_API_KEY not configured');
  }

  return new DomainServices({
    fetchEntity: fetch,
    apiKey: apiKeyName,
    plid: '1',
    env,
    market,
    isServerCall: true,
  });
}

/**
 * POST /api/domains/search - Search for available domains
 *
 * Uses @site/domain-services to search for domain availability.
 * This keeps the API key server-side for security.
 *
 * @param request - Next.js request object with JSON body { query: string, maxResults?: number }
 * @param authContext - Customer authentication context
 * @returns Domain search results with pricing
 */
export const POST = withCustomerAuth(async (
  request: NextRequest,
  authContext: CustomerAuthContext
): Promise<NextResponse> => {
  try {
    const customerId = authContext.user?.customerId || 'anonymous';
    if (isRateLimited(customerId)) {
      logger.warn('domains.search.rate-limited', { customerId });
      return NextResponse.json(
        { error: 'Too many requests. Please try again shortly.' },
        { status: 429 }
      );
    }

    const body = await request.json();
    const { query } = body;

    let maxResults = 10;
    if (typeof body.maxResults === 'number' && Number.isFinite(body.maxResults)) {
      maxResults = Math.max(1, Math.min(25, Math.floor(body.maxResults)));
    }

    // ISC is gated on `appbuilder-domain-offers-isc` AND the allowlist in
    // @/lib/domain-offers/isc-config. Anything else gets dropped silently
    // so the request still succeeds with standard pricing.
    const offersEnabled = await checkSwitchboardFlag(
      'appbuilder-domain-offers-isc',
      request
    );
    const normalizedIsc = offersEnabled
      ? normalizeIsc(typeof body.isc === 'string' ? body.isc : null)
      : null;
    const isc = normalizedIsc ?? undefined;

    if (!query || typeof query !== 'string') {
      return NextResponse.json(
        { error: 'Query parameter is required' },
        { status: 400 }
      );
    }

    // Sanitize: strip invalid chars, collapse consecutive dots, trim leading/trailing dots
    const sanitizedQuery = query
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-.]/g, '')
      .replace(/\.{2,}/g, '.')
      .replace(/^\.+|\.+$/g, '');

    if (sanitizedQuery.length < 1 || sanitizedQuery.length > 253) {
      return NextResponse.json(
        { error: 'Invalid query' },
        { status: 400 }
      );
    }

    // Prefer market from client (sourced from locale cookie), fall back to server detection
    const clientMarket = typeof body.market === 'string' ? body.market.trim() : '';
    const market = (clientMarket && LOCALE_RE.test(clientMarket)) ? clientMarket : await detectTranslationLocale();
    const domainServices = getDomainServices(market);
    const entourageFetchOptions = getEntourageFetchOptions(request);

    const validSeeds = validateSeeds(body.seeds);
    const useFanout = validSeeds.length > 0;
    const seedAwareCaller = typeof body.seedPrompt === 'string' && body.seedPrompt.trim().length > 0;
    const spinsQuery: string = seedAwareCaller ? buildSpinsQuery(query, sanitizedQuery) : sanitizedQuery;

    logger.info('domains.search.start', {
      query: sanitizedQuery,
      spinsQuery,
      seedsCount: validSeeds.length,
      seedsUsed: useFanout ? 'llm' : 'fallback',
      maxResults,
      market,
      isc: isc ?? null,
      hasForwardedCookies: !!entourageFetchOptions.options,
      customerId: authContext.user?.customerId,
    });

    const exactPromise = domainServices.findExact({
      query: sanitizedQuery,
      ...(isc ? { extraParams: { isc } } : {}),
      ...entourageFetchOptions,
    });

    // Each seed gets the full maxResults; downstream dedup-by-FQDN trims overlap.
    // Per-seed pagesize trades a few extra GoDaddy result rows for predictable
    // post-dedup output ≥ maxResults (vs floor(maxResults/N) which floors to as
    // few as 1 result per seed for the real callers using maxResults=5 or 6).
    const fanoutQueries = useFanout ? validSeeds : [spinsQuery];
    if (useFanout) {
      logger.info('domains.search.fanout.begin', {
        seedsCount: validSeeds.length,
        pagesizePerSeed: maxResults,
      });
    }
    const spinsPromises = fanoutQueries.map(q =>
      domainServices.findSpins({
        query: q,
        extraParams: { pagesize: maxResults, ...(isc ? { isc } : {}) },
        ...entourageFetchOptions,
      })
    );

    const results = await Promise.allSettled([exactPromise, ...spinsPromises]);

    const exactData = results[0].status === 'fulfilled' ? results[0].value : null;
    const spinsResults = results.slice(1);
    const fulfilledSpins = spinsResults
      .filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled')
      .map(r => r.value);
    const rejectedSpins = spinsResults.filter(r => r.status === 'rejected');

    if (results[0].status === 'rejected') {
      logger.warn('domains.search.exact-error', {
        error: (results[0] as PromiseRejectedResult).reason?.message || 'Unknown error',
        reason: (results[0] as PromiseRejectedResult).reason?.name || 'unknown',
        customerId: authContext.user?.customerId,
      });
    }
    spinsResults.forEach((r, i) => {
      if (r.status === 'rejected') {
        logger.warn('domains.search.spins-error', {
          error: r.reason?.message || 'Unknown error',
          reason: r.reason?.name || 'unknown',
          seed: fanoutQueries[i],
          customerId: authContext.user?.customerId,
        });
      }
    });

    logger.info('domains.search.fanout.summary', {
      seedsCount: validSeeds.length,
      fulfilled: fulfilledSpins.length,
      rejected: rejectedSpins.length,
    });

    // Interleave per-seed results so every seed gets representation before the
    // maxResults cap is applied (flatMap would let seed 1 fill all slots).
    const spinsData = fulfilledSpins.length > 0
      ? {
          RecommendedDomains: interleaveArrays(fulfilledSpins.map(d => d?.RecommendedDomains || [])),
          Domains: interleaveArrays(fulfilledSpins.map(d => d?.Domains || [])),
          Products: fulfilledSpins.flatMap(d => d?.Products || []),
        }
      : null;

    if (!exactData && !spinsData) {
      logger.error('domains.search.api-error', {
        message: 'Both exact and spins searches failed',
      });
      return NextResponse.json(
        { error: 'Failed to search domains' },
        { status: 502 }
      );
    }

    // Log raw API responses for debugging
    logger.info('domains.search.raw-response', {
      hasExactData: !!exactData,
      hasSpinsData: !!spinsData,
      exactDataKeys: exactData ? Object.keys(exactData) : [],
      spinsDataKeys: spinsData ? Object.keys(spinsData) : [],
      exactMatchDomain: exactData?.ExactMatchDomain ? {
        fqdn: exactData.ExactMatchDomain.Fqdn,
        availabilityCode: exactData.ExactMatchDomain.AvailabilityCode,
      } : null,
      recommendedDomainsCount: spinsData?.RecommendedDomains?.length || 0,
      domainsCount: spinsData?.Domains?.length || 0,
      sampleRecommended: spinsData?.RecommendedDomains?.slice(0, 3).map((d: any) => ({
        fqdn: d.Fqdn,
        availabilityCode: d.AvailabilityCode,
      })) || [],
      sampleDomains: spinsData?.Domains?.slice(0, 3).map((d: any) => ({
        fqdn: d.Fqdn,
        availabilityCode: d.AvailabilityCode,
      })) || [],
      sampleProduct: spinsData?.Products?.[0] || exactData?.Products?.[0] || null,
      spinsDataPreview: spinsData ? JSON.stringify(spinsData).slice(0, 500) : null,
    });

    // Format results
    const domains: FormattedSearchDomain[] = [];
    const products = new Map<number, any>();

    // For long queries the sanitized string is an unwieldy concatenation (e.g.
    // "sandbaggersteakhouse2"). Show brandable spin suggestions first so the user
    // sees useful alternatives before the exact match that mirrors their full input.
    const exactAvailStatus = exactData?.ExactMatchDomain?.AvailabilityStatus;
    const isLongQuery = sanitizedQuery.length > LONG_QUERY_THRESHOLD;

    const exactDomain = exactAvailStatus === 1000
      ? (() => {
          const exact = exactData.ExactMatchDomain;
          return {
            fqdn: exact.Fqdn,
            sld: exact.NameWithoutExtension || exact.Sld,
            tld: exact.Tld || exact.Extension,
            availabilityCode: exactAvailStatus,
            productId: exact.ProductId,
            isPremium: exact.IsPremiumTier || exact.IsPremium || false,
            isExactMatch: true,
            priceDisplay: exact.PriceDisplay,
            _raw: exact,
          };
        })()
      : null;

    // Short queries: exact match first (current behaviour)
    if (!isLongQuery && exactDomain) {
      domains.push(exactDomain);
    }

    // Process products from exact match
    if (exactData?.Products) {
      for (const p of exactData.Products) {
        const priceInfo = p.PriceInfo || p;
        products.set(p.ProductId, {
          productId: p.ProductId,
          priceInfo: {
            listPrice: priceInfo.ListPrice,
            listPriceDisplay: priceInfo.ListPriceDisplay,
            currentPrice: priceInfo.CurrentPrice,
            currentPriceDisplay: priceInfo.CurrentPriceDisplay,
            renewalPrice: priceInfo.RenewalPrice,
            renewalPriceDisplay: priceInfo.RenewalPriceDisplay,
            isOnSale: priceInfo.CurrentPrice < priceInfo.ListPrice,
          },
        });
      }
    }

    // Process spins (alternative suggestions)
    // RecommendedDomains are implicitly available - the API only returns available domains
    // Check both RecommendedDomains and Domains fields (API may use either)
    const spinDomains = [...(spinsData?.RecommendedDomains || []), ...(spinsData?.Domains || [])];
    for (const spin of spinDomains) {
      // Avoid duplicates
      if (!domains.some(d => d.fqdn === spin.Fqdn)) {
        domains.push({
          fqdn: spin.Fqdn,
          sld: spin.NameWithoutExtension || spin.Sld,
          tld: spin.Extension || spin.Tld,
          availabilityCode: spin.AvailabilityStatus || spin.AvailabilityCode || 1000, // Default 1000 (available)
          productId: spin.ProductId,
          isPremium: spin.IsPremiumTier || spin.IsPremium || false,
          isExactMatch: false,
          priceDisplay: spin.PriceDisplay,
          _raw: spin,
        });
      }
    }

    // Long queries: exact match appended after spins (if not already present via dedup)
    if (isLongQuery && exactDomain && !domains.some(d => d.fqdn === exactDomain.fqdn)) {
      domains.push(exactDomain);
    }

    // Process products from spins
    if (spinsData?.Products) {
      for (const p of spinsData.Products) {
        if (!products.has(p.ProductId)) {
          const priceInfo = p.PriceInfo || p;
          products.set(p.ProductId, {
            productId: p.ProductId,
            priceInfo: {
              listPrice: priceInfo.ListPrice,
              listPriceDisplay: priceInfo.ListPriceDisplay,
              currentPrice: priceInfo.CurrentPrice,
              currentPriceDisplay: priceInfo.CurrentPriceDisplay,
              renewalPrice: priceInfo.RenewalPrice,
              renewalPriceDisplay: priceInfo.RenewalPriceDisplay,
              isOnSale: priceInfo.CurrentPrice < priceInfo.ListPrice,
            },
          });
        }
      }
    }

    // Cap output to maxResults so fan-out doesn't exceed caller expectations.
    // For long queries the exact match is appended last; if spins fill all slots it
    // would be silently dropped. Reserve the final slot for it in that case.
    const exactDroppedByLongQueryCap =
      isLongQuery &&
      exactDomain !== null &&
      !domains.slice(0, maxResults).some(d => d.fqdn === exactDomain.fqdn);
    const cappedDomains = exactDroppedByLongQueryCap
      ? [...domains.slice(0, maxResults - 1), exactDomain]
      : domains.slice(0, maxResults);

    // Only include products referenced by the capped domain set
    const referencedProductIds = new Set(cappedDomains.map(d => d.productId).filter(Boolean));
    const productsArray = Array.from(products.values()).filter(p => referencedProductIds.has(p.productId));

    const spinsResultCount = cappedDomains.filter(d => !d.isExactMatch).length;
    const exactMatchCount = cappedDomains.filter(d => d.isExactMatch).length;

    logger.info('domains.search.success', {
      query: sanitizedQuery,
      domainsFound: cappedDomains.length,
      totalBeforeCap: domains.length,
      productsFound: productsArray.length,
      seedsUsed: useFanout ? 'llm' : 'fallback',
      seedsCount: validSeeds.length,
      spinsFulfilled: fulfilledSpins.length,
      spinsRejected: rejectedSpins.length,
      spinsResultCount,
      exactMatchCount,
    });

    return NextResponse.json({
      domains: cappedDomains,
      products: productsArray,
      meta: {
        seedsUsed: useFanout ? 'llm' : 'fallback',
        seedsCount: validSeeds.length,
        spinsFulfilled: fulfilledSpins.length,
        spinsRejected: rejectedSpins.length,
        spinsResultCount,
        exactMatchCount,
        totalBeforeCap: domains.length,
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Check if error is client-caused (validation) or server-caused
    const isClientError = errorMessage.toLowerCase().includes('invalid') ||
      errorMessage.toLowerCase().includes('validation') ||
      errorMessage.toLowerCase().includes('required') ||
      errorMessage.toLowerCase().includes('malformed');

    const statusCode = isClientError ? 400 : 500;

    // Use explicit branches for type-safe logging
    if (isClientError) {
      logger.warn('domains.search.error', {
        error: errorMessage,
        statusCode,
        isClientError: true,
      });
    } else {
      logger.error('domains.search.error', {
        error: errorMessage,
        statusCode,
        isClientError: false,
      });
    }

    return NextResponse.json(
      { error: isClientError ? errorMessage : 'Internal server error' },
      { status: statusCode }
    );
  }
});
