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

type SyncStrategy = 'on_commit' | 'on_publish' | 'manual';
const VALID_STRATEGIES: SyncStrategy[] = ['on_commit', 'on_publish', 'manual'];

/**
 * POST: Configure GitHub remote (repo + branch + sync strategy).
 * Proxies to agents POST /apps/:id/git/remote/configure.
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

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const repoUrl = body.repoUrl as string | undefined;
  const branch = body.branch as string | undefined;
  const syncStrategy = (body.syncStrategy as SyncStrategy) ?? 'manual';

  if (!repoUrl || !branch) {
    return NextResponse.json({ error: 'repoUrl and branch are required' }, { status: 400 });
  }

  if (!VALID_STRATEGIES.includes(syncStrategy)) {
    return NextResponse.json(
      { error: `syncStrategy must be one of: ${VALID_STRATEGIES.join(', ')}` },
      { status: 400 },
    );
  }

  try {
    const adapter = getControlPlaneAdapter();
    const site = await adapter.getSite(appId, authContext.jwt!);
    if (!site?.agent_url) {
      return NextResponse.json({ error: 'Site not found or no agent URL' }, { status: 404 });
    }

    const response = await agentFetch(`${site.agent_url}/apps/${appId}/git/remote/configure`, {
      siteId: appId,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repoUrl, branch, syncStrategy }),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      logger.error('github.configure.agent.error', { appId, status: response.status, errorBody });
      return NextResponse.json(
        { error: 'Failed to configure remote' },
        { status: response.status },
      );
    }

    return NextResponse.json(await response.json());
  } catch (err) {
    logger.error('github.configure.failed', {
      appId,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
});
