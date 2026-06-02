import { NextRequest, NextResponse } from 'next/server';

import { getControlPlaneAdapter } from '@/lib/control-plane';
import { type CustomerAuthContext, withCustomerAuth } from '@/lib/customer-auth';
import { type AiroApiError, type AiroApiErrorV2, AiroHttpError, AiroMgmtClient } from '@/lib/mgmt-airo';
import { logger } from '@/lib/request-context';
import { ApiErrorCode } from '@/utils/api-errors';
import { DomainApiErrorCode } from '@/utils/domain-validation';

export const dynamic = 'force-dynamic';

/**
 * GET /api/sites/[id]/domains/job - Poll domain modification job status for an FQDN
 *
 * Proxies mgmt-airo GET .../domain-job?fqdn=
 *
 * @param request - Query: fqdn (required)
 */
export const GET = withCustomerAuth(async (
  request: NextRequest,
  authContext: CustomerAuthContext,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> => {
  let siteId: string | undefined;
  let fqdn: string | null = null;

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
    fqdn = searchParams.get('fqdn');

    if (!fqdn) {
      return NextResponse.json(
        { code: DomainApiErrorCode.FQDN_REQUIRED, error: 'Domain (fqdn) is required as a query parameter' },
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
      logger.error('sites.domains.job.get.missing-ids', {
        message: 'Site missing subscription_id or system_id',
        siteId,
      });
      return NextResponse.json(
        { code: ApiErrorCode.SITE_CONFIG_INCOMPLETE, error: 'Site configuration incomplete' },
        { status: 400 }
      );
    }

    logger.info('sites.domains.job.get.start', {
      message: 'Fetching domain job status',
      siteId,
      subscriptionId: site.subscription_id,
      systemId: site.system_id,
      fqdn,
    });

    const baseUrl = process.env.MGMT_AIRO_BASE_URL || 'https://mgmt.nstk.net';
    const client = new AiroMgmtClient({ baseUrl, jwt: authContext.jwt });
    const response = await client.getDomainJob(
      site.subscription_id,
      site.system_id,
      siteId,
      fqdn
    );

    logger.info('sites.domains.job.get.success', {
      message: 'Domain job status retrieved',
      siteId,
      fqdn,
      overallStatus: response.overallStatus,
    });

    return NextResponse.json(response);
  } catch (error) {
    if (error instanceof AiroHttpError && error.status === 404) {
      logger.info('sites.domains.job.get.not-found', {
        message: 'No domain job found',
        siteId,
        fqdn,
      });
      return NextResponse.json(
        { code: DomainApiErrorCode.DOMAIN_ERROR_NOT_FOUND, error: 'No domain job found for the specified domain.' },
        { status: 404 }
      );
    }

    logger.error('sites.domains.job.get.error', {
      message: 'Failed to get domain job',
      siteId,
      fqdn,
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
      { code: DomainApiErrorCode.DOMAIN_ERROR_FETCH_FAILED, error: 'Failed to get domain job', details: errorMessage },
      { status: error instanceof AiroHttpError ? error.status : 500 }
    );
  }
});
