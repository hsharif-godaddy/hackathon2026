import { NextRequest, NextResponse } from 'next/server';

import { getControlPlaneAdapter } from '@/lib/control-plane';
import {
  createCustomerAuthError,
  type CustomerAuthContext,
  customerHasAccount,
  withCustomerAuth,
} from '@/lib/customer-auth';
import { AiroMgmtClient } from '@/lib/mgmt-airo';
import { logger } from '@/lib/request-context';
import { sanitizeDomainInput, validateDomain } from '@/utils/domain';

export const dynamic = 'force-dynamic';

/**
 * GET /api/apps/[id]/dns-check-conflict
 *
 * Query params:
 * - fqdn (required): domain to validate against product DNS.
 */
export const GET = withCustomerAuth(async (
  request: NextRequest,
  authContext: CustomerAuthContext,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> => {
  const { id: siteId } = await params;
  try {
    const { user } = authContext;
    const requestedFqdn = request.nextUrl.searchParams.get('fqdn');

    if (!customerHasAccount(user)) {
      return createCustomerAuthError(
        'You must have an account to check DNS conflicts',
        403
      );
    }

    if (!siteId) {
      return NextResponse.json(
        { error: 'Site ID is required' },
        { status: 400 }
      );
    }

    if (!requestedFqdn) {
      return NextResponse.json(
        { error: 'fqdn query param is required' },
        { status: 400 }
      );
    }
    const fqdn = sanitizeDomainInput(requestedFqdn);
    const fqdnValidation = validateDomain(fqdn);
    if (!fqdnValidation.isValid) {
      return NextResponse.json(
        { error: 'Invalid fqdn query param' },
        { status: 400 }
      );
    }

    const adapter = getControlPlaneAdapter();
    const site = await adapter.getSite(siteId, authContext.jwt);

    if (!site) {
      return NextResponse.json(
        { error: 'Site not found' },
        { status: 404 }
      );
    }

    if (!site.subscription_id || !site.system_id) {
      logger.error('dns-conflict.api.missing-ids', {
        siteId,
        hasSubscriptionId: !!site.subscription_id,
        hasSystemId: !!site.system_id,
        message: 'Site missing required subscription_id or system_id',
      });
      return NextResponse.json(
        { error: 'Site missing required metadata (subscription_id or system_id)' },
        { status: 400 }
      );
    }

    const siteDomains = (site.domains ?? []).map((domain) => sanitizeDomainInput(domain.fqdn).toLowerCase());
    if (!siteDomains.includes(fqdn.toLowerCase())) {
      return NextResponse.json(
        { error: 'fqdn must match a domain attached to this site' },
        { status: 400 }
      );
    }

    if (!authContext.jwt) {
      throw new Error('Authentication token required');
    }

    const baseUrl = process.env.MGMT_AIRO_BASE_URL || 'https://mgmt.nstk.net';
    const client = new AiroMgmtClient({ baseUrl, jwt: authContext.jwt });

    logger.info('dns-conflict.api.start', {
      siteId,
      subscriptionId: site.subscription_id,
      systemId: site.system_id,
      fqdn,
    });

    const response = await client.checkDnsConflict(
      site.subscription_id,
      site.system_id,
      siteId,
      fqdn
    );

    logger.info('dns-conflict.api.success', {
      siteId,
      fqdn,
      hasProductDNSConflict: response.hasProductDNSConflict,
      failedOpen: response.failedOpen,
    });

    return NextResponse.json(response);
  } catch (error) {
    logger.error('dns-conflict.api.error', {
      siteId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });

    const errorStatus = (error as { status?: unknown })?.status;
    const status = typeof errorStatus === 'number' && errorStatus >= 400 && errorStatus <= 599
      ? (errorStatus >= 500 ? errorStatus : 502)
      : 500;

    return NextResponse.json(
      {
        error: 'Failed to check DNS conflict',
      },
      { status }
    );
  }
});
