import { PrismaSiteService } from '@/lib/database/prisma-site-service';
import { getDeploymentAdapter } from '@/lib/deployment';
import { DevEnvironmentManager } from '@/lib/dev-environment/DevEnvironmentManager';
import Database from 'better-sqlite3';
import path from 'path';
import type { ISiteAdapter, SiteInfo, CreateSiteRequest, ServerInfo, SiteLimitCheck } from './interfaces/ISiteAdapter';
import { SiteStatus } from '@/generated/prisma';

/**
 * Development Site Adapter
 * 
 * Manages sites using local development environment (processes/Docker)
 * Maps dev apps to the site interface for consistent API behavior
 */
export class DevSiteAdapter implements ISiteAdapter {
  private siteService: PrismaSiteService;
  private devEnvManager: DevEnvironmentManager | null = null;
  private db: Database.Database | null = null;

  constructor() {
    // SAFETY CHECK: Prevent usage in production environments
    this.validateDevelopmentEnvironment();
    this.siteService = new PrismaSiteService();
  }

  private async getDevEnvManager(): Promise<DevEnvironmentManager> {
    if (!this.devEnvManager) {
      // Use the same database path as the agents service
      const dbPath = path.join(process.cwd(), 'development.db');
      this.db = new Database(dbPath);
      this.devEnvManager = new DevEnvironmentManager(this.db);
      await this.devEnvManager.initialize();
    }
    return this.devEnvManager;
  }

  private cleanup(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.devEnvManager = null;
    }
  }

  async createSite(request: CreateSiteRequest): Promise<SiteInfo> {
    // Default to dev-account if no accountId provided (common in development)
    const accountId = request.accountId || 'dev-account';

    const prompt = request.initialPrompt || request.prompt;
    if (!prompt) {
      throw new Error('Initial prompt is required');
    }

    console.log('🔧 Creating new development site:', { 
      accountId, 
      prompt: prompt.substring(0, 50) + '...'
    });

    // Create simplified site record without Ceph
    const site = await this.siteService.createSiteSimple({
      account_id: accountId,
      initial_prompt: prompt
    });

    try {
      // Deploy using development deployment adapter (local or docker)
      const deploymentAdapter = getDeploymentAdapter();
      const deploymentResult = await deploymentAdapter.deploy({
        siteId: site.id,
        accountId: accountId,
        prompt,
        title: site.title
      });

      if (deploymentResult.success) {
        // Map deployment status to SiteStatus enum
        const siteStatus = this.mapDeploymentStatusToSiteStatus(deploymentResult.status);
        
        // Update site with deployment results
        const updatedSite = await this.siteService.updateSite(site.id, {
          status: siteStatus,
          agent_url: deploymentResult.urls?.agent,
          backend_url: deploymentResult.urls?.backend,
          preview_url: deploymentResult.urls?.preview
        });

        console.log('✅ Development site created and deployed successfully:', {
          siteId: site.id,
          status: deploymentResult.status,
          urls: deploymentResult.urls
        });

        return this.mapToSiteInfo(updatedSite);
      } else {
        // Deployment failed - update site status
        await this.siteService.updateSite(site.id, {
          status: SiteStatus.failed
        });

        console.error('❌ Development deployment failed:', deploymentResult.error);
        throw new Error(`Deployment failed: ${deploymentResult.error}`);
      }
    } catch (deployError) {
      // Update site status to failed
      await this.siteService.updateSite(site.id, {
        status: SiteStatus.failed
      });

      console.error('❌ Development site deployment error:', deployError);
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
    console.log('🛑 Destroying development site:', { siteId });
    
    try {
      // Use deployment adapter to handle infrastructure cleanup
      const deploymentAdapter = getDeploymentAdapter();
      const destroyResult = await deploymentAdapter.destroy(siteId);
      
      if (!destroyResult.success) {
        console.warn('⚠️ Failed to destroy development deployment, proceeding with site deletion:', destroyResult.error);
      } else {
        console.log('✅ Development site deployment destroyed successfully');
      }

      // Delete site record
      const deleted = await this.siteService.deleteSite(siteId);
      
      if (!deleted) {
        console.error('❌ Failed to delete development site record');
        return false;
      }

      console.log('✅ Development site completely destroyed:', { siteId });
      return true;
    } catch (error) {
      console.error('❌ Error destroying development site:', error);
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
      console.error('🚨 CRITICAL SECURITY VIOLATION:', {
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

    console.log('✅ DevSiteAdapter: Environment validation passed - running in development mode');
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
      case 'pending':
      case 'queued':
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