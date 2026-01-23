/**
 * GET /api/auth/token
 *
 * Generates site-scoped JWT for preview app authentication
 *
 * This endpoint generates a JWT token scoped to a specific site that can be used
 * for cross-domain authentication (e.g., preview apps on different domains).
 *
 * Use case: Preview apps run on different domains than the builder app:
 * - Production: preview.c4.test-airoapp.ai vs airo-builder.test-godaddy.com
 * - Local: localhost vs local.gasket.dev-godaddy.com
 *
 * The browser won't send the builder app's auth_idp cookie to preview domains,
 * so we generate a site-scoped JWT that can be passed via Authorization header.
 *
 * Security: This endpoint validates that the authenticated user owns the requested
 * site before issuing a token, preventing authorization bypass attacks.
 */

import { NextRequest, NextResponse } from 'next/server';

import { getControlPlaneAdapter, isV2ControlPlaneEnabled } from '@/lib/control-plane';
import { createCustomerAuthError, type CustomerAuthContext, customerHasAccount, type CustomerUser, withCustomerAuth } from '@/lib/customer-auth';
import { getJWTService } from '@/lib/jwt-service';
import { AIRO_OWNER_PRODUCTS } from '@/lib/mgmt-airo';
import { SiteAdapterFactory } from '@/lib/site-adapters/SiteAdapterFactory';

export const dynamic = 'force-dynamic';

/**
 * Validate and retrieve site using V2 control plane adapter
 */
async function getSiteV2(siteId: string, user: CustomerUser, jwt: string, owningProduct?: string): Promise<NextResponse | null> {
  if (!customerHasAccount(user)) {
    return createCustomerAuthError('You must have an account to access preview apps', 403);
  }

  const adapter = getControlPlaneAdapter();
  const productFilter = owningProduct || AIRO_OWNER_PRODUCTS.AIRO_APP_BUILDER;
  const site = await adapter.getSite(siteId, jwt, productFilter);

  if (!site) {
    return NextResponse.json({
      error: 'Site not found'
    }, { status: 404 });
  }

  return null;
}

/**
 * Validate and retrieve site using legacy site adapter
 */
async function getSiteLegacy(siteId: string, user: CustomerUser): Promise<NextResponse | null> {
  const siteAdapter = SiteAdapterFactory.getInstance();

  if (siteAdapter.requiresAuth() && !customerHasAccount(user)) {
    return createCustomerAuthError('You must have an account to access preview apps', 403);
  }

  const site = await siteAdapter.getSiteById(siteId);

  if (!site) {
    return NextResponse.json({
      error: 'Site not found'
    }, { status: 404 });
  }

  if (siteAdapter.requiresAuth() && site.account_id !== user.accountId) {
    return createCustomerAuthError('You can only access your own sites', 403);
  }

  return null;
}

/**
 * Validate site access and ownership based on control plane mode
 */
async function validateSiteAccess(siteId: string, user: CustomerUser, jwt: string, owningProduct?: string): Promise<NextResponse | null> {
  const isV2 = isV2ControlPlaneEnabled();
  return isV2 ? await getSiteV2(siteId, user, jwt, owningProduct) : await getSiteLegacy(siteId, user);
}

export const GET = withCustomerAuth(async (request: NextRequest, authContext: CustomerAuthContext): Promise<NextResponse> => {
  try {
    const { user } = authContext;

    // Get siteId from query parameter
    const siteId = request.nextUrl.searchParams.get('siteId');

    if (!siteId) {
      return NextResponse.json({
        error: 'siteId query parameter is required'
      }, {
        status: 400,
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate',
          'Pragma': 'no-cache'
        }
      });
    }

    // Validate user owns this site (CRITICAL: prevents authorization bypass)
    const validationError = await validateSiteAccess(siteId, user, authContext.jwt || '');
    if (validationError) {
      return validationError;
    }

    // Generate site-scoped JWT
    const jwtService = getJWTService();
    const result = await jwtService.createToken({
      siteId,
      canDownload: false,  // Preview apps don't need download permission
      canPublish: false,   // Preview apps don't need publish permission
      isE2S: user.isE2S ?? false
    });

    return NextResponse.json(
      { token: result.token },
      {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate',
          'Pragma': 'no-cache'
        }
      }
    );

  } catch (error) {
    // Log error details server-side but return generic message to client
    console.error('Token generation failed:', error);
    return NextResponse.json({
      error: 'Token generation failed'
    }, {
      status: 500,
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'Pragma': 'no-cache'
      }
    });
  }
});
