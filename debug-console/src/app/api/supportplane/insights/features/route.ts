import { NextRequest, NextResponse } from 'next/server';

import { withAuth } from '@/lib/api-auth';
import { logger } from '@/lib/logger';
import { routeCached } from '@/lib/route-cache';
import { InsightsClient } from '@/lib/supportplane/store/insights-client';

export const dynamic = 'force-dynamic';

/**
 * GET /api/supportplane/insights/features
 * Query feature request insights with filtering and sorting
 * Supports ?action=stats for aggregate metrics
 */
async function handler(request: NextRequest): Promise<NextResponse> {
  try {
    const searchParams: URLSearchParams = request.nextUrl.searchParams;
    const action: string | null = searchParams.get('action');
    const productLine: string | null = searchParams.get('product_line');
    const sortBy: string | null = searchParams.get('sort_by');
    const limit: string | null = searchParams.get('limit');
    const createdAfter: string | null = searchParams.get('created_after');

    const client = new InsightsClient();

    // Stats action - return aggregate metrics
    if (action === 'stats') {
      const cacheKey: string = `features:stats:${createdAfter || 'all'}`;
      const features = await routeCached(
        cacheKey,
        60_000, // 60s TTL
        () => client.queryInsightsByType('FEATURE', {
          sortBy: 'last_updated',
          limit: 1000, // Get all features for stats
          createdAfter: createdAfter || undefined,
        })
      );

      const stats = {
        total_features: features.length,
        high_demand_features: features.filter(f => f.occurrence_count > 10).length,
        high_conversion_features: features.filter(f => (f.conversion_signal_rate ?? 0) > 0.7).length,
        total_requests: features.reduce((sum, f) => sum + f.occurrence_count, 0),
        avg_conversion_rate: features.length > 0
          ? features.reduce((sum, f) => sum + (f.conversion_signal_rate ?? 0), 0) / features.length
          : 0,
      };

      logger.info('insights.features.stats.success', { stats });
      return NextResponse.json({ stats });
    }

    // List action - return filtered/sorted features
    const cacheKey: string = `features:${productLine || 'all'}:${sortBy || 'business_impact_score'}:${limit || '50'}:${createdAfter || 'all'}`;
    const features = await routeCached(
      cacheKey,
      60_000, // 60s TTL
      () => client.queryInsightsByType('FEATURE', {
        sortBy: (sortBy as 'last_updated' | 'occurrence_count' | 'business_impact_score') || 'business_impact_score',
        limit: limit ? parseInt(limit, 10) : 50,
        productLine: productLine || undefined,
        createdAfter: createdAfter || undefined,
      })
    );

    logger.info('insights.features.query.success', {
      count: features.length,
      product_line: productLine,
      sort_by: sortBy,
    });

    return NextResponse.json({ features });
  } catch (error) {
    logger.error('insights.features.query.failed', {
      error: error instanceof Error ? error.message : String(error),
    });

    return NextResponse.json(
      { error: 'Failed to query feature insights' },
      { status: 500 }
    );
  }
}

export const GET = withAuth(handler);
