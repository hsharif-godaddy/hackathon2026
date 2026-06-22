import { NextRequest, NextResponse } from 'next/server';

import { withAuth } from '@/lib/api-auth';
import { logger } from '@/lib/logger';
import { queryTranscripts } from '@/lib/l1-transcript-db';
import { getRecentFeedback } from '@/lib/feedback-db';
import { listTickets } from '@/lib/support-db';

export const dynamic = 'force-dynamic';

interface TodayStats {
  date: string;
  transcripts: {
    today: number;
    yesterday: number;
    delta: number;
  };
  feedback: {
    today: number;
    yesterday: number;
    delta: number;
    sentiment: {
      positive: number;
      neutral: number;
      negative: number;
    };
  };
  support: {
    open: number;
    resolved_today: number;
    p1_count: number;
    backlog_velocity: number;
  };
}

export const GET = withAuth(async function todayStats(_request: NextRequest) {
  try {
    const today = new Date().toISOString().split('T')[0]!;
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0]!;
    const yesterdayStart = `${yesterday}T00:00:00.000Z`;
    const todayEnd = `${today}T23:59:59.999Z`;
    const env = process.env.FEEDBACK_ENV ?? process.env.SP_ENV ?? 'dev';

    const [transcriptRows, feedbackResult, tickets] = await Promise.all([
      queryTranscripts({ start_date: yesterdayStart, end_date: todayEnd }),
      getRecentFeedback(env, 5000, 0, { days: 2 }),
      listTickets({ limit: 5000 }),
    ]);

    // L1 Transcripts
    const transcriptsToday = transcriptRows.filter((r) => r.created_at?.slice(0, 10) === today).length;
    const transcriptsYesterday = transcriptRows.filter((r) => r.created_at?.slice(0, 10) === yesterday).length;

    // Feedback counts
    const feedbackRows = feedbackResult.rows;
    const feedbackToday = feedbackRows.filter((r) => r.feedback_utc_ts?.slice(0, 10) === today).length;
    const feedbackYesterday = feedbackRows.filter((r) => r.feedback_utc_ts?.slice(0, 10) === yesterday).length;

    const todayFeedback = feedbackRows.filter((r) => r.feedback_utc_ts?.slice(0, 10) === today);
    const positive = todayFeedback.filter((r) => (r.rating ?? 0) >= 5).length;
    const neutral = todayFeedback.filter((r) => r.rating === 4).length;
    const negative = todayFeedback.filter((r) => (r.rating ?? 0) <= 3 && r.rating !== null).length;

    // Support Tickets
    const resolved = new Set(['Done', 'Closed']);
    const openCount = tickets.filter((t) => !resolved.has(t.status ?? '')).length;
    const resolvedToday = tickets.filter((t) => t.resolved_utc?.slice(0, 10) === today).length;
    const p1Count = tickets.filter((t) => t.priority === 'P1' && !resolved.has(t.status ?? '')).length;
    const createdToday = tickets.filter((t) => t.created_utc?.slice(0, 10) === today).length;
    const backlogVelocity = createdToday - resolvedToday;

    const stats: TodayStats = {
      date: today,
      transcripts: { today: transcriptsToday, yesterday: transcriptsYesterday, delta: transcriptsToday - transcriptsYesterday },
      feedback: {
        today: feedbackToday, yesterday: feedbackYesterday, delta: feedbackToday - feedbackYesterday,
        sentiment: { positive, neutral, negative },
      },
      support: { open: openCount, resolved_today: resolvedToday, p1_count: p1Count, backlog_velocity: backlogVelocity },
    };

    return NextResponse.json(stats);
  } catch (err) {
    logger.error('supportplane.today.error', {}, { error: err as Error });
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 });
  }
});
