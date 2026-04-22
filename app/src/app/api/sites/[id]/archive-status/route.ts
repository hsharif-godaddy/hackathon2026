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

// GET /api/sites/[id]/archive-status — cold archive state for develop UX
export const GET = withCustomerAuth(async (
  _request: NextRequest,
  authContext: CustomerAuthContext,
  { params }: { params: Promise<{ id: string }> }
) => {
  try {
    const { user } = authContext;
    const { id: siteId } = await params;

    if (!customerHasAccount(user)) {
      return createCustomerAuthError('You must have an account to view site status', 403);
    }

    const adapter = getControlPlaneAdapter();
    const status = await adapter.getArchiveStatus(siteId, authContext.jwt);

    return NextResponse.json(status);
  } catch (error) {
    const siteId = (await params).id;

    logger.error('archive-status.error', {
      message: 'Failed to load archive status',
      siteId,
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
    });

    return handleControlPlaneError(error, 'archive-status');
  }
});
