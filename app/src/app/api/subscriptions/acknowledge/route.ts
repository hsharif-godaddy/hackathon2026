import { NextRequest, NextResponse } from 'next/server';

import { type CustomerAuthContext, withCustomerAuth } from '@/lib/customer-auth';
import { AiroHttpError, AiroMgmtClient } from '@/lib/mgmt-airo';
import { logger } from '@/lib/request-context';

export const dynamic = 'force-dynamic';

interface AcknowledgeRequestBody {
  subscriptionId: string;
}

export const POST = withCustomerAuth(async (
  request: NextRequest,
  authContext: CustomerAuthContext
): Promise<NextResponse> => {
  let subscriptionId: string | undefined;
  try {
    if (!authContext.jwt) {
      return NextResponse.json({ error: 'Authentication token required' }, { status: 401 });
    }

    let body: AcknowledgeRequestBody;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON request body' }, { status: 400 });
    }
    subscriptionId = body.subscriptionId;

    if (!subscriptionId) {
      return NextResponse.json({ error: 'subscriptionId is required' }, { status: 400 });
    }

    const baseUrl = process.env.MGMT_AIRO_BASE_URL || 'https://mgmt.nstk.net';
    const client = new AiroMgmtClient({ baseUrl, jwt: authContext.jwt });

    const subscription = await client.getSubscription(subscriptionId, { includeAttributes: true });
    if (subscription.customerId !== authContext.user.customerId) {
      logger.warn('subscription.acknowledge.ownership-mismatch', {
        subscriptionId,
        requestCustomerId: authContext.user.customerId,
        subscriptionCustomerId: subscription.customerId,
      });
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const updated = await client.acknowledgeConversion(subscription);

    logger.info('subscription.acknowledge.success', {
      subscriptionId,
      customerId: authContext.user.customerId,
    });

    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    if (error instanceof AiroHttpError) {
      logger.error('subscription.acknowledge.api-error', {
        subscriptionId,
        customerId: authContext.user.customerId,
        status: error.status,
        body: error.body,
      });
      return NextResponse.json(
        { error: 'Failed to acknowledge conversion' },
        { status: error.status }
      );
    }

    logger.error('subscription.acknowledge.error', {
      subscriptionId,
      customerId: authContext.user.customerId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return NextResponse.json(
      { error: 'Failed to acknowledge conversion' },
      { status: 500 }
    );
  }
}, { level: 3 });
