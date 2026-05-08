import { NextResponse } from 'next/server';

import { withAuth } from '@/lib/api-auth';
import { INVESTIGATE_CONFIG } from '@/lib/investigate/config';
import { isStaleHeartbeat, isTerminal, readResult, readState } from '@/lib/investigate/state';
import { keysFor } from '@/lib/investigate/types';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type RouteContext = { params: Promise<{ id: string }> };

export const GET = withAuth<{ id: string }>(async (request, _auth, context) => {
  const { id: investigationId } = await (context as RouteContext).params;
  const url = new URL(request.url);
  const appId = url.searchParams.get('appId');
  const customerId = url.searchParams.get('customerId');

  if (!appId || !customerId) {
    return NextResponse.json({ error: 'appId and customerId are required' }, { status: 400 });
  }

  const keys = keysFor(customerId, appId);
  let state;
  try {
    state = await readState(keys.stateKey);
  } catch (err) {
    // Transient S3 error (throttle, AccessDenied mid-rotation, etc.).
    // Surface as 503 with a breadcrumb so the UI's poll loop gets a
    // retryable signal rather than a 500 that looks like a bug.
    logger.error(
      'investigate.status.read.failed',
      { investigationId, appId, customerId, stateKey: keys.stateKey },
      { error: err as Error },
    );
    return NextResponse.json({ error: 'state_read_failed' }, { status: 503 });
  }
  if (!state) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  if (state.investigationId !== investigationId) {
    // A newer investigation superseded this one for the same (cust, app).
    return NextResponse.json({ error: 'superseded', current: state.investigationId }, { status: 410 });
  }

  const terminal = isTerminal(state.status);
  const stale = !terminal && isStaleHeartbeat(state);

  let markdown: string | null = null;
  if (terminal && state.status === 'completed' && state.resultKey) {
    markdown = await readResult(state.resultKey, INVESTIGATE_CONFIG.inlineResultMaxBytes);
  }

  return NextResponse.json({
    investigationId: state.investigationId,
    appId: state.appId,
    customerId: state.customerId,
    status: state.status,
    phase: state.phase,
    lastEvent: state.lastEvent,
    startedAt: state.startedAt,
    heartbeatAt: state.heartbeatAt,
    completedAt: state.completedAt,
    durationMs: state.durationMs,
    stale,
    error: state.error,
    reportAvailable: !!state.resultKey,
    reportFilename: state.reportFilename,
    evidence: state.evidence ?? null,
    markdown,
  });
});
