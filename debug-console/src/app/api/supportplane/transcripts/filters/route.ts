/**
 * /api/supportplane/transcripts/filters
 * Get distinct filter values for dropdowns
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api-auth';
import { logger } from '@/lib/logger';
import { getStore } from '@/lib/supportplane/store';

const FILTERS_CACHE_TTL_MS = 60000;
let filtersCache:
  | {
      expiresAt: number;
      payload: {
        success: true;
        filters: {
          categories: string[];
          interaction_statuses: string[];
          sub_intents: string[];
          friction_points: string[];
          tags: string[];
        };
      };
    }
  | null = null;

async function handler(request: NextRequest) {
  try {
    if (request.method !== 'GET') {
      return NextResponse.json({ error: 'Method not allowed' }, { status: 405 });
    }

    if (filtersCache && filtersCache.expiresAt > Date.now()) {
      return NextResponse.json(filtersCache.payload);
    }

    const filters = await getStore().getTranscriptFilterOptions();

    const payload = {
      success: true,
      filters,
    } as const;

    filtersCache = {
      expiresAt: Date.now() + FILTERS_CACHE_TTL_MS,
      payload,
    };

    return NextResponse.json(payload);
  } catch (error) {
    logger.error('supportplane.transcripts.filters.error', { error: String(error) });
    return NextResponse.json(
      {
        error: 'Failed to fetch filters',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

export const GET = withAuth(handler);
