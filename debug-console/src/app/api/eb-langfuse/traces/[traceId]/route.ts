import { NextResponse } from 'next/server';

import { withAuth } from '@/lib/api-auth';
import { getLangfuseEbConfig } from '@/lib/langfuse-eb-client';
import { logger } from '@/lib/logger';

const TRACE_ID_RE = /^[a-zA-Z0-9_-]{8,128}$/;

export const GET = withAuth<{ traceId: string }>(async function ebTraceById(request, _auth, context) {
  const requestStartedAt = Date.now();
  let traceIdForLog = 'unknown';
  try {
    const lf = getLangfuseEbConfig();
    if (!lf) {
      logger.error('langfuse.eb.trace.config.missing');
      return NextResponse.json({ error: 'Langfuse EB credentials not configured' }, { status: 500 });
    }

    const { traceId } = await context.params;
    traceIdForLog = traceId;
    if (!TRACE_ID_RE.test(traceId)) {
      logger.warn('langfuse.eb.trace.id.invalid', { length: traceId.length });
      return NextResponse.json({ error: 'Invalid traceId' }, { status: 400 });
    }

    logger.info('langfuse.eb.trace.request.start', { traceId });

    const traceResponse = await fetch(`${lf.baseUrl}/api/public/traces/${encodeURIComponent(traceId)}`, {
      headers: {
        Authorization: lf.authHeader,
        'Content-Type': 'application/json',
        'Accept-Encoding': 'gzip, deflate, br',
      },
      signal: request.signal,
    });

    if (!traceResponse.ok) {
      const errorText = await traceResponse.text();
      logger.warn(
        'langfuse.eb.trace.request.error',
        { traceId, status: traceResponse.status, message: errorText.slice(0, 200) },
        { duration: Date.now() - requestStartedAt },
      );
      return NextResponse.json(
        { error: `Langfuse EB API error: ${traceResponse.status}`, message: errorText },
        { status: traceResponse.status },
      );
    }

    const data = await traceResponse.json();
    logger.info('langfuse.eb.trace.request.success', { traceId }, { duration: Date.now() - requestStartedAt });
    return NextResponse.json(data);
  } catch (error) {
    const aborted = (error as Error)?.name === 'AbortError' || request.signal.aborted;
    if (aborted) {
      logger.info('langfuse.eb.trace.request.aborted', { traceId: traceIdForLog }, { duration: Date.now() - requestStartedAt });
      return new NextResponse(null, { status: 499 });
    }
    logger.error(
      'langfuse.eb.trace.request.failure',
      { traceId: traceIdForLog },
      { error: error as Error, duration: Date.now() - requestStartedAt },
    );
    return NextResponse.json(
      {
        error: 'Failed to fetch Langfuse EB trace',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
});
