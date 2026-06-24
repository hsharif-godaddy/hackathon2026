import { type NextRequest, NextResponse } from 'next/server';

import { withAuth } from '@/lib/api-auth';
import { logger } from '@/lib/logger';
import { getAllTranscriptsCached } from '@/lib/supportplane/db/transcript-cache';
import type { TranscriptRow } from '@/lib/supportplane/db/l1-transcript-db';

export const dynamic = 'force-dynamic';

export const GET = withAuth(async function todayTranscripts(_request: NextRequest) {
  const today: string = new Date().toISOString().split('T')[0]!;
  const yesterday: string = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0]!;

  try {
    // Use shared full-scan cache — avoids a FilterExpression that bypasses caching.
    // Date filtering is done in JS so all transcript routes share the same warm scan.
    const allRows: TranscriptRow[] = await getAllTranscriptsCached();
    const rows: TranscriptRow[] = allRows.filter(
      (r: TranscriptRow) => (r.created_at ?? '') >= `${yesterday}T00:00:00.000Z` && (r.created_at ?? '') <= `${today}T23:59:59.999Z`,
    );
    const todayCount: number = rows.filter((r: TranscriptRow) => r.created_at?.slice(0, 10) === today).length;
    const yesterdayCount: number = rows.filter((r: TranscriptRow) => r.created_at?.slice(0, 10) === yesterday).length;
    return NextResponse.json({ today: todayCount, yesterday: yesterdayCount, delta: todayCount - yesterdayCount });
  } catch (err) {
    const error: string = err instanceof Error ? err.message : String(err);
    logger.warn('supportplane.today.transcripts.error', { error });
    return NextResponse.json({ today: 0, yesterday: 0, delta: 0, error });
  }
});
