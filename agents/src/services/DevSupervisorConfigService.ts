import { existsSync } from 'fs';
import { Logger } from '../logging/index.js';
import { getErrorMessage } from '../utils/error.js';

export interface DevSupervisorEnvironment {
  /** Whether dev-supervisor is available */
  available: boolean;
  /** Socket path being used */
  socketPath: string;
  /** Environment type */
  environment: 'docker' | 'local' | 'unknown';
  /** Whether running as PID 1 */
  isPid1: boolean;
  /** Version information if available */
  version?: string;
}

export interface DevSupervisorConfig {
  /** Socket path to use */
  socketPath: string;
  /** Whether to enable health monitoring by default */
  enableHealthMonitoring: boolean;
  /** Default health check interval */
  defaultHealthInterval: string;
  /** Default restart policy */
  defaultRestartPolicy: {
    enabled: boolean;
    maxRestarts: number;
    restartWindow: string;
  };
}

/**
 * Configuration service for dev-supervisor integration
 * 
 * Handles environment detection, configuration management, and setup
 * for dev-supervisor integration across different deployment environments.
 */
export class DevSupervisorConfigService {
  private logger: Logger;
  private cachedEnvironment: DevSupervisorEnvironment | undefined;

  constructor() {
    this.logger = Logger.create({ service: 'dev-supervisor-config' });
  }

  /**
   * Detect the current dev-supervisor environment
   */
  async detectEnvironment(): Promise<DevSupervisorEnvironment> {
    if (this.cachedEnvironment) {
      return this.cachedEnvironment;
    }

    this.logger.info('dev_supervisor.environment.detect.begin', {});

    const socketPath = this.getSocketPath();
    const available = existsSync(socketPath);
    const environment = this.detectEnvironmentType();
    const isPid1 = process.pid === 1;

    let version: string | undefined;
    if (available) {
      try {
        // Try to get version information from dev-supervisor
        // This would require making an HTTP request to /info endpoint
        version = await this.getDevSupervisorVersion(socketPath);
      } catch (error) {
        this.logger.debug('dev_supervisor.version.failure', {
          error: getErrorMessage(error)
        });
      }
    }

    const env: DevSupervisorEnvironment = {
      available,
      socketPath,
      environment,
      isPid1,
      ...(version !== undefined && { version })
    };

    this.logger.info('dev_supervisor.environment.detected', {
      available: env.available,
      environment: env.environment,
      socketPath: env.socketPath,
      isPid1: env.isPid1,
      version: env.version
    });

    this.cachedEnvironment = env;
    return env;
  }

  /**
   * Get the appropriate socket path for the current environment
   */
  private getSocketPath(): string {
    // Check environment variable first
    if (process.env.DEV_SUPERVISOR_SOCKET_PATH) {
      return process.env.DEV_SUPERVISOR_SOCKET_PATH;
    }

    // Docker container environment
    if (this.isDockerEnvironment()) {
      return '/tmp/supervisor/dev-supervisor.sock';
    }

    // Local development environment
    return '/tmp/dev-supervisor.sock';
  }

  /**
   * Detect the environment type
   */
  private detectEnvironmentType(): 'docker' | 'local' | 'unknown' {
    // Check for Docker environment indicators first
    if (this.isDockerEnvironment()) {
      return 'docker';
    }

    // Check for local development indicators
    if (process.env.NODE_ENV === 'development' || 
        process.env.NODE_ENV === 'production') {
      return 'local';
    }

    return 'unknown';
  }

  /**
   * Check if running in Docker environment
   */
  private isDockerEnvironment(): boolean {
    // Check common Docker environment indicators
    return !!(
      process.env.DOCKER_ENV ||
      process.env.CONTAINER_ID ||
      existsSync('/.dockerenv') ||
      (process.pid === 1 && existsSync('/tmp/supervisor'))
    );
  }

