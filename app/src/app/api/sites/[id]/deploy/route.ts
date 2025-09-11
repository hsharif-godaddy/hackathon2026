import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/request-context';
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

    logger.info('deploy.start', { message: 'Starting deployment for site', siteId });

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
      logger.info('deploy.skip.running', { message: 'Site is already running, skipping deployment', siteId });
      return NextResponse.json({
        success: true,
        message: 'Site is already deployed and running',
        site
      });
    }

    if (site.status === 'creating') {
      logger.info('deploy.skip.in-progress', { message: 'Site deployment already in progress, skipping duplicate', siteId });
      return NextResponse.json({
        success: true,
        message: 'Site deployment is already in progress',
        site
      });
    }

    // Allow deployment for 'init', 'stopped', 'failed' statuses
    if (!['init', 'stopped', 'failed'].includes(site.status)) {
      logger.warn('deploy.skip.invalid-status', { message: 'Site status does not allow deployment', siteId, status: site.status });
      return NextResponse.json({
        success: false,
        message: `Site status '${site.status}' does not allow deployment`
      }, { status: 400 });
    }

    // Start deployment asynchronously in the background
    // We don't await this so the API responds immediately
    logger.info('deploy.background.start', { message: 'Starting background deployment task', siteId });
    deployInBackground(siteId, site.account_id || user.accountId!, user.accountId!);

    // Update site status to indicate deployment is starting
    await siteAdapter.updateSite(siteId, { status: 'creating' });

    // Log different messages based on site status
    if (site.status === 'init') {
      logger.info('deploy.background.init', { message: 'Initializing deployment for new site', siteId });
    } else {
      logger.info('deploy.background.redeploy', { message: 'Re-deploying site', siteId });
    }

    return NextResponse.json({
      success: true,
      message: 'Deployment started',
      site: {
        ...site,
        status: 'creating'
      }
    });

  } catch (error) {
    // Extract siteId from params in catch block since it's not in scope
    const siteId = (await params).id;
    logger.error('deploy.start.error', { message: 'Failed to start deployment', siteId: siteId, errorMessage: error instanceof Error ? error.message : 'Unknown error' });
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
    logger.info('deploy.background.start-task', { message: 'Starting background deployment task', siteId });

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

    logger.info('deploy.adapter.call', {
      message: 'Calling deploymentAdapter.deploy',
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

    logger.info('deploy.adapter.result', { 
      message: 'Deployment result', 
      siteId, 
      success: deploymentResult.success,
      status: deploymentResult.status,
      hasUrls: !!deploymentResult.urls,
      error: deploymentResult.error || 'None'
    });

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
        case 'created':
          siteStatus = 'created';
          break;
        case 'failed':
          siteStatus = 'failed';
          break;
        case 'creating':
        case 'created':
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

      logger.info('deploy.update.site', { 
        message: 'Updating site with deployment results', 
        siteId, 
        status: updateData.status,
        hasAgentUrl: !!updateData.agent_url,
        hasBackendUrl: !!updateData.backend_url,
        hasPreviewUrl: !!updateData.preview_url
      });
      await siteAdapter.updateSite(siteId, updateData);

      logger.info('deploy.complete.success', {
        message: 'Background deployment completed successfully',
        siteId,
        status: deploymentResult.status,
        previewUrl: deploymentResult.urls?.preview,
        hasUrls: !!deploymentResult.urls
      });
    } else {
      // Deployment failed - update site status
      await siteAdapter.updateSite(siteId, {
        status: 'failed'
      });

      logger.error('deploy.complete.failed', { message: 'Background deployment failed', siteId, errorMessage: deploymentResult.error });
    }
  } catch (error) {
    logger.error('deploy.background.error', {
      message: 'Background deployment error',
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
      errorType: error instanceof Error ? error.constructor.name : 'Unknown',
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
      logger.info('deploy.error.status-update', { message: 'Updated site status to failed after deployment error', siteId });
    } catch (updateError) {
      logger.error('deploy.error.status-update-failed', { message: 'Failed to update site status after deployment error', siteId, errorMessage: updateError instanceof Error ? updateError.message : 'Unknown error' });
    }
  }
}
