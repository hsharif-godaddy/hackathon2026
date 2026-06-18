/**
 * /api/supportplane/transcripts/browse
 * Browse and query L1 transcripts with filters and pagination
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api-auth';
import { logger } from '@/lib/logger';
import { countTranscripts, isTaggingActive, queryTranscripts, QueryFilters } from '@/lib/l1-transcript-db';

async function handler(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    // Parse filters
    const filters: QueryFilters = {
      app_id: searchParams.get('app_id') || undefined,
      shopper_id: searchParams.get('shopper_id') || undefined,
      customer_id: searchParams.get('customer_id') || undefined,
      domain: searchParams.get('domain') || undefined,
      interaction_id: searchParams.get('interaction_id') || undefined,
      category: searchParams.get('category') || undefined,
      interaction_status: searchParams.get('interaction_status') || undefined,
      sub_intent: searchParams.get('sub_intent') || undefined,
      friction_point: searchParams.get('friction_point') || undefined,
      tags: searchParams.get('tags')?.split(',').filter(Boolean) || undefined,
      text_search: searchParams.get('text_search') || undefined,
      start_date: searchParams.get('start_date') || undefined,
      end_date: searchParams.get('end_date') || undefined,
      limit: parseInt(searchParams.get('limit') || '50', 10),
      offset: parseInt(searchParams.get('offset') || '0', 10),
    };

    const [total, transcripts, taggingActive] = await Promise.all([
      countTranscripts(filters),
      queryTranscripts(filters),
      Promise.resolve(isTaggingActive()),
    ]);

    return NextResponse.json({
      transcripts,
      tagging_active: taggingActive,
      pagination: {
        total,
        limit: filters.limit,
        offset: filters.offset,
        has_more: total > (filters.offset || 0) + transcripts.length,
      },
      filters: {
        app_id: filters.app_id || null,
        shopper_id: filters.shopper_id || null,
        customer_id: filters.customer_id || null,
        domain: filters.domain || null,
        tags: filters.tags || null,
        text_search: filters.text_search || null,
        start_date: filters.start_date || null,
        end_date: filters.end_date || null,
      },
    });
  } catch (error) {
    logger.error('supportplane.transcripts.browse.error', { error: String(error) });
    return NextResponse.json(
      {
        error: 'Query failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

export const GET = withAuth(handler);
