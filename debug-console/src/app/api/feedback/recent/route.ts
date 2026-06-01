import { NextResponse } from 'next/server';

import { withAuth } from '@/lib/api-auth';
import {
  applyFeedbackFilters,
  buildFeedbackByApp,
  buildFeedbackRecent,
  feedbackFiltersCacheKey,
  feedbackWindowCacheKey,
  getFeedbackItemsCached,
  getFeedbackS3Bucket,
  parseFeedbackFilters,
  parseFeedbackRequest,
  type FeedbackWindow,
} from '@/lib/feedback-s3';
import { routeCached, setRouteCache } from '@/lib/route-cache';

export const dynamic = 'force-dynamic';

export const GET = withAuth(async (request, _auth) => {
  try {
    if (!getFeedbackS3Bucket()) {
      return NextResponse.json({ error: 'FEEDBACK_S3_BUCKET not configured' }, { status: 503 });
    }
    const sp = request.nextUrl.searchParams;
    const appId = sp.get('appId')?.trim() || undefined;

    // Per-app callers need a wider default window: traffic for a single app
    // is sparse, and the panel is meant to show "progress" over time. The
    // explicit `days`/`start`/`end`/`all` params still win when present.
    let window: FeedbackWindow;
    const hasExplicitWindow =
      sp.get('days') || sp.get('start') || sp.get('end') || sp.get('all');
    if (appId && !hasExplicitWindow) {
      window = { kind: 'rolling', days: 90 };
    } else {
      const parsed = parseFeedbackRequest(sp);
      if ('error' in parsed) {
        return NextResponse.json({ error: parsed.error }, { status: 400 });
      }
      window = parsed;
    }

    // Score / topics / experiments only apply to the analytics caller (no
    // appId). The per-app dashboard wants the full row set so it can drive
    // its own client-side expansion + deeplink-target search.
    const filters = appId ? { scores: undefined, topics: undefined, experiments: undefined } : parseFeedbackFilters(sp);

    const limitRaw = sp.get('limit');
    const parsedLimit = limitRaw ? Number.parseInt(limitRaw, 10) : NaN;
    const limit = Number.isInteger(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 500) : undefined;
    const recentOpts = limit !== undefined ? { limit, summaryMaxLen: 0 } : undefined;
    const cacheKey = `feedback_recent_${feedbackWindowCacheKey(window)}_app${appId ?? ''}_l${limit ?? 'def'}_${feedbackFiltersCacheKey(filters)}_fs2`;

    // `?force=1` from the panel's Refresh button bypasses BOTH the
    // 180s route cache and the 120s in-process item cache. Without this,
    // a user clicking Refresh sees identical data for up to 3 minutes —
    // the entire purpose of the button defeated. The bypass still pays
    // the underlying S3 cost; this is intentional (button is operator-only).
    const force = sp.get('force') === '1';

    const fetchFresh = async () => {
      const { items, merged_truncated, partition_errors } = await getFeedbackItemsCached(window, appId, force);
      if (appId) {
        return {
          ...buildFeedbackByApp(items, window, merged_truncated),
          partition_errors,
        };
      }
      const filtered = applyFeedbackFilters(items, filters);
      return {
        ...buildFeedbackRecent(filtered, window, merged_truncated, recentOpts),
        partition_errors,
      };
    };

    let data;
    if (force) {
      data = await fetchFresh();
      // Seed the route cache so concurrent dashboard readers (other
      // operators on the same app) see the fresh result immediately
      // instead of reading the stale pre-refresh entry sitting in cache
      // until its natural 180s TTL expires. Without this, a force-refresh
      // fixes the clicker's view but other tabs keep reading stale data.
      setRouteCache(cacheKey, data, 180_000);
    } else {
      data = await routeCached(cacheKey, 180_000, fetchFresh);
    }
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
});
