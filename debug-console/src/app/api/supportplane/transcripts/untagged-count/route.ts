import { NextRequest, NextResponse } from 'next/server';

import { withAuth } from '@/lib/api-auth';
import { logger } from '@/lib/logger';
import { getAllTranscriptsCached } from '@/lib/supportplane/db/transcript-cache';
import type { TranscriptRow } from '@/lib/supportplane/db/l1-transcript-db';

// 5-minute cache — the underlying transcript scan is already cached for 15 min,
// so this TTL just avoids re-counting on every page navigation.
const UNTAGGED_CACHE_TTL_MS = 300_000;
let untaggedCache: { expiresAt: number; count: number } | null = null;

async function handler(_request: NextRequest): Promise<NextResponse> {
  try {
    if (untaggedCache && untaggedCache.expiresAt > Date.now()) {
      return NextResponse.json({ success: true, untagged: untaggedCache.count });
    }

    // Use shared full-scan cache — avoids a separate countTableScan that bypasses caching.
    const rows: TranscriptRow[] = await getAllTranscriptsCached();
    const count: number = rows.filter((r: TranscriptRow) => {
      const noTags: boolean = !r.tags || (Array.isArray(r.tags) ? r.tags.length === 0 : r.tags === '[]' || r.tags === '');
      const hasTranscript: boolean = Boolean(r.full_transcript && r.full_transcript !== '');
      return noTags && hasTranscript;
    }).length;

    untaggedCache = { expiresAt: Date.now() + UNTAGGED_CACHE_TTL_MS, count };
    return NextResponse.json({ success: true, untagged: count });
  } catch (error: unknown) {
    logger.error('supportplane.transcripts.untaggedCount.error', {}, { error: error as Error });
    return NextResponse.json(
      { error: 'Failed to count untagged transcripts', message: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}

export const GET = withAuth(handler);
