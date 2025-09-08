import { NextRequest, NextResponse } from 'next/server';
import { SiteAdapterFactory } from '@/lib/site-adapters/SiteAdapterFactory';
import { 
  withCustomerAuth, 
  customerHasAccount,
  createCustomerAuthError,
  type CustomerAuthContext 
} from '@/lib/customer-auth';

// GET /api/sites - Get sites using site adapter
async function handleGetSites(request: NextRequest, accountId?: string) {
  const { searchParams } = new URL(request.url);
  const siteId = searchParams.get('site_id');
  const siteAdapter = SiteAdapterFactory.getInstance();

  if (siteId) {
    // Get specific site
    const site = await siteAdapter.getSiteById(siteId);
    if (!site) {
      return NextResponse.json({ error: 'Site not found' }, { status: 404 });
    }

    // Check ownership if adapter requires auth
    if (siteAdapter.requiresAuth() && accountId && site.account_id !== accountId) {
      return createCustomerAuthError('You can only access your own sites', 403);
    }

    return NextResponse.json(site);
  }

  // Get all sites for account (dev mode uses dummy account)
  const sites = await siteAdapter.getSitesByAccountId(accountId || 'dev-account');
  return NextResponse.json(sites);
}

// Authenticated GET for production
export const GET = withCustomerAuth(async (request: NextRequest, authContext: CustomerAuthContext) => {
  try {
    const { user } = authContext;
    const siteAdapter = SiteAdapterFactory.getInstance();

    // Check auth requirements
    if (siteAdapter.requiresAuth() && !customerHasAccount(user)) {
      return createCustomerAuthError('You must have an account to access sites', 403);
    }

    return await handleGetSites(request, user.accountId);
  } catch (error) {
    console.error('Error fetching sites:', error);
    return NextResponse.json(
      { error: 'Failed to fetch sites' },
      { status: 500 }
    );
  }
});

// POST /api/sites - Authenticated customers can create sites in their own account only
export const POST = withCustomerAuth(async (request: NextRequest, authContext: CustomerAuthContext) => {
  try {
    const body = await request.json();
    const { prompt, initialPrompt } = body; // Extract prompt from request body
    const { user } = authContext;

    // Customer must have an account to create sites
    if (!customerHasAccount(user)) {
      return createCustomerAuthError('You must have an account to create sites. Please create an account first.', 403);
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

    // Check site limits using adapter
    const siteAdapter = SiteAdapterFactory.getInstance();
    const limitCheck = await siteAdapter.checkSiteLimit(account_id);
    if (!limitCheck.canCreate) {
      return NextResponse.json(
        {
          error: 'Site limit exceeded',
          current: limitCheck.currentCount,
          limit: limitCheck.limit
        },
        { status: 403 }
      );
    }

    // Create site using adapter (handles both data persistence and deployment)
    try {
      const site = await siteAdapter.createSite({
        accountId: account_id,
        initialPrompt: projectPrompt
      });

      return NextResponse.json(site, { status: 201 });
    } catch (error) {
      console.error('❌ Site creation failed:', error);
      return NextResponse.json(
        {
          error: 'Site creation failed',
          details: error instanceof Error ? error.message : 'Unknown error'
        },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('Error creating site:', error);
    return NextResponse.json(
      { error: 'Failed to create site' },
      { status: 500 }
    );
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

    // Get site adapter and check site exists and ownership
    const siteAdapter = SiteAdapterFactory.getInstance();
    const site = await siteAdapter.getSiteById(siteId);
    
    if (!site) {
      return NextResponse.json({ error: 'Site not found' }, { status: 404 });
    }

    // Customer can only delete sites from their own account
    if (siteAdapter.requiresAuth() && site.account_id !== user.accountId) {
      return createCustomerAuthError('You can only delete your own sites', 403);
    }

    // Destroy site using adapter (handles both infrastructure cleanup and database deletion)
    const destroyed = await siteAdapter.destroySite(siteId);
    
    if (!destroyed) {
      return NextResponse.json({ error: 'Failed to delete site' }, { status: 500 });
    }

    console.log('✅ Site deleted by authenticated customer:', {
      siteId,
      accountId: user.accountId,
      shopperId: user.shopperId
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting site:', error);
    return NextResponse.json(
      { error: 'Failed to delete site' },
      { status: 500 }
    );
  }
});

