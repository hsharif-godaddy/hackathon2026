import { Logger } from '../logging/index.js';
import { DevSupervisorClient, createDevSupervisorClient, HealthCheckConfig, RestartPolicy } from './DevSupervisorClient.js';
import { getErrorMessage } from '../utils/error.js';

export interface HealthMonitoringConfig {
  /** Application ID */
  appId: string;
  /** Health check configuration */
  healthCheck: HealthCheckConfig;
  /** Restart policy configuration */
  restartPolicy?: RestartPolicy;
}

export interface HealthMonitoringStatus {
  /** Whether health monitoring is active */
  active: boolean;
  /** Current health status */
  status: 'healthy' | 'unhealthy' | 'starting' | 'disabled';
  /** Status message */
  message: string;
  /** Last check time */
  lastCheck?: string;
  /** Check duration in milliseconds */
  duration?: number;
  /** Consecutive failures */
  consecutiveFailures?: number;
  /** Restart statistics */
  restartStats?: {
    totalRestarts: number;
    recentRestarts: number;
    maxRestarts: number;
  };
}

/**
 * Health Monitoring Service
 * 
 * Provides health monitoring capabilities for applications using dev-supervisor.
 * Can configure health checks, restart policies, and monitor application health.
 */
export class HealthMonitoringService {
  private logger: Logger;
  private devSupervisor?: DevSupervisorClient | null;

  constructor(socketPath: string) {
    this.logger = Logger.create({ service: 'health-monitoring' });
    this.devSupervisor = createDevSupervisorClient(socketPath);
  }

  /**
   * Check if health monitoring is available
   */
  isAvailable(): boolean {
    return this.devSupervisor?.isAvailable() ?? false;
  }

  /**
   * Configure health monitoring for an application
   */
  async configureHealthMonitoring(config: HealthMonitoringConfig): Promise<boolean> {
    if (!this.devSupervisor) {
      this.logger.warn('health.configure.unavailable', {
        appId: config.appId
      });
      return false;
    }

    this.logger.info('health.configure.begin', {
      appId: config.appId,
      healthCheckType: config.healthCheck.type,
      restartPolicyEnabled: config.restartPolicy?.enabled
    });

    try {
      await this.devSupervisor.configureHealthCheck(
        config.healthCheck,
        config.restartPolicy
      );

      this.logger.info('health.configure.success', {
        appId: config.appId
      });

      return true;
    } catch (error) {
      this.logger.error('health.configure.failure', {
        appId: config.appId,
        error: getErrorMessage(error)
      });
      return false;
    }
  }

  /**
   * Get health monitoring status for an application
   */
  async getHealthStatus(appId: string): Promise<HealthMonitoringStatus | null> {
    if (!this.devSupervisor) {
      return null;
    }

    try {
      this.logger.debug('health.status.request', { appId });

      const [healthStatus, restartStats] = await Promise.all([
        this.devSupervisor.getHealthStatus(),
        this.devSupervisor.getRestartStats()
      ]);

      const status: HealthMonitoringStatus = {
        active: healthStatus.status !== 'disabled',
        status: healthStatus.status,
        message: healthStatus.message,
        lastCheck: healthStatus.last_check,
        duration: healthStatus.duration,
        consecutiveFailures: healthStatus.consecutive_failures,
        restartStats: {
          totalRestarts: restartStats.total_restarts,
          recentRestarts: restartStats.recent_restarts,
          maxRestarts: restartStats.max_restarts
        }
      };

      this.logger.debug('health.status.retrieved', {
        appId,
        status: status.status,
        consecutiveFailures: status.consecutiveFailures
      });

      return status;
    } catch (error) {
      this.logger.error('health.status.failure', {
        appId,
        error: getErrorMessage(error)
      });
      return null;
    }
  }

  /**
   * Create default health check configuration for HTTP applications
   */
  static createHttpHealthCheck(port: number, path: string = '/health'): HealthCheckConfig {
    return {
      type: 'http',
      url: `http://localhost:${port}${path}`,
      interval: '30s',
      timeout: '10s',
      failure_threshold: 3,
      success_threshold: 2,
      start_period: '60s'
    };
  }

  /**
   * Create default health check configuration for TCP applications
   */
  static createTcpHealthCheck(port: number): HealthCheckConfig {
    return {
      type: 'tcp',
      address: `localhost:${port}`,
      interval: '30s',
      timeout: '5s',
      failure_threshold: 3,
      success_threshold: 2,
      start_period: '30s'
    };
  }

  /**
   * Create default health check configuration for command-based checks
   */
  static createCommandHealthCheck(command: string): HealthCheckConfig {
    return {
      type: 'command',
      command,
      interval: '60s',
      timeout: '30s',
      failure_threshold: 3,
      success_threshold: 1,
      start_period: '30s'
    };
  }

  /**
   * Create default restart policy
   */
  static createDefaultRestartPolicy(): RestartPolicy {
    return {
      enabled: true,
      max_restarts: 5,
      restart_window: '5m',
      backoff_multiplier: 2,
      max_backoff: '1m',
      initial_delay: '5s'
    };
  }

  /**
   * Create production restart policy (more conservative)
   */
  static createProductionRestartPolicy(): RestartPolicy {
    return {
      enabled: true,
      max_restarts: 3,
      restart_window: '10m',
      backoff_multiplier: 2.5,
      max_backoff: '5m',
      initial_delay: '10s'
    };
  }

  /**
   * Configure health monitoring for a web application
   */
  async configureWebAppHealthMonitoring(appId: string, port: number, options?: {
    healthPath?: string;
    restartPolicy?: 'default' | 'production' | RestartPolicy;
  }): Promise<boolean> {
    const healthCheck = HealthMonitoringService.createHttpHealthCheck(
      port,
      options?.healthPath
    );

    let restartPolicy: RestartPolicy;
    if (!options?.restartPolicy || options.restartPolicy === 'default') {
      restartPolicy = HealthMonitoringService.createDefaultRestartPolicy();
    } else if (options.restartPolicy === 'production') {
      restartPolicy = HealthMonitoringService.createProductionRestartPolicy();
    } else {
      restartPolicy = options.restartPolicy;
    }

    return await this.configureHealthMonitoring({
      appId,
      healthCheck,
      restartPolicy
    });
  }

  /**
   * Disable health monitoring for an application
   */
  async disableHealthMonitoring(appId: string): Promise<boolean> {
    if (!this.devSupervisor) {
      return false;
    }

    this.logger.info('health.disable.begin', { appId });

    try {
      // Configure with undefined to disable
      await this.devSupervisor.configureHealthCheck(undefined, undefined);

      this.logger.info('health.disable.success', { appId });
      return true;
    } catch (error) {
      this.logger.error('health.disable.failure', {
        appId,
        error: getErrorMessage(error)
      });
      return false;
    }
  }
}

/**
 * Create a HealthMonitoringService instance if dev-supervisor is available
 * @param socketPath - Required socket path for the dev-supervisor connection
 */
export function createHealthMonitoringService(socketPath: string): HealthMonitoringService | null {
  const service = new HealthMonitoringService(socketPath);
  return service.isAvailable() ? service : null;
}