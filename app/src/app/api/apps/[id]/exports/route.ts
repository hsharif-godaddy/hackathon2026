/**
 * Export Tracking API
 *
 * Records and lists app exports for refund eligibility tracking.
 */

import { NextRequest, NextResponse } from 'next/server';

import { getControlPlaneAdapter } from '@/lib/control-plane';
import {
  createCustomerAuthError,
  type CustomerAuthContext,
  customerHasAccount,
  withCustomerAuth
} from '@/lib/customer-auth';
import { AiroMgmtClient } from '@/lib/mgmt-airo';
import { logger } from '@/lib/request-context';

export const dynamic = 'force-dynamic';

/**
 * GET /api/apps/[id]/exports
 *
 * Lists all exports for an app.
 * Used to verify export tracking is working correctly.
 *
 * Response: { exports: [...], total: number }
 */
export const GET = withCustomerAuth(async (
  request: NextRequest,
  authContext: CustomerAuthContext,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> => {
  const { id: siteId } = await params;

  try {
    if (!siteId) {
      return NextResponse.json(
        { error: 'Site ID is required' },
        { status: 400 }
      );
    }

    if (!authContext.jwt) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    // Get site from control plane adapter
    const adapter = getControlPlaneAdapter();
    const site = await adapter.getSite(siteId, authContext.jwt);

    if (!site) {
      return NextResponse.json(
        { error: 'Site not found' },
        { status: 404 }
      );
    }

    // Check if site has subscription and system IDs
    if (!site.subscription_id || !site.system_id) {
      return NextResponse.json({
        exports: [],
        total: 0,
        message: 'Site missing subscription metadata - no export tracking available'
      });
    }

    logger.info('exports.api.list.start', {
      siteId,
      subscriptionId: site.subscription_id,
      systemId: site.system_id,
    });

    const baseUrl = process.env.MGMT_AIRO_BASE_URL || 'https://mgmt.nstk.net';
    const client = new AiroMgmtClient({ baseUrl, jwt: authContext.jwt });

    const result = await client.getAppExports(
      site.subscription_id,
      site.system_id,
      siteId
    );

    logger.info('exports.api.list.success', {
      siteId,
      total: result.total,
    });

    return NextResponse.json(result);
  } catch (error) {
    logger.error('exports.api.list.error', {
      siteId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });

    return NextResponse.json(
      { error: 'Failed to fetch exports' },
      { status: 500 }
    );
  }
});

/**
 * POST /api/apps/[id]/exports
 *
 * Records an export event to the control plane.
 * This is called by the client action when an export is initiated.
 *
 * Request body: { appName?: string, format?: string }
 * Response: { exportId, success }
 */
export const POST = withCustomerAuth(async (
  request: NextRequest,
  authContext: CustomerAuthContext,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> => {
  // Parse params and body at the top
  const { id: siteId } = await params;
  let body: { appName?: string; format?: string } = {};

  try {
    body = await request.json();
  } catch (parseError) {
    logger.error('exports.api.create.parse-error', {
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

    // Customer must have an account to export
    if (!customerHasAccount(user)) {
      return createCustomerAuthError(
        'You must have an account to export apps',
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

    // Check if site has subscription and system IDs (required for export tracking)
    if (!site.subscription_id || !site.system_id) {
      logger.warn('exports.api.create.missing-ids', {
        siteId,
        hasSubscriptionId: !!site.subscription_id,
        hasSystemId: !!site.system_id,
        message: 'Site missing subscription_id or system_id - export tracking skipped'
      });

      // Return false since tracking didn't occur (site missing subscription metadata)
      return NextResponse.json({
        success: false,
        message: 'Export not tracked (missing metadata)',
        exportId: null
      });
    }

    // JWT is provided by withCustomerAuth wrapper
    if (!authContext.jwt) {
      throw new Error('Authentication token required');
    }

    const baseUrl = process.env.MGMT_AIRO_BASE_URL || 'https://mgmt.nstk.net';
    const client = new AiroMgmtClient({ baseUrl, jwt: authContext.jwt });

    // Extract user identifier from auth context
    // Always use customerId of the logged-in user for refund eligibility tracking
    // This ensures delegates who export also count towards refund eligibility
    const initiatedBy = user.customerId || 'unknown';
    const authType = user.authType || 'basic';
    const isDelegated = authType === 'e2s' || authType === 's2s';

    logger.info('exports.api.create.start', {
      siteId,
      subscriptionId: site.subscription_id,
      systemId: site.system_id,
      initiatedBy,
      customerId: user.customerId,
      isDelegated,
      authType,
      format: body.format || 'zip'
    });

    const exportData = {
      initiatedBy,
      exportedAt: new Date().toISOString(),
      appName: body.appName || site.name || siteId,
      metadata: {
        format: body.format || 'zip',
        customerId: user.customerId,
        isDelegated,
        authType
      }
    };

    const response = await client.recordExport(
      site.subscription_id,
      site.system_id,
      siteId,
      exportData
    );

    // recordExport returns null on failure
    if (!response) {
      logger.error('exports.api.create.failed', {
        siteId,
        subscriptionId: site.subscription_id,
        initiatedBy,
        message: 'MHP-Airo recordExport returned null'
      });

      return NextResponse.json({
        success: false,
        message: 'Export not tracked (MHP-Airo call failed)',
        exportId: null
      });
    }

    logger.info('exports.api.create.success', {
      siteId,
      exportId: response.id,
      subscriptionId: site.subscription_id,
      initiatedBy,
      isDelegated
    });

    return NextResponse.json({
      success: true,
      exportId: response.id
    });

  } catch (error) {
    // Log error but return success - export tracking shouldn't block exports
    logger.error('exports.api.create.error', {
      siteId,
      error: error instanceof Error ? error.message : 'Unknown error'
    });

    // Return false since tracking failed - but don't block the download
    return NextResponse.json({
      success: false,
      message: 'Export not tracked (error occurred)',
      exportId: null
    });
  }
});