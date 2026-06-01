import { NextResponse } from 'next/server';

import { withAuth } from '@/lib/api-auth';
import {
  applyFeedbackFilters,
  buildExperimentCohorts,
  buildFeedbackFacets,
  buildFeedbackSummary,
  feedbackFiltersCacheKey,
  feedbackWindowCacheKey,
  filterFeedbackItemsForWindow,
  getFeedbackItemsCached,
  getFeedbackS3Bucket,
  parseFeedbackFilters,
  parseFeedbackRequest,
  parseFeedbackUtc,
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
    const filters = parseFeedbackFilters(request.nextUrl.searchParams);
    const cacheKey = `feedback_summary_${feedbackWindowCacheKey(window)}_${feedbackFiltersCacheKey(filters)}`;
    const data = await routeCached(cacheKey, 300_000, async () => {
      const { items, merged_truncated, partition_errors } = await getFeedbackItemsCached(window);
      // Facets are computed from the windowed (pre-filter) items so opening
      // any filter dropdown still shows every option in the time range —
      // applying a filter narrows the data, not the menu.
      const windowed = filterFeedbackItemsForWindow(items, window);
      const facets = buildFeedbackFacets(windowed);
      const filtered = applyFeedbackFilters(windowed, filters);
      // Timeline rides on the summary so the panel chart can show every
      // matching rating (recent/list is capped at 12 rows for the table).
      // Skip rating=0 — those rows have no actual score and would crush
      // the y-axis to the bottom edge.
      const timeline: Array<{ ts: number; rating: number }> = [];
      for (const item of filtered) {
        const ts = parseFeedbackUtc(String(item.feedback_utc_ts ?? ''));
        const r = Number(item.rating);
        if (!ts || !Number.isFinite(r) || r < 1 || r > 7) continue;
        timeline.push({ ts: ts.getTime(), rating: r });
      }
      timeline.sort((a, b) => a.ts - b.ts);
      // Compare variants for the experiments in the active filter so the
      // panel can answer "is the 'on' cohort driving feedback up vs 'off'?"
      // Run over `filtered` so any concurrent score/topic filters stay in
      // scope; the cohort builder still only counts rows that contain the
      // named experiment, so the experiments filter doesn't strip variants.
      const experimentCohorts =
        filters.experiments && filters.experiments.size > 0
          ? buildExperimentCohorts(filtered, filters.experiments)
          : {};
      return {
        ...buildFeedbackSummary(filtered, window, merged_truncated),
        facets,
        timeline,
        experimentCohorts,
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
