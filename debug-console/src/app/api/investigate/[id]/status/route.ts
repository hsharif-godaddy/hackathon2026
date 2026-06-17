import { NextResponse } from 'next/server';

import { withAuth } from '@/lib/api-auth';
import { ensureSummaryAfterTerminal, readAnalysis } from '@/lib/investigate/summaries';
import { headResult, isStaleHeartbeat, isTerminal, readState } from '@/lib/investigate/state';
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
    return NextResponse.json({ error: 'superseded', current: state.investigationId }, { status: 410 });
  }

  const terminal = isTerminal(state.status);
  const stale = !terminal && isStaleHeartbeat(state);

  // Status payload no longer carries the report body — client fetches it
  // via /report with a presigned URL. Keeps this route O(1) regardless of
  // report size and avoids the 1MB cliff that used to dead-end the UI.
  let reportSize: number | null = null;
  let reportEtag: string | null = null;
  if (terminal && state.status === 'completed' && state.resultKey) {
    try {
      const head = await headResult(state.resultKey);
      if (head) {
        reportSize = head.size;
        reportEtag = head.etag;
      }
    } catch (err) {
      // Transient S3 HEAD failure (throttle, network flap). Don't 500 the
      // whole poll — the client can still show status; report metadata
      // will fill in on the next poll tick.
      logger.warn(
        'investigate.status.head.failed',
        { investigationId, appId, customerId, resultKey: state.resultKey },
        { error: err as Error },
      );
    }
  }

  // Surface the verdict + fix-prompt sidecar so the panel can render the
  // verdict badge and Copy-fix-prompt button. Gated to completed runs,
  // mirroring ensureSummary's readAnalysis gating — failed/killed runs never
  // produce a sidecar. Best-effort: readAnalysis returns null on 404/error.
  const analysis = terminal && state.status === 'completed'
    ? await readAnalysis(customerId, appId, investigationId)
    : null;

  // Floating promise — safe because debug-console is a long-lived Node process.
  // If this ever runs on Vercel/edge (frozen after response), the write would be
  // silently dropped. Await the call instead if the deploy target changes.
  ensureSummaryAfterTerminal(state, { reportSize, reportEtag });

  return NextResponse.json({
    investigationId: state.investigationId,
    appId: state.appId,
    customerId: state.customerId,
    status: state.status,
    phase: state.phase,
    lastEvent: state.lastEvent,
    reason: state.reason ?? null,
    startedAt: state.startedAt,
    heartbeatAt: state.heartbeatAt,
    completedAt: state.completedAt,
    durationMs: state.durationMs,
    stale,
    error: state.error,
    reportAvailable: !!state.resultKey,
    reportFilename: state.reportFilename,
    reportSize,
    reportEtag,
    evidence: state.evidence ?? null,
    cost: state.cost ?? null,
    verdict: analysis?.verdict ?? null,
    relatesTo: analysis?.relatesTo ?? null,
    verdictConfidence: analysis?.verdictConfidence ?? null,
    verdictRationale: analysis?.verdictRationale ?? null,
    verifierNote: analysis?.verifierNote ?? null,
    fixKind: analysis?.fixKind ?? null,
    fixPrompt: analysis?.fixPrompt ?? null,
    engNote: analysis?.engNote ?? null,
  });
});
