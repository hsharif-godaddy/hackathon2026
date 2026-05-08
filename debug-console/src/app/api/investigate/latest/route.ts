import { NextResponse } from 'next/server';

import { withAuth } from '@/lib/api-auth';
import { INVESTIGATE_CONFIG } from '@/lib/investigate/config';
import { isStaleHeartbeat, isTerminal, readResult, readState } from '@/lib/investigate/state';
import { keysFor } from '@/lib/investigate/types';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// GET /api/investigate/latest?appId=...&customerId=...
//
// Used by the Investigate tab in AppDetailsPanel to surface the most recent
// investigation for a given (customerId, appId) without needing its
// investigationId. Reads the `active/` state row (which is overwritten on
// every new run for the same pair) and inlines the report markdown when the
// run is complete.
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
    // Transient S3 error. Return 503 so the tab distinguishes "never
    // ran" (200 exists:false) from "backend flaky" and can retry.
    logger.error(
      'investigate.latest.read.failed',
      { appId, customerId, stateKey: keys.stateKey },
      { error: err as Error },
    );
    return NextResponse.json({ error: 'state_read_failed' }, { status: 503 });
  }
  if (!state) {
    // No prior investigation for this pair — not an error, just empty.
    return NextResponse.json({ exists: false }, { status: 200 });
  }

  const terminal = isTerminal(state.status);
  const stale = !terminal && isStaleHeartbeat(state);

  let markdown: string | null = null;
  if (terminal && state.status === 'completed' && state.resultKey) {
    markdown = await readResult(state.resultKey, INVESTIGATE_CONFIG.inlineResultMaxBytes);
  }

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
    markdown,
  });
});
