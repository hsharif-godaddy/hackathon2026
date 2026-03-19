import { PrismaSiteService } from '@/lib/database/prisma-site-service';
import { deploymentAdapter } from '@/lib/deployment';
import type { CreateSiteRequest, ISiteAdapter, ServerInfo, SiteInfo, SiteLimitCheck } from './interfaces/ISiteAdapter';
import { logger } from '../request-context';

/**
 * Production Site Adapter
 *
 * Manages sites using production services (Nomad, SQS, database)
 * Wraps the existing SiteService to match the adapter interface
 */
export class ProdSiteAdapter implements ISiteAdapter {
  private siteService: PrismaSiteService;

  constructor() {
    this.siteService = new PrismaSiteService();
  }

  async createSite(request: CreateSiteRequest): Promise<SiteInfo> {
    if (!request.accountId) {
      throw new Error('Account ID is required for production sites');
    }

    const prompt = request.initialPrompt || request.prompt;
    if (!prompt) {
      throw new Error('Initial prompt is required');
    }

    logger.info('🚀 Creating new production site:', {
      accountId: request.accountId,
      prompt: prompt.substring(0, 50) + '...'
    });

    // Create site record with Ceph storage assignment
    const site = await this.siteService.createSite({
      account_id: request.accountId,
      initial_prompt: prompt
    });

    try {
      // Deploy using deployment adapter
      const deploymentResult = await deploymentAdapter.deploy({
        siteId: site.id,
        accountId: request.accountId,
        prompt,
        title: site.title
      });

      if (deploymentResult.success) {
        // Update site with deployment results
        const updatedSite = await this.siteService.updateSite(site.id, {
          status: deploymentResult.status,
          agent_url: deploymentResult.urls?.agent,
          backend_url: deploymentResult.urls?.backend,
          preview_url: deploymentResult.urls?.preview,
          // Only set Ceph info if provided (production mode)
          ...(deploymentResult.infrastructure?.cephMountId && {
            ceph_mount_id: deploymentResult.infrastructure.cephMountId,
            ceph_dir_number: deploymentResult.infrastructure.cephDirNumber
          })
        });

        logger.info('✅ Production site created and deployed successfully:', {
          siteId: site.id,
          status: deploymentResult.status,
          urls: deploymentResult.urls
        });

        return this.mapToSiteInfo(updatedSite);
      } else {
        // Deployment failed - update site status
        await this.siteService.updateSite(site.id, {
          status: 'failed'
        });

        logger.error('❌ Production deployment failed:', deploymentResult.error);
        throw new Error(`Deployment failed: ${deploymentResult.error}`);
      }
    } catch (deployError) {
      // Update site status to failed
      await this.siteService.updateSite(site.id, {
        status: 'failed'
      });

      logger.error('❌ Production site deployment error:', deployError);
      throw new Error(`Deployment failed: ${deployError instanceof Error ? deployError.message : 'Unknown error'}`);
    }
  }

  async getSiteById(siteId: string): Promise<SiteInfo | null> {
    const site = await this.siteService.getSiteById(siteId);

    if (!site) {
      return null;
    }

    return this.mapToSiteInfo(site);
  }

  async updateSite(siteId: string, updates: Partial<SiteInfo>): Promise<SiteInfo | null> {
    // Map SiteInfo updates to the format expected by SiteService
    const updateData: any = {};

    if (updates.name) {updateData.title = updates.name;}
    if (updates.status) {updateData.status = updates.status;}
    if (updates.agent_url) {updateData.agent_url = updates.agent_url;}
    if (updates.backend_url !== undefined) {updateData.backend_url = updates.backend_url;}
    if (updates.preview_url !== undefined) {updateData.preview_url = updates.preview_url;}

    const updatedSite = await this.siteService.updateSite(siteId, updateData);

    if (!updatedSite) {
      return null;
    }

    return this.mapToSiteInfo(updatedSite);
  }

  async getSitesByAccountId(accountId: string): Promise<SiteInfo[]> {
    const sites = await this.siteService.getSitesByAccountId(accountId);
    return sites.map(site => this.mapToSiteInfo(site));
  }

  async deleteSite(siteId: string): Promise<boolean> {
    return await this.siteService.deleteSite(siteId);
  }

  async destroySite(siteId: string): Promise<boolean> {
    logger.info('🛑 Destroying production site:', { siteId });

    try {
      // Use deployment adapter to handle infrastructure cleanup
      const destroyResult = await deploymentAdapter.destroy(siteId);

      if (!destroyResult.success) {
        logger.warn('⚠️ Failed to destroy production deployment, proceeding with site deletion:', destroyResult.error);
      } else {
        logger.info('✅ Production site deployment destroyed successfully');
      }

      // Delete site record
      const deleted = await this.siteService.deleteSite(siteId);

      if (!deleted) {
        logger.error('❌ Failed to delete production site record');
        return false;
      }

      logger.info('✅ Production site completely destroyed:', { siteId });
      return true;
    } catch (error) {
      logger.error('❌ Error destroying production site:', error);
      return false;
    }
  }

  async getRunningServers(): Promise<ServerInfo[]> {
    // For production, we'd need to query Nomad or the actual infrastructure
    // For now, return empty array as this would need to be implemented based on actual prod architecture
    // TODO: Implement production server discovery (Nomad API, etc.)
    return [];
  }

  async checkSiteLimit(accountId: string): Promise<SiteLimitCheck> {
    return await this.siteService.checkSiteLimit(accountId);
  }

  requiresAuth(): boolean {
    return true; // Production requires authentication
  }

  getCapabilities() {
    return {
      supportsCustomDomains: true,
      supportsScaling: true,
      supportsLogs: true
    };
  }

  private mapToSiteInfo(site: any): SiteInfo {
    return {
      id: site.id,
      name: site.title, // Map database 'title' field to API 'name' field
      status: site.status,
      agent_url: site.agent_url,
      backend_url: site.backend_url,
      preview_url: site.preview_url,
      account_id: site.account_id,
      initial_prompt: site.initial_prompt,
      created_at: site.created_at,
      updated_at: site.updated_at
    };
  }
}
