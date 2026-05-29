import type { NextRequest } from 'next/server';

import { logger } from '@/lib/request-context';
import gasket from '../../../gasket';

const FALLBACK_MARKET = 'en-US';

export type MarketSource = 'visitor-market' | 'fallback';

export interface MarketResolution {
  marketId: string;
  visitorMarket: string | undefined;
  source: MarketSource;
}

/**
 * Resolve the marketId used for datacenter selection.
 *
 * Reads the request-time market from Gasket's visitor plugin
 * (`gasket.actions.getVisitor(req).market`), which derives the market from the
 * `market` cookie / `x-market-id` header / `Accept-Language` chain.
 *
 * Falls back to `en-US` only if the visitor plugin throws or returns no
 * market — in practice the plugin always populates `market`.
 */
export async function resolveMarketId(request: NextRequest): Promise<MarketResolution> {
  const visitor = await gasket.actions.getVisitor(request).catch((error: unknown) => {
    logger.warn('market.resolve.visitor-failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  });
  const visitorMarket = visitor?.market;

  const resolution: MarketResolution = visitorMarket
    ? { marketId: visitorMarket, visitorMarket, source: 'visitor-market' }
    : { marketId: FALLBACK_MARKET, visitorMarket: undefined, source: 'fallback' };

  logger.info('market.resolve', resolution);
  return resolution;
}
