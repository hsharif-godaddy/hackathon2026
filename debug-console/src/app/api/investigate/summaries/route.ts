import { NextResponse } from 'next/server';

import { withAuth } from '@/lib/api-auth';
import { listLatestSummariesByDate } from '@/lib/investigate/summaries';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_PAGE_SIZE = 200;

interface ListedSummary {
  investigationId: string;
  appId: string;
  customerId: string;
  status: 'completed' | 'failed' | 'killed';
  startedAt: string;
  completedAt: string;
  durationMs: number | null;
  startedBy: string;
  feedbackExcerpt: string;
  sentiment: 'positive' | 'neutral' | 'negative' | null;
  confidence: number | null;
  rootCause: string | null;
  category: string | null;
  reportAvailable: boolean;
  error: string | null;
}

export const GET = withAuth(async (request) => {
  const url = new URL(request.url);
  const date = url.searchParams.get('date');
  if (!date || !DATE_RE.test(date)) {
    return NextResponse.json({ error: 'date query param required (yyyy-mm-dd)' }, { status: 400 });
  }
  const continuationToken = url.searchParams.get('nextToken') || undefined;
  const pageSizeRaw = Number(url.searchParams.get('pageSize'));
  const pageSize = Number.isFinite(pageSizeRaw) && pageSizeRaw > 0 ? Math.min(pageSizeRaw, MAX_PAGE_SIZE) : 50;

  // listLatestSummariesByDate reads summaries/latest/{date}/ — 1 object per app
  // per day. S3 pagination unit = unique app, so nextToken maps cleanly to
  // "next N apps" with zero wasted GETs or client-side dedup.
  // Filters (appId substring, status, sentiment) applied client-side so
  // pagination always yields N apps regardless of filter sparsity.
  let page;
  try {
    page = await listLatestSummariesByDate(date, { pageSize, continuationToken });
  } catch (err) {
    logger.error('investigate.summaries.list.failed', { date }, { error: err as Error });
    return NextResponse.json({ error: 'list_failed' }, { status: 503 });
  }

  const items = page.items;

  const trimmed: ListedSummary[] = items.map((s) => ({
    investigationId: s.investigationId,
    appId: s.appId,
    customerId: s.customerId,
    status: s.status,
    startedAt: s.startedAt,
    completedAt: s.completedAt,
    durationMs: s.durationMs,
    startedBy: s.startedBy,
    feedbackExcerpt: s.feedbackExcerpt,
    sentiment: s.sentiment,
    confidence: s.confidence,
    rootCause: s.rootCause,
    category: s.category,
    reportAvailable: s.reportAvailable,
    error: s.error,
  }));

  return NextResponse.json({ items: trimmed, nextToken: page.nextToken });
});
