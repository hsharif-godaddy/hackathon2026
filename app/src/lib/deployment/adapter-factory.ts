import { logger } from '../request-context';
/**
 * Deployment adapter factory with environment detection
 * Automatically selects the appropriate deployment strategy based on environment
 */

import { DeploymentAdapter, DeploymentMode } from './types';
import { ProductionDeploymentAdapter } from './production-adapter';
import { DockerDeploymentAdapter } from './docker-adapter';

export class DeploymentAdapterFactory {
  private static instance: DeploymentAdapter | null = null;

  /**
   * Get deployment adapter singleton based on environment
   */
  public static getInstance(): DeploymentAdapter {
    if (!DeploymentAdapterFactory.instance) {
      const mode = DeploymentAdapterFactory.detectDeploymentMode();
      DeploymentAdapterFactory.instance = DeploymentAdapterFactory.createAdapter(mode);
    }
    return DeploymentAdapterFactory.instance;
  }

  /**
   * Force reset singleton (useful for testing)
   */
  public static reset(): void {
    DeploymentAdapterFactory.instance = null;
  }

  /**
   * Detect deployment mode based on environment variables
   */
  private static detectDeploymentMode(): DeploymentMode {
    // Explicit override via environment variable
    const modeOverride = process.env.DEPLOYMENT_MODE as DeploymentMode;
    if (modeOverride && ['docker', 'production'].includes(modeOverride)) {
      logger.info(`deployment.mode.explicit`, { mode: modeOverride });
      return modeOverride;
    }

    // Production detection (multiple indicators)
    const isProduction =
      process.env.NODE_ENV === 'production' ||
      !!process.env.MYSQL_DB_USERNAME ||
      !!process.env.AWS_REGION_NOMAD ||
      !!process.env.PRODUCTION_DOMAIN;

    if (isProduction) {
      logger.info('deployment.mode.production', { message: 'Detected production environment - using Nomad + SQS + Ceph' });
      return 'production';
    }

    // Default to Docker for all development/non-production environments
    logger.info('deployment.mode.docker', { message: 'Using Docker containers for development' });
    return 'docker';
  }

  /**
   * Create appropriate adapter for deployment mode
   */
  private static createAdapter(mode: DeploymentMode): DeploymentAdapter {
    switch (mode) {
      case 'production':
        return new ProductionDeploymentAdapter();
        
      case 'docker':
        return new DockerDeploymentAdapter();

      default:
        throw new Error(`Unknown deployment mode: ${mode}. Only 'docker' and 'production' are supported.`);
    }
  }

  /**
   * Get current deployment mode without creating adapter
   */
  public static getCurrentMode(): DeploymentMode {
    return DeploymentAdapterFactory.detectDeploymentMode();
  }

  /**
   * Check if current environment supports the requested features
   */
  public static getEnvironmentCapabilities(): {
    mode: DeploymentMode;
    hasAgentsService: boolean;
    hasProductionInfrastructure: boolean;
    hasDatabase: boolean;
    recommendedForDevelopment: boolean;
  } {
    const mode = DeploymentAdapterFactory.detectDeploymentMode();

    return {
      mode,
      hasAgentsService: !!process.env.AGENTS_SERVICE_URL || mode !== 'production',
      hasProductionInfrastructure: mode === 'production',
      hasDatabase: true,
      recommendedForDevelopment: mode === 'docker'
    };
  }
}

/**
 * Convenience function to get the deployment adapter
 */
export function getDeploymentAdapter(): DeploymentAdapter {
  return DeploymentAdapterFactory.getInstance();
}

/**
 * Environment configuration helper
 */
export function getDeploymentEnvironmentInfo() {
  const capabilities = DeploymentAdapterFactory.getEnvironmentCapabilities();
  
  logger.info('deployment.environment.info', {
    mode: capabilities.mode,
    nodeEnv: process.env.NODE_ENV,
    agentsServiceUrl: process.env.AGENTS_SERVICE_URL || 'http://localhost:4000 (default)',
    hasMySQL: !!process.env.MYSQL_DB_USERNAME,
    hasAWS: !!process.env.AWS_REGION_NOMAD,
    capabilities
  });

  return capabilities;
}