  /**
   * Get dev-supervisor version information
   */
  private async getDevSupervisorVersion(socketPath: string): Promise<string | undefined> {
    try {
      // This would make an HTTP request over Unix socket to /info endpoint
      // For now, return undefined as this requires the full HTTP client
      return undefined;
    } catch (error) {
      this.logger.debug('dev_supervisor.version.request.failure', {
        socketPath,
        error: getErrorMessage(error)
      });
      return undefined;
    }
  }

  /**
   * Get the recommended configuration for the current environment
   */
  async getRecommendedConfig(): Promise<DevSupervisorConfig> {
    const env = await this.detectEnvironment();

    // Docker environment configuration
    if (env.environment === 'docker') {
      return {
        socketPath: env.socketPath,
        enableHealthMonitoring: true,
        defaultHealthInterval: '30s',
        defaultRestartPolicy: {
          enabled: true,
          maxRestarts: 5,
          restartWindow: '5m'
        }
      };
    }

    // Local development configuration
    if (env.environment === 'local') {
      return {
        socketPath: env.socketPath,
        enableHealthMonitoring: process.env.NODE_ENV === 'production',
        defaultHealthInterval: '60s',
        defaultRestartPolicy: {
          enabled: false,
          maxRestarts: 3,
          restartWindow: '10m'
        }
      };
    }

    // Unknown environment - conservative defaults
    return {
      socketPath: env.socketPath,
      enableHealthMonitoring: false,
      defaultHealthInterval: '60s',
      defaultRestartPolicy: {
        enabled: false,
        maxRestarts: 3,
        restartWindow: '10m'
      }
    };
  }

  /**
   * Validate the dev-supervisor configuration
   */
  async validateConfiguration(): Promise<{
    valid: boolean;
    issues: string[];
    recommendations: string[];
  }> {
    const env = await this.detectEnvironment();
    const config = await this.getRecommendedConfig();
    
    const issues: string[] = [];
    const recommendations: string[] = [];

    // Check if dev-supervisor is available when expected
    if (env.environment === 'docker' && !env.available) {
      issues.push('dev-supervisor not available in Docker environment');
      recommendations.push('Ensure dev-supervisor is installed and running in the container');
    }

    // Check socket path permissions
    if (env.available) {
      if (!existsSync(env.socketPath)) {
        issues.push(`Socket file does not exist: ${env.socketPath}`);
      }
    }

    // Check PID 1 configuration in Docker
    if (env.environment === 'docker' && !env.isPid1) {
      recommendations.push('Consider running dev-supervisor as PID 1 for better process management');
    }

    // Check health monitoring configuration
    if (env.available && !config.enableHealthMonitoring && env.environment === 'docker') {
      recommendations.push('Enable health monitoring in Docker environment for better reliability');
    }

    this.logger.info('dev_supervisor.config.validation', {
      valid: issues.length === 0,
      issueCount: issues.length,
      recommendationCount: recommendations.length
    });

    return {
      valid: issues.length === 0,
      issues,
      recommendations
    };
  }

  /**
   * Clear cached environment information (useful for testing)
   */
  clearCache(): void {
    this.cachedEnvironment = undefined;
  }

  /**
   * Check if dev-supervisor integration should be enabled
   */
  async shouldEnableIntegration(): Promise<boolean> {
    const env = await this.detectEnvironment();
    
    // Only enable if available and in a known, supported environment
    return env.available && env.environment !== 'unknown';
  }

  /**
   * Get integration status summary
   */
  async getIntegrationStatus(): Promise<{
    enabled: boolean;
    environment: DevSupervisorEnvironment;
    config: DevSupervisorConfig;
    validation: Awaited<ReturnType<DevSupervisorConfigService['validateConfiguration']>>;
  }> {
    const [environment, config, validation] = await Promise.all([
      this.detectEnvironment(),
      this.getRecommendedConfig(),
      this.validateConfiguration()
    ]);

    const enabled = await this.shouldEnableIntegration();

    return {
      enabled,
      environment,
      config,
      validation
    };
  }
}