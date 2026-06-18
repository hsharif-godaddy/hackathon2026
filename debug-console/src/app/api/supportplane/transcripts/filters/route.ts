/**
 * /api/supportplane/transcripts/filters
 * Get distinct filter values for dropdowns
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api-auth';
import { logger } from '@/lib/logger';
import { getL1TranscriptsDb } from '@/lib/l1-transcript-db';

async function handler(request: NextRequest) {
  try {
    if (request.method !== 'GET') {
      return NextResponse.json({ error: 'Method not allowed' }, { status: 405 });
    }

    const db = getL1TranscriptsDb();

    // Get distinct categories
    const categories = db.prepare(`
      SELECT DISTINCT category FROM l1_transcripts
      WHERE category IS NOT NULL AND category != ''
      ORDER BY category
    `).all() as Array<{ category: string }>;

    // Get distinct interaction statuses
    const statuses = db.prepare(`
      SELECT DISTINCT interaction_status FROM l1_transcripts
      WHERE interaction_status IS NOT NULL AND interaction_status != ''
      ORDER BY interaction_status
    `).all() as Array<{ interaction_status: string }>;

    // Get distinct sub_intents and friction_points from raw_data
    const rawDataRows = db.prepare(`
      SELECT raw_data FROM l1_transcripts WHERE raw_data IS NOT NULL
    `).all() as Array<{ raw_data: string }>;

    const subIntentSet = new Set<string>();
    const frictionPointSet = new Set<string>();

    rawDataRows.forEach(row => {
      try {
        const data = JSON.parse(row.raw_data);
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

    // Get distinct tags
    const tagsRows = db.prepare(`
      SELECT DISTINCT json_each.value as tag
      FROM l1_transcripts, json_each(l1_transcripts.tags)
      WHERE tags IS NOT NULL
      ORDER BY tag
    `).all() as Array<{ tag: string }>;

    const tags = tagsRows.map(t => t.tag);

    return NextResponse.json({
      success: true,
      filters: {
        categories: categories.map(c => c.category),
        interaction_statuses: statuses.map(s => s.interaction_status),
        sub_intents: subIntents,
        friction_points: frictionPoints,
        tags: tags,
      },
    });
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
