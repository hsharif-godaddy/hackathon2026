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

export const GET = withCustomerAuth(async (
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
      return NextResponse.json({ valid: false, expiresAt: null });
    }

    return NextResponse.json({
      valid: !tokens.isExpired(tokenData),
      expiresAt: tokenData.expiresAt,
    });
  } catch (err) {
    logger.error('github.token.status.failed', {
      appId,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
});
