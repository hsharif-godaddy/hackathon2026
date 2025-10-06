/**
 * Base deployment adapter with common functionality
 */

import { DeploymentAdapter, DeploymentConfig, DeploymentResult, DeploymentEnvironment } from './types';
import { logger } from '../request-context';

export abstract class BaseDeploymentAdapter implements DeploymentAdapter {
  protected environment: DeploymentEnvironment;

  constructor(environment: DeploymentEnvironment) {
    this.environment = environment;
  }

  abstract deploy(config: DeploymentConfig): Promise<DeploymentResult>;
  abstract getStatus(siteId: string): Promise<{ status: 'init' | 'creating' | 'created' | 'running' | 'failed' | 'stopped' | 'error'; message?: string; }>;
  abstract destroy(siteId: string): Promise<{ success: boolean; error?: string; }>;
  abstract getMetadata(siteId: string): Promise<{ cephMountId?: string; cephDirNumber?: string; [key: string]: any; }>;

  /**
   * Generate URLs based on environment
   */
  protected generateUrls(siteId: string): {
    agent?: string;
    preview?: string;
  } {
    switch (this.environment.mode) {
      case 'local':
        return {
          agent: `http://localhost:4000/api/apps/${siteId}`,
          preview: `http://localhost:3000`  // Will be assigned dynamically
        };

      case 'docker':
        return {
          agent: `http://localhost:4000/api/apps/${siteId}`,
          preview: `http://localhost:3000`  // Will be assigned dynamically
        };

      case 'production':
        const domain = this.environment.domain || 'c4.dev-airoapp.ai';
        return {
          agent: `https://${siteId}.agent.${domain}`,
          preview: `https://${siteId}.preview.${domain}`
        };

      default:
        throw new Error(`Unknown deployment mode: ${this.environment.mode}`);
    }
  }

  /**
   * Log deployment operations with context
   */
  protected log(level: 'info' | 'warn' | 'error', message: string, data?: any) {
    const eventName = `deployment_${level}`;
    const formattedMessage = `[${this.environment.mode.toUpperCase()}] ${message}`;
    
    switch (level) {
      case 'info':
        logger.info(eventName, formattedMessage, { data });
        break;
      case 'warn':
        logger.warn(eventName, formattedMessage, { data });
        break;
      case 'error':
        logger.error(eventName, formattedMessage, { data });
        break;
    }
  }
}
