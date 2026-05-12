import { NextResponse } from 'next/server';

import { withAuth } from '@/lib/api-auth';
import { getLangfuseEbConfig } from '@/lib/langfuse-eb-client';
import { logger } from '@/lib/logger';

const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const LIST_LIMIT = 40;
const DETAIL_BATCH_SIZE = 20;

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

export const GET = withAuth<{ sessionId: string }>(async function ebSessionTraces(request, _auth, context) {
  const requestStartedAt = Date.now();
  let sessionIdForLog = 'unknown';
  try {
    const lf = getLangfuseEbConfig();
    if (!lf) {
      logger.error('langfuse.eb.sessionTraces.config.missing');
      return NextResponse.json({ error: 'Langfuse EB credentials not configured' }, { status: 500 });
    }

    const { sessionId } = await context.params;
    sessionIdForLog = sessionId;
    if (!SESSION_ID_RE.test(sessionId)) {
      logger.warn('langfuse.eb.sessionTraces.id.invalid', { length: sessionId.length });
      return NextResponse.json({ error: 'Invalid sessionId' }, { status: 400 });
    }

    logger.info('langfuse.eb.sessionTraces.request.start', { sessionId });

    const tracesParams = new URLSearchParams({
      page: '1',
      limit: String(LIST_LIMIT),
      sessionId,
    });

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
        'langfuse.eb.sessionTraces.list.error',
        { sessionId, status: tracesResponse.status, message: errorText.slice(0, 200) },
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
    const totalItems = tracesData.meta?.totalItems ?? traceIds.length;

    const fullTraces: EbTrace[] = [];
    for (let i = 0; i < traceIds.length; i += DETAIL_BATCH_SIZE) {
      if (request.signal.aborted) break;
      const batch = traceIds.slice(i, i + DETAIL_BATCH_SIZE);
      const batchResults = await Promise.all(
        batch.map(async function fetchOne(traceId: string) {
          try {
            const traceResponse = await fetch(`${lf.baseUrl}/api/public/traces/${traceId}`, {
              headers: {
                Authorization: lf.authHeader,
                'Content-Type': 'application/json',
                'Accept-Encoding': 'gzip, deflate, br',
              },
              signal: request.signal,
            });
            if (!traceResponse.ok) return null;
            return (await traceResponse.json()) as EbTrace;
          } catch {
            return null;
          }
        }),
      );
      for (const t of batchResults) {
        if (t) fullTraces.push(t);
      }
    }

    fullTraces.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    logger.info(
      'langfuse.eb.sessionTraces.request.success',
      { sessionId, listed: traceIds.length, fetched: fullTraces.length },
      { duration: Date.now() - requestStartedAt },
    );

    return NextResponse.json({
      sessionId,
      traces: fullTraces,
      totalItems,
      listedTraceIds: traceIds.length,
      fetchedTraces: fullTraces.length,
    });
  } catch (error) {
    const aborted = (error as Error)?.name === 'AbortError' || request.signal.aborted;
    if (aborted) {
      logger.info(
        'langfuse.eb.sessionTraces.request.aborted',
        { sessionId: sessionIdForLog },
        { duration: Date.now() - requestStartedAt },
      );
      return new NextResponse(null, { status: 499 });
    }
    logger.error(
      'langfuse.eb.sessionTraces.request.failure',
      { sessionId: sessionIdForLog },
      { error: error as Error, duration: Date.now() - requestStartedAt },
    );
    return NextResponse.json(
      {
        error: 'Failed to fetch Langfuse EB session traces',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
});
