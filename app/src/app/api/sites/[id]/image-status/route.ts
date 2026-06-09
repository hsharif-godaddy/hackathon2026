import { NextRequest, NextResponse } from 'next/server';

import { getControlPlaneAdapter } from '@/lib/control-plane';
import { handleControlPlaneError } from '@/lib/control-plane/error-handler';
import {
  createCustomerAuthError,
  type CustomerAuthContext,
  customerHasAccount,
  withCustomerAuth
} from '@/lib/customer-auth';
import { extractKatanaVersion } from '@/lib/mgmt-airo';
import { logger } from '@/lib/request-context';

export const dynamic = 'force-dynamic';

// GET /api/sites/[id]/image-status - Get image status for an app
export const GET = withCustomerAuth(async (request: NextRequest, authContext: CustomerAuthContext, { params }: { params: Promise<{ id: string }> }) => {
  const { id: siteId } = await params;

  try {
    if (!customerHasAccount(authContext.user)) {
      return createCustomerAuthError('You must have an account to check image status', 403);
    }

    if (!siteId) {
      return NextResponse.json(
        { error: 'Site ID is required' },
        { status: 400 }
      );
    }

    logger.info('image-status.request', { siteId });

    if (!authContext.jwt) {
      return NextResponse.json({ error: 'Authentication token required' }, { status: 401 });
    }

    const katanaVersion = extractKatanaVersion(request.headers);

    return NextResponse.json(
      await getControlPlaneAdapter().getImageStatus(siteId, authContext.jwt, katanaVersion)
    );
  } catch (error) {
    logger.error('image-status.error', {
      siteId,
      errorMessage: error instanceof Error ? error.message : 'Unknown error'
    });

    return handleControlPlaneError(error, 'image-status');
  }
});
