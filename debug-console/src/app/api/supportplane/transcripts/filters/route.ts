/**
 * /api/supportplane/transcripts/filters
 * Get distinct filter values for dropdowns
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api-auth';
import { logger } from '@/lib/logger';
import { queryTranscripts } from '@/lib/l1-transcript-db';

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

    const rows = await queryTranscripts({});
    const categories = new Set<string>();
    const statuses = new Set<string>();
    const tagsSet = new Set<string>();

    const subIntentSet = new Set<string>();
    const frictionPointSet = new Set<string>();

    rows.forEach(row => {
      if (row.category) {
        categories.add(row.category);
      }
      if (row.interaction_status) {
        statuses.add(row.interaction_status);
      }
      if (Array.isArray(row.tags)) {
        row.tags.forEach((tag) => tagsSet.add(tag));
      } else if (typeof row.tags === 'string') {
        try {
          const tags = JSON.parse(row.tags) as string[];
          tags.forEach((tag) => tagsSet.add(tag));
        } catch {
          // skip
        }
      }

      try {
        const data =
          typeof row.raw_data === 'string' ? JSON.parse(row.raw_data) : row.raw_data;
        if (data.sub_intent && data.sub_intent !== 'N/A' && data.sub_intent !== '') {
          subIntentSet.add(data.sub_intent);
        }
        if (data.friction_point && data.friction_point !== 'N/A' && data.friction_point !== '') {
          frictionPointSet.add(data.friction_point);
        }
      } catch {
        // Skip invalid JSON
      }
    });

    const subIntents = Array.from(subIntentSet).sort();
    const frictionPoints = Array.from(frictionPointSet).sort();
    const tags = Array.from(tagsSet).sort();

    const payload = {
      success: true,
      filters: {
        categories: Array.from(categories).sort(),
        interaction_statuses: Array.from(statuses).sort(),
        sub_intents: subIntents,
        friction_points: frictionPoints,
        tags: tags,
      },
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
