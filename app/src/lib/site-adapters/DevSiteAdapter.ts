import { logger } from '../request-context';
import { PrismaSiteService } from '@/lib/database/prisma-site-service';
import { getDeploymentAdapter } from '@/lib/deployment';
import { DevEnvironmentManager } from '@/lib/dev-environment/DevEnvironmentManager';
import type { ISiteAdapter, SiteInfo, CreateSiteRequest, ServerInfo, SiteLimitCheck } from './interfaces/ISiteAdapter';
import { SiteStatus } from '@/generated/prisma';

/**
 * Development Site Adapter
 *
 * Manages sites using local development environment (processes/Docker)
 * Maps dev apps to the site interface for consistent API behavior
 * 
 * IMPORTANT: JobId handling delegated to LegacyControlPlaneAdapter
 */
export class DevSiteAdapter implements ISiteAdapter {
  private siteService: PrismaSiteService;
  private devEnvManager: DevEnvironmentManager | null = null;
  private static readonly JOB_ID_PREFIX = 'dev-job-'; // Match LegacyControlPlaneAdapter prefix

  constructor() {
    // SAFETY CHECK: Prevent usage in production environments
    this.validateDevelopmentEnvironment();
    this.siteService = new PrismaSiteService();
  }

  private async getDevEnvManager(): Promise<DevEnvironmentManager> {
    if (!this.devEnvManager) {
      // Use singleton instance to share state across all adapters
      this.devEnvManager = DevEnvironmentManager.getInstance();
      await this.devEnvManager.initialize();
    }
    return this.devEnvManager;
  }

  private cleanup(): void {
    // No cleanup needed anymore since DevEnvironmentManager uses DatabaseManager singleton
    this.devEnvManager = null;
  }

  async createSite(request: CreateSiteRequest): Promise<SiteInfo> {
    // Default to dev-account if no accountId provided (common in development)
    const accountId = request.accountId || 'dev-account';

    const prompt = request.initialPrompt || request.prompt;
    if (!prompt) {
      throw new Error('Initial prompt is required');
    }

    // Create site record in database immediately
    const site = await this.siteService.createSiteSimple({
      account_id: accountId,
      initial_prompt: prompt
    });

    // Create "jobId" by prefixing the real appId (no storage needed!)
    const jobId = `${DevSiteAdapter.JOB_ID_PREFIX}${site.id}`;

    logger.info('dev-site-adapter.create-site', {
      jobId,
      realAppId: site.id,
      accountId
    });

    // Start deployment in background (non-blocking)
    this.deployInBackground(site.id, accountId, prompt);

    // Return jobId immediately (matches prod V2 flow)
    return {
      id: jobId,
      name: 'Creating...',
      status: 'creating',
      account_id: accountId,
      initial_prompt: prompt,
      created_at: site.created_at.toISOString(),
      updated_at: site.updated_at.toISOString()
    };
  }

