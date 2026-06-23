/**
 * GET /api/supportplane/transcripts/tag-resolution
 *
 * Returns tag vs issue_resolution cross-tab for visualization
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api-auth';
import { logger } from '@/lib/logger';
import { queryTranscripts } from '@/lib/supportplane/db/l1-transcript-db';

interface TagResolutionData {
  tag: string;
  total: number;
  resolved: number;
  unresolved: number;
  unknown: number;
  resolution_rate: number;
}

async function handler(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const daysBack = parseInt(searchParams.get('days_back') || '30', 10);
    const minCount = parseInt(searchParams.get('min_count') || '3', 10);

    const cutoff = Date.now() - daysBack * 24 * 60 * 60 * 1000;
    const rows = (await queryTranscripts({}))
      .filter((row) => Boolean(row.created_at) && new Date(row.created_at as string).getTime() >= cutoff);

    const buckets = new Map<string, { resolved: number; unresolved: number; unknown: number; total: number }>();

    for (const row of rows) {
      const tags =
        Array.isArray(row.tags)
          ? row.tags
          : typeof row.tags === 'string'
            ? (() => {
                try {
                  return JSON.parse(row.tags) as string[];
                } catch {
                  return [] as string[];
                }
              })()
            : [];

      let resolution: 'resolved' | 'unresolved' | 'unknown' = 'unknown';
      const status = (row.interaction_status || '').toLowerCase();
      if (status === 'resolved' || status === 'yes') {
        resolution = 'resolved';
      } else if (status === 'unresolved' || status === 'no') {
        resolution = 'unresolved';
      }

      for (const tag of tags) {
        const bucket = buckets.get(tag) || { resolved: 0, total: 0, unknown: 0, unresolved: 0 };
        bucket.total += 1;
        bucket[resolution] += 1;
        buckets.set(tag, bucket);
      }
    }

    const data: TagResolutionData[] = [...buckets.entries()]
      .filter(([, bucket]) => bucket.total >= minCount)
      .map(([tag, bucket]) => ({
        resolution_rate: bucket.total ? Math.round((bucket.resolved / bucket.total) * 1000) / 10 : 0,
        resolved: bucket.resolved,
        tag,
        total: bucket.total,
        unknown: bucket.unknown,
        unresolved: bucket.unresolved,
      }))
      .sort((left, right) => right.total - left.total)
      .slice(0, 20);

    logger.info('supportplane.tag_resolution.success', {
      tags_count: data.length,
      days_back: daysBack,
    });

    return NextResponse.json({
      success: true,
      data,
      daysBack,
    });
  } catch (error) {
    logger.error('supportplane.tag_resolution.error', {}, { error: error as Error });
    return NextResponse.json(
      {
        error: 'Failed to fetch tag resolution data',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

export const GET = withAuth(handler);
