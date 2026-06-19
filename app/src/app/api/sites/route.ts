import { NextRequest, NextResponse } from 'next/server';

import { getControlPlaneAdapter } from '@/lib/control-plane';
import { handleControlPlaneError } from '@/lib/control-plane/error-handler';
import { CORS_ROUTES, createCorsOptionsHandler } from '@/lib/cors';
import {
  createCustomerAuthError,
  type CustomerAuthContext,
  customerHasAccount,
  withCustomerAuth} from '@/lib/customer-auth';
import { resolveMarketId } from '@/lib/market/resolve-market';
import { logger } from '@/lib/request-context';
import { injectShareTokenIntoPreviewUrl } from '@/lib/share/inject-preview-token';

// Force dynamic rendering to prevent database calls during build
export const dynamic = 'force-dynamic';

// CORS preflight handler
export const OPTIONS = createCorsOptionsHandler(CORS_ROUTES.GET_SITES);

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

    // This single-site path is the on-demand share-token injection point: the
    // apps list (below) returns the control-plane payload as-is, and the
    // Projects-page preview button fetches ?site_id=<id> when a preview is
    // opened. Keeping injection off the list keeps an un-paginated list GET
    // lightweight (no per-app agent round-trips). The appbuilder-share-links
    // rollout is complete, so injection is no longer flag-gated — see
    // lib/share/inject-preview-token.ts for why preview_url gets the token
    // (3PC-blocking browsers / dev-supervisor auth).
    //
    // Spread (don't mutate the adapter-returned object) — the project's
    // "immutable data flows across architectural boundaries" guideline.
    if (site.preview_url && site.agent_url) {
      const previewUrl = await injectShareTokenIntoPreviewUrl(
        siteId,
        site.agent_url,
        site.preview_url,
      );
      return NextResponse.json({ ...site, preview_url: previewUrl });
    }
    return NextResponse.json(site);
  }

  // List all sites — return the control-plane payload as-is. A list GET
  // must stay lightweight and this endpoint is intentionally un-paginated,
  // so there is no per-site work here: share tokens are injected on-demand
  // via the ?site_id= path above when a preview is actually opened (see the
  // Projects-page AppCard preview button).
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
    const errorResponse = handleControlPlaneError(error, 'sites.fetch');
    return errorResponse;
  }
}, { addCorsHeaders: true, corsRoute: CORS_ROUTES.GET_SITES });

// POST /api/sites - Authenticated customers can create sites in their own account only
export const POST = withCustomerAuth(async (request: NextRequest, authContext: CustomerAuthContext) => {
  try {
    const body = await request.json();
    const { prompt, initialPrompt, datacenter: rawDatacenter } = body;
    const validDatacenter =
      typeof rawDatacenter === 'string' && rawDatacenter.trim().length > 0 ? rawDatacenter.trim() : undefined;
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

    const { marketId } = await resolveMarketId(request);

    // Create site using control plane adapter
    const adapter = getControlPlaneAdapter();
    const result = await adapter.createSite({
      accountId: account_id,
      prompt: projectPrompt,
      jwt: authContext.jwt,
      marketId,
      headers: request.headers,
      ...(validDatacenter && { datacenter: validDatacenter }),
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
}, { level: 3 });
