import { NextRequest, NextResponse } from 'next/server';
import { SiteAdapterFactory } from '@/lib/site-adapters/SiteAdapterFactory';
import { logger } from '@/lib/request-context';
import { 
  withCustomerAuth, 
  customerHasAccount,
  createCustomerAuthError,
  type CustomerAuthContext 
} from '@/lib/customer-auth';

// GET /api/sites/[id] - Get specific site
async function handleGetSite(request: NextRequest, siteId: string, authContext?: CustomerAuthContext) {
  const siteAdapter = SiteAdapterFactory.getInstance();
  
  // Handle authentication if required by the adapter
  if (siteAdapter.requiresAuth() && authContext) {
    const { user } = authContext;
    
    if (!customerHasAccount(user)) {
      return createCustomerAuthError('You must have an account to access sites', 403);
    }
  }

  const site = await siteAdapter.getSiteById(siteId);
  if (!site) {
    return NextResponse.json({ error: 'Site not found' }, { status: 404 });
  }

  // Check ownership for production sites
  if (siteAdapter.requiresAuth() && authContext && site.account_id !== authContext.user.accountId) {
    return createCustomerAuthError('You can only access your own sites', 403);
  }

  return NextResponse.json(site);
}

// GET /api/sites/[id] - Get specific site (authenticated)
export const GET = withCustomerAuth(async (request: NextRequest, authContext: CustomerAuthContext, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> => {
  try {
    const { id: siteId } = await params;
    const { user } = authContext;

    if (!siteId) {
      return NextResponse.json({ error: 'Site ID is required' }, { status: 400 });
    }

    // Use the centralized handler with auth context
    return await handleGetSite(request, siteId, authContext);

  } catch (error) {
    console.error('Error fetching site:', error);
    return NextResponse.json(
      { error: 'Failed to fetch site' },
      { status: 500 }
    );
  }
});

// DELETE /api/sites/[id] - Delete specific site
export const DELETE = withCustomerAuth(async (request: NextRequest, authContext: CustomerAuthContext, { params }: { params: Promise<{ id: string }> }) => {
  try {
    const { id: siteId } = await params;
    const { user } = authContext;

    // Customer must have an account to delete sites
    if (!customerHasAccount(user)) {
      return createCustomerAuthError('You must have an account to delete sites', 403);
    }

    if (!siteId) {
      return NextResponse.json({ error: 'Site ID is required' }, { status: 400 });
    }

    // Get site adapter and check site exists and ownership
    const siteAdapter = SiteAdapterFactory.getInstance();
    const existingSite = await siteAdapter.getSiteById(siteId);
    
    if (!existingSite) {
      return NextResponse.json({ error: 'Site not found' }, { status: 404 });
    }

    // Customer can only delete sites from their own account
    if (siteAdapter.requiresAuth() && existingSite.account_id !== user.accountId) {
      return createCustomerAuthError('You can only delete your own sites', 403);
    }

    // Destroy site using adapter (handles both infrastructure cleanup and database deletion)
    const destroyed = await siteAdapter.destroySite(siteId);
    
    if (!destroyed) {
      return NextResponse.json({ error: 'Failed to delete site' }, { status: 500 });
    }

    logger.info('sites.delete.success', {
      message: 'Site deleted by authenticated customer',
      siteId,
      accountId: user.accountId
    });

    return NextResponse.json({ 
      success: true, 
      message: 'Site deleted successfully' 
    });

  } catch (error) {
    console.error('Error deleting site:', error);
    return NextResponse.json(
      { error: 'Failed to delete site' },
      { status: 500 }
    );
  }
});

// PATCH /api/sites/[id] - Update specific site
export const PATCH = withCustomerAuth(async (request: NextRequest, authContext: CustomerAuthContext, { params }: { params: Promise<{ id: string }> }) => {
  try {
    const { id: siteId } = await params;
    const updateData = await request.json();
    const { user } = authContext;

    // Customer must have an account to update sites
    if (!customerHasAccount(user)) {
      return createCustomerAuthError('You must have an account to update sites', 403);
    }

    if (!siteId) {
      return NextResponse.json({ error: 'Site ID is required' }, { status: 400 });
    }

    // Get site adapter and check site exists and ownership
    const siteAdapter = SiteAdapterFactory.getInstance();
    const existingSite = await siteAdapter.getSiteById(siteId);
    
    if (!existingSite) {
      return NextResponse.json({ error: 'Site not found' }, { status: 404 });
    }

    // Customer can only update sites from their own account
    if (siteAdapter.requiresAuth() && existingSite.account_id !== user.accountId) {
      return createCustomerAuthError('You can only update your own sites', 403);
    }

    const updatedSite = await siteAdapter.updateSite(siteId, updateData);
    if (!updatedSite) {
      return NextResponse.json({ error: 'Site not found' }, { status: 404 });
    }

    logger.info('sites.update.success', {
      message: 'Site updated by authenticated customer',
      siteId,
      accountId: user.accountId
    });

    return NextResponse.json(updatedSite);
  } catch (error) {
    console.error('Error updating site:', error);
    return NextResponse.json(
      { error: 'Failed to update site' },
      { status: 500 }
    );
  }
});
