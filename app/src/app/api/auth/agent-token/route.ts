/**
 * Agent Token Endpoint
 * Creates simple JWT tokens for agent communication
 * POST /api/auth/agent-token
 */

import { NextRequest, NextResponse } from 'next/server';
import { getJWTService } from '@/lib/jwt-service';
import { withCustomerAuth, customerHasAccount, createCustomerAuthError, type CustomerAuthContext } from '@/lib/customer-auth';
import { SiteAdapterFactory } from '@/lib/site-adapters/SiteAdapterFactory';

export interface CreateAgentTokenRequest {
  siteId: string;
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

    // Check auth requirements
    const siteAdapter = SiteAdapterFactory.getInstance();
    if (siteAdapter.requiresAuth() && !customerHasAccount(user)) {
      return createCustomerAuthError('You must have an account to create agent tokens', 403);
    }

    // Verify site exists and user owns it
    const site = await siteAdapter.getSiteById(body.siteId);
    
    if (!site) {
      return NextResponse.json({ 
        error: 'Site not found' 
      }, { status: 404 });
    }

    // Verify ownership - user can only create tokens for their own sites
    if (siteAdapter.requiresAuth() && site.account_id !== user.accountId) {
      return createCustomerAuthError('You can only create tokens for your own sites', 403);
    }

    // Create simple JWT token (no complex auth dependencies)
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
