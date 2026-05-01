import { NextRequest, NextResponse } from 'next/server';

import { getControlPlaneAdapter } from '@/lib/control-plane';
import {
  createCustomerAuthError,
  type CustomerAuthContext,
  customerHasAccount,
  withCustomerAuth} from '@/lib/customer-auth';
import { AiroMgmtClient } from '@/lib/mgmt-airo';
import { logger } from '@/lib/request-context';

export const dynamic = 'force-dynamic';

/**
 * GET /api/apps/[id]/deployments
 *
 * Fetches deployment history for an app from mgmt-airo API.
 * Uses the control plane adapter to resolve subscription_id and system_id from the site.
 *
 * Query params: limit (default: 20), includeJobData (default: true)
 * Response: { deployments: [], totalCount, hasMore }
 */
export const GET = withCustomerAuth(async (
  request: NextRequest,
  authContext: CustomerAuthContext,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> => {
  try {
    const { user } = authContext;
    const { id: siteId } = await params;

    // Customer must have an account to view deployments
    if (!customerHasAccount(user)) {
      return createCustomerAuthError(
        'You must have an account to view deployments',
        403
      );
    }

    if (!siteId) {
      return NextResponse.json(
        { error: 'Site ID is required' },
        { status: 400 }
      );
    }

    // Get site from control plane adapter (handles auth and ownership)
    const adapter = getControlPlaneAdapter();
    const site = await adapter.getSite(siteId, authContext.jwt);

    if (!site) {
      return NextResponse.json(
        { error: 'Site not found' },
        { status: 404 }
      );
    }

    // Check if site has subscription and system IDs (required for deployments)
    if (!site.subscription_id || !site.system_id) {
      logger.error('deployments.api.missing-ids', {
        siteId,
        hasSubscriptionId: !!site.subscription_id,
        hasSystemId: !!site.system_id,
        message: 'Site missing required subscription_id or system_id'
      });
      return NextResponse.json(
        { error: 'Site missing required metadata (subscription_id or system_id)' },
        { status: 400 }
      );
    }

    // Parse query parameters
    const searchParams = request.nextUrl.searchParams;
    const limit = parseInt(searchParams.get('limit') || '20', 10);
    const includeJobData = searchParams.get('includeJobData') !== 'false';

    // JWT is provided by withCustomerAuth wrapper
    if (!authContext.jwt) {
      throw new Error('Authentication token required');
    }

    const baseUrl = process.env.MGMT_AIRO_BASE_URL || 'https://mgmt.nstk.net';
    const client = new AiroMgmtClient({ baseUrl, jwt: authContext.jwt });

    logger.info('deployments.api.start', {
      siteId,
      subscriptionId: site.subscription_id,
      systemId: site.system_id,
      limit,
      includeJobData
    });

    const response = await client.getDeployments(
      site.subscription_id,
      site.system_id,
      siteId,
      limit,
      includeJobData
    );

    logger.info('deployments.api.success', {
      siteId,
      subscriptionId: site.subscription_id,
      systemId: site.system_id,
      count: response.deployments?.length || 0
    });

    return NextResponse.json(response);

  } catch (error) {
    const { id: siteId } = await params;

    logger.error('deployments.api.error', {
      siteId,
      error: error instanceof Error ? error.message : 'Unknown error'
    });

    const status = (error as { status?: number })?.status ?? 500;

    return NextResponse.json(
      {
        error: 'Failed to fetch deployments',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status }
    );
  }
});

/**
 * POST /api/apps/[id]/deployments
 *
 * Creates a deployment record in mgmt-airo after agents service creates the archive.
 * This must be called from the frontend (not agents service) for security.
 *
 * Request body: { gitHash: string }
 * Response: { deploymentId, statusJobId, status, message }
 */
export const POST = withCustomerAuth(async (
  request: NextRequest,
  authContext: CustomerAuthContext,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> => {
  // Parse params and body at the top so they're accessible in error handler
  const { id: siteId } = await params;
  let body: { dnsUpdateConsent?: boolean; gitHash?: string } = {};

  try {
    const parsedBody: unknown = await request.json();
    if (parsedBody === null || typeof parsedBody !== 'object' || Array.isArray(parsedBody)) {
      return NextResponse.json(
        { error: 'Invalid request body' },
        { status: 400 }
      );
    }

    const requestBody = parsedBody as { dnsUpdateConsent?: unknown; gitHash?: unknown };
    if ('dnsUpdateConsent' in requestBody && requestBody.dnsUpdateConsent !== undefined && typeof requestBody.dnsUpdateConsent !== 'boolean') {
      return NextResponse.json(
        { error: 'Invalid dnsUpdateConsent: expected boolean' },
        { status: 400 }
      );
    }

    if ('gitHash' in requestBody && requestBody.gitHash !== undefined && typeof requestBody.gitHash !== 'string') {
      return NextResponse.json(
        { error: 'Invalid gitHash: expected string' },
        { status: 400 }
      );
    }

    body = {
      ...(typeof requestBody.gitHash === 'string' ? { gitHash: requestBody.gitHash } : {}),
      ...(typeof requestBody.dnsUpdateConsent === 'boolean' ? { dnsUpdateConsent: requestBody.dnsUpdateConsent } : {}),
    };
  } catch (parseError) {
    logger.error('deployments.api.create.parse-error', {
      siteId,
      error: parseError instanceof Error ? parseError.message : 'Failed to parse request body'
    });
    return NextResponse.json(
      { error: 'Invalid request body' },
      { status: 400 }
    );
  }

  try {
    const { user } = authContext;

    // Customer must have an account to create deployments
    if (!customerHasAccount(user)) {
      return createCustomerAuthError(
        'You must have an account to create deployments',
        403
      );
    }

    if (!siteId) {
      return NextResponse.json(
        { error: 'Site ID is required' },
        { status: 400 }
      );
    }

    if (!body.gitHash) {
      return NextResponse.json(
        { error: 'gitHash is required' },
        { status: 400 }
      );
    }

    // Get site from control plane adapter (handles auth and ownership)
    const adapter = getControlPlaneAdapter();
    const site = await adapter.getSite(siteId, authContext.jwt);

    if (!site) {
      return NextResponse.json(
        { error: 'Site not found' },
        { status: 404 }
      );
    }

    // Check if site has subscription and system IDs (required for deployments)
    if (!site.subscription_id || !site.system_id) {
      logger.error('deployments.api.create.missing-ids', {
        siteId,
        hasSubscriptionId: !!site.subscription_id,
        hasSystemId: !!site.system_id,
        message: 'Site missing required subscription_id or system_id'
      });
      return NextResponse.json(
        { error: 'Site missing required metadata (subscription_id or system_id)' },
        { status: 400 }
      );
    }

    // JWT is provided by withCustomerAuth wrapper
    if (!authContext.jwt) {
      throw new Error('Authentication token required');
    }

    const baseUrl = process.env.MGMT_AIRO_BASE_URL || 'https://mgmt.nstk.net';
    const client = new AiroMgmtClient({ baseUrl, jwt: authContext.jwt });

    logger.info('deployments.api.create.start', {
      siteId,
      subscriptionId: site.subscription_id,
      systemId: site.system_id,
      gitHash: body.gitHash.substring(0, 7)
    });

    const response = await client.publishApp(
      site.subscription_id,
      site.system_id,
      siteId,
      body.gitHash,
      body.dnsUpdateConsent
    );

    logger.info('deployments.api.create.success', {
      siteId,
      deploymentId: response.deploymentId,
      status: response.status
    });

    return NextResponse.json({
      deploymentId: response.deploymentId,
      statusJobId: response.statusJobId,
      status: response.status,
      message: response.message
    });

  } catch (error) {
    logger.error('deployments.api.create.error', {
      siteId,
      gitHash: body.gitHash?.substring(0, 7),
      error: error instanceof Error ? error.message : 'Unknown error'
    });

    const status = (error as { status?: number })?.status ?? 500;

    return NextResponse.json(
      {
        error: 'Failed to create deployment',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status }
    );
  }
}, { level: 3 });

