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

// POST /api/sites/[id]/resume - Resume site from hibernation
// Body: { variant: 'preview' | 'publish' }
export const POST = withCustomerAuth(async (request: NextRequest, authContext: CustomerAuthContext, { params }: { params: Promise<{ id: string }> }) => {
  try {
    const { user } = authContext;
    const { id: siteId } = await params;

    if (!customerHasAccount(user)) {
      return createCustomerAuthError('You must have an account to resume sites', 403);
    }

    if (!siteId) {
      return NextResponse.json(
        { error: 'Site ID is required' },
        { status: 400 }
      );
    }

    // Parse body for variant
    let variant = 'preview';
    try {
      const body = await request.json().catch(() => ({}));
      variant = body?.variant || 'preview';
    } catch {
      // Use default variant
    }

    logger.info('resume.start', {
      message: 'Starting resume for site',
      siteId,
      variant
    });

    if (!authContext.jwt) {
      return NextResponse.json({ error: 'Authentication token required' }, { status: 401 });
    }

    const adapter = getControlPlaneAdapter();
    const result = await adapter.resumeSite(siteId, variant, authContext.jwt);

    return NextResponse.json(result);

  } catch (error) {
    const siteId = (await params).id;

    logger.error('resume.error', {
      message: 'Failed to resume site',
      siteId,
      errorMessage: error instanceof Error ? error.message : 'Unknown error'
    });

    return handleControlPlaneError(error, 'resume');
  }
});

