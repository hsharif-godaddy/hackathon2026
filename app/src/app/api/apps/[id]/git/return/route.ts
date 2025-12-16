import { NextRequest, NextResponse } from 'next/server';

import { agentFetch } from '@/lib/agent-fetch';
import {
  createCustomerAuthError,
  type CustomerAuthContext,
  customerHasAccount,
  withCustomerAuth} from '@/lib/customer-auth';
import { logger } from '@/lib/request-context';
import { SiteAdapterFactory } from '@/lib/site-adapters/SiteAdapterFactory';

export const POST = withCustomerAuth(async (request: NextRequest, authContext: CustomerAuthContext, { params }: { params: Promise<{ id: string }> }) => {
  try {
    const { user } = authContext;
    const { id: siteId } = await params;

    // Customer must have an account to use git operations
    if (!customerHasAccount(user)) {
      return createCustomerAuthError('You must have an account to use git operations', 403);
    }

    if (!siteId) {
      return NextResponse.json(
        { error: 'Site ID is required' },
        { status: 400 }
      );
    }

    // Get site adapter and check site exists and ownership
    const siteAdapter = SiteAdapterFactory.getInstance();
    const site = await siteAdapter.getSiteById(siteId);

    if (!site) {
      return NextResponse.json({ error: 'Site not found' }, { status: 404 });
    }

    // Customer can only access sites from their own account
    if (siteAdapter.requiresAuth() && site.account_id !== user.accountId) {
      return createCustomerAuthError('You can only access your own sites', 403);
    }
    
    if (!site?.agent_url) {
      throw new Error('Site does not have agent URL')
    }
    
    // Forward the request to the agent service
    const agentUrl = `${site.agent_url}/git/return`
    
    const body = await request.text()
    
    const response = await agentFetch(agentUrl, {
      siteId: siteId,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: body
    })

    if (!response.ok) {
      logger.error(`Agent git/return failed: ${response.status} ${response.statusText}`)
      return NextResponse.json(
        { 
          error: 'Failed to return to latest commit',
          status: response.status 
        },
        { status: response.status }
      )
    }

    const data = await response.json()
    return NextResponse.json(data)

  } catch (error) {
    logger.error('Error in git/return route:', error)
    return NextResponse.json(
      { 
        error: 'Internal server error', 
        message: error instanceof Error ? error.message : 'Unknown error' 
      },
      { status: 500 }
    )
  }
});
