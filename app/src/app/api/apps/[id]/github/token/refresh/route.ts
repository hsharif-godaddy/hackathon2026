import { NextRequest, NextResponse } from 'next/server';

import {
  createCustomerAuthError,
  type CustomerAuthContext,
  customerHasAccount,
  withCustomerAuth,
} from '@/lib/customer-auth';
import { enforce } from '@/lib/github';
import * as tokens from '@/lib/github/tokens';
import { logger } from '@/lib/request-context';

export const dynamic = 'force-dynamic';

/**
 * POST: Refresh the GitHub token if expired, then persist via updateSecrets.
 * tokens.resolve() handles the GitHub API call + save in one step.
 */
export const POST = withCustomerAuth(async (
  request: NextRequest,
  authContext: CustomerAuthContext,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> => {
  const gateResponse = await enforce(request);
  if (gateResponse) return gateResponse;

  const { id: appId } = await params;

  if (!customerHasAccount(authContext.user)) {
    return createCustomerAuthError('Account required', 403);
  }

  try {
    const tokenData = await tokens.load(appId, authContext.jwt!);
    if (!tokenData) {
      return NextResponse.json({ error: 'No GitHub token found' }, { status: 404 });
    }

    if (!tokens.isExpired(tokenData)) {
      return NextResponse.json({ refreshed: false });
    }

    await tokens.resolve(appId, authContext.jwt!);
    logger.info('github.token.refresh.success', { appId });
    return NextResponse.json({ refreshed: true });
  } catch (err) {
    logger.error('github.token.refresh.failed', {
      appId,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: 'Token refresh failed' }, { status: 500 });
  }
}, { level: 3 });
