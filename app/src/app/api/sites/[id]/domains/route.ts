import { NextRequest, NextResponse } from 'next/server';

import { getControlPlaneAdapter, isV2ControlPlaneEnabled } from '@/lib/control-plane';
import { type CustomerAuthContext, withCustomerAuth } from '@/lib/customer-auth';
import { type AiroApiError, AiroHttpError, AiroMgmtClient } from '@/lib/mgmt-airo';
import { logger } from '@/lib/request-context';
import { ApiErrorCode } from '@/utils/api-errors';
import { DomainApiErrorCode } from '@/utils/domain-validation';

export const dynamic = 'force-dynamic';

/**
 * POST /api/sites/[id]/domains - Modify domains for a site
 *
 * Triggers domain modification (create/delete) for a site via mgmt-airo.
 * Returns a job ID to track the workflow progress.
 *
 * @param request - Next.js request object with body containing:
 *   - domainsToCreate: Array of domains to create [{ fqdn: string, primary?: boolean }]
 *   - domainsToDelete: Array of domains to delete [{ fqdn: string }]
 *   - createCdn: Whether to create CDN for the domains (boolean, optional)
 *   - isWildcardDomain: Whether to create a wildcard domain (boolean, optional)
 * @param authContext - Customer authentication context
 * @param params - Route parameters with site ID
 * @returns Domain modification job response with statusJobId
 */
export const POST = withCustomerAuth(async (
  request: NextRequest,
  authContext: CustomerAuthContext,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> => {
  let siteId: string | undefined;

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
        { code: ApiErrorCode.V2_CONTROL_PLANE_REQUIRED, error: 'Domain management requires V2 control plane' },
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
      logger.error('sites.domains.modify.missing-ids', {
        message: 'Site missing subscription_id or system_id',
        siteId,
      });
      return NextResponse.json(
        { code: ApiErrorCode.SITE_CONFIG_INCOMPLETE, error: 'Site configuration incomplete' },
        { status: 400 }
      );
    }

    // Parse request body
    const body = await request.json();
    const { domainsToCreate = [], domainsToDelete = [], createCdn = false } = body;

    // Validate at least one operation is requested
    if (domainsToCreate.length === 0 && domainsToDelete.length === 0) {
      return NextResponse.json(
        { code: DomainApiErrorCode.DOMAIN_OPERATION_REQUIRED, error: 'Must specify at least one domain to create or delete' },
        { status: 400 }
      );
    }

    // Validate domain objects
    for (const domain of domainsToCreate) {
      if (!domain.fqdn || typeof domain.fqdn !== 'string') {
        return NextResponse.json(
          { code: DomainApiErrorCode.INVALID_DOMAIN_FORMAT, error: 'Invalid domain format: fqdn is required' },
          { status: 400 }
        );
      }
    }

    for (const domain of domainsToDelete) {
      if (!domain.fqdn || typeof domain.fqdn !== 'string') {
        return NextResponse.json(
          { code: DomainApiErrorCode.INVALID_DOMAIN_FORMAT, error: 'Invalid domain format: fqdn is required' },
          { status: 400 }
        );
      }
    }

    logger.info('sites.domains.modify.start', {
      message: 'Starting domain modification',
      siteId,
      subscriptionId: site.subscription_id,
      systemId: site.system_id,
      domainsToCreateCount: domainsToCreate.length,
      domainsToDeleteCount: domainsToDelete.length,
      createCdn,
      isWildcardDomain: true,
    });

    // Create mgmt-airo client and trigger domain modification
    const baseUrl = process.env.MGMT_AIRO_BASE_URL || 'https://mgmt.nstk.net';
    const client = new AiroMgmtClient({ baseUrl, jwt: authContext.jwt });
    const response = await client.modifyDomains(
      site.subscription_id,
      site.system_id,
      siteId,
      {
        domainsToCreate,
        domainsToDelete,
        createCdn,
        isWildcardDomain: true,
      },
    );

    logger.info('sites.domains.modify.success', {
      message: 'Domain modification job started',
      siteId,
      statusJobId: response.statusJobId,
      status: response.status,
    });

    return NextResponse.json(response);

  } catch (error) {
    logger.error('sites.domains.modify.error', {
      message: 'Failed to modify domains',
      siteId,
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
      { code: DomainApiErrorCode.DOMAIN_MODIFY_FAILED, error: 'Failed to modify domains', details: errorMessage },
      { status: error instanceof AiroHttpError ? error.status : 500 }
    );
  }
});
