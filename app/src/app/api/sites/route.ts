import { NextRequest, NextResponse } from 'next/server';

import { getControlPlaneAdapter } from '@/lib/control-plane';
import { handleControlPlaneError } from '@/lib/control-plane/error-handler';
import {
  createCustomerAuthError,
  type CustomerAuthContext,
  customerHasAccount,
  withCustomerAuth} from '@/lib/customer-auth';
import { logger } from '@/lib/request-context';

// Force dynamic rendering to prevent database calls during build
export const dynamic = 'force-dynamic';

// GET /api/sites - Get sites using control plane adapter
async function handleGetSites(request: NextRequest, jwt: string) {
  const { searchParams } = new URL(request.url);
  const siteId = searchParams.get('site_id');

  const adapter = getControlPlaneAdapter();

  if (siteId) {
    // Get specific site
    const site = await adapter.getSite(siteId, jwt);
    if (!site) {
      return NextResponse.json({ error: 'Site not found' }, { status: 404 });
    }
    return NextResponse.json(site);
  }

  // List all sites
  const sites = await adapter.listSites(jwt);
  return NextResponse.json(sites);
}

// Authenticated GET for production
export const GET = withCustomerAuth(async (request: NextRequest, authContext: CustomerAuthContext) => {
  try {
    // JWT token required
    if (!authContext.jwt) {
      return NextResponse.json({ error: 'Authentication token required' }, { status: 401 });
    }

    return await handleGetSites(request, authContext.jwt);
  } catch (error) {
    return handleControlPlaneError(error, 'sites.fetch');
  }
});

// POST /api/sites - Authenticated customers can create sites in their own account only
export const POST = withCustomerAuth(async (request: NextRequest, authContext: CustomerAuthContext) => {
  try {
    const body = await request.json();
    const { prompt, initialPrompt } = body;
    const { user } = authContext;

    // Customer must have an account to create sites
    if (!customerHasAccount(user)) {
      return createCustomerAuthError('You must have an account to create sites. Please create an account first.', 403);
    }

    // JWT required
    if (!authContext.jwt) {
      return NextResponse.json({ error: 'Authentication token required' }, { status: 401 });
    }

    // Accept either prompt or initialPrompt
    const projectPrompt = prompt || initialPrompt;
    if (!projectPrompt) {
      return NextResponse.json(
        { error: 'prompt or initialPrompt is required' },
        { status: 400 }
      );
    }

    // Use authenticated user's account ID
    const account_id = user.accountId!;

    // Create site using control plane adapter
    const adapter = getControlPlaneAdapter();
    const result = await adapter.createSite({
      accountId: account_id,
      prompt: projectPrompt,
      jwt: authContext.jwt
    });

    if (!result.success) {
      throw new Error(result.error || 'Failed to create site');
    }

    return NextResponse.json({
      id: result.siteId,
      status: result.status,
      created_at: result.created_at?.toISOString() || new Date().toISOString()
    }, { status: 201 });

  } catch (error) {
    return handleControlPlaneError(error, 'sites.create');
  }
});

// DELETE /api/sites - Authenticated customers can only delete their own sites
export const DELETE = withCustomerAuth(async (request: NextRequest, authContext: CustomerAuthContext) => {
  try {
    const { searchParams } = new URL(request.url);
    const siteId = searchParams.get('site_id');
    const { user } = authContext;

    // Customer must have an account to delete sites
    if (!customerHasAccount(user)) {
      return createCustomerAuthError('You must have an account to delete sites', 403);
    }

    if (!siteId) {
      return NextResponse.json(
        { error: 'site_id is required' },
        { status: 400 }
      );
    }

    // JWT required
    if (!authContext.jwt) {
      return NextResponse.json({ error: 'Authentication token required' }, { status: 401 });
    }

    const adapter = getControlPlaneAdapter();

    // Get site to verify ownership
    const site = await adapter.getSite(siteId, authContext.jwt);
    if (!site) {
      return NextResponse.json({ error: 'Site not found' }, { status: 404 });
    }

    // Delete site, passing system_id and subscription_id to avoid redundant getSite call
    const result = await adapter.deleteSite(siteId, authContext.jwt, site.system_id, site.subscription_id);

    if (!result.success) {
      return NextResponse.json({ error: result.error || 'Failed to delete site' }, { status: 500 });
    }

    logger.info('sites.delete.success', {
      message: 'Site deleted by authenticated customer',
      siteId,
      accountId: user.accountId
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleControlPlaneError(error, 'sites.delete');
  }
});
