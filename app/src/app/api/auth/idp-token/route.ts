import { NextRequest, NextResponse } from 'next/server';

import { getControlPlaneAdapter } from '@/lib/control-plane';
import { type CustomerAuthContext, withCustomerAuth } from '@/lib/customer-auth';
import { getJWTService } from '@/lib/jwt-service';
import { logger } from '@/lib/request-context';
import { checkSwitchboardFlag } from '@/lib/switchboard/server';

export const dynamic = 'force-dynamic';

export const POST = withCustomerAuth(async (request: NextRequest, authContext: CustomerAuthContext): Promise<NextResponse> => {
  const origin = request.headers.get('origin')
  if (origin !== null) {
    const host = request.headers.get('host') ?? request.nextUrl.host
    let originHost: string
    try {
      originHost = new URL(origin).host
    } catch {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    if (originHost !== host) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  const careAgentEnabled = await checkSwitchboardFlag('airo-builder-care-agent-enabled', request).catch(() => false);
  if (!careAgentEnabled) {
    return NextResponse.json({ error: 'Feature not enabled' }, { status: 403 });
  }

  let body: { appId?: unknown; conversationId?: unknown } | null = null;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { appId, conversationId } = body ?? {};

  if (!appId || typeof appId !== 'string') {
    return NextResponse.json({ error: 'appId is required' }, { status: 400 });
  }
  if (!conversationId || typeof conversationId !== 'string') {
    return NextResponse.json({ error: 'conversationId is required' }, { status: 400 });
  }

  const idpToken = authContext.jwt;
  if (!idpToken) {
    logger.warn('care.prefetch_idp_token.no_jwt', { appId, conversationId });
    return NextResponse.json({ error: 'No SSO token available' }, { status: 401 });
  }
  let agentsBaseUrl: string;
  try {
    const adapter = getControlPlaneAdapter();
    const site = await adapter.getSite(appId, authContext.jwt);
    if (!site) {
      logger.error('care.prefetch_idp_token.site_not_found', { appId, conversationId });
      return NextResponse.json({ error: 'Site not found' }, { status: 404 });
    }
    if (!site.agent_url) {
      logger.error('care.prefetch_idp_token.no_agent_url', { appId, conversationId });
      return NextResponse.json({ error: 'Site has no agent URL' }, { status: 502 });
    }
    agentsBaseUrl = site.agent_url;
  } catch (err) {
    logger.error('care.prefetch_idp_token.site_lookup_failed', {
      appId,
      conversationId,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: 'Failed to resolve agent URL' }, { status: 502 });
  }


  let agentToken: string;
  try {
    const { user } = authContext;
    const result = await getJWTService().getToken({
      siteId: appId,
      customerId: user.customerId,
      canDownload: false,
      canPublish: false,
      authType: user.authType || 'basic',
      isE2S: user.isE2S ?? false,
    });
    agentToken = result.token;
  } catch (err) {
    logger.error('care.prefetch_idp_token.mint_failed', {
      appId,
      conversationId,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: 'Failed to mint agent token' }, { status: 500 });
  }


  try {
    const agentsRes = await fetch(
      `${agentsBaseUrl}/api/conversations/${appId}/${conversationId}/idp-token`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${agentToken}`,
        },
        body: JSON.stringify({ token: idpToken }),
      },
    );

    if (!agentsRes.ok) {
      const text = await agentsRes.text().catch(() => '');
      logger.error('care.prefetch_idp_token.agents_rejected', {
        appId,
        conversationId,
        status: agentsRes.status,
        body: text.slice(0, 200),
      });
      return NextResponse.json({ error: 'Agents service rejected token' }, { status: 502 });
    }
  } catch (err) {
    logger.error('care.prefetch_idp_token.agents_unreachable', {
      appId,
      conversationId,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: 'Failed to reach agents service' }, { status: 502 });
  }

  return NextResponse.json({ accepted: true });
});
