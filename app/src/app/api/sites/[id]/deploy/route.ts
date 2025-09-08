import { NextRequest, NextResponse } from 'next/server';
import { SiteAdapterFactory } from '@/lib/site-adapters/SiteAdapterFactory';
import type { SiteInfo } from '@/lib/site-adapters/interfaces/ISiteAdapter';
import { 
  withCustomerAuth, 
  customerHasAccount,
  createCustomerAuthError,
  type CustomerAuthContext 
} from '@/lib/customer-auth';

// POST /api/sites/[id]/deploy - Trigger deployment for an existing site
export const POST = withCustomerAuth(async (request: NextRequest, authContext: CustomerAuthContext, { params }: { params: Promise<{ id: string }> }) => {
  try {
    const { user } = authContext;
    const { id: siteId } = await params;

    // Customer must have an account to deploy sites
    if (!customerHasAccount(user)) {
      return createCustomerAuthError('You must have an account to deploy sites', 403);
    }

    if (!siteId) {
      return NextResponse.json(
        { error: 'Site ID is required' },
        { status: 400 }
      );
    }

    console.log('🚀 Starting deployment for site:', siteId);

    // Get site adapter and check site exists and ownership
    const siteAdapter = SiteAdapterFactory.getInstance();
    const site = await siteAdapter.getSiteById(siteId);
    
    if (!site) {
      return NextResponse.json({ error: 'Site not found' }, { status: 404 });
    }

    // Customer can only deploy sites from their own account
    if (siteAdapter.requiresAuth() && site.account_id !== user.accountId) {
      return createCustomerAuthError('You can only deploy your own sites', 403);
    }

    // Check if already deployed or deployment is in progress
    if (site.status === 'running') {
      console.log('✅ Site is already running, skipping deployment');
      return NextResponse.json({
        success: true,
        message: 'Site is already deployed and running',
        site
      });
    }
    
    if (site.status === 'creating') {
      console.log('⏳ Site deployment already in progress, skipping duplicate');
      return NextResponse.json({
        success: true,
        message: 'Site deployment is already in progress',
        site
      });
    }

    // Allow deployment for 'stopped', 'failed' statuses  
    if (!['stopped', 'failed'].includes(site.status)) {
      console.log(`❌ Site status '${site.status}' does not allow deployment`);
      return NextResponse.json({
        success: false,
        message: `Site status '${site.status}' does not allow deployment`
      }, { status: 400 });
    }

    // Update site status to indicate deployment is starting
    await siteAdapter.updateSite(siteId, { status: 'creating' });

    // Start deployment asynchronously in the background
    // We don't await this so the API responds immediately
    console.log('🚀 Starting background deployment task for site:', siteId);
    deployInBackground(siteId, site.account_id || user.accountId!, user.accountId!);

    return NextResponse.json({
      success: true,
      message: 'Deployment started',
      site: {
        ...site,
        status: 'creating'
      }
    });

  } catch (error) {
    console.error('❌ Failed to start deployment:', error);
    return NextResponse.json(
      {
        error: 'Failed to start deployment',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
});

// Background deployment function
async function deployInBackground(siteId: string, siteAccountId: string, userAccountId: string) {
  try {
    console.log('📦 Starting background deployment for site:', siteId);
    
    const siteAdapter = SiteAdapterFactory.getInstance();
    
    // Get the site to get the initial prompt
    const site = await siteAdapter.getSiteById(siteId);
    if (!site) {
      throw new Error('Site not found during background deployment');
    }

    // For dev mode, we need to use the deployment adapter directly
    // since we're bypassing the normal createSite flow
    const { getDeploymentAdapter } = await import('@/lib/deployment');
    const deploymentAdapter = getDeploymentAdapter();
    
    // Get the initial prompt - it should be in the site record
    // We'll need to get it from the database since the site was created with createSiteSimple
    const { PrismaSiteService } = await import('@/lib/database/prisma-site-service');
    const siteService = new PrismaSiteService();
    const siteData = await siteService.getSiteById(siteId);
    
    if (!siteData?.initial_prompt) {
      throw new Error('No initial prompt found for site');
    }

    console.log('📦 Calling deploymentAdapter.deploy with:', {
      siteId,
      accountId: siteAccountId,
      prompt: siteData.initial_prompt ? 'Present' : 'Missing',
      title: siteData.title
    });

    const deploymentResult = await deploymentAdapter.deploy({
      siteId,
      accountId: siteAccountId,
      prompt: siteData.initial_prompt,
      title: siteData.title
    });

    console.log('📦 Deployment result:', deploymentResult);

    if (deploymentResult.success) {
      // Map deployment status to valid SiteInfo status
      let siteStatus: SiteInfo['status'];
      switch (deploymentResult.status) {
        case 'running':
          siteStatus = 'running';
          break;
        case 'stopped':
          siteStatus = 'stopped';
          break;
        case 'failed':
          siteStatus = 'failed';
          break;
        case 'pending':
        case 'queued':
          siteStatus = 'creating';
          break;
        default:
          siteStatus = 'created';
      }

      // Update site with deployment results
      const updateData = {
        status: siteStatus,
        agent_url: deploymentResult.urls?.agent,
        backend_url: deploymentResult.urls?.backend,
        preview_url: deploymentResult.urls?.preview
      };
      
      console.log('📦 Updating site with deployment results:', updateData);
      await siteAdapter.updateSite(siteId, updateData);

      console.log('✅ Background deployment completed successfully:', {
        siteId,
        status: deploymentResult.status,
        urls: deploymentResult.urls
      });
    } else {
      // Deployment failed - update site status
      await siteAdapter.updateSite(siteId, {
        status: 'failed'
      });

      console.error('❌ Background deployment failed:', deploymentResult.error);
    }
  } catch (error) {
    console.error('❌ Background deployment error:', error);
    console.error('❌ Error details:', {
      message: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      siteId,
      siteAccountId,
      userAccountId
    });
    
    // Update site status to failed on error
    try {
      const siteAdapter = SiteAdapterFactory.getInstance();
      await siteAdapter.updateSite(siteId, {
        status: 'failed'
      });
      console.log('✅ Updated site status to failed after deployment error');
    } catch (updateError) {
      console.error('❌ Failed to update site status after deployment error:', updateError);
    }
  }
}