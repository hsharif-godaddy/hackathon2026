/**
 * Agent Token Endpoint
 * Creates simple JWT tokens for agent communication
 * POST /api/auth/agent-token
 */

import { NextRequest, NextResponse } from 'next/server';
import { getJWTService } from '@/lib/jwt-service';
import { withCustomerAuth, customerHasAccount, createCustomerAuthError, type CustomerAuthContext, type CustomerUser } from '@/lib/customer-auth';
import { getControlPlaneAdapter, isV2ControlPlaneEnabled } from '@/lib/control-plane';
import { SiteAdapterFactory } from '@/lib/site-adapters/SiteAdapterFactory';

export interface CreateAgentTokenRequest {
  siteId: string;
}

export const dynamic = 'force-dynamic';

/**
 * Validate and retrieve site using V2 control plane adapter
 */
async function getSiteV2(siteId: string, user: CustomerUser, jwt: string): Promise<NextResponse | null> {
  if (!customerHasAccount(user)) {
    return createCustomerAuthError('You must have an account to create agent tokens', 403);
  }
  
  const adapter = getControlPlaneAdapter();
  const site = await adapter.getSite(siteId, jwt);
  
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
    return createCustomerAuthError('You must have an account to create agent tokens', 403);
  }

  const site = await siteAdapter.getSiteById(siteId);
  
  if (!site) {
    return NextResponse.json({ 
      error: 'Site not found' 
    }, { status: 404 });
  }

  if (siteAdapter.requiresAuth() && site.account_id !== user.accountId) {
    return createCustomerAuthError('You can only create tokens for your own sites', 403);
  }
  
  return null;
}

/**
 * Validate site access and ownership based on control plane mode
 */
async function validateSiteAccess(siteId: string, user: CustomerUser, jwt: string): Promise<NextResponse | null> {
  const isV2 = isV2ControlPlaneEnabled();
  return isV2 ? await getSiteV2(siteId, user, jwt) : await getSiteLegacy(siteId, user);
}

export const POST = withCustomerAuth(async (request: NextRequest, authContext: CustomerAuthContext): Promise<NextResponse> => {
  try {
    const body: CreateAgentTokenRequest = await request.json();
    const { user } = authContext;
    
    if (!body.siteId) {
      return NextResponse.json({ 
        error: 'siteId is required' 
      }, { status: 400 });
    }

    const validationError = await validateSiteAccess(body.siteId, user, authContext.jwt || '');
    if (validationError) {
      return validationError;
    }

    const jwtService = getJWTService();
    const result = await jwtService.getToken({
      siteId: body.siteId
    });

    return NextResponse.json({
      token: result.token,
      expires: result.expires.toISOString(),
      siteId: body.siteId,
      type: 'jwt'
    });

  } catch (error) {
    return NextResponse.json({ 
      error: 'Token creation failed',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
});
