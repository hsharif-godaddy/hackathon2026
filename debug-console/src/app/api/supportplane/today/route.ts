import { NextRequest, NextResponse } from 'next/server';

import { withAuth } from '@/lib/api-auth';
import { logger } from '@/lib/logger';
import { getL1TranscriptsDb } from '@/lib/l1-transcript-db';
import { getFeedbackDb } from '@/lib/feedback-db';
import { getSupportDb } from '@/lib/support-db';

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

/**
 * GET /api/supportplane/today
 *
 * Cross-domain daily rollup for executive TODAY dashboard
 */
export const GET = withAuth(async function todayStats(_request: NextRequest) {
  try {
    const today = new Date().toISOString().split('T')[0];
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    // L1 Transcripts
    const transcriptsDb = getL1TranscriptsDb();
    const transcriptsToday = transcriptsDb.prepare(
      'SELECT COUNT(*) as count FROM l1_transcripts WHERE DATE(created_at) = ?'
    ).get(today) as { count: number };
    const transcriptsYesterday = transcriptsDb.prepare(
      'SELECT COUNT(*) as count FROM l1_transcripts WHERE DATE(created_at) = ?'
    ).get(yesterday) as { count: number };

    // Feedback
    const feedbackDb = getFeedbackDb();
    const feedbackToday = feedbackDb.prepare(
      'SELECT COUNT(*) as count FROM feedback_raw WHERE DATE(feedback_utc_ts) = ?'
    ).get(today) as { count: number };
    const feedbackYesterday = feedbackDb.prepare(
      'SELECT COUNT(*) as count FROM feedback_raw WHERE DATE(feedback_utc_ts) = ?'
    ).get(yesterday) as { count: number };

    // Feedback sentiment (1-3 negative, 4 neutral, 5-7 positive)
    const sentiment = feedbackDb.prepare(`
      SELECT
        SUM(CASE WHEN rating >= 5 THEN 1 ELSE 0 END) as positive,
        SUM(CASE WHEN rating = 4 THEN 1 ELSE 0 END) as neutral,
        SUM(CASE WHEN rating <= 3 AND rating IS NOT NULL THEN 1 ELSE 0 END) as negative
      FROM feedback_raw
      WHERE DATE(feedback_utc_ts) = ?
    `).get(today) as { positive: number; neutral: number; negative: number };

    // Support Tickets
    const supportDb = getSupportDb();
    const openTickets = supportDb.prepare(
      'SELECT COUNT(*) as count FROM tickets WHERE status NOT IN (?, ?)'
    ).get('Done', 'Closed') as { count: number };
    const resolvedToday = supportDb.prepare(
      'SELECT COUNT(*) as count FROM tickets WHERE DATE(resolved_utc) = ?'
    ).get(today) as { count: number };
    const p1Count = supportDb.prepare(
      'SELECT COUNT(*) as count FROM tickets WHERE priority = ? AND status NOT IN (?, ?)'
    ).get('P1', 'Done', 'Closed') as { count: number };

    const createdToday = supportDb.prepare(
      'SELECT COUNT(*) as count FROM tickets WHERE DATE(created_utc) = ?'
    ).get(today) as { count: number };
    const backlogVelocity = createdToday.count - resolvedToday.count;

    const stats: TodayStats = {
      date: today,
      transcripts: {
        today: transcriptsToday.count,
        yesterday: transcriptsYesterday.count,
        delta: transcriptsToday.count - transcriptsYesterday.count,
      },
      feedback: {
        today: feedbackToday.count,
        yesterday: feedbackYesterday.count,
        delta: feedbackToday.count - feedbackYesterday.count,
        sentiment: {
          positive: sentiment.positive ?? 0,
          neutral: sentiment.neutral ?? 0,
          negative: sentiment.negative ?? 0,
        },
      },
      support: {
        open: openTickets.count,
        resolved_today: resolvedToday.count,
        p1_count: p1Count.count,
        backlog_velocity: backlogVelocity,
      },
    };

    return NextResponse.json(stats);
  } catch (err) {
    logger.error('supportplane.today.error', {}, { error: err as Error });
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
});
