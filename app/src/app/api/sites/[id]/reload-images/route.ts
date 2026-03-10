import { NextRequest, NextResponse } from 'next/server';

import { getControlPlaneAdapter } from '@/lib/control-plane';
import { handleControlPlaneError } from '@/lib/control-plane/error-handler';
import {
  createCustomerAuthError,
  type CustomerAuthContext,
  customerHasAccount,
  withCustomerAuth
} from '@/lib/customer-auth';
import { logger } from '@/lib/request-context';

export const dynamic = 'force-dynamic';

// POST /api/sites/[id]/reload-images - Trigger image reload for an app
export const POST = withCustomerAuth(async (_request: NextRequest, authContext: CustomerAuthContext, { params }: { params: Promise<{ id: string }> }) => {
  const { id: siteId } = await params;

  try {
    if (!customerHasAccount(authContext.user)) {
      return createCustomerAuthError('You must have an account to reload images', 403);
    }

    if (!siteId) {
      return NextResponse.json(
        { error: 'Site ID is required' },
        { status: 400 }
      );
    }

    logger.info('reload-images.request', { siteId });

    if (!authContext.jwt) {
      return NextResponse.json({ error: 'Authentication token required' }, { status: 401 });
    }

    return NextResponse.json(
      await getControlPlaneAdapter().reloadImages(siteId, authContext.jwt)
    );
  } catch (error) {
    logger.error('reload-images.error', {
      siteId,
      errorMessage: error instanceof Error ? error.message : 'Unknown error'
    });

    return handleControlPlaneError(error, 'reload-images');
  }
});
