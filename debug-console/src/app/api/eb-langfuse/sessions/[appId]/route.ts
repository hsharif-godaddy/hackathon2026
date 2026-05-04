import { NextResponse } from 'next/server';

import { withAuth } from '@/lib/api-auth';
import { buildAppIdFilter, getLangfuseEbConfig } from '@/lib/langfuse-eb-client';
import { logger } from '@/lib/logger';

interface EbObservation {
  id: string;
  name: string;
  type: string;
  model?: string;
  input?: unknown;
  output?: unknown;
  statusMessage?: string;
  level?: string;
  parentObservationId?: string;
  startTime?: string;
  endTime?: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  calculatedInputCost?: number;
  calculatedOutputCost?: number;
  calculatedTotalCost?: number;
  metadata?: unknown;
}

interface EbScore {
  id: string;
  name: string;
  value?: number | string | null;
  stringValue?: string | null;
  comment?: string | null;
  dataType?: string;
  source?: string;
}

interface EbTrace {
  id: string;
  name: string | null;
  timestamp: string;
  sessionId: string | null;
  userId: string | null;
  input: unknown;
  output: unknown;
  metadata: Record<string, unknown> | null;
  tags: string[];
  environment?: string | null;
  totalCost?: number | null;
  latency?: number | null;
  scores?: EbScore[];
  observations?: EbObservation[];
}

interface EbSession {
  sessionId: string;
  traces: EbTrace[];
  firstTrace: string;
  lastTrace: string;
  traceCount: number;
  totalCost: number;
}

const PAGE_SIZE = 20;
const DETAIL_BATCH_SIZE = 20;
// Same shape as the agent routes' APP_ID_RE: alphanumeric + `_-`, 1..128 chars.
const APP_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

