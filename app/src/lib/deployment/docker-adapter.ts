/**
 * Docker deployment adapter for local development
 * Uses Docker containers for app deployment while maintaining local development workflow
 */

import path from 'path';

import { agentFetch } from '@/lib/agent-fetch';
import { formatSubscriptionId } from '@/lib/subscription-id';
import { BaseDeploymentAdapter } from './base-adapter';
import { DeploymentConfig, DeploymentResult } from './types';
import { DevEnvironmentManager } from '../dev-environment/DevEnvironmentManager';
import { getAppPath } from '../dev-environment/utils/app-paths';

export class DockerDeploymentAdapter extends BaseDeploymentAdapter {
  private devEnvironmentManager: DevEnvironmentManager;
  private agentsServiceUrl: string;
  private baseAppsDir: string;
  private templateDir: string;

  constructor() {
    super({
      mode: 'docker',
      agentsServiceUrl: process.env.AGENTS_SERVICE_URL || 'http://localhost:4000'
    });

    this.agentsServiceUrl = this.environment.agentsServiceUrl!;
    this.baseAppsDir = process.env.APPS_BASE_DIR || '/tmp/apps';
    this.templateDir = process.env.APP_TEMPLATE_DIR || path.join(process.cwd(), '..', 'app-templates', 'v8');

    // Use singleton instance to share state across all adapters
    this.devEnvironmentManager = DevEnvironmentManager.getInstance();

    this.log('info', 'Docker deployment adapter initialized', {
      agentsServiceUrl: this.agentsServiceUrl,
      baseAppsDir: this.baseAppsDir,
      templateDir: this.templateDir
    });
  }

