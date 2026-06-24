import { NextRequest, NextResponse } from 'next/server';

import { type CustomerAuthContext,withCustomerAuth } from '@/lib/customer-auth';
import { checkStatus, enforce } from '@/lib/github';
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

  if (!authContext.jwt) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  try {
    return NextResponse.json(await checkStatus(appId, authContext.jwt), {
      headers: { 'Cache-Control': 'no-store, private' },
    });
  } catch (err) {
    logger.error('github.status.failed', {
      appId,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { connected: false, appInstalled: false, appInstallUrl: '' },
      { status: 200, headers: { 'Cache-Control': 'no-store, private' } },
    );
  }
});
