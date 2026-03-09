import { NextRequest, NextResponse } from 'next/server';

import { getControlPlaneAdapter, isV2ControlPlaneEnabled } from '@/lib/control-plane';
import {
  createCustomerAuthError,
  type CustomerAuthContext,
  customerHasAccount,
  withCustomerAuth} from '@/lib/customer-auth';
import { logger } from '@/lib/request-context';

// Force dynamic rendering to prevent database calls during build
export const dynamic = 'force-dynamic';

// GET /api/sites/[id] - Get specific site
async function handleGetSite(request: NextRequest, siteId: string, authContext: CustomerAuthContext) {
  const includeCdn = request.nextUrl.searchParams.get('includeCdn') === 'true';
  const adapter = getControlPlaneAdapter();
  const site = await adapter.getSite(siteId, authContext.jwt, undefined, { includeCdn });

  if (!site) {
    return NextResponse.json({ error: 'Site not found' }, { status: 404 });
  }

  // Add control plane type to response so client knows whether to skip deploy
  const siteWithMetadata = {
    ...site,
    controlPlane: isV2ControlPlaneEnabled() ? 'v2' : 'legacy'
  };

  // Add no-cache headers to prevent caching during polling
  return NextResponse.json(siteWithMetadata, {
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
      'Pragma': 'no-cache',
      'Expires': '0',
    },
  });
}

// GET /api/sites/[id] - Get specific site (authenticated)
export const GET = withCustomerAuth(async (request: NextRequest, authContext: CustomerAuthContext, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> => {
  try {
    const { id: siteId } = await params;

    if (!siteId) {
      return NextResponse.json({ error: 'Site ID is required' }, { status: 400 });
    }

    // JWT required
    if (!authContext.jwt) {
      return NextResponse.json({ error: 'Authentication token required' }, { status: 401 });
    }

    // Use the centralized handler with auth context
    return await handleGetSite(request, siteId, authContext);

  } catch (error) {
    logger.error('sites.get.error', {
      message: 'Failed to fetch site',
      error: error instanceof Error ? error.message : String(error)
    });
    return NextResponse.json(
      { error: 'Failed to fetch site' },
      { status: 500 }
    );
  }
});

// DELETE /api/sites/[id] - Delete specific site
export const DELETE = withCustomerAuth(async (request: NextRequest, authContext: CustomerAuthContext, { params }: { params: Promise<{ id: string }> }) => {
  try {
    const { id: siteId } = await params;
    const { user } = authContext;

    // Customer must have an account to delete sites
    if (!customerHasAccount(user)) {
      return createCustomerAuthError('You must have an account to delete sites', 403);
    }

    if (!siteId) {
      return NextResponse.json({ error: 'Site ID is required' }, { status: 400 });
    }

    // JWT required
    if (!authContext.jwt) {
      return NextResponse.json({ error: 'Authentication token required' }, { status: 401 });
    }

    const adapter = getControlPlaneAdapter();

    // Get site first to verify existence and get system_id (only one expensive search)
    const site = await adapter.getSite(siteId, authContext.jwt);
    if (!site) {
      return NextResponse.json({ error: 'Site not found' }, { status: 404 });
    }

    // Delete via adapter, passing system_id and subscription_id to avoid redundant getSite call
    const result = await adapter.deleteSite(siteId, authContext.jwt, site.system_id, site.subscription_id);

    if (!result.success) {
      return NextResponse.json({ error: result.error || 'Failed to delete site' }, { status: 500 });
    }

    logger.info('sites.delete.success', {
      message: 'Site deleted by authenticated customer',
      siteId,
      accountId: user.accountId
    });

    return NextResponse.json({
      success: true,
      message: 'Site deleted successfully'
    });

  } catch (error) {
    logger.error('sites.delete.error', {
      message: 'Failed to delete site',
      error: error instanceof Error ? error.message : String(error)
    });
    return NextResponse.json(
      { error: 'Failed to delete site' },
      { status: 500 }
    );
  }
});

// PATCH /api/sites/[id] - Update specific site
export const PATCH = withCustomerAuth(async (request: NextRequest, authContext: CustomerAuthContext, { params }: { params: Promise<{ id: string }> }) => {
  try {
    const { id: siteId } = await params;
    const updateData = await request.json();
    const { user } = authContext;

    // Customer must have an account to update sites
    if (!customerHasAccount(user)) {
      return createCustomerAuthError('You must have an account to update sites', 403);
    }

    if (!siteId) {
      return NextResponse.json({ error: 'Site ID is required' }, { status: 400 });
    }

    // JWT required
    if (!authContext.jwt) {
      return NextResponse.json({ error: 'Authentication token required' }, { status: 401 });
    }

    const adapter = getControlPlaneAdapter();

    // Check site exists and ownership
    const existingSite = await adapter.getSite(siteId, authContext.jwt);

    if (!existingSite) {
      return NextResponse.json({ error: 'Site not found' }, { status: 404 });
    }

    // Update site via adapter
    const updatedSite = await adapter.updateSite(siteId, updateData, authContext.jwt);

    if (!updatedSite) {
      return NextResponse.json({ error: 'Failed to update site' }, { status: 404 });
    }

    logger.info('sites.update.success', {
      message: 'Site updated by authenticated customer',
      siteId,
      accountId: user.accountId
    });

    return NextResponse.json(updatedSite);
  } catch (error) {
    logger.error('sites.update.error', {
      message: 'Failed to update site',
      error: error instanceof Error ? error.message : String(error)
    });
    return NextResponse.json(
      { error: 'Failed to update site' },
      { status: 500 }
    );
  }
});
