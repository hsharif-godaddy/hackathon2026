import type { NextRequest } from 'next/server';

import { logger } from '@/lib/request-context';
import { fetchShopperMarketId } from '@/lib/shopper/shopper-market';
import gasket from '../../../gasket';

const FALLBACK_MARKET = 'en-US';

export type MarketSource = 'shopper-api' | 'visitor-market' | 'fallback';

export interface MarketResolution {
  marketId: string;
  shopperMarket: string | undefined;
  visitorMarket: string | undefined;
  source: MarketSource;
}

/**
 * Resolve the marketId used for datacenter selection.
 *
 * Combines two signals:
 * - Shopper API (`fetchShopperMarketId`) — account-level resident market
 * - Gasket visitor (`gasket.actions.getVisitor(req).market`) — request-time
 *   market from `market` cookie / `x-market-id` header / `Accept-Language`
 *
 * Priority:
 *   1. Whichever signal is NOT `en-US` (preferring shopper if both differ from en-US)
 *   2. Shopper (if defined)
 *   3. Visitor market
 *   4. Hard-coded `en-US` fallback (only if both signals are missing — should not happen
 *      in practice; the visitor plugin always populates `market`)
 *
 * The non-`en-US` preference exists because the godaddy.com US storefront sets
 * `market=en-US` cookies for many shoppers whose actual resident market is
 * elsewhere — so `en-US` is the noisier of the two possible values.
 */
export async function resolveMarketId(
  request: NextRequest,
  shopperId: string | undefined,
  jwt: string,
): Promise<MarketResolution> {
  const [visitor, shopperMarket] = await Promise.all([
    gasket.actions.getVisitor(request).catch((error: unknown) => {
      logger.warn('market.resolve.visitor-failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }),
    shopperId ? fetchShopperMarketId(request, shopperId, jwt) : Promise.resolve(undefined),
  ]);
  const visitorMarket = visitor?.market;

  const candidates: ReadonlyArray<readonly [string | undefined, MarketSource]> = [
    [shopperMarket, 'shopper-api'],
    [visitorMarket, 'visitor-market'],
  ];

  // First pass: prefer non-en-US.
  for (const [value, source] of candidates) {
    if (value && value !== FALLBACK_MARKET) {
      return logResult({ marketId: value, shopperMarket, visitorMarket, source });
    }
  }

  // Second pass: shopper > visitor when both are en-US (or only one is defined).
  for (const [value, source] of candidates) {
    if (value) {
      return logResult({ marketId: value, shopperMarket, visitorMarket, source });
    }
  }

  return logResult({
    marketId: FALLBACK_MARKET,
    shopperMarket,
    visitorMarket,
    source: 'fallback',
  });
}

function logResult(resolution: MarketResolution): MarketResolution {
  logger.info('market.resolve', {
    shopperMarket: resolution.shopperMarket,
    visitorMarket: resolution.visitorMarket,
    marketId: resolution.marketId,
    source: resolution.source,
  });
  return resolution;
}
