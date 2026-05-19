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
 * Authentication: two caller forms.
 *
 * 1. Customer auth (cookie OR `Authorization: sso-jwt <basic|e2s|s2s>`).
 *    Mints with the original authType and the default 12h TTL.
 *
 * 2. Cert2s service-caller delegation (`Authorization: sso-jwt <cert2s-token>`),
 *    used by mhp-core hosting on behalf of the app owner for pre-archive
 *    screenshot capture. Mints with `authType: 'cert2s'` and a 15-min TTL cap
 *    so a compromised hosting cert can't sit on a long-lived owner token.
 *
 * The cert2s mint requires BOTH the sso-jwt header form AND authType=cert2s —
 * either side alone returns 403. This locks the cert2s path to the delegated
 * form bound to a real owner (no plain cert-realm, no arbitrary s2s).
 *
 * Site ownership is validated via the control-plane adapter for both forms,
 * preventing authorization bypass.
 */

import { NextRequest, NextResponse } from 'next/server';

import { getControlPlaneAdapter } from '@/lib/control-plane';
import { createCustomerAuthError, type CustomerAuthContext, customerHasAccount, type CustomerUser, withCustomerAuth } from '@/lib/customer-auth';
import { getJWTService } from '@/lib/jwt-service';
import { AIRO_OWNER_PRODUCTS, type AiroOwnerProduct } from '@/lib/mgmt-airo';
import { logger } from '@/lib/request-context';

export const dynamic = 'force-dynamic';

const NO_CACHE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate',
  'Pragma': 'no-cache'
};

// Long enough for the downstream share-mint + screenshot-render hops, short
// enough that a leak can't produce a long-lived owner-scoped token.
const CERT2S_AIROAPP_TTL_SECONDS = 15 * 60;

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

/**
 * `withCustomerAuth` accepts both the auth_idp cookie and the sso-jwt header
 * form, so this is how the route distinguishes them and applies different
 * policy (cert2s mints require the sso-jwt form).
 */
function isSsoJwtCaller(request: NextRequest): boolean {
  const authHeader = request.headers.get('authorization');
  return !!authHeader && authHeader.toLowerCase().startsWith('sso-jwt ');
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

    // The cert2s mint requires BOTH sso-jwt header form AND authType=cert2s.
    // Either side alone is rejected — the property is load-bearing, not
    // coincidental.
    const ssoJwtCaller = isSsoJwtCaller(request);
    const isCert2s = ssoJwtCaller && user.authType === 'cert2s';
    if (ssoJwtCaller !== (user.authType === 'cert2s')) {
      logger.warn('auth.token.cert2s.gateMismatch', {
        ssoJwtCaller,
        authType: user.authType,
        siteId,
      }, { tags: ['security'] });
      return NextResponse.json({ error: 'Forbidden' }, {
        status: 403,
        headers: NO_CACHE_HEADERS
      });
    }

    // CRITICAL: prevents authorization bypass. Cert2s flows through the same
    // control-plane lookup, confirming the shopperId claim owns the siteId.
    const validationError = await validateSiteAccess(siteId, user, authContext.jwt || '', owningProductResult.owningProduct);
    if (validationError) {
      return validationError;
    }

    // Cert2s mints get a 15-min TTL override (12h default otherwise).
    const jwtService = getJWTService();
    const result = await jwtService.createToken({
      siteId,
      canDownload: false,  // Preview apps don't need download permission
      canPublish: false,   // Preview apps don't need publish permission
      authType: user.authType || 'basic',
      isE2S: user.isE2S ?? false
    }, isCert2s ? CERT2S_AIROAPP_TTL_SECONDS : undefined);

    if (isCert2s) {
      logger.info('auth.token.cert2s.minted', {
        siteId,
        shopperId: user.shopperId,
        ttlSeconds: CERT2S_AIROAPP_TTL_SECONDS,
      }, { tags: ['security'] });
    }

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
