import { NextRequest, NextResponse } from 'next/server';

import { agentFetch } from '@/lib/agent-fetch';
import { getControlPlaneAdapter } from '@/lib/control-plane';
import {
  createCustomerAuthError,
  type CustomerAuthContext,
  customerHasAccount,
  withCustomerAuth,
} from '@/lib/customer-auth';
import { enforce, resolveToken } from '@/lib/github';
import { logger } from '@/lib/request-context';

export const dynamic = 'force-dynamic';

/**
 * POST: Trigger a git push to the configured remote.
 * Resolves a fresh GitHub token and proxies to agents POST /apps/:id/git/push.
 */
export const POST = withCustomerAuth(async (
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
      return NextResponse.json({ error: 'Site not found or no agent URL' }, { status: 404 });
    }

    const token = await resolveToken(appId, authContext.jwt!);

    let statusRes: Response;
    try {
      statusRes = await agentFetch(`${site.agent_url}/apps/${appId}/git/remote/status`, {
        siteId: appId,
        method: 'GET',
      });
    } catch (agentErr) {
      logger.error('github.push.agent-unreachable', {
        appId,
        error: agentErr instanceof Error ? agentErr.message : String(agentErr),
      });
      return NextResponse.json({ error: 'Agent service unavailable' }, { status: 502 });
    }

    if (!statusRes.ok) {
      return NextResponse.json({ error: 'Agent returned an error while fetching remote config' }, { status: 502 });
    }

    const remoteStatus = await statusRes.json() as { remotes?: { repoUrl: string }[] };
    const repoUrl = remoteStatus.remotes?.[0]?.repoUrl;
    if (!repoUrl) {
      return NextResponse.json({ error: 'No repository URL configured' }, { status: 400 });
    }

    const response = await agentFetch(`${site.agent_url}/apps/${appId}/git/push`, {
      siteId: appId,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, repoUrl }),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      logger.error('github.push.agent.error', { appId, status: response.status, errorBody });
      return NextResponse.json(
        { error: 'Failed to trigger push' },
        { status: response.status },
      );
    }

    return NextResponse.json(await response.json());
  } catch (err) {
    logger.error('github.push.failed', {
      appId,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}, { level: 3 });
