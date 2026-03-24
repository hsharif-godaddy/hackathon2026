/**
 * GET /api/auth/token
 *
 * Generates site-scoped JWT for preview app authentication
 *
 * This endpoint generates a JWT token scoped to a specific site that can be used
 * for cross-domain authentication (e.g., preview apps on different domains).
 *
 * Query parameters:
 * - siteId (required): site to scope token to
 * - owningProduct (optional): owner product filter for site lookup
 *   (defaults to AiroAppBuilder when omitted)
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

import { getControlPlaneAdapter } from '@/lib/control-plane';
import { createCustomerAuthError, type CustomerAuthContext, customerHasAccount, type CustomerUser, withCustomerAuth } from '@/lib/customer-auth';
import { getJWTService } from '@/lib/jwt-service';
import { AIRO_OWNER_PRODUCTS, type AiroOwnerProduct } from '@/lib/mgmt-airo';

export const dynamic = 'force-dynamic';

const NO_CACHE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate',
  'Pragma': 'no-cache'
};

function parseOwningProduct(owningProduct: string | null): { owningProduct?: AiroOwnerProduct; error?: NextResponse } {
  if (owningProduct === null) {
    return {};
  }

  const normalizedOwningProduct = owningProduct.trim();
  const validOwningProducts = Object.values(AIRO_OWNER_PRODUCTS);
  if (!normalizedOwningProduct || !validOwningProducts.includes(normalizedOwningProduct as AiroOwnerProduct)) {
    return {
      error: NextResponse.json({
        error: `Invalid owningProduct query parameter. Allowed values: ${validOwningProducts.join(', ')}`
      }, {
        status: 400,
        headers: NO_CACHE_HEADERS
      })
    };
  }

  return { owningProduct: normalizedOwningProduct as AiroOwnerProduct };
}

/**
 * Validate site access and ownership via control plane adapter
 */
async function validateSiteAccess(siteId: string, user: CustomerUser, jwt: string, owningProduct?: AiroOwnerProduct): Promise<NextResponse | null> {
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

export const GET = withCustomerAuth(async (request: NextRequest, authContext: CustomerAuthContext): Promise<NextResponse> => {
  try {
    const { user } = authContext;

    // Get query parameters
    const { searchParams } = new URL(request.url);
    const siteId = searchParams.get('siteId');
    const owningProductResult = parseOwningProduct(searchParams.get('owningProduct'));

    if (!siteId) {
      return NextResponse.json({
        error: 'siteId query parameter is required'
      }, {
        status: 400,
        headers: NO_CACHE_HEADERS
      });
    }

    if (owningProductResult.error) {
      return owningProductResult.error;
    }

    // Validate user owns this site (CRITICAL: prevents authorization bypass)
    const validationError = await validateSiteAccess(siteId, user, authContext.jwt || '', owningProductResult.owningProduct);
    if (validationError) {
      return validationError;
    }

    // Generate site-scoped JWT
    const jwtService = getJWTService();
    const result = await jwtService.createToken({
      siteId,
      canDownload: false,  // Preview apps don't need download permission
      canPublish: false,   // Preview apps don't need publish permission
      authType: user.authType || 'basic',
      isE2S: user.isE2S ?? false
    });

    return NextResponse.json(
      { token: result.token },
      {
        headers: NO_CACHE_HEADERS
      }
    );

  } catch (error) {
    // Log error details server-side but return generic message to client
    console.error('Token generation failed:', error);
    return NextResponse.json({
      error: 'Token generation failed'
    }, {
      status: 500,
      headers: NO_CACHE_HEADERS
    });
  }
});
