import { getControlPlaneAdapter } from '@/lib/control-plane';
import { NextRequest, NextResponse } from 'next/server';
import { AiroMgmtClient } from '@/lib/mgmt-airo';
import { logger } from '@/lib/request-context';
import {
  createCustomerAuthError,
  customerHasAccount,
  withCustomerAuth,
  type CustomerAuthContext
} from '@/lib/customer-auth';

export const dynamic = 'force-dynamic';

/**
 * GET /api/apps/[id]/deployments
 *
 * Fetches deployment history for an app from mgmt-airo API.
 * Uses the control plane adapter to resolve subscription_id and system_id from the site.
 *
 * @param {NextRequest} request - The incoming HTTP request with searchParams:
 *   - limit: Maximum number of deployments to return (default: 20)
 *   - includeJobData: Whether to include job data (default: true)
 * @param {CustomerAuthContext} authContext - Authentication context with user info
 * @param {Object} params - Route parameters
 * @param {string} params.id - The site ID
 *
 * @returns {NextResponse} Response containing deployments array and metadata
 *
 * @example
 * // Request
 * GET /api/apps/abc123/deployments?limit=10&includeJobData=true
 *
 * // Response
 * {
 *   "deployments": [
 *     {
 *       "id": "deployment-123",
 *       "status": "deployed",
 *       "commitHash": "a1b2c3d",
 *       "createdAt": "2024-01-01T00:00:00Z"
 *     }
 *   ]
 * }
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
      logger.warn('deployments.api.no-ids', {
        siteId,
        hasSubscriptionId: !!site.subscription_id,
        hasSystemId: !!site.system_id,
      });
      return NextResponse.json(
        { error: 'Site does not have deployment configuration' },
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
    logger.error('deployments.api.error', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });

    const status = (error && typeof error === 'object' && 'status' in error && typeof error.status === 'number')
      ? error.status
      : 500;

    return NextResponse.json(
      {
        error: 'Failed to fetch deployments',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status }
    );
  }
});

