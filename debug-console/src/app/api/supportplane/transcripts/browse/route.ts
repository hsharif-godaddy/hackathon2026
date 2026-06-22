import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api-auth';
import { logger } from '@/lib/logger';
import { browsePage, isTaggingActive, queryTranscripts, QueryFilters } from '@/lib/l1-transcript-db';

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

    const pageLimit = filters.limit || 50;
    const pageOffset = filters.offset || 0;

    const hasSearchFilter = Boolean(
      filters.app_id || filters.shopper_id || filters.customer_id ||
      filters.domain || filters.interaction_id || filters.category ||
      filters.interaction_status || filters.sub_intent || filters.friction_point ||
      filters.tags?.length || filters.text_search || filters.start_date || filters.end_date
    );

    let transcripts: QueryFilters[];
    let hasMore: boolean;
    if (!hasSearchFilter) {
      // Browse mode: fast index query — O(limit), independent of table size
      const rows = await browsePage(pageLimit + 1, pageOffset);
      hasMore = rows.length > pageLimit;
      transcripts = rows.slice(0, pageLimit).map(({ full_transcript: _ft, conversation_summary: _cs, ...summary }) => summary) as unknown as QueryFilters[];
    } else {
      // Search mode: full candidate scan with filter matching
      const pageRowsFilter: QueryFilters = { ...filters, limit: pageLimit + 1 };
      const rows = await queryTranscripts(pageRowsFilter);
      hasMore = rows.length > pageLimit;
      transcripts = rows.slice(0, pageLimit).map(({ full_transcript: _ft, conversation_summary: _cs, ...summary }) => summary) as unknown as QueryFilters[];
    }

    const taggingActive = await isTaggingActive();
    const estimatedTotal = pageOffset + transcripts.length + (hasMore ? 1 : 0);

    return NextResponse.json({
      transcripts,
      tagging_active: taggingActive,
      pagination: {
        total: estimatedTotal,
        total_is_estimate: true,
        limit: filters.limit,
        offset: filters.offset,
        has_more: hasMore,
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
