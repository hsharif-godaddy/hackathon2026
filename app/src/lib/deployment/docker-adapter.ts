/**
 * Docker deployment adapter for local development
 * Uses Docker containers for app deployment while maintaining local development workflow
 */

import { BaseDeploymentAdapter } from './base-adapter';
import { DeploymentConfig, DeploymentResult } from './types';
import { DevEnvironmentManager } from '../dev-environment/DevEnvironmentManager';
import { agentFetch } from '@/lib/agent-fetch';
import path from 'path';
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

    // Initialize dev environment manager (now uses DatabaseManager)
    this.devEnvironmentManager = new DevEnvironmentManager();

    this.log('info', 'Docker deployment adapter initialized', {
      agentsServiceUrl: this.agentsServiceUrl,
      baseAppsDir: this.baseAppsDir,
      templateDir: this.templateDir
    });
  }

  async deploy(config: DeploymentConfig): Promise<DeploymentResult> {
    const { siteId, accountId, prompt, title } = config;

    try {
      this.log('info', 'Starting Docker deployment', { siteId, accountId });

      // Step 1: Initialize dev environment manager
      await this.devEnvironmentManager.initialize();

      // Step 2: Create app directory and copy template
      const appPath = getAppPath(siteId); // Use centralized utility
      const result = await this.devEnvironmentManager.createDevApp({
        siteId,
        name: title || siteId,
        initialPrompt: prompt,
        templateVersion: 'v8'
      });

      if (!result.success) {
        throw new Error(result.error || 'Failed to create dev app');
      }

      // Step 3: Start the app using Docker (must be started before getting connection path)
      const started = await this.devEnvironmentManager.startDevServer(siteId);

      if (!started) {
        throw new Error('Failed to start Docker container');
      }

      // Step 4: Get dev-supervisor connection path and register with agents service
      const connectionPath = this.devEnvironmentManager.getConnectionPath(siteId);
      await this.registerWithAgents(siteId, title || `App ${siteId}`, prompt, result.appPath || appPath, undefined, connectionPath);

      // Step 5: Get app status to get actual URLs
      const appStatus = await this.devEnvironmentManager.getDevAppStatus(siteId);

      // Generate URLs based on app status and result
      const backendUrl = (appStatus && 'metadata' in appStatus && appStatus.metadata?.url) || `http://localhost:${result.port}`;
      const urls = {
        agent: `${this.agentsServiceUrl}`, // For AI interactions
        backend: backendUrl,
        preview: backendUrl
      };

      this.log('info', 'Docker deployment completed successfully', {
        siteId,
        appPath,
        port: result.port,
        urls,
        appStatus: appStatus.status
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
        status: 'running'
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

      let status: 'init' | 'creating' | 'created' | 'running' | 'failed' | 'stopped' | 'error';
      switch (appStatus.status) {
        case 'running':
          status = 'running';
          break;
        case 'creating':
          status = 'creating';
          break;
        case 'error':
          status = 'error';
          break;
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
        appPath: (appStatus && 'metadata' in appStatus && appStatus.metadata?.appPath) || 'unknown',
        port: (appStatus && 'metadata' in appStatus && appStatus.metadata?.port) || 3000,
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
  private async registerWithAgents(siteId: string, name: string, initialPrompt: string, appPath: string, previewUrl?: string, socketPath?: string | null): Promise<void> {
    try {
      this.log('info', 'Registering app with agents service', { siteId, name, socketPath });

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
          socketPath: socketPath || undefined // Include connection path if available
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