export const GET = withAuth<{ appId: string }>(async function ebSessions(request, _auth, context) {
  const requestStartedAt = Date.now();
  let appIdForLog = 'unknown';
  try {
    const lf = getLangfuseEbConfig();
    if (!lf) {
      logger.error('langfuse.eb.sessions.config.missing');
      return NextResponse.json(
        { error: 'Langfuse EB credentials not configured' },
        { status: 500 },
      );
    }

    const { appId } = await context.params;
    if (!APP_ID_RE.test(appId)) {
      logger.warn('langfuse.eb.sessions.appId.invalid', { length: appId.length });
      return NextResponse.json({ error: 'Invalid appId' }, { status: 400 });
    }
    appIdForLog = appId;
    const searchParams = request.nextUrl.searchParams;
    const fromTimestamp = searchParams.get('fromTimestamp');
    const toTimestamp = searchParams.get('toTimestamp');
    const pageRaw = parseInt(searchParams.get('page') || '1', 10);
    const requestedPage = Number.isFinite(pageRaw) && pageRaw > 0 ? Math.min(pageRaw, 10_000) : 1;

    logger.info('langfuse.eb.sessions.request.start', {
      appId,
      page: requestedPage,
      pageSize: PAGE_SIZE,
      hasFromTimestamp: !!fromTimestamp,
      hasToTimestamp: !!toTimestamp,
    });

    const tracesParams = new URLSearchParams({
      page: String(requestedPage),
      limit: String(PAGE_SIZE),
      filter: buildAppIdFilter(appId),
    });
    if (fromTimestamp) tracesParams.append('fromTimestamp', fromTimestamp);
    if (toTimestamp) tracesParams.append('toTimestamp', toTimestamp);

    const tracesRequestStartedAt = Date.now();
    const tracesResponse = await fetch(`${lf.baseUrl}/api/public/traces?${tracesParams}`, {
      headers: {
        Authorization: lf.authHeader,
        'Content-Type': 'application/json',
        'Accept-Encoding': 'gzip, deflate, br',
      },
      signal: request.signal,
    });

    if (!tracesResponse.ok) {
      const errorText = await tracesResponse.text();
      logger.warn(
        'langfuse.eb.sessions.list.error',
        {
          appId,
          page: requestedPage,
          status: tracesResponse.status,
          message: errorText.slice(0, 200),
        },
        { duration: Date.now() - tracesRequestStartedAt },
      );
      return NextResponse.json(
        { error: `Langfuse EB API error: ${tracesResponse.status}`, message: errorText },
        { status: tracesResponse.status },
      );
    }

    const tracesData = await tracesResponse.json();
    const listItems = (tracesData.data || []) as Array<{ id: string }>;
    const traceIds = listItems.map((t) => t.id);
    const totalPages = tracesData.meta?.totalPages || 1;
    const totalItems = tracesData.meta?.totalItems ?? null;
    const hasMore = requestedPage < totalPages;

    logger.info(
      'langfuse.eb.sessions.list.success',
      {
        appId,
        page: requestedPage,
        returnedTraceIds: traceIds.length,
        totalItems,
        totalPages,
        hasMore,
      },
      { duration: Date.now() - tracesRequestStartedAt },
    );

    const fullTraces: EbTrace[] = [];
    let failedFetches = 0;
    const failureSamples: Array<{ traceId: string; status?: number; error?: string }> = [];

    for (let i = 0; i < traceIds.length; i += DETAIL_BATCH_SIZE) {
      if (request.signal.aborted) break;
      const batch = traceIds.slice(i, i + DETAIL_BATCH_SIZE);
      const batchResults = await Promise.all(
        batch.map(async function fetchOne(traceId) {
          try {
            const traceResponse = await fetch(`${lf.baseUrl}/api/public/traces/${traceId}`, {
              headers: {
                Authorization: lf.authHeader,
                'Content-Type': 'application/json',
                'Accept-Encoding': 'gzip, deflate, br',
              },
              signal: request.signal,
            });
            if (!traceResponse.ok) {
              failedFetches++;
              if (failureSamples.length < 5) {
                failureSamples.push({ traceId, status: traceResponse.status });
              }
              return null;
            }
            return (await traceResponse.json()) as EbTrace;
          } catch (err) {
            failedFetches++;
            if (failureSamples.length < 5) {
              failureSamples.push({ traceId, error: (err as Error)?.name ?? 'unknown' });
            }
            return null;
          }
        }),
      );
      for (const t of batchResults) {
        if (t) fullTraces.push(t);
      }
    }

    const degraded = traceIds.length > 0 && failedFetches > traceIds.length / 2;
    const completeLog = {
      appId,
      page: requestedPage,
      requestedTraceIds: traceIds.length,
      fetchedTraces: fullTraces.length,
      failedFetches,
      ...(failureSamples.length > 0 && { failureSamples }),
    };
    if (degraded) {
      logger.warn('langfuse.eb.sessions.details.degraded', completeLog);
    } else {
      logger.info('langfuse.eb.sessions.details.complete', completeLog);
    }

    const sessionMap = new Map<string, EbSession>();
    for (const trace of fullTraces) {
      const sessionId = trace.sessionId || 'no-session';
      let session = sessionMap.get(sessionId);
      if (!session) {
        session = {
          sessionId,
          traces: [],
          firstTrace: trace.timestamp,
          lastTrace: trace.timestamp,
          traceCount: 0,
          totalCost: 0,
        };
        sessionMap.set(sessionId, session);
      }
      session.traces.push(trace);
      session.traceCount++;
      session.totalCost += trace.totalCost || 0;
      if (new Date(trace.timestamp) < new Date(session.firstTrace)) {
        session.firstTrace = trace.timestamp;
      }
      if (new Date(trace.timestamp) > new Date(session.lastTrace)) {
        session.lastTrace = trace.timestamp;
      }
    }

    for (const session of sessionMap.values()) {
      session.traces.sort(
        (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
      );
    }

    const sessions = Array.from(sessionMap.values()).sort(
      (a, b) => new Date(b.lastTrace).getTime() - new Date(a.lastTrace).getTime(),
    );

    const warnings: string[] = [];
    if (failedFetches > 0) {
      warnings.push(`Failed to fetch ${failedFetches} of ${traceIds.length} traces`);
    }

    logger.info(
      'langfuse.eb.sessions.request.success',
      {
        appId,
        page: requestedPage,
        sessions: sessions.length,
        totalTraces: fullTraces.length,
        failedFetches,
        warnings: warnings.length,
      },
      { duration: Date.now() - requestStartedAt },
    );

    return NextResponse.json({
      appId,
      sessions,
      totalTraces: fullTraces.length,
      totalItems,
      pagination: {
        page: requestedPage,
        totalPages,
        hasMore,
      },
      ...(warnings.length > 0 && { warnings }),
    });
  } catch (error) {
    const aborted = (error as Error)?.name === 'AbortError' || request.signal.aborted;
    if (aborted) {
      logger.info('langfuse.eb.sessions.request.aborted', { appId: appIdForLog }, { duration: Date.now() - requestStartedAt });
      return new NextResponse(null, { status: 499 });
    }
    logger.error(
      'langfuse.eb.sessions.request.error',
      { appId: appIdForLog },
      { error: error as Error, duration: Date.now() - requestStartedAt },
    );
    return NextResponse.json(
      {
        error: 'Failed to fetch Langfuse EB sessions',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
});
