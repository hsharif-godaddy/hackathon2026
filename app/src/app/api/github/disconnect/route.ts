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
): Promise<NextResponse> => {
  const gateResponse = await enforce(request);
  if (gateResponse) return gateResponse;

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const appId = body.appId as string | undefined;

  if (!appId) {
    return NextResponse.json({ error: 'appId is required' }, { status: 400 });
  }

  if (!authContext.jwt) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  try {
    const tokenData = await loadTokens(appId, authContext.jwt);

    // Best-effort revocation on GitHub
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

    // Remove git remote config from agent database
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
