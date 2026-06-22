import { NextRequest, NextResponse } from 'next/server';

import { withAuth } from '@/lib/api-auth';
import { logger } from '@/lib/logger';
import { queryTranscripts } from '@/lib/l1-transcript-db';

const UNTAGGED_CACHE_TTL_MS = 30000;
let untaggedCache: { expiresAt: number; count: number } | null = null;

async function handler(request: NextRequest) {
  try {
    if (untaggedCache && untaggedCache.expiresAt > Date.now()) {
      return NextResponse.json({
        success: true,
        untagged: untaggedCache.count,
      });
    }

    const rows = await queryTranscripts({});
    const count = rows.filter(
      (row) =>
        (row.tags === null || row.tags === undefined) &&
        row.full_transcript !== null &&
        row.full_transcript !== undefined &&
        row.full_transcript !== ''
    ).length;

    untaggedCache = {
      expiresAt: Date.now() + UNTAGGED_CACHE_TTL_MS,
      count,
    };

    return NextResponse.json({
      success: true,
      untagged: count,
    });
  } catch (error) {
    logger.error('supportplane.transcripts.untaggedCount.error', {}, { error: error as Error });
    return NextResponse.json(
      {
        error: 'Failed to count untagged transcripts',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

export const GET = withAuth(handler);
