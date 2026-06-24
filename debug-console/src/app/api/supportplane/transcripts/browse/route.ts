import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api-auth';
import { logger } from '@/lib/logger';
import { browsePage, countTranscripts, isTaggingActive, queryTranscripts, QueryFilters } from '@/lib/supportplane/db/l1-transcript-db';

// 5-minute server-side cache for no-filter browse (matches fullScanCache / candidateCache TTL)
interface BrowseCache {
  expiresAt: number;
  response: unknown;
  inFlight: Promise<unknown> | null;
}
const browseCache: BrowseCache = { expiresAt: 0, response: null, inFlight: null };
const BROWSE_CACHE_TTL_MS = 300_000;

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

    // No-filter browse at offset 0: serve from 30s cache to absorb polling
    if (!hasSearchFilter && pageOffset === 0) {
      if (browseCache.expiresAt > Date.now() && browseCache.response !== null) {
        return NextResponse.json(browseCache.response);
      }
      if (browseCache.inFlight) {
        return NextResponse.json(await browseCache.inFlight);
      }
      const inFlight: Promise<unknown> = (async (): Promise<unknown> => {
        const rows = await browsePage(pageLimit + 1, 0);
        const hasMoreRows: boolean = rows.length > pageLimit;
        const transcriptSlice: QueryFilters[] = rows.slice(0, pageLimit).map(({ full_transcript: _ft, conversation_summary: _cs, ...summary }) => summary) as unknown as QueryFilters[];
        const taggingActiveFlag: boolean = await isTaggingActive();
        const payload: unknown = {
          transcripts: transcriptSlice,
          tagging_active: taggingActiveFlag,
          pagination: { total: transcriptSlice.length + (hasMoreRows ? 1 : 0), total_is_estimate: true, limit: pageLimit, offset: 0, has_more: hasMoreRows },
          filters: { app_id: null, shopper_id: null, customer_id: null, domain: null, tags: null, text_search: null, start_date: null, end_date: null },
        };
        browseCache.response = payload;
        browseCache.expiresAt = Date.now() + BROWSE_CACHE_TTL_MS;
        return payload;
      })()
        .then((payload: unknown) => {
          // Clear inFlight on success so the next miss re-queries; expiresAt above keeps the warm cache.
          browseCache.inFlight = null;
          return payload;
        })
        .catch((err: unknown) => {
          // Clear inFlight on failure too, otherwise a transient scan error stays cached as a
          // rejected promise and every later no-filter browse returns 500 until restart.
          browseCache.inFlight = null;
          throw err;
        });
      browseCache.inFlight = inFlight;
      return NextResponse.json(await inFlight);
    }

    let transcripts: QueryFilters[];
    let hasMore: boolean;
    let actualTotal: number;

    if (!hasSearchFilter) {
      // Browse mode: fast index query — O(limit), independent of table size
      const rows = await browsePage(pageLimit + 1, pageOffset);
      hasMore = rows.length > pageLimit;
      transcripts = rows.slice(0, pageLimit).map(({ full_transcript: _ft, conversation_summary: _cs, ...summary }) => summary) as unknown as QueryFilters[];

      // Get actual total count for browse mode
      actualTotal = await countTranscripts({});
    } else {
      // Search mode: full candidate scan with filter matching
      const pageRowsFilter: QueryFilters = { ...filters, limit: pageLimit + 1 };
      const rows = await queryTranscripts(pageRowsFilter);
      hasMore = rows.length > pageLimit;
      transcripts = rows.slice(0, pageLimit).map(({ full_transcript: _ft, conversation_summary: _cs, ...summary }) => summary) as unknown as QueryFilters[];

      // Get actual total count for search mode with filters
      actualTotal = await countTranscripts({
        app_id: filters.app_id,
        shopper_id: filters.shopper_id,
        customer_id: filters.customer_id,
        domain: filters.domain,
        interaction_id: filters.interaction_id,
        category: filters.category,
        interaction_status: filters.interaction_status,
        sub_intent: filters.sub_intent,
        friction_point: filters.friction_point,
        tags: filters.tags,
        text_search: filters.text_search,
        start_date: filters.start_date,
        end_date: filters.end_date,
      });
    }

    const taggingActive = await isTaggingActive();

    return NextResponse.json({
      transcripts,
      tagging_active: taggingActive,
      pagination: {
        total: actualTotal,
        total_is_estimate: false,
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
