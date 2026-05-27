import type { NextRequest } from 'next/server';

import { logger } from '@/lib/request-context';
import { getApiBaseUrl } from '@/utils/getServerRootDomain';

interface ShopperData {
  marketId?: string;
}

const TIMEOUT_MS = 5000;

/**
 * Fetch the shopper's resident marketId from Shopper API.
 *
 * Used to drive datacenter selection from the customer's account-level market
 * rather than the request-time `market` cookie, which is dominated by `en-US`
 * because most users sign up via the godaddy.com US storefront.
 *
 * Returns `undefined` on any failure (network, timeout, parse, non-2xx, or
 * empty/whitespace `marketId`). Callers must fall back to another signal
 * (see `resolveMarketId` in @/lib/market/resolve-market).
 */
export async function fetchShopperMarketId(
  request: NextRequest,
  shopperId: string,
  jwt: string
): Promise<string | undefined> {
  const start = Date.now();
  const url = `${getApiBaseUrl(request, 'api')}/v1/shoppers/${encodeURIComponent(shopperId)}`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `sso-jwt ${jwt}`,
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!response.ok) {
      // 401/403 indicates an expired/invalid sso-jwt or missing scope —
      // a config/code bug, not a transient blip — so surface at error level.
      const isAuthFailure = response.status === 401 || response.status === 403;
      const logFn = isAuthFailure ? logger.error : logger.warn;
      logFn('shopper-market.fetch.http-error', {
        status: response.status,
        durationMs: Date.now() - start,
      });
      return undefined;
    }

    const data = (await response.json()) as ShopperData;
    const marketId = data.marketId?.trim();
    if (!marketId) {
      logger.warn('shopper-market.fetch.empty-marketId', {
        durationMs: Date.now() - start,
      });
      return undefined;
    }
    logger.info('shopper-market.fetch.success', {
      durationMs: Date.now() - start,
    });
    return marketId;
  } catch (error) {
    let reason: 'timeout' | 'parse-error' | 'error' = 'error';
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      reason = 'timeout';
    } else if (error instanceof SyntaxError) {
      reason = 'parse-error';
    }
    logger.warn('shopper-market.fetch.failed', {
      reason,
      errorMessage: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - start,
    });
    return undefined;
  }
}
