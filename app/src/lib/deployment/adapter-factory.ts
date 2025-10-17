import { logger } from '../request-context';
/**
 * Deployment adapter factory with environment detection
 * Automatically selects the appropriate deployment strategy based on environment
 */

import { DeploymentAdapter, DeploymentMode } from './types';
import { ProductionDeploymentAdapter } from './production-adapter';
import { LocalDeploymentAdapter } from './local-adapter';
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
    if (modeOverride && ['local', 'docker', 'production'].includes(modeOverride)) {
      logger.info(`🔧 Using explicit deployment mode: ${modeOverride}`);
      return modeOverride;
    }

    // Production detection (multiple indicators)
    const isProduction =
      process.env.NODE_ENV === 'production' ||
      !!process.env.MYSQL_DB_USERNAME ||        // MySQL indicates production
      !!process.env.AWS_REGION_NOMAD ||         // AWS/Nomad indicates production
      !!process.env.PRODUCTION_DOMAIN;         // Production domain set

    if (isProduction) {
      logger.info('🏭 Detected production environment - using Nomad + SQS + Ceph');
      return 'production';
    }

    // Development mode detection
    const isDevelopment = process.env.NODE_ENV === 'development';

    if (isDevelopment) {
      // Use new LOCAL_ENVIRONMENT_MODE system
      const localMode = process.env.LOCAL_ENVIRONMENT_MODE?.toLowerCase() || 'auto';

      switch (localMode) {
        case 'docker':
          logger.info('🐳 Development mode with explicit Docker containers');
          return 'docker';
        case 'process':
          logger.info('🔧 Development mode with explicit local processes');
          return 'local';
        case 'auto':
        default:
          // Auto-detect based on Docker availability
          try {
            require('child_process').execSync('docker info', { stdio: 'ignore', timeout: 5000 }); // eslint-disable-line @typescript-eslint/no-var-requires
            logger.info('🐳 Development mode with Docker containers (auto-detected)');
            return 'docker';
          } catch {
            logger.info('🔧 Development mode with local processes (Docker not available)');
            return 'local';
          }
      }
    }

    // Default fallback
    logger.info('⚠️ Could not detect deployment mode, defaulting to local');
    return 'local';
  }

  /**
   * Create appropriate adapter for deployment mode
   */
  private static createAdapter(mode: DeploymentMode): DeploymentAdapter {
    switch (mode) {
      case 'production':
        return new ProductionDeploymentAdapter();

      case 'local':
        return new LocalDeploymentAdapter();

      case 'docker':
        return new DockerDeploymentAdapter();

      default:
        throw new Error(`Unknown deployment mode: ${mode}`);
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
      hasDatabase: true, // Always true with our database manager
      recommendedForDevelopment: mode === 'local' || mode === 'docker'
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

  logger.info('🔍 Deployment Environment Info:', {
    mode: capabilities.mode,
    nodeEnv: process.env.NODE_ENV,
    localEnvironmentMode: process.env.LOCAL_ENVIRONMENT_MODE || 'auto (default)',
    agentsServiceUrl: process.env.AGENTS_SERVICE_URL || 'http://localhost:4000 (default)',
    hasMySQL: !!process.env.MYSQL_DB_USERNAME,
    hasAWS: !!process.env.AWS_REGION_NOMAD,
    capabilities
  });

  return capabilities;
}
