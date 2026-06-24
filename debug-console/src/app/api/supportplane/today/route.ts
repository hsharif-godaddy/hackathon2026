import { NextRequest, NextResponse } from 'next/server';

import { withAuth } from '@/lib/api-auth';
import { logger } from '@/lib/logger';
import { getRecentFeedback, type FeedbackRow } from '@/lib/supportplane/db/feedback-db';
import { queryTranscripts, type TranscriptRow } from '@/lib/supportplane/db/l1-transcript-db';
import { listTickets, type Ticket } from '@/lib/supportplane/db/support-db';
import { getSpEnv } from '@/lib/supportplane/store/config';

export const dynamic = 'force-dynamic';

interface TodayStats {
  date: string;
  transcripts: {
    today: number;
    yesterday: number;
    delta: number;
    error?: string;
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
    error?: string;
  };
  support: {
    open: number;
    resolved_today: number;
    p1_count: number;
    backlog_velocity: number;
    error?: string;
  };
}

async function safeQueryTranscripts(start: string, end: string): Promise<{ rows: TranscriptRow[]; error?: string }> {
  try {
    const rows: TranscriptRow[] = await queryTranscripts({ start_date: start, end_date: end });
    return { rows };
  } catch (err) {
    const msg: string = err instanceof Error ? err.message : String(err);
    logger.warn('supportplane.today.transcripts.error', { error: msg });
    return { rows: [], error: msg };
  }
}

async function safeFeedback(env: string): Promise<{ rows: FeedbackRow[]; error?: string }> {
  try {
    const result: { rows: FeedbackRow[]; total: number } = await getRecentFeedback(env, 5000, 0, { days: 2 });
    return { rows: result.rows };
  } catch (err) {
    const msg: string = err instanceof Error ? err.message : String(err);
    logger.warn('supportplane.today.feedback.error', { error: msg });
    return { rows: [], error: msg };
  }
}

async function safeTickets(): Promise<{ rows: Ticket[]; error?: string }> {
  try {
    const rows: Ticket[] = await listTickets({ limit: 5000 });
    return { rows };
  } catch (err) {
    const msg: string = err instanceof Error ? err.message : String(err);
    logger.warn('supportplane.today.tickets.error', { error: msg });
    return { rows: [], error: msg };
  }
}

export const GET = withAuth(async function todayStats(_request: NextRequest) {
  const today: string = new Date().toISOString().split('T')[0]!;
  const yesterday: string = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0]!;
  const env: string = getSpEnv();

  const [transcriptResult, feedbackResult, ticketResult] = await Promise.all([
    safeQueryTranscripts(`${yesterday}T00:00:00.000Z`, `${today}T23:59:59.999Z`),
    safeFeedback(env),
    safeTickets(),
  ]);

  // L1 Transcripts
  const transcriptRows: TranscriptRow[] = transcriptResult.rows;
  const transcriptsToday: number = transcriptRows.filter((r) => r.created_at?.slice(0, 10) === today).length;
  const transcriptsYesterday: number = transcriptRows.filter((r) => r.created_at?.slice(0, 10) === yesterday).length;

  // Feedback
  const feedbackRows: FeedbackRow[] = feedbackResult.rows;
  const feedbackToday: number = feedbackRows.filter((r) => r.feedback_utc_ts?.slice(0, 10) === today).length;
  const feedbackYesterday: number = feedbackRows.filter((r) => r.feedback_utc_ts?.slice(0, 10) === yesterday).length;
  const todayFeedback: FeedbackRow[] = feedbackRows.filter((r) => r.feedback_utc_ts?.slice(0, 10) === today);
  const positive: number = todayFeedback.filter((r) => (r.rating ?? 0) >= 5).length;
  const neutral: number = todayFeedback.filter((r) => r.rating === 4).length;
  const negative: number = todayFeedback.filter((r) => r.rating !== null && r.rating !== undefined && r.rating <= 3).length;

  // Support Tickets
  const resolved: Set<string> = new Set(['Done', 'Closed']);
  const tickets: Ticket[] = ticketResult.rows;
  const openCount: number = tickets.filter((t) => !resolved.has(t.status ?? '')).length;
  const resolvedToday: number = tickets.filter((t) => t.resolved_utc?.slice(0, 10) === today).length;
  const p1Count: number = tickets.filter((t) => t.priority === 'P1' && !resolved.has(t.status ?? '')).length;
  const createdToday: number = tickets.filter((t) => t.created_utc?.slice(0, 10) === today).length;

  const stats: TodayStats = {
    date: today,
    transcripts: {
      today: transcriptsToday,
      yesterday: transcriptsYesterday,
      delta: transcriptsToday - transcriptsYesterday,
      ...(transcriptResult.error ? { error: transcriptResult.error } : {}),
    },
    feedback: {
      today: feedbackToday,
      yesterday: feedbackYesterday,
      delta: feedbackToday - feedbackYesterday,
      sentiment: { positive, neutral, negative },
      ...(feedbackResult.error ? { error: feedbackResult.error } : {}),
    },
    support: {
      open: openCount,
      resolved_today: resolvedToday,
      p1_count: p1Count,
      backlog_velocity: createdToday - resolvedToday,
      ...(ticketResult.error ? { error: ticketResult.error } : {}),
    },
  };

  return NextResponse.json(stats);
});
