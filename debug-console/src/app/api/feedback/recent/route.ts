import { NextResponse } from 'next/server';

import { withAuth } from '@/lib/api-auth';
import {
  buildFeedbackRecent,
  feedbackWindowCacheKey,
  getFeedbackItemsCached,
  getFeedbackS3Bucket,
  parseFeedbackRequest,
} from '@/lib/feedback-s3';
import { routeCached } from '@/lib/route-cache';

export const dynamic = 'force-dynamic';

export const GET = withAuth(async (request, _auth) => {
  try {
    if (!getFeedbackS3Bucket()) {
      return NextResponse.json({ error: 'FEEDBACK_S3_BUCKET not configured' }, { status: 503 });
    }
    const window = parseFeedbackRequest(request.nextUrl.searchParams);
    if ('error' in window) {
      return NextResponse.json({ error: window.error }, { status: 400 });
    }
    const limitRaw = request.nextUrl.searchParams.get('limit');
    const parsed = limitRaw ? Number.parseInt(limitRaw, 10) : NaN;
    const limit = Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 500) : undefined;
    const recentOpts = limit !== undefined ? { limit, summaryMaxLen: 0 } : undefined;
    const cacheKey = `feedback_recent_${feedbackWindowCacheKey(window)}_l${limit ?? 'def'}_fs1`;
    const data = await routeCached(cacheKey, 180_000, async () => {
      const { items, merged_truncated, partition_errors } = await getFeedbackItemsCached(window);
      return {
        ...buildFeedbackRecent(items, window, merged_truncated, recentOpts),
        partition_errors,
      };
    });
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
});
