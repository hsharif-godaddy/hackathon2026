import { NextRequest, NextResponse } from 'next/server';

import { agentFetch } from '@/lib/agent-fetch';
import { getControlPlaneAdapter } from '@/lib/control-plane';
import { type CustomerAuthContext,withCustomerAuth } from '@/lib/customer-auth';
import { enforce, getConfig, loadTokens, removeTokens } from '@/lib/github';
import { logger } from '@/lib/request-context';

export const dynamic = 'force-dynamic';

export const POST = withCustomerAuth(async (
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
    const tokenData = await loadTokens(appId, authContext.jwt);

    // Best-effort: revoke the GitHub token so it can't be reused.
    // Non-fatal — disconnect succeeds even if revocation fails.
    if (tokenData?.accessToken) {
      const config = getConfig();
      try {
        await fetch(`${config.apiBase}/applications/${config.clientId}/grant`, {
          method: 'DELETE',
          headers: {
            'Authorization': `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}`,
            'Accept': 'application/vnd.github+json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ access_token: tokenData.accessToken }),
        });
      } catch (revokeErr) {
        logger.warn('github.disconnect.revoke.failed', {
          appId,
          error: revokeErr instanceof Error ? revokeErr.message : String(revokeErr),
        });
      }
    }

    await removeTokens(appId, authContext.jwt);

    // Best-effort: tell the agent to clear its git remote config.
    // Non-fatal — disconnect succeeds even if agent cleanup fails.
    try {
      const adapter = getControlPlaneAdapter();
      const site = await adapter.getSite(appId, authContext.jwt);
      if (site?.agent_url) {
        await agentFetch(`${site.agent_url}/apps/${appId}/git/remote/configure`, {
          siteId: appId,
          method: 'DELETE',
        });
      }
    } catch (agentErr) {
      logger.warn('github.disconnect.agent-cleanup.failed', {
        appId,
        error: agentErr instanceof Error ? agentErr.message : String(agentErr),
      });
    }

    logger.info('github.disconnect.success', { appId });

    return NextResponse.json({ success: true });
  } catch (err) {
    logger.error('github.disconnect.failed', {
      appId,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: 'Disconnect failed' }, { status: 500 });
  }
}, { level: 3 });
