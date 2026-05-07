import { NextRequest, NextResponse } from 'next/server';

import { getControlPlaneAdapter } from '@/lib/control-plane';
import { handleControlPlaneError } from '@/lib/control-plane/error-handler';
import { createCorsOptionsHandler, withCorsHeaders } from '@/lib/cors';
import {
  createCustomerAuthError,
  type CustomerAuthContext,
  customerHasAccount,
  withCustomerAuth} from '@/lib/customer-auth';
import { logger } from '@/lib/request-context';
import { injectShareTokenIntoPreviewUrl } from '@/lib/share/inject-preview-token';
import { checkSwitchboardFlag } from '@/lib/switchboard/server';
import { detectLocale } from '@/lib/translations/server-intl';

// Force dynamic rendering to prevent database calls during build
export const dynamic = 'force-dynamic';

// CORS preflight handler
export const OPTIONS = createCorsOptionsHandler();

// GET /api/sites - Get sites using control plane adapter
async function handleGetSites(request: NextRequest, jwt: string, origin: string | null) {
  const { searchParams } = new URL(request.url);
  const siteId = searchParams.get('site_id');

  const adapter = getControlPlaneAdapter();

  // Hoist the Switchboard flag check above the per-site loop — single
  // in-memory lookup is fine to call once per site, but agreeing on the
  // result up front lets us skip the per-site work entirely when off.
  // See lib/share/inject-preview-token.ts for context on why preview_url
  // gets the token injected (3PC-blocking browsers).
  //
  // checkSwitchboardFlag can throw on Switchboard outages — treat that as
  // "flag off" so a transient Switchboard failure can't take down the
  // entire site list fetch. The injection is a best-effort enhancement.
  let flagEnabled = false;
  try {
    flagEnabled = await checkSwitchboardFlag('appbuilder-share-links', request);
  } catch (err) {
    logger.warn('share.previewUrl.flag.lookupError', {
      error: err instanceof Error ? err.message : 'Unknown switchboard error',
    });
  }

  if (siteId) {
    // Get specific site
    const site = await adapter.getSite(siteId, jwt);
    if (!site) {
      return withCorsHeaders(NextResponse.json({ error: 'Site not found' }, { status: 404 }), origin);
    }
    // Spread (don't mutate the adapter-returned object) — matches the list
    // path below and the project's "immutable data flows across
    // architectural boundaries" guideline. The current V2 adapter returns
    // fresh objects per call, but consistency keeps that assumption local.
    if (flagEnabled && site.preview_url && site.agent_url) {
      const previewUrl = await injectShareTokenIntoPreviewUrl(
        siteId,
        site.agent_url,
        site.preview_url,
      );
      return withCorsHeaders(
        NextResponse.json({ ...site, preview_url: previewUrl }),
        origin,
      );
    }
    return withCorsHeaders(NextResponse.json(site), origin);
  }

  // List all sites
  const sites = await adapter.listSites(jwt);

  // Inject in parallel for sites that have both agent_url and preview_url.
  // Each lookup is a fast SQLite read on agents; mints are rare (1× per
  // app per ~7 days). Promise.all is safe — the helper catches its own
  // errors and falls back to the bare URL, so no rejection bubbles up.
  if (flagEnabled) {
    const updated = await Promise.all(
      sites.map(async (site) => {
        if (!site.preview_url || !site.agent_url) return site;
        const previewUrl = await injectShareTokenIntoPreviewUrl(
          site.id,
          site.agent_url,
          site.preview_url,
        );
        return { ...site, preview_url: previewUrl };
      }),
    );
    return withCorsHeaders(NextResponse.json(updated), origin);
  }

  return withCorsHeaders(NextResponse.json(sites), origin);
}

// Authenticated GET for production
export const GET = withCustomerAuth(async (request: NextRequest, authContext: CustomerAuthContext) => {
  const origin = request.headers.get('origin');

  try {
    // JWT token required
    if (!authContext.jwt) {
      return withCorsHeaders(NextResponse.json({ error: 'Authentication token required' }, { status: 401 }), origin);
    }

    return await handleGetSites(request, authContext.jwt, origin);
  } catch (error) {
    const errorResponse = handleControlPlaneError(error, 'sites.fetch');
    return withCorsHeaders(errorResponse, origin);
  }
});

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

    // Detect locale for datacenter selection
    const marketId = await detectLocale();

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
