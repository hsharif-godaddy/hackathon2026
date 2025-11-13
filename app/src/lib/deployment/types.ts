/**
 * Deployment adapter types and interfaces
 * Defines the contract for different deployment strategies (local, docker, production)
 */

export interface DeploymentConfig {
  siteId: string;
  accountId: string;
  prompt: string;
  title?: string;
  subscriptionId?: string;
  customerId?: string;
}

export interface DeploymentResult {
  success: boolean;
  siteId: string;
  urls?: {
    agent?: string;
    backend?: string;
    preview?: string;
  };
  infrastructure?: {
    jobId?: string;
    cephMountId?: string;
    cephDirNumber?: string;
    messageId?: string; // For SQS-based deployments
    agentAppId?: string; // For local development
    [key: string]: any; // Allow additional adapter-specific fields
  };
  error?: string;
  status: 'init' | 'creating' | 'created' | 'running' | 'failed' | 'stopped' | 'error';
}

export interface DeploymentAdapter {
  /**
   * Deploy a new site/application
   */
  deploy(config: DeploymentConfig): Promise<DeploymentResult>;

  /**
   * Check deployment status
   */
  getStatus(siteId: string): Promise<{
    status: 'init' | 'creating' | 'created' | 'running' | 'failed' | 'stopped' | 'error';
    message?: string;
  }>;

  /**
   * Stop/destroy a deployment
   */
  destroy(siteId: string): Promise<{
    success: boolean;
    error?: string;
  }>;

  /**
   * Get adapter-specific metadata for site creation
   */
  getMetadata(siteId: string): Promise<{
    cephMountId?: string;
    cephDirNumber?: string;
    [key: string]: any;
  }>;
}

export type DeploymentMode = 'docker' | 'production';

export interface DeploymentEnvironment {
  mode: DeploymentMode;
  agentsServiceUrl?: string;
  domain?: string;
  [key: string]: any;
}
