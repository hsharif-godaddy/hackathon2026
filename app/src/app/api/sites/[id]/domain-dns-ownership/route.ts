import { NextRequest, NextResponse } from 'next/server';

import { getControlPlaneAdapter } from '@/lib/control-plane';
import { type CustomerAuthContext, withCustomerAuth } from '@/lib/customer-auth';
import { type AiroApiError, type AiroApiErrorV2, AiroHttpError, AiroMgmtClient } from '@/lib/mgmt-airo';
import { logger } from '@/lib/request-context';
import { ApiErrorCode } from '@/utils/api-errors';
import { DomainApiErrorCode } from '@/utils/domain-validation';

export const dynamic = 'force-dynamic';

/**
 * GET /api/sites/[id]/domain-dns-ownership - Domain DNS ownership for one or more FQDNs
 *
 * Query parameter fqdns is required (comma-separated; a single domain is valid).
 * customerId and shopperId are taken from the authenticated session, not the request.
 *
 * @param request - Next.js request with query: fqdns (required)
 * @param authContext - Customer authentication context
 * @param params - Route parameters with site ID
 */
export const GET = withCustomerAuth(async (
  request: NextRequest,
  authContext: CustomerAuthContext,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> => {
  let siteId: string | undefined;
  let fqdns: string | null = null;

  try {
    const { id } = await params;
    siteId = id;

    if (!siteId) {
      return NextResponse.json(
        { code: ApiErrorCode.SITE_ID_REQUIRED, error: 'Site ID is required' },
        { status: 400 }
      );
    }

    if (!authContext.jwt) {
      return NextResponse.json(
        { code: ApiErrorCode.AUTH_REQUIRED, error: 'Authentication token required' },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    fqdns = searchParams.get('fqdns');

    if (!fqdns) {
      return NextResponse.json(
        { code: DomainApiErrorCode.FQDNS_REQUIRED, error: 'fqdns is required as a query parameter' },
        { status: 400 }
      );
    }

    const adapter = getControlPlaneAdapter();
    const site = await adapter.getSite(siteId, authContext.jwt);

    if (!site) {
      return NextResponse.json(
        { code: ApiErrorCode.SITE_NOT_FOUND, error: 'Site not found' },
        { status: 404 }
      );
    }

    if (!site.subscription_id || !site.system_id) {
      logger.error('sites.domain-dns-ownership.get.missing-ids', {
        message: 'Site missing subscription_id or system_id',
        siteId,
      });
      return NextResponse.json(
        { code: ApiErrorCode.SITE_CONFIG_INCOMPLETE, error: 'Site configuration incomplete' },
        { status: 400 }
      );
    }

    const customerId = authContext.user.customerId;
    const shopperId = authContext.user.shopperId;

    logger.info('sites.domain-dns-ownership.get.start', {
      message: 'Fetching domain DNS ownership',
      siteId,
      subscriptionId: site.subscription_id,
      systemId: site.system_id,
      fqdns,
    });

    const baseUrl = process.env.MGMT_AIRO_BASE_URL || 'https://mgmt.nstk.net';
    const client = new AiroMgmtClient({ baseUrl, jwt: authContext.jwt });
    const data = await client.getDomainDnsOwnership(
      site.subscription_id,
      site.system_id,
      siteId,
      {
        fqdns,
        customerId,
        shopperId,
      }
    );

    logger.info('sites.domain-dns-ownership.get.success', {
      message: 'Domain DNS ownership retrieved',
      siteId,
      fqdns,
      isGdDomain: data.isGdDomain,
    });

    return NextResponse.json(data);
  } catch (error) {
    logger.error('sites.domain-dns-ownership.get.error', {
      message: 'Failed to get domain DNS ownership',
      siteId,
      fqdns,
      error: error instanceof Error ? error.message : 'Unknown error',
      errorBody: error instanceof AiroHttpError ? JSON.stringify(error) : undefined,
    });

    let errorMessage: string | AiroApiError | AiroApiErrorV2 = 'Unknown error';

    if (error instanceof AiroHttpError) {
      errorMessage = error.body;
    } else if (error instanceof Error) {
      errorMessage = error.message;
    }

    return NextResponse.json(
      {
        code: DomainApiErrorCode.DOMAIN_ERROR_FETCH_FAILED,
        error: 'Failed to get domain DNS ownership',
        details: errorMessage,
      },
      { status: error instanceof AiroHttpError ? error.status : 500 }
    );
  }
});
