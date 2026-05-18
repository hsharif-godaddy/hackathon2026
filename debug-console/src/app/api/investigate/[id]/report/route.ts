import { NextResponse } from 'next/server';

import { withAuth } from '@/lib/api-auth';
import { INVESTIGATE_CONFIG } from '@/lib/investigate/config';
import { ensureSummaryAfterTerminal } from '@/lib/investigate/summaries';
import { headResult, presignResultUrl, readState } from '@/lib/investigate/state';
import { keysFor } from '@/lib/investigate/types';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/investigate/:id/report?appId=...&customerId=...
//
// Returns a short-lived presigned S3 GET URL for result.md. Browser fetches
// directly from S3 — bypasses the Next/Lambda 6MB response cap and keeps
// the route O(1) on memory regardless of report size.
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
      'investigate.report.read.failed',
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
  // `completed` is the only terminal status that leaves a readable result.
  // `failed`/`killed` leave the state row but no resultKey, so they fall
  // through to report_not_ready.
  if (state.status !== 'completed' || !state.resultKey) {
    return NextResponse.json({ error: 'report_not_ready' }, { status: 409 });
  }

  let head;
  let signedUrl;
  try {
    head = await headResult(state.resultKey);
    if (!head) {
      return NextResponse.json({ error: 'report_missing' }, { status: 404 });
    }
    // Floating promise — safe because debug-console is a long-lived Node process.
    // If this ever runs on Vercel/edge (frozen after response), the write would be
    // silently dropped. Await the call instead if the deploy target changes.
    ensureSummaryAfterTerminal(state, { reportSize: head.size, reportEtag: head.etag });
    signedUrl = await presignResultUrl(
      state.resultKey,
      INVESTIGATE_CONFIG.presignedReportTtlSec,
    );
  } catch (err) {
    logger.error(
      'investigate.report.presign.failed',
      { investigationId, appId, customerId, resultKey: state.resultKey },
      { error: err as Error },
    );
    return NextResponse.json({ error: 'presign_failed' }, { status: 503 });
  }

  return NextResponse.json({
    url: signedUrl,
    size: head.size,
    etag: head.etag,
    expiresInSec: INVESTIGATE_CONFIG.presignedReportTtlSec,
  });
});
