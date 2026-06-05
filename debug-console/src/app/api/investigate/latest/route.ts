import { NextResponse } from 'next/server';

import { withAuth } from '@/lib/api-auth';
import { ensureSummaryAfterTerminal, readAnalysis } from '@/lib/investigate/summaries';
import { headResult, isStaleHeartbeat, isTerminal, readState } from '@/lib/investigate/state';
import { keysFor } from '@/lib/investigate/types';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// GET /api/investigate/latest?appId=...&customerId=...
//
// Returns the most recent investigation for a (customerId, appId) pair.
// Report body is not inlined — client fetches it via /report when needed.
export const GET = withAuth(async (request) => {
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
      'investigate.latest.read.failed',
      { appId, customerId, stateKey: keys.stateKey },
      { error: err as Error },
    );
    return NextResponse.json({ error: 'state_read_failed' }, { status: 503 });
  }
  if (!state) {
    return NextResponse.json({ exists: false }, { status: 200 });
  }

  const terminal = isTerminal(state.status);
  const stale = !terminal && isStaleHeartbeat(state);

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
      logger.warn(
        'investigate.latest.head.failed',
        { appId, customerId, resultKey: state.resultKey },
        { error: err as Error },
      );
    }
  }

  // Surface the verdict + fix-prompt sidecar so the panel can render the
  // verdict badge and Copy-fix-prompt button. Gated to completed runs,
  // mirroring ensureSummary's readAnalysis gating — failed/killed runs never
  // produce a sidecar. Best-effort: readAnalysis returns null on 404/error.
  const analysis = terminal && state.status === 'completed'
    ? await readAnalysis(customerId, appId, state.investigationId)
    : null;

  // Floating promise — safe because debug-console is a long-lived Node process.
  // If this ever runs on Vercel/edge (frozen after response), the write would be
  // silently dropped. Await the call instead if the deploy target changes.
  ensureSummaryAfterTerminal(state, { reportSize, reportEtag });

  return NextResponse.json({
    exists: true,
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
