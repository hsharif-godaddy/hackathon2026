import { NextRequest, NextResponse } from 'next/server';

import { withAuth } from '@/lib/api-auth';
import { logger } from '@/lib/logger';
import { routeCached } from '@/lib/route-cache';
import { InsightsClient } from '@/lib/supportplane/store/insights-client';

export const dynamic = 'force-dynamic';

/**
 * GET /api/supportplane/insights/patterns
 * Query friction pattern insights with filtering and sorting
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
      const cacheKey: string = `patterns:stats:${createdAfter || 'all'}`;
      const patterns = await routeCached(
        cacheKey,
        60_000, // 60s TTL
        () => client.queryInsightsByType('PATTERN', {
          sortBy: 'last_updated',
          limit: 1000, // Get all patterns for stats
          createdAfter: createdAfter || undefined,
        })
      );

      const stats = {
        total_patterns: patterns.length,
        increasing_trends: patterns.filter(p => p.trend === 'increasing').length,
        decreasing_trends: patterns.filter(p => p.trend === 'decreasing').length,
        avg_occurrence_count: patterns.length > 0
          ? patterns.reduce((sum, p) => sum + p.occurrence_count, 0) / patterns.length
          : 0,
      };

      logger.info('insights.patterns.stats.success', { stats });
      return NextResponse.json({ stats });
    }

    // List action - return filtered/sorted patterns
    const cacheKey: string = `patterns:${productLine || 'all'}:${sortBy || 'occurrence_count'}:${limit || '50'}:${createdAfter || 'all'}`;
    const patterns = await routeCached(
      cacheKey,
      60_000, // 60s TTL
      () => client.queryInsightsByType('PATTERN', {
        sortBy: (sortBy as 'last_updated' | 'occurrence_count' | 'business_impact_score') || 'occurrence_count',
        limit: limit ? parseInt(limit, 10) : 50,
        productLine: productLine || undefined,
        createdAfter: createdAfter || undefined,
      })
    );

    logger.info('insights.patterns.query.success', {
      count: patterns.length,
      product_line: productLine,
      sort_by: sortBy,
    });

    return NextResponse.json({ patterns });
  } catch (error) {
    logger.error('insights.patterns.query.failed', {
      error: error instanceof Error ? error.message : String(error),
    });

    return NextResponse.json(
      { error: 'Failed to query pattern insights' },
      { status: 500 }
    );
  }
}

export const GET = withAuth(handler);
