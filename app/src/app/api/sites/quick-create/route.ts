import { NextRequest, NextResponse } from 'next/server';

import { getControlPlaneAdapter } from '@/lib/control-plane';
import {
  createCustomerAuthError,
  type CustomerAuthContext,
  customerHasAccount,
  withCustomerAuth} from '@/lib/customer-auth';
import { logger } from '@/lib/request-context';

// POST /api/sites/quick-create - Fast site creation
// Uses control plane adapter (V2 or Legacy)
export const POST = withCustomerAuth(async (request: NextRequest, authContext: CustomerAuthContext) => {
  try {
    const body = await request.json();
    const { prompt, initialPrompt } = body;
    const { user } = authContext;

    // Customer must have an account to create sites
    if (!customerHasAccount(user)) {
      return createCustomerAuthError('You must have an account to create sites. Please create an account first.', 403);
    }

    // Accept either prompt or initialPrompt
    const projectPrompt = prompt || initialPrompt;
    if (!projectPrompt) {
      return NextResponse.json(
        { error: 'prompt or initialPrompt is required' },
        { status: 400 }
      );
    }

    // JWT required for authentication
    if (!authContext.jwt) {
      return NextResponse.json({ error: 'Authentication token required' }, { status: 401 });
    }

    // Use authenticated user's account ID
    const account_id = user.accountId!;

    logger.info('sites.quick-create.start', { accountId: account_id });

    // Use control plane adapter (automatically handles V2 vs Legacy)
    const adapter = getControlPlaneAdapter();
    const result = await adapter.createSite({
      accountId: account_id,
      prompt: projectPrompt.trim(),
      jwt: authContext.jwt
    });

    if (!result.success) {
      throw new Error(result.error || 'Failed to create site');
    }

    logger.info('sites.quick-create.success', { siteId: result.siteId });

    return NextResponse.json({
      id: result.siteId,
      name: result.name,
      status: result.status,
      account_id: result.account_id,
      created_at: result.created_at?.toISOString() || new Date().toISOString(),
      updated_at: result.updated_at?.toISOString() || new Date().toISOString(),
      type: result.type // 'job' for V2 job IDs, 'site' for real site IDs
    }, { status: 201 });

  } catch (error) {
    logger.error('sites.quick-create.error', { message: 'Quick site creation failed', errorMessage: error instanceof Error ? error.message : 'Unknown error' });
    return NextResponse.json(
      {
        error: 'Failed to create site record',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
});
