import { NextRequest, NextResponse } from 'next/server';

import { withAuth } from '@/lib/api-auth';
import { logger } from '@/lib/logger';
import { routeCached } from '@/lib/route-cache';
import { InsightsClient } from '@/lib/supportplane/store/insights-client';

export const dynamic = 'force-dynamic';

/**
 * GET /api/supportplane/insights/bugs
 * Query bug insights with filtering and sorting
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
      const cacheKey: string = `bugs:stats:${createdAfter || 'all'}`;
      const bugs = await routeCached(
        cacheKey,
        60_000, // 60s TTL
        () => client.queryInsightsByType('BUG', {
          sortBy: 'last_updated',
          limit: 1000, // Get all bugs for stats
          createdAfter: createdAfter || undefined,
        })
      );

      const now: Date = new Date();
      const sevenDaysAgo: Date = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      const stats = {
        total_bugs: bugs.length,
        recent_bugs_last_7_days: bugs.filter(b => new Date(b.last_seen) >= sevenDaysAgo).length,
        critical_bugs_low_resolution: bugs.filter(b => b.resolution_rate < 0.2).length,
        total_occurrences: bugs.reduce((sum, b) => sum + b.occurrence_count, 0),
        avg_resolution_rate: bugs.length > 0
          ? bugs.reduce((sum, b) => sum + b.resolution_rate, 0) / bugs.length
          : 0,
      };

      logger.info('insights.bugs.stats.success', { stats });
      return NextResponse.json({ stats });
    }

    // List action - return filtered/sorted bugs
    const cacheKey: string = `bugs:${productLine || 'all'}:${sortBy || 'business_impact_score'}:${limit || '50'}:${createdAfter || 'all'}`;
    const bugs = await routeCached(
      cacheKey,
      60_000, // 60s TTL
      () => client.queryInsightsByType('BUG', {
        sortBy: (sortBy as 'last_updated' | 'occurrence_count' | 'business_impact_score') || 'business_impact_score',
        limit: limit ? parseInt(limit, 10) : 50,
        productLine: productLine || undefined,
        createdAfter: createdAfter || undefined,
      })
    );

    logger.info('insights.bugs.query.success', {
      count: bugs.length,
      product_line: productLine,
      sort_by: sortBy,
    });

    return NextResponse.json({ bugs });
  } catch (error) {
    logger.error('insights.bugs.query.failed', {
      error: error instanceof Error ? error.message : String(error),
    });

    return NextResponse.json(
      { error: 'Failed to query bug insights' },
      { status: 500 }
    );
  }
}

export const GET = withAuth(handler);
