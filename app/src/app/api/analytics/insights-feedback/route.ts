import { randomUUID } from 'node:crypto';

import { after, NextRequest, NextResponse } from 'next/server';

import {
  buildInsightsFeedbackRow,
  getClickHouseInsightsFeedbackConfig,
  insertInsightsFeedbackRow,
} from '@/lib/clickhouse/insights-feedback-insert';
import { type CustomerAuthContext, withCustomerAuth } from '@/lib/customer-auth';
import { logger } from '@/lib/request-context';
import { type InsightKind, parseInsightKind } from '@/types/analytics';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Vote = 'up' | 'down' | 'none';

interface InsightsFeedbackPayload {
  vote: Vote;
  appId: string | null;
  pageHostId: string | null;
  insightKind: InsightKind;
  insightTitle: string | null;
  insightBody: string | null;
  partitionSnapDate: string | null;
  insightRaw: unknown;
}

function vote(value: unknown): Vote | null {
  return value === 'up' || value === 'down' || value === 'none' ? value : null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

export const POST = withCustomerAuth(async (
  request: NextRequest,
  authContext: CustomerAuthContext,
): Promise<NextResponse> => {
  const clickhouseConfig = getClickHouseInsightsFeedbackConfig();

  // Content-Length is required: unknown-length bodies are rejected with 400 instead of skipping
  // this guard. The header is only a pre-parse hint; if it understates the real body, Next.js
  // body size limits still cap what we read.
  const rawContentLength = request.headers.get('content-length');
  if (rawContentLength === null || rawContentLength.trim() === '') {
    return NextResponse.json({ error: 'Content-Length header is required' }, { status: 400 });
  }
  const trimmedLength = rawContentLength.trim();
  if (!/^\d+$/.test(trimmedLength)) {
    return NextResponse.json({ error: 'Invalid Content-Length' }, { status: 400 });
  }
  const contentLength = Number(trimmedLength);
  if (contentLength > 200_000) {
    return NextResponse.json({ error: 'Request body too large' }, { status: 413 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch (err) {
    logger.warn('analytics.insightsFeedback.invalid_payload', {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
  }

  const payload = body as Partial<InsightsFeedbackPayload>;
  const parsedVote = vote(payload.vote);
  const parsedKind = parseInsightKind(payload.insightKind);
  if (!parsedVote || !parsedKind) {
    return NextResponse.json({ error: 'Invalid vote or insightKind' }, { status: 400 });
  }

  const feedbackId = randomUUID();
  const row = buildInsightsFeedbackRow({
    feedbackId,
    vote: parsedVote,
    appId: str(payload.appId),
    pageHostId: str(payload.pageHostId),
    insightKind: parsedKind,
    insightTitle: str(payload.insightTitle),
    insightBody: str(payload.insightBody),
    partitionSnapDate: str(payload.partitionSnapDate),
    insightRaw: payload.insightRaw ?? null,
    customerId: authContext.user.customerId ?? null,
  });

  if (!clickhouseConfig) {
    logger.warn('analytics.insightsFeedback.clickhouse.skipped_not_configured', { feedbackId });
    return NextResponse.json({ success: true, feedbackId, persisted: false });
  }

  const chConfig = clickhouseConfig;

  // Schedule ClickHouse after the response so latency does not depend on upstream CH (matches fire-and-forget UI).
  after(async () => {
    try {
      await insertInsightsFeedbackRow(row, chConfig);
    } catch (err) {
      logger.error('analytics.insightsFeedback.clickhouse.insert_failed', {
        feedbackId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  return NextResponse.json({ success: true, feedbackId, persisted: false });
});
