/**
 * Base deployment adapter with common functionality
 */

import { DeploymentAdapter, DeploymentConfig, DeploymentResult, DeploymentEnvironment } from './types';

export abstract class BaseDeploymentAdapter implements DeploymentAdapter {
  protected environment: DeploymentEnvironment;

  constructor(environment: DeploymentEnvironment) {
    this.environment = environment;
  }

  abstract deploy(config: DeploymentConfig): Promise<DeploymentResult>;
  abstract getStatus(siteId: string): Promise<{ status: 'pending' | 'queued' | 'running' | 'failed' | 'stopped'; message?: string; }>;
  abstract destroy(siteId: string): Promise<{ success: boolean; error?: string; }>;
  abstract getMetadata(siteId: string): Promise<{ cephMountId?: string; cephDirNumber?: string; [key: string]: any; }>;

  /**
   * Generate URLs based on environment
   */
  protected generateUrls(siteId: string): {
    agent?: string;
    backend?: string;
    preview?: string;
  } {
    switch (this.environment.mode) {
      case 'local':
        return {
          agent: `http://localhost:4000/api/apps/${siteId}`,
          backend: `http://localhost:3001`, // Will be assigned dynamically
          preview: `http://localhost:3000`  // Will be assigned dynamically
        };
        
      case 'docker':
        return {
          agent: `http://localhost:4000/api/apps/${siteId}`,
          backend: `http://localhost:3001`, // Will be assigned dynamically  
          preview: `http://localhost:3000`  // Will be assigned dynamically
        };
        
      case 'production':
        const domain = this.environment.domain || 'ab.sxb1.test-secureserver.net';
        return {
          agent: `https://agent-${siteId}.${domain}`,
          backend: `https://backend-${siteId}.${domain}`,
          preview: `https://preview-${siteId}.${domain}`
        };
        
      default:
        throw new Error(`Unknown deployment mode: ${this.environment.mode}`);
    }
  }

  /**
   * Log deployment operations with context
   */
  protected log(level: 'info' | 'warn' | 'error', message: string, data?: any) {
    const prefix = `[${this.environment.mode.toUpperCase()}]`;
    const logData = data ? ` ${JSON.stringify(data)}` : '';
    
    switch (level) {
      case 'info':
        console.log(`✅ ${prefix} ${message}${logData}`);
        break;
      case 'warn':
        console.warn(`⚠️ ${prefix} ${message}${logData}`);
        break;
      case 'error':
        console.error(`❌ ${prefix} ${message}${logData}`);
        break;
    }
  }
}