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

// POST /api/sites/[id]/archive-restore — start async cold-archive restore
export const POST = withCustomerAuth(async (
  request: NextRequest,
  authContext: CustomerAuthContext,
  { params }: { params: Promise<{ id: string }> }
) => {
  try {
    const { user } = authContext;
    const { id: siteId } = await params;

    if (!customerHasAccount(user)) {
      return createCustomerAuthError('You must have an account to restore sites', 403);
    }

    let targetCell: string | undefined;
    try {
      const body = await request.json().catch(() => ({}));
      targetCell = typeof body?.targetCell === 'string' ? body.targetCell : undefined;
    } catch {
      // ignore body parse errors
    }

    const adapter = getControlPlaneAdapter();
    const result = await adapter.startArchiveRestore(siteId, authContext.jwt, targetCell ? { targetCell } : undefined);

    return NextResponse.json(result, { status: 202 });
  } catch (error) {
    const siteId = (await params).id;

    logger.error('archive-restore.error', {
      message: 'Failed to start archive restore',
      siteId,
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
    });

    return handleControlPlaneError(error, 'archive-restore');
  }
}, { level: 3 });