  /**
   * Background deployment - fire and forget
   */
  private deployInBackground(siteId: string, accountId: string, prompt: string): void {
    (async () => {
      try {
        logger.info('dev-site-adapter.deploy.start', { siteId });

        const deploymentAdapter = getDeploymentAdapter();
        const site = await this.siteService.getSiteById(siteId);
        
        if (!site) {
          logger.error('dev-site-adapter.deploy.site-not-found', { siteId });
          return;
        }

        const deploymentResult = await deploymentAdapter.deploy({
          siteId,
          accountId,
          prompt,
          title: site.title
        });

        if (deploymentResult.success) {
          const siteStatus = this.mapDeploymentStatusToSiteStatus(deploymentResult.status);
          await this.siteService.updateSite(siteId, {
            status: siteStatus,
            agent_url: deploymentResult.urls?.agent,
            backend_url: deploymentResult.urls?.backend,
            preview_url: deploymentResult.urls?.preview
          });

          logger.info('dev-site-adapter.deploy.success', {
            siteId,
            status: deploymentResult.status,
            urls: deploymentResult.urls
          });
        } else {
          await this.siteService.updateSite(siteId, {
            status: SiteStatus.failed
          });

          logger.error('dev-site-adapter.deploy.failed', {
            siteId,
            error: deploymentResult.error
          });
        }
      } catch (error) {
        logger.error('dev-site-adapter.deploy.error', {
          siteId,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    })().catch(error => {
      logger.error('dev-site-adapter.deploy.uncaught', { siteId, error });
    });
  }

  async getSiteById(siteId: string): Promise<SiteInfo | null> {
    // Check if this is a jobId (matches prod V2 flow)
    if (this.isJobId(siteId)) {
      // Delegate to control plane adapter which manages the job registry
      const { getControlPlaneAdapter } = await import('@/lib/control-plane');
      const controlPlane = getControlPlaneAdapter();
      
      // Control plane getSite handles jobId lookup internally
      const site = await controlPlane.getSite(siteId, '');
      
      if (!site) {
        return null;
      }
      
      // Ensure required fields are present and timestamps are strings
      return {
        ...site,
        name: site.name || 'Untitled',
        created_at: typeof site.created_at === 'string' ? site.created_at : site.created_at.toISOString(),
        updated_at: typeof site.updated_at === 'string' ? site.updated_at : site.updated_at.toISOString()
      };
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
    return siteId.startsWith(DevSiteAdapter.JOB_ID_PREFIX);
  }

  async updateSite(siteId: string, updates: Partial<SiteInfo>): Promise<SiteInfo | null> {
    // Map SiteInfo updates to the format expected by SiteService
    const updateData: any = {};

    if (updates.name) updateData.title = updates.name; // Map API 'name' field to database 'title' field
    if (updates.status) updateData.status = updates.status;
    if (updates.agent_url) updateData.agent_url = updates.agent_url;
    if (updates.backend_url !== undefined) updateData.backend_url = updates.backend_url;
    if (updates.preview_url !== undefined) updateData.preview_url = updates.preview_url;

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
    logger.info('🛑 Destroying development site:', { siteId });

    try {
      // Use deployment adapter to handle infrastructure cleanup
      const deploymentAdapter = getDeploymentAdapter();
      const destroyResult = await deploymentAdapter.destroy(siteId);

      if (!destroyResult.success) {
        logger.warn('⚠️ Failed to destroy development deployment, proceeding with site deletion:', destroyResult.error);
      } else {
        logger.info('✅ Development site deployment destroyed successfully');
      }

      // Delete site record
      const deleted = await this.siteService.deleteSite(siteId);

      if (!deleted) {
        logger.error('❌ Failed to delete development site record');
        return false;
      }

      logger.info('✅ Development site completely destroyed:', { siteId });
      return true;
    } catch (error) {
      logger.error('❌ Error destroying development site:', error);
      return false;
    }
  }

  async getRunningServers(): Promise<ServerInfo[]> {
    try {
      // Get actual running development servers from the dev environment manager
      const devEnvManager = await this.getDevEnvManager();
      const devServers = await devEnvManager.getRunningDevServers();

      // Map dev servers to ServerInfo interface - these are the actual dev server URLs
      return devServers.map(server => ({
        appId: server.appId,
        port: server.port,
        url: server.url, // This should be something like http://localhost:3001
        status: 'running' as const,
        type: 'process' as const,
        lastActivity: server.metadata?.startTime || new Date().toISOString()
      }));
    } finally {
      this.cleanup();
    }
  }

  async checkSiteLimit(accountId: string): Promise<SiteLimitCheck> {
    // In development mode, there are no limits
    const sites = await this.getSitesByAccountId(accountId);
    return {
      canCreate: true,
      currentCount: sites.length,
      limit: -1 // -1 indicates unlimited
    };
  }

  requiresAuth(): boolean {
    return false; // Dev mode doesn't require authentication
  }

  getCapabilities() {
    return {
      supportsCustomDomains: false,
      supportsScaling: false,
      supportsLogs: true
    };
  }

  /**
   * SAFETY CHECK: Validate that this adapter is only used in development environments
   */
  private validateDevelopmentEnvironment(): void {
    const isProduction =
      process.env.NODE_ENV === 'production' ||
      !!process.env.MYSQL_DB_USERNAME ||        // MySQL indicates production
      !!process.env.AWS_REGION_NOMAD ||         // AWS/Nomad indicates production
      !!process.env.PRODUCTION_DOMAIN;         // Production domain set

    if (isProduction) {
      const error = new Error(
        '🚨 SECURITY ERROR: DevSiteAdapter cannot be used in production environments! ' +
        'This adapter is designed for development only and lacks production-grade security, ' +
        'error handling, and data persistence guarantees.'
      );

      // Log the error for monitoring systems
      logger.error('🚨 CRITICAL SECURITY VIOLATION:', {
        error: error.message,
        adapter: 'DevSiteAdapter',
        environment: {
          NODE_ENV: process.env.NODE_ENV,
          hasMySQL: !!process.env.MYSQL_DB_USERNAME,
          hasAWS: !!process.env.AWS_REGION_NOMAD,
          hasProdDomain: !!process.env.PRODUCTION_DOMAIN
        },
        timestamp: new Date().toISOString(),
        stackTrace: error.stack
      });

      throw error;
    }

    logger.info('✅ DevSiteAdapter: Environment validation passed - running in development mode');
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

  private mapDeploymentStatusToSiteStatus(deploymentStatus: string): SiteStatus {
    // Map deployment statuses to SiteStatus enum
    switch (deploymentStatus) {
      case 'running':
        return SiteStatus.running;
      case 'stopped':
        return SiteStatus.stopped;
      case 'failed':
        return SiteStatus.failed;
      case 'creating':
      case 'created':
        return SiteStatus.creating;
      default:
        return SiteStatus.stopped;
    }
  }

  private mapDevStatusToSiteStatus(devStatus: string): SiteInfo['status'] {
    // Map dev environment statuses to site statuses
    switch (devStatus) {
      case 'creating':
        return 'creating';
      case 'created':
        return 'created';
      case 'running':
        return 'running';
      case 'stopped':
        return 'stopped';
      case 'error':
        return 'error';
      default:
        return 'error';
    }
  }
}
