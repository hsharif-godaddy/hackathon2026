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
import { logger } from '@/lib/request-context';
import { detectLocale } from '@/lib/translations';

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
    const market = (clientMarket && LOCALE_RE.test(clientMarket)) ? clientMarket : await detectLocale();
    const domainServices = getDomainServices(market);

    logger.info('domains.search.start', {
      query: sanitizedQuery,
      maxResults,
      market,
      customerId: authContext.user?.customerId,
    });

    // Use Promise.allSettled to ensure both requests complete even if one fails
    const results = await Promise.allSettled([
      domainServices.findExact({ query: sanitizedQuery }),
      domainServices.findSpins({
        query: sanitizedQuery,
        extraParams: { pagesize: maxResults }
      }),
    ]);


    const exactData = results[0].status === 'fulfilled' ? results[0].value : null;
    const spinsData = results[1].status === 'fulfilled' ? results[1].value : null;

    if (results[0].status === 'rejected') {
      logger.warn('domains.search.exact-error', { error: results[0].reason?.message || 'Unknown error' });
    }
    if (results[1].status === 'rejected') {
      logger.warn('domains.search.spins-error', { error: results[1].reason?.message || 'Unknown error' });
    }

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
    const domains: any[] = [];
    const products = new Map<number, any>();

    // Process exact match - AvailabilityStatus 1000 = available (API uses AvailabilityStatus not AvailabilityCode)
    const exactAvailStatus = exactData?.ExactMatchDomain?.AvailabilityStatus;
    if (exactAvailStatus === 1000) {
      const exact = exactData.ExactMatchDomain;
      domains.push({
        fqdn: exact.Fqdn,
        sld: exact.NameWithoutExtension || exact.Sld,
        tld: exact.Tld || exact.Extension,
        availabilityCode: exactAvailStatus,
        productId: exact.ProductId,
        isPremium: exact.IsPremiumTier || exact.IsPremium || false,
        isExactMatch: true,
        _raw: exact,
      });
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
    const spinDomains = spinsData?.RecommendedDomains || spinsData?.Domains || [];
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
          _raw: spin,
        });
      }
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

    // Convert products Map to array for JSON serialization
    const productsArray = Array.from(products.values());

    logger.info('domains.search.success', {
      query: sanitizedQuery,
      domainsFound: domains.length,
      productsFound: productsArray.length,
    });

    return NextResponse.json({
      domains,
      products: productsArray,
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