  async deploy(config: DeploymentConfig): Promise<DeploymentResult> {
    const { siteId, accountId, prompt, title, subscriptionId, customerId } = config;

    try {
      this.log('info', 'Starting Docker deployment', { siteId, accountId });

      // Step 1: Initialize dev environment manager
      await this.devEnvironmentManager.initialize();

      // Step 2: Create app directory and copy template (fast - ~1-2s)
      const appPath = getAppPath(siteId);
      const result = await this.devEnvironmentManager.createDevApp({
        siteId,
        name: title || siteId,
        initialPrompt: prompt,
        templateVersion: 'v8'
      });

      if (!result.success) {
        throw new Error(result.error || 'Failed to create dev app');
      }

      // Step 3: Start async deployment in background (DON'T AWAIT)
      // This includes docker-compose up, health checks, and agent registration
      this.startAsyncDeployment(
        siteId,
        title || siteId,
        prompt,
        result.appPath || appPath,
        result.port!,
        subscriptionId,
        customerId || accountId
      ).catch(error => {
        this.log('error', 'Async deployment failed', { siteId, error });
        // Update site status to 'error' in database
        this.updateSiteStatusToError(siteId, error.message).catch(err => {
          this.log('error', 'Failed to update site status to error', { siteId, err });
        });
      });

      // Step 4: Return immediately with 'creating' status
      const urls = {
        agent: `${this.agentsServiceUrl}`,
        backend: `https://localhost:${result.port}`,
        preview: `https://localhost:${result.port}`
      };

      this.log('info', 'Docker deployment initiated (async)', {
        siteId,
        appPath,
        port: result.port,
        status: 'creating'
      });

      return {
        success: true,
        siteId,
        urls,
        infrastructure: {
          appPath: result.appPath,
          port: result.port,
          mode: 'docker'
        },
        status: 'creating'  // Return immediately with 'creating' status
      };

    } catch (error) {
      this.log('error', 'Docker deployment failed', {
        siteId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      // Cleanup on failure
      await this.cleanup(siteId);

      return {
        success: false,
        siteId,
        error: error instanceof Error ? error.message : 'Docker deployment failed',
        status: 'failed'
      };
    }
  }

  /**
   * Background deployment process
   * Starts docker containers, waits for health checks, and registers with agents service
   */
  private async startAsyncDeployment(
    siteId: string,
    title: string,
    prompt: string,
    appPath: string,
    port: number,
    subscriptionId?: string,
    customerId?: string
  ): Promise<void> {
    try {
      this.log('info', 'Starting async Docker container startup', { siteId });

      // Update status to 'creating'
      await this.updateSiteStatus(siteId, 'creating');

      // Start the app using Docker (this is the slow part - docker-compose up + health checks)
      const started = await this.devEnvironmentManager.startDevServer(siteId);

      if (!started) {
        throw new Error('Failed to start Docker container');
      }

      // Get app status to get actual URLs
      const appStatus = await this.devEnvironmentManager.getDevAppStatus(siteId);
      const backendUrl = appStatus.metadata?.url || `https://localhost:${port}`;

      // Get dev-supervisor connection paths and register with agents service
      const connectionPath = this.devEnvironmentManager.getConnectionPath(siteId);
      const publishSupervisorPath = this.devEnvironmentManager.getPublishSupervisorConnectionPath(siteId);
      await this.registerWithAgents(
        siteId,
        title,
        prompt,
        appPath,
        backendUrl,
        connectionPath,
        subscriptionId,
        customerId,
        publishSupervisorPath
      );

      // Get publish URL from dev app info (if V4 unified job with publish port)
      const devApp = this.devEnvironmentManager.getDevApp(siteId);
      const publishUrl = devApp?.publishPort ? `https://localhost:${devApp.publishPort}` : undefined;

      // Update status to 'running' with URLs
      await this.updateSiteStatus(siteId, 'running', {
        agent_url: this.agentsServiceUrl,
        backend_url: backendUrl,
        preview_url: backendUrl,
        published_url: publishUrl
      });

      this.log('info', 'Async Docker deployment completed successfully', {
        siteId,
        status: 'running',
        urls: {
          agent: this.agentsServiceUrl,
          backend: backendUrl,
          preview: backendUrl,
          published: publishUrl
        }
      });

    } catch (error) {
      this.log('error', 'Async Docker deployment failed', { siteId, error });
      await this.updateSiteStatus(siteId, 'error');
      throw error;
    }
  }

  /**
   * Helper to update site status in database
   */
  private async updateSiteStatus(
    siteId: string,
    status: 'creating' | 'running' | 'error',
    urls?: { agent_url?: string; backend_url?: string; preview_url?: string; published_url?: string }
  ): Promise<void> {
    try {
      // Import dynamically to avoid circular dependencies
      const { PrismaSiteService } = await import('@/lib/database/prisma-site-service');
      const siteService = new PrismaSiteService();

      // Check if site exists before updating
      const existingSite = await siteService.getSiteById(siteId);
      if (!existingSite) {
        this.log('warn', 'Site not found, skipping status update', { siteId, status });
        return;
      }

      const updatedSite = await siteService.updateSite(siteId, {
        status,
        ...urls
      });

      if (!updatedSite) {
        this.log('warn', 'Site update returned null (site may not exist)', { siteId, status });
        return;
      }

      this.log('info', 'Site status updated', { siteId, status });
    } catch (error) {
      // Log error but don't throw - status updates are non-critical
      this.log('error', 'Failed to update site status', { 
        siteId, 
        status, 
        error: error instanceof Error ? error.message : String(error) 
      });
    }
  }

  /**
   * Helper to update site to error status
   */
  private async updateSiteStatusToError(siteId: string, errorMessage: string): Promise<void> {
    this.log('error', 'Updating site to error status', { siteId, errorMessage });
    await this.updateSiteStatus(siteId, 'error');
  }

  async destroy(siteId: string): Promise<DeploymentResult> {
    try {
      this.log('info', 'Destroying Docker deployment', { siteId });

      // Initialize dev environment manager if needed
      await this.devEnvironmentManager.initialize();

      // Stop and remove app
      const stopped = await this.devEnvironmentManager.stopDevServer(siteId);
      const removed = await this.devEnvironmentManager.deleteDevApp(siteId);

      this.log('info', 'Docker deployment destroyed successfully', {
        siteId,
        containerStopped: stopped,
        containerRemoved: removed
      });

      return {
        success: true,
        siteId,
        status: 'stopped'
      };

    } catch (error) {
      this.log('error', 'Docker deployment destruction failed', {
        siteId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      return {
        success: false,
        siteId,
        error: error instanceof Error ? error.message : 'Docker destruction failed',
        status: 'failed'
      };
    }
  }

  /**
   * Cleanup specific deployment
   */
  private async cleanup(siteId: string): Promise<void> {
    try {
      await this.devEnvironmentManager.initialize();

      // Stop and remove app
      await this.devEnvironmentManager.stopDevServer(siteId).catch(() => {}); // Ignore errors
      await this.devEnvironmentManager.deleteDevApp(siteId).catch(() => {}); // Ignore errors

      this.log('info', 'Docker deployment cleanup completed', { siteId });
    } catch (error) {
      this.log('warn', 'Docker deployment cleanup failed', {
        siteId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }


  /**
   * Get deployment status (required by base class)
   */
  async getStatus(siteId: string): Promise<{ status: 'init' | 'creating' | 'created' | 'running' | 'failed' | 'stopped' | 'error'; message?: string; }> {
    try {
      await this.devEnvironmentManager.initialize();
      const appStatus = await this.devEnvironmentManager.getDevAppStatus(siteId);

      // Map ServerStatus to deployment status
      let status: 'init' | 'creating' | 'created' | 'running' | 'failed' | 'stopped' | 'error';
      switch (appStatus.status) {
        case 'running':
          status = 'running';
          break;
        case 'error':
          status = 'error';
          break;
        case 'not_found':
          status = 'failed';
          break;
        case 'exited':
        case 'dead':
        case 'container_missing':
        case 'stopped':
        default:
          status = 'stopped';
      }

      return {
        status,
        message: appStatus.message
      };
    } catch (error) {
      return {
        status: 'failed',
        message: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Get deployment metadata (required by base class)
   */
  async getMetadata(siteId: string): Promise<{ cephMountId?: string; cephDirNumber?: string; [key: string]: any; }> {
    try {
      await this.devEnvironmentManager.initialize();
      const appStatus = await this.devEnvironmentManager.getDevAppStatus(siteId);

      return {
        appPath: appStatus.metadata?.appPath || 'unknown',
        port: appStatus.metadata?.port || 3000,
        mode: 'docker',
        containerMode: true
      };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Check if agents service is available
   */
  private async checkAgentsService(): Promise<boolean> {
    try {
      const response = await fetch(`${this.agentsServiceUrl}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000)
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Register app with agents service for AI assistance
   */
  private async registerWithAgents(siteId: string, name: string, initialPrompt: string, appPath: string, previewUrl?: string, socketPath?: string | null, subscriptionId?: string, customerId?: string, publishSupervisorPath?: string | null): Promise<void> {
    try {
      const prefixedSubscriptionId = formatSubscriptionId(subscriptionId);
      this.log('info', 'Registering app with agents service', {
        siteId,
        name,
        socketPath,
        customerId: customerId || 'not-provided',
        subscriptionId_original: subscriptionId || 'not-provided',
        subscriptionId_prefixed: prefixedSubscriptionId || 'not-provided'
      });

      const response = await agentFetch(`${this.agentsServiceUrl}/apps/register`, {
        siteId,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          siteId,
          name,
          appPath,
          initialPrompt,
          previewUrl,
          socketPath: socketPath || undefined, // Preview supervisor connection path
          publishSupervisorPath: publishSupervisorPath || undefined, // Publish supervisor connection path (V4 unified job)
          subscriptionId: prefixedSubscriptionId,
          customerId
        }),
        signal: AbortSignal.timeout(10000) // 10 second timeout
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to register app with agents service: ${response.status} ${errorText}`);
      }

      const result = await response.json();
      this.log('info', 'App registered with agents service', {
        siteId,
        success: result.success
      });

    } catch (error) {
      this.log('error', 'Failed to register app with agents service', {
        siteId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      // Throw error to fail deployment - agent registration is required for proper functionality
      throw new Error(`Agent registration failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

}
