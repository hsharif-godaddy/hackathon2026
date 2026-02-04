import { NextRequest, NextResponse } from 'next/server';

import { getControlPlaneAdapter, isV2ControlPlaneEnabled } from '@/lib/control-plane';
import { type CustomerAuthContext, withCustomerAuth } from '@/lib/customer-auth';
import { AiroMgmtClient } from '@/lib/mgmt-airo';
import { logger } from '@/lib/request-context';

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
 * @param authContext - Customer authentication context
 * @param params - Route parameters with site ID
 * @returns Domain modification job response with statusJobId
 */
export const POST = withCustomerAuth(async (
  request: NextRequest,
  authContext: CustomerAuthContext,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> => {
  try {
    const { id: siteId } = await params;

    if (!siteId) {
      return NextResponse.json({ error: 'Site ID is required' }, { status: 400 });
    }

    if (!authContext.jwt) {
      return NextResponse.json({ error: 'Authentication token required' }, { status: 401 });
    }

    // Only V2 control plane supports domain management
    if (!isV2ControlPlaneEnabled()) {
      return NextResponse.json(
        { error: 'Domain management requires V2 control plane' },
        { status: 400 }
      );
    }

    // Get site to retrieve subscription_id and system_id
    const adapter = getControlPlaneAdapter();
    const site = await adapter.getSite(siteId, authContext.jwt);

    if (!site) {
      return NextResponse.json({ error: 'Site not found' }, { status: 404 });
    }

    if (!site.subscription_id || !site.system_id) {
      logger.error('sites.domains.modify.missing-ids', {
        message: 'Site missing subscription_id or system_id',
        siteId,
      });
      return NextResponse.json(
        { error: 'Site configuration incomplete' },
        { status: 400 }
      );
    }

    // Parse request body
    const body = await request.json();
    const { domainsToCreate = [], domainsToDelete = [], createCdn = false } = body;

    // Validate at least one operation is requested
    if (domainsToCreate.length === 0 && domainsToDelete.length === 0) {
      return NextResponse.json(
        { error: 'Must specify at least one domain to create or delete' },
        { status: 400 }
      );
    }

    // Validate domain objects
    for (const domain of domainsToCreate) {
      if (!domain.fqdn || typeof domain.fqdn !== 'string') {
        return NextResponse.json(
          { error: 'Invalid domain format: fqdn is required' },
          { status: 400 }
        );
      }
    }

    for (const domain of domainsToDelete) {
      if (!domain.fqdn || typeof domain.fqdn !== 'string') {
        return NextResponse.json(
          { error: 'Invalid domain format: fqdn is required' },
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
      }
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
      error: error instanceof Error ? error.message : 'Unknown error',
    });

    return NextResponse.json(
      { error: 'Failed to modify domains', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: error?.status ?? 500 }
    );
  }
});
