import { NextRequest, NextResponse } from 'next/server';

import { getControlPlaneAdapter, isV2ControlPlaneEnabled } from '@/lib/control-plane';
import { type CustomerAuthContext, withCustomerAuth } from '@/lib/customer-auth';
import { type AiroApiError, AiroHttpError, AiroMgmtClient } from '@/lib/mgmt-airo';
import { logger } from '@/lib/request-context';
import { ApiErrorCode } from '@/utils/api-errors';
import { DomainApiErrorCode } from '@/utils/domain-validation';

export const dynamic = 'force-dynamic';

/**
 * GET /api/sites/[id]/domain-errors - Get domain error details for a specific domain
 *
 * Retrieves error details for a specific domain if one exists.
 * Returns 404 if no error exists for the given domain.
 *
 * @param request - Next.js request object with query parameter:
 *   - fqdn: Fully qualified domain name to check for errors (required)
 * @param authContext - Customer authentication context
 * @param params - Route parameters with site ID
 * @returns Domain error details or 404 if no error exists
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

    // Only V2 control plane supports domain management
    if (!isV2ControlPlaneEnabled()) {
      return NextResponse.json(
        { code: ApiErrorCode.V2_CONTROL_PLANE_REQUIRED, error: 'Domain error checking requires V2 control plane' },
        { status: 400 }
      );
    }

    // Get fqdn from query parameters
    const { searchParams } = new URL(request.url);
    fqdn = searchParams.get('fqdn');

    if (!fqdn) {
      return NextResponse.json(
        { code: DomainApiErrorCode.FQDN_REQUIRED, error: 'Domain (fqdn) is required as a query parameter' },
        { status: 400 }
      );
    }

    // Get site to retrieve subscription_id and system_id
    const adapter = getControlPlaneAdapter();
    const site = await adapter.getSite(siteId, authContext.jwt);

    if (!site) {
      return NextResponse.json(
        { code: ApiErrorCode.SITE_NOT_FOUND, error: 'Site not found' },
        { status: 404 }
      );
    }

    if (!site.subscription_id || !site.system_id) {
      logger.error('sites.domain-errors.get.missing-ids', {
        message: 'Site missing subscription_id or system_id',
        siteId,
      });
      return NextResponse.json(
        { code: ApiErrorCode.SITE_CONFIG_INCOMPLETE, error: 'Site configuration incomplete' },
        { status: 400 }
      );
    }

    logger.info('sites.domain-errors.get.start', {
      message: 'Checking domain error',
      siteId,
      subscriptionId: site.subscription_id,
      systemId: site.system_id,
      fqdn,
    });

    // Create mgmt-airo client and get domain error
    const baseUrl = process.env.MGMT_AIRO_BASE_URL || 'https://mgmt.nstk.net';
    const client = new AiroMgmtClient({ baseUrl, jwt: authContext.jwt });
    const domainError = await client.getDomainError(
      site.subscription_id,
      site.system_id,
      siteId,
      fqdn
    );

    logger.info('sites.domain-errors.get.success', {
      message: 'Domain error retrieved',
      siteId,
      fqdn,
      errorCode: domainError.error.code,
      canRetry: domainError.error.canRetry,
    });

    return NextResponse.json(domainError);

  } catch (error) {
    if (error instanceof AiroHttpError && error.status === 404) {
      logger.info('sites.domain-errors.get.not-found', {
        message: 'No domain error found',
        siteId,
        fqdn,
      });
      return NextResponse.json(
        { code: DomainApiErrorCode.DOMAIN_ERROR_NOT_FOUND, error: 'No domain error found for the specified domain' },
        { status: 404 }
      );
    }

    logger.error('sites.domain-errors.get.error', {
      message: 'Failed to get domain error',
      siteId,
      fqdn,
      error: error instanceof Error ? error.message : 'Unknown error',
      errorBody: error instanceof AiroHttpError ? JSON.stringify(error) : undefined,
    });

    let errorMessage: string | AiroApiError = 'Unknown error';

    if (error instanceof AiroHttpError) {
      errorMessage = error.body;
    } else if (error instanceof Error) {
      errorMessage = error.message;
    }

    return NextResponse.json(
      { code: DomainApiErrorCode.DOMAIN_ERROR_FETCH_FAILED, error: 'Failed to get domain error', details: errorMessage },
      { status: error instanceof AiroHttpError ? error.status : 500 }
    );
  }
});
