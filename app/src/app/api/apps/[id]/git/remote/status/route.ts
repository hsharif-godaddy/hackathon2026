import { NextRequest, NextResponse } from 'next/server';

import { agentFetch } from '@/lib/agent-fetch';
import { getControlPlaneAdapter } from '@/lib/control-plane';
import {
  createCustomerAuthError,
  type CustomerAuthContext,
  customerHasAccount,
  withCustomerAuth,
} from '@/lib/customer-auth';
import { enforce } from '@/lib/github';
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
  const { user } = authContext;

  if (!customerHasAccount(user)) {
    return createCustomerAuthError('Account required', 403);
  }

  try {
    const adapter = getControlPlaneAdapter();
    const site = await adapter.getSite(appId, authContext.jwt!);
    if (!site?.agent_url) {
      return NextResponse.json({ error: 'Site not found' }, { status: 404 });
    }

    const response = await agentFetch(`${site.agent_url}/apps/${appId}/git/remote/status`, {
      siteId: appId,
      method: 'GET',
    });

    if (!response.ok) {
      logger.warn('github.remote-status.agent-error', { appId, status: response.status });
      return NextResponse.json(
        { remotes: [], agentError: true },
        { status: 502 },
      );
    }

    return NextResponse.json(await response.json());
  } catch (err) {
    logger.error('github.remote-status.failed', {
      appId,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { remotes: [], agentError: true },
      { status: 502 },
    );
  }
});
