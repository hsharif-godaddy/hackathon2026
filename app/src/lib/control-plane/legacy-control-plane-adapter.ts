import { IControlPlaneAdapter, CreateSiteParams, CreateSiteResult, SiteInfo } from './types';
import { PrismaSiteService } from '@/lib/database/prisma-site-service';
import { getDeploymentAdapter } from '@/lib/deployment';
import { logger } from '@/lib/request-context';

/**
 * Legacy Control Plane Adapter - Uses database + Nomad/SQS
 *
 * Implements control plane interface using existing database and deployment systems.
 * Provides backward compatibility with V1 architecture.
 */
export class LegacyControlPlaneAdapter implements IControlPlaneAdapter {
  private siteService: PrismaSiteService;

  constructor() {
    this.siteService = new PrismaSiteService();
  }

  /**
   * Create site using legacy database + deployment system
   */
  async createSite(params: CreateSiteParams): Promise<CreateSiteResult> {
    try {
      logger.info('legacy-control-plane.create-site.start', { accountId: params.accountId });

      // Create site record in database
      const site = await this.siteService.createSite({
        account_id: params.accountId,
        initial_prompt: params.prompt
      });

      try {
        // Deploy via existing deployment adapter (Nomad/SQS)
        const deploymentAdapter = getDeploymentAdapter();
        const deployResult = await deploymentAdapter.deploy({
          siteId: site.id,
          accountId: params.accountId,
          prompt: params.prompt,
          title: site.title
        });

        if (deployResult.success) {
          // Update site with deployment results
          await this.siteService.updateSite(site.id, {
            status: deployResult.status,
            agent_url: deployResult.urls?.agent,
            backend_url: deployResult.urls?.backend,
            preview_url: deployResult.urls?.preview,
            ...(deployResult.infrastructure?.cephMountId && {
              ceph_mount_id: deployResult.infrastructure.cephMountId,
              ceph_dir_number: deployResult.infrastructure.cephDirNumber
            })
          });

          logger.info('legacy-control-plane.create-site.success', {
            siteId: site.id,
            status: deployResult.status
          });

          return {
            success: true,
            siteId: site.id,
            status: deployResult.status,
            created_at: site.created_at,
            // Include all fields to match interface
            name: site.title,
            account_id: site.account_id,
            updated_at: site.updated_at,
            type: 'site' // Explicitly mark as real site ID
          };
        } else {
          // Deployment failed
          await this.siteService.updateSite(site.id, { status: 'failed' });
          throw new Error(deployResult.error || 'Deployment failed');
        }
      } catch (deployError) {
        // Update site status to failed
        await this.siteService.updateSite(site.id, { status: 'failed' });
        logger.error('legacy-control-plane.deploy.error', { error: deployError });
        throw deployError;
      }
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
   * Get site by database ID
   */
  async getSite(siteId: string): Promise<SiteInfo | null> {
    const site = await this.siteService.getSiteById(siteId);

    if (!site) {
      return null;
    }

    return this.mapToSiteInfo(site);
  }

  /**
   * List all sites for account
   */
  async listSites(): Promise<SiteInfo[]> {
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
  async deleteSite(siteId: string): Promise<{ success: boolean; error?: string }> {
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
  async deploySite(siteId: string): Promise<{ success: boolean; site: SiteInfo; message: string }> {
    try {
      logger.info('legacy-control-plane.deploy-site.start', { siteId });

      // Get site to validate status
      const site = await this.getSite(siteId);

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
          preview_url: deployResult.urls?.preview
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
  async updateSite(siteId: string, updates: Partial<SiteInfo>): Promise<SiteInfo | null> {
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

