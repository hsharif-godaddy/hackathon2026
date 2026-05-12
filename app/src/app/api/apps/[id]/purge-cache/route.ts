import { NextRequest, NextResponse } from 'next/server';

import { getControlPlaneAdapter } from '@/lib/control-plane';
import {
  createCustomerAuthError,
  type CustomerAuthContext,
  customerHasAccount,
  withCustomerAuth
} from '@/lib/customer-auth';
import { AiroHttpError, AiroMgmtClient } from '@/lib/mgmt-airo';
import { mgmtAiro401Response } from '@/lib/mgmt-airo/auth-error';
import { logger } from '@/lib/request-context';

export const dynamic = 'force-dynamic';

export const POST = withCustomerAuth(async (
  _request: NextRequest,
  authContext: CustomerAuthContext,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> => {
  const { id: siteId } = await params;
  const { user, jwt } = authContext;

  try {
    if (!customerHasAccount(user)) {
      return createCustomerAuthError(
        'You must have an account to purge cache',
        403
      );
    }

    if (!siteId) {
      return NextResponse.json(
        { error: 'Site ID is required' },
        { status: 400 }
      );
    }

    if (!jwt) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    logger.info('purge-cache.start', { siteId, customerId: user.customerId });

    const site = await getControlPlaneAdapter().getSite(siteId, jwt);

    if (!site) {
      return NextResponse.json(
        { error: 'Site not found' },
        { status: 404 }
      );
    }

    if (!site.subscription_id || !site.system_id) {
      return NextResponse.json(
        { error: 'Site is missing subscription or system metadata' },
        { status: 422 }
      );
    }

    const baseUrl = process.env.MGMT_AIRO_BASE_URL || 'https://mgmt.nstk.net';
    const client = new AiroMgmtClient({ baseUrl, jwt });

    const response = await client.purgeCache(
      site.subscription_id,
      site.system_id,
      siteId
    );

    logger.info('purge-cache.initiated', {
      siteId,
      jobId: response.statusJobId,
    });

    return NextResponse.json({ jobId: response.statusJobId });

  } catch (error) {
    const authResponse = mgmtAiro401Response(error, 'purge-cache.hbi-expired', { siteId });
    if (authResponse) return authResponse;

    if (error instanceof AiroHttpError && error.status === 409) {
      let body: Record<string, unknown> | null = null;
      try {
        body = typeof error.body === 'string' ? JSON.parse(error.body) : error.body;
      } catch {
        // ignore parse failure — fall through to generic error
      }
      if (body?.statusJobId) {
        logger.info('purge-cache.already-running', {
          siteId,
          jobId: body.statusJobId,
        });
        return NextResponse.json({ jobId: body.statusJobId });
      }
    }

    logger.error('purge-cache.error', {
      siteId,
      error: error instanceof Error ? error.message : String(error),
      status: error instanceof AiroHttpError ? error.status : undefined,
    });

    const status = error instanceof AiroHttpError ? error.status : 500;
    return NextResponse.json(
      { error: 'Failed to start cache purge' },
      { status }
    );
  }
});
