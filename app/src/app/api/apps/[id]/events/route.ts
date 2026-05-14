import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getControlPlaneAdapter } from '@/lib/control-plane';
import {
  createCustomerAuthError,
  type CustomerAuthContext,
  customerHasAccount,
  withCustomerAuth,
} from '@/lib/customer-auth';
import { type AiroEventPayload, AiroHttpError, AiroMgmtClient } from '@/lib/mgmt-airo';
import { logger } from '@/lib/request-context';

export const dynamic = 'force-dynamic';

const MGMT_AIRO_BASE_URL = process.env.MGMT_AIRO_BASE_URL || 'https://mgmt.nstk.net';

interface EventRequest {
  params: Promise<{ id: string }>;
}

const EventBodySchema = z.object({
  eventType: z.string(),
  occurredAt: z.string(),
  idempotencyKey: z.uuid(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

/**
 * POST /api/apps/[id]/events
 *
 * Records a lifecycle event for an app in mgmt-airo (e.g. build.initial_build_completed).
 * Uses an idempotency key so repeated calls for the same event are safe.
 *
 * Request body: { eventType: string, occurredAt: string, idempotencyKey: string, metadata?: object }
 */
export const POST = withCustomerAuth(async (
  request: NextRequest,
  authContext: CustomerAuthContext,
  { params }: EventRequest,
): Promise<NextResponse> => {
  const { id: siteId } = await params;

  if (!authContext.jwt) {
    return NextResponse.json({ error: 'Authentication token required' }, { status: 401 });
  }

  const { user } = authContext;

  if (!customerHasAccount(user)) {
    return createCustomerAuthError('You must have an account to record events', 403);
  }

  const data = await request.json().catch(() => null);
  const parsed = EventBodySchema.safeParse(data);

  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const airoEventPayload: AiroEventPayload = parsed.data;

  const adapter = getControlPlaneAdapter();
  const site = await adapter.getSite(siteId, authContext.jwt);

  if (!site) {
    return NextResponse.json({ error: 'Site not found' }, { status: 404 });
  }

  if (!site.subscription_id || !site.system_id) {
    logger.error('events.api.missing-ids', {
      siteId,
      hasSubscriptionId: !!site.subscription_id,
      hasSystemId: !!site.system_id,
    });
    return NextResponse.json(
      { error: 'Site missing required metadata (subscription_id or system_id)' },
      { status: 400 },
    );
  }

  const client = new AiroMgmtClient({ baseUrl: MGMT_AIRO_BASE_URL, jwt: authContext.jwt });

  logger.info('events.api.start', {
    siteId,
    eventType: airoEventPayload.eventType,
    idempotencyKey: airoEventPayload.idempotencyKey,
  });

  try {
    const response = await client.recordEvent(
      site.subscription_id,
      site.system_id,
      siteId,
      airoEventPayload,
    );
    logger.info('events.api.success', { siteId, eventType: airoEventPayload.eventType });
    return NextResponse.json(response);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const status = error instanceof AiroHttpError ? error.status : undefined;
    logger.warn('events.api.upstream-failed', { siteId, eventType: airoEventPayload.eventType, status, errorMessage });

    return NextResponse.json({ error: 'Upstream event recording failed', upstreamStatus: status, message: errorMessage }, { status: 502 });
  }
});
