import { IControlPlaneAdapter, CreateSiteParams, CreateSiteResult, SiteInfo } from './types';
import { PrismaSiteService } from '@/lib/database/prisma-site-service';
import { getDeploymentAdapter } from '@/lib/deployment';
import { logger } from '@/lib/request-context';

/**
 * Legacy Control Plane Adapter - Uses database + Nomad/SQS
 *
 * Implements control plane interface using existing database and deployment systems.
 * Provides backward compatibility with V1 architecture.
 * 
 * IMPORTANT: Uses dev-job-{appId} pattern - no separate job storage needed!
 * JobId is just the real appId with a prefix, stripped on lookup.
 */
export class LegacyControlPlaneAdapter implements IControlPlaneAdapter {
  private siteService: PrismaSiteService;
  private static readonly JOB_ID_PREFIX = 'dev-job-'; // Match DevSiteAdapter prefix

  constructor() {
    this.siteService = new PrismaSiteService();
  }

  /**
   * Create site using legacy database + deployment system
   * Returns dev-job-{appId} as jobId (no separate job storage needed!)
   */
  async createSite(params: CreateSiteParams): Promise<CreateSiteResult> {
    try {
      logger.info('legacy-control-plane.create-site.start', {
        accountId: params.accountId
      }, {
        tags: ['security']
      });

      // Create site record in database immediately
      const site = await this.siteService.createSite({
        account_id: params.accountId,
        initial_prompt: params.prompt
      });

      // Create "jobId" by prefixing the real appId (no storage needed!)
      const jobId = `${LegacyControlPlaneAdapter.JOB_ID_PREFIX}${site.id}`;

      logger.info('legacy-control-plane.create-site.success', {
        jobId,
        realAppId: site.id,
        accountId: params.accountId
      });

      // Start deployment in background (non-blocking)
      this.deployInBackground(site.id, params.accountId, params.prompt);

      // Return jobId immediately (matches V2 flow)
      const createdAt = new Date();
      return {
        success: true,
        siteId: jobId, // Return jobId (dev-job-{appId})
        status: 'creating',
        created_at: createdAt,
        name: site.title,
        account_id: params.accountId,
        updated_at: createdAt,
        type: 'job' // Marks as job to trigger polling UX
      };
    } catch (error) {
      logger.error('legacy-control-plane.create-site.error', { error });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        status: 'failed'
      };
    }
  }


  /**
   * Get site by ID (handles both jobIds and real appIds)
   */
  async getSite(siteId: string, _jwt: string): Promise<SiteInfo | null> {
    // Check if this is a jobId (matches V2 flow)
    if (this.isJobId(siteId)) {
      return await this.jobIdLookup(siteId);
    }

    // Normal appId lookup
    const site = await this.siteService.getSiteById(siteId);

    if (!site) {
      return null;
    }

    return this.mapToSiteInfo(site);
  }

  /**
   * Check if ID is a jobId
   */
  private isJobId(siteId: string): boolean {
    return siteId.startsWith(LegacyControlPlaneAdapter.JOB_ID_PREFIX);
  }

  /**
   * Job ID lookup - strips dev-job- prefix and looks up real site
   * Simple stateless approach - no job registry needed!
   */
  private async jobIdLookup(jobId: string): Promise<SiteInfo | null> {
    // Extract real appId by stripping prefix
    const realAppId = jobId.replace(LegacyControlPlaneAdapter.JOB_ID_PREFIX, '');

    logger.info('legacy-control-plane.job-id-lookup.extracting', {
      jobId,
      realAppId
    });

    // Look up the actual site
    const site = await this.siteService.getSiteById(realAppId);

    if (!site) {
      logger.info('legacy-control-plane.job-id-lookup.not-found', {
        jobId,
        realAppId
      });
      return null;
    }

    // Return site with real appId (triggers frontend transition)
    return this.mapToSiteInfo(site);
  }

  /**
   * List all sites for account
   */
  async listSites(_jwt: string): Promise<SiteInfo[]> {
    // Note: In legacy mode, we'd need to extract accountId from JWT
    // For now, return all sites (would need JWT parsing implementation)
    // TODO: Parse JWT to extract accountId and use getSitesByAccountId()

    // Get all sites directly from database
    const prismaClient = (this.siteService as any).client;
    const sites = await prismaClient.sites.findMany({
      orderBy: { created_at: 'desc' }
    });

    return sites.map((site: any) => this.mapToSiteInfo(site));
  }

  /**
   * Delete site using legacy deployment cleanup
   */
  async deleteSite(siteId: string, _jwt: string, _systemId?: string, _subscriptionId?: string): Promise<{ success: boolean; error?: string }> {
    try {
      logger.info('legacy-control-plane.delete-site.start', { siteId });

      // Destroy infrastructure
      const deploymentAdapter = getDeploymentAdapter();
      const destroyResult = await deploymentAdapter.destroy(siteId);

      if (!destroyResult.success) {
        logger.warn('legacy-control-plane.destroy.warning', {
          siteId,
          error: destroyResult.error
        });
      }

      // Delete database record
      await this.siteService.deleteSite(siteId);

      logger.info('legacy-control-plane.delete-site.success', { siteId });

      return { success: true };
    } catch (error) {
      logger.error('legacy-control-plane.delete-site.error', { siteId, error });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Deploy site
   *
   * Legacy Mode: Triggers manual deployment via background task.
   * Updates site status to 'creating' and starts async deployment.
   */
  async deploySite(siteId: string, jwt: string): Promise<{ success: boolean; site: SiteInfo; message: string }> {
    try {
      logger.info('legacy-control-plane.deploy-site.start', { siteId });

      // Get site to validate status
  const site = await this.getSite(siteId, jwt);

      if (!site) {
        throw new Error('Site not found');
      }

      // Check if already deployed or in progress
      if (site.status === 'running') {
        return {
          success: true,
          site,
          message: 'Site is already deployed and running'
        };
      }

      if (site.status === 'creating') {
        return {
          success: true,
          site,
          message: 'Site deployment is already in progress'
        };
      }

      // Only allow deployment for 'init', 'stopped', 'failed' statuses
      if (!['init', 'stopped', 'failed'].includes(site.status)) {
        throw new Error(`Site status '${site.status}' does not allow deployment`);
      }

      // Update status to creating
      await this.siteService.updateSite(siteId, { status: 'creating' });

      // Start background deployment (fire and forget)
      this.deployInBackground(siteId, site.account_id, site.initial_prompt || '');

      const updatedSite = {
        ...site,
        status: 'creating' as SiteInfo['status']
      };

      logger.info('legacy-control-plane.deploy-site.triggered', { siteId });

      return {
        success: true,
        site: updatedSite,
        message: 'Deployment started'
      };
    } catch (error) {
      logger.error('legacy-control-plane.deploy-site.error', { siteId, error });
      throw new Error(`Deploy failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Background deployment handler
   * Triggers actual deployment and updates site status when complete
   */
  private async deployInBackground(siteId: string, accountId: string, prompt: string): Promise<void> {
    try {
      logger.info('legacy-control-plane.deploy-background.start', { siteId });

      const deploymentAdapter = getDeploymentAdapter();
      const site = await this.siteService.getSiteById(siteId);

      if (!site) {
        throw new Error('Site not found');
      }

      const deployResult = await deploymentAdapter.deploy({
        siteId,
        accountId,
        prompt: site.initial_prompt || prompt,
        title: site.title
      });

      if (deployResult.success) {
        // Update site with deployment results
        await this.siteService.updateSite(siteId, {
          status: deployResult.status,
          agent_url: deployResult.urls?.agent,
          backend_url: deployResult.urls?.backend,
          preview_url: deployResult.urls?.preview,
          ...(deployResult.infrastructure?.cephMountId && {
            ceph_mount_id: deployResult.infrastructure.cephMountId,
            ceph_dir_number: deployResult.infrastructure.cephDirNumber
          })
        });

        logger.info('legacy-control-plane.deploy-background.success', {
          siteId,
          status: deployResult.status
        });
      } else {
        // Deployment failed
        await this.siteService.updateSite(siteId, { status: 'failed' });
        logger.error('legacy-control-plane.deploy-background.failed', {
          siteId,
          error: deployResult.error
        });
      }
    } catch (error) {
      logger.error('legacy-control-plane.deploy-background.error', { siteId, error });

      // Update status to failed
      try {
        await this.siteService.updateSite(siteId, { status: 'failed' });
      } catch (updateError) {
        logger.error('legacy-control-plane.deploy-background.update-failed', {
          siteId,
          error: updateError
        });
      }
    }
  }

  /**
   * Update site
   *
   * Legacy Mode: Updates site metadata in database.
   */
  async updateSite(siteId: string, updates: Partial<SiteInfo>, _jwt: string): Promise<SiteInfo | null> {
    try {
      logger.info('legacy-control-plane.update-site.start', { siteId });

      // Update site in database
      const updatedSite = await this.siteService.updateSite(siteId, updates);

      if (!updatedSite) {
        return null;
      }

      logger.info('legacy-control-plane.update-site.success', { siteId });

      return this.mapToSiteInfo(updatedSite);
    } catch (error) {
      logger.error('legacy-control-plane.update-site.error', { siteId, error });
      throw new Error(`Update failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Map database site record to SiteInfo
   */
  private mapToSiteInfo(site: any): SiteInfo {
    return {
      id: site.id,
      name: site.title,
      status: site.status,
      account_id: site.account_id,
      initial_prompt: site.initial_prompt,
      agent_url: site.agent_url,
      backend_url: site.backend_url,
      preview_url: site.preview_url,
      ceph_mount_id: site.ceph_mount_id,
      ceph_dir_number: site.ceph_dir_number,
      created_at: site.created_at,
      updated_at: site.updated_at
    };
  }
}
