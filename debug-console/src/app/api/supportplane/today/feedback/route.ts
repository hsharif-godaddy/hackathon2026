import { type NextRequest, NextResponse } from 'next/server';

import { withAuth } from '@/lib/api-auth';
import { logger } from '@/lib/logger';
import { getRecentFeedback, type FeedbackRow } from '@/lib/supportplane/db/feedback-db';
import { getSpEnv } from '@/lib/supportplane/store/config';

export const dynamic = 'force-dynamic';

export const GET = withAuth(async function todayFeedback(_request: NextRequest) {
  const today: string = new Date().toISOString().split('T')[0]!;
  const yesterday: string = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0]!;
  const env: string = getSpEnv();

  try {
    const result = await getRecentFeedback(env, 5000, 0, { days: 2 });
    const rows: FeedbackRow[] = result.rows;
    const todayCount: number = rows.filter((r) => r.feedback_utc_ts?.slice(0, 10) === today).length;
    const yesterdayCount: number = rows.filter((r) => r.feedback_utc_ts?.slice(0, 10) === yesterday).length;
    const todayRows: FeedbackRow[] = rows.filter((r) => r.feedback_utc_ts?.slice(0, 10) === today);
    const ratedRows: FeedbackRow[] = todayRows.filter((r) => r.rating !== null && r.rating !== undefined);
    return NextResponse.json({
      today: todayCount,
      yesterday: yesterdayCount,
      delta: todayCount - yesterdayCount,
      sentiment: {
        positive: ratedRows.filter((r) => r.rating! >= 5).length,
        neutral: ratedRows.filter((r) => r.rating! === 4).length,
        negative: ratedRows.filter((r) => r.rating! <= 3).length,
      },
    });
  } catch (err) {
    const error: string = err instanceof Error ? err.message : String(err);
    logger.warn('supportplane.today.feedback.error', { error });
    return NextResponse.json({ today: 0, yesterday: 0, delta: 0, sentiment: { positive: 0, neutral: 0, negative: 0 }, error });
  }
});
