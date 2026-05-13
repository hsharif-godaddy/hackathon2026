import { randomUUID } from 'node:crypto';

import { NextResponse } from 'next/server';

import { withAuth } from '@/lib/api-auth';
import { gdAuthService } from '@/lib/gd-auth-service';
import { INVESTIGATE_CONFIG } from '@/lib/investigate/config';
import { invokeInvestigator } from '@/lib/investigate/lambda-client';
import { acquireLock } from '@/lib/investigate/lock';
import { keysForInvestigation } from '@/lib/investigate/types';
import type { InvestigationState } from '@/lib/investigate/types';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface InvestigateRequest {
  appId?: string;
  customerId?: string;
  feedback?: string;
  fullstoryUrl?: string | null;
  timeWindow?: string | null;
  gocodeApiKey?: string;
}

const MAX_FEEDBACK_LEN = 4000;
const MIN_GOCODE_KEY_LEN = 16;

function bad(msg: string, status = 400): NextResponse {
  return NextResponse.json({ error: msg }, { status });
}

function newInvestigationId(): string {
  const ts = new Date().toISOString().slice(0, 10);
  return `inv-${ts}-${randomUUID().slice(0, 8)}`;
}

export const POST = withAuth(async (request, auth) => {
  let body: InvestigateRequest;
  try {
    body = (await request.json()) as InvestigateRequest;
  } catch {
    return bad('Invalid JSON body');
  }

  const appId = body.appId?.trim();
  const customerId = body.customerId?.trim();
  const feedback = body.feedback?.trim();
  const gocodeApiKey = body.gocodeApiKey?.trim();

  if (!appId) return bad('appId is required');
  if (!customerId) return bad('customerId is required');
  if (!feedback) return bad('feedback is required');
  if (feedback.length > MAX_FEEDBACK_LEN) {
    return bad(`feedback exceeds ${MAX_FEEDBACK_LEN} characters`);
  }
  if (!gocodeApiKey || gocodeApiKey.length < MIN_GOCODE_KEY_LEN) {
    return bad('gocodeApiKey is required (paste your GoCode API key)');
  }

  // Forward the user's JOMAX token so the Lambda can hit console/agent APIs
  // as the calling user. Saves us from maintaining a service-account token
  // with a refresh job; the token lifetime is comfortably longer than the
  // ~60-120s a typical investigation takes.
  const jomaxToken = gdAuthService.extractTokenFromRequest(request);
  if (!jomaxToken) {
    return bad('unable to read JOMAX token from request', 401);
  }

  const investigationId = newInvestigationId();
  const keys = keysForInvestigation(customerId, appId, investigationId);
  const now = new Date().toISOString();
  const startedBy = auth.user?.email || auth.user?.cid || auth.user?.shopperId || 'unknown';

  const state: InvestigationState = {
    investigationId,
    appId,
    customerId,
    status: 'pending',
    startedAt: now,
    startedBy,
    updatedAt: now,
    heartbeatAt: now,
    phase: 'pending',
    lastEvent: 'awaiting lambda cold start',
    input: {
      feedback,
      fullstoryUrl: body.fullstoryUrl ?? null,
      timeWindow: body.timeWindow ?? null,
    },
    resultKey: null,
    reportFilename: null,
    completedAt: null,
    durationMs: null,
    lambdaRequestId: null,
    error: null,
  };

  const lock = await acquireLock(keys.stateKey, state);
  if (!lock.acquired) {
    logger.info('investigate.lock.conflict', {
      appId,
      customerId,
      existingInvestigationId: lock.existing?.investigationId,
      existingStatus: lock.existing?.status,
    });
    return NextResponse.json(
      {
        error: 'investigation_in_progress',
        investigationId: lock.existing?.investigationId,
        status: lock.existing?.status,
        startedAt: lock.existing?.startedAt,
      },
      { status: 409 },
    );
  }

  try {
    await invokeInvestigator({
      investigationId,
      appId,
      customerId,
      feedback,
      fullstoryUrl: body.fullstoryUrl ?? null,
      timeWindow: body.timeWindow ?? null,
      stateKey: keys.stateKey,
      historyPrefix: keys.historyPrefix,
      resultKey: keys.resultKey,
      tracePrefix: keys.tracePrefix,
      eventsPrefix: keys.eventsPrefix,
      jomaxToken,
      gocodeApiKey,
    });
  } catch (error) {
    logger.error('investigate.lambda.invoke.failed', { investigationId, appId }, { error: error as Error });
    // Surface the failure to the user by marking state, not by leaving a
    // stale `pending` row that blocks re-runs until the 60s zombie timeout.
    // If the state write itself also fails (S3 down, IAM revoke), we must
    // NOT let it escape the catch — the user already got a 502 from the
    // invoke failure; leaking a second error loses the invoke log and
    // leaves the row as `pending` anyway. The stale-heartbeat reclaim in
    // acquireLock picks it up after ~60s as a fallback.
    try {
      const { writeState } = await import('@/lib/investigate/state');
      await writeState(keys.stateKey, {
        ...state,
        status: 'failed',
        lastEvent: 'failed to invoke lambda',
        error: (error as Error).message,
        completedAt: new Date().toISOString(),
      });
    } catch (writeErr) {
      logger.error(
        'investigate.state.release.failed',
        { investigationId, appId, note: 'zombie lock will be reclaimed after stale threshold' },
        { error: writeErr as Error },
      );
    }
    return NextResponse.json({ error: 'failed_to_invoke_lambda' }, { status: 502 });
  }

  logger.info('investigate.started', { investigationId, appId, customerId, startedBy, tookOverZombie: !!lock.tookOverZombie });

  return NextResponse.json(
    {
      investigationId,
      status: 'pending',
      statusUrl: `/api/investigate/${investigationId}/status?appId=${encodeURIComponent(appId)}&customerId=${encodeURIComponent(customerId)}`,
      bucket: INVESTIGATE_CONFIG.bucket,
    },
    { status: 202 },
  );
});
