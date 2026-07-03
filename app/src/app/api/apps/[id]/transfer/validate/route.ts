/**
 * Transfer Validation Proxy
 *
 * Derives transfer eligibility from the agent's /apps/:id/commerce/binding
 * endpoint (the current source of truth for GoDaddy Commerce). An app is
 * ineligible for ownership transfer when a Commerce binding is configured.
 *
 * GET /api/apps/:id/transfer/validate → { canTransfer, gdCommerce }
 */

import { NextRequest, NextResponse } from 'next/server';

import { agentFetch } from '@/lib/agent-fetch';
import { resolveAgentsBaseUrl } from '@/lib/agents-base-url';
import { getControlPlaneAdapter } from '@/lib/control-plane';
import { type CustomerAuthContext, withCustomerAuth } from '@/lib/customer-auth';
import { logger } from '@/lib/request-context';

export const dynamic = 'force-dynamic';

export const GET = withCustomerAuth(async (
  _request: NextRequest,
  authContext: CustomerAuthContext,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> => {
  try {
    if (!authContext.jwt) {
      return NextResponse.json({ error: 'Authentication token required' }, { status: 401 });
    }

    const { id: appId } = await params;
    if (!appId) {
      return NextResponse.json({ error: 'appId path parameter is required' }, { status: 400 });
    }

    const adapter = getControlPlaneAdapter();
    const site = await adapter.getSite(appId, authContext.jwt);

    if (!site) {
      return NextResponse.json({ error: 'Site not found' }, { status: 404 });
    }

    const agentBaseUrl: string = resolveAgentsBaseUrl(site);
    const response = await agentFetch(
      `${agentBaseUrl}/apps/${appId}/commerce/binding`,
      { siteId: appId }
    );

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('transfer.validate.proxy.failure', {
        appId,
        status: response.status,
        error: errorText,
      });
      return NextResponse.json(
        { error: 'Failed to validate transfer eligibility' },
        { status: response.status }
      );
    }

    const binding: { configured?: boolean } = await response.json();
    const gdCommerce: boolean = Boolean(binding.configured);

    if (gdCommerce) {
      logger.warn('transfer.validate.commerce.blocked', {
        appId,
        gdCommerce,
      });
    }

    return NextResponse.json({ canTransfer: !gdCommerce, gdCommerce });
  } catch (error) {
    logger.error('transfer.validate.proxy.error', {
      appId: (await params).id,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: 'Failed to validate transfer eligibility' },
      { status: 500 }
    );
  }
});
