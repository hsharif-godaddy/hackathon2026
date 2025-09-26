import { DevSupervisorClient, createDevSupervisorClient, isDevSupervisorAvailable } from '../services/DevSupervisorClient.js';
import { AppRepository } from '../database/index.js';
import { Logger } from '../logging/index.js';
import os from 'os';

/**
 * Determine if TCP mode should be used for dev-supervisor
 */
function shouldUseTcpMode(): boolean {
  // Check environment variable first
  if (process.env.DEV_SUPERVISOR_USE_TCP === 'true') {
    return true;
  }
  
  // Auto-enable TCP mode on macOS for better compatibility
  if (os.platform() === 'darwin') {
    return true;
  }
  
  return false;
}

/**
 * Get TCP port for dev-supervisor
 */
function getTcpPort(): string {
  return process.env.DEV_SUPERVISOR_TCP_PORT || '8877';
}

/**
 * Generate TCP connection URL for an app
 */
function generateTcpConnectionUrl(appId: string): string {
  // Extract numeric suffix for port offset (similar to Docker container manager)
  const sanitizedId = appId.toLowerCase().replace(/[^a-z0-9.-]/g, "").substring(0, 63);
  const basePort = parseInt(getTcpPort());
  const portOffset = parseInt(sanitizedId.slice(-3)) || 0;
  const supervisorPort = basePort + portOffset;
  
  return `tcp://localhost:${supervisorPort}`;
}

/**
 * Factory for creating DevSupervisorClient instances consistently across tools
 * Handles socket path resolution, availability checking, and error handling
 */
export class DevSupervisorClientFactory {
  private static logger = Logger.create({ service: 'dev-supervisor-client-factory' });
  private static appRepositoryInstance: AppRepository | null = null;

  /**
   * Get AppRepository instance (lazy loaded to avoid circular dependency)
   */
  private static getAppRepository(): AppRepository {
    if (!this.appRepositoryInstance) {
      this.appRepositoryInstance = new AppRepository();
    }
    return this.appRepositoryInstance;
  }

  /**
   * Create a DevSupervisorClient for a specific app
   * @param appId - The app ID to create a client for
   * @returns DevSupervisorClient instance or null if not available
   * @throws Error if app not found
   */
  static createForApp(appId: string): DevSupervisorClient | null {
    this.logger.debug('dev_supervisor.client.create.begin', {
      appId,
      source: 'app_lookup'
    });

    const app = this.getAppRepository().findById(appId);
    if (!app) {
      this.logger.error('dev_supervisor.client.create.app_not_found', {
        appId,
        error: `App with ID ${appId} not found`
      });
      throw new Error(`App with ID ${appId} not found`);
    }

    // Try TCP mode first if configured
    if (shouldUseTcpMode()) {
      const tcpUrl = generateTcpConnectionUrl(appId);
      this.logger.debug('dev_supervisor.client.create.tcp_attempt', {
        appId,
        tcpUrl
      });
      
      const tcpClient = this.createForSocketPath(tcpUrl, appId);
      if (tcpClient) {
        return tcpClient;
      }
      
      this.logger.debug('dev_supervisor.client.create.tcp_fallback', {
        appId,
        message: 'TCP connection failed, trying Unix socket'
      });
    }

    // Fall back to Unix socket mode
    if (!app.socketPath) {
      this.logger.info('dev_supervisor.client.create.no_socket', {
        appId,
        socketPath: app.socketPath
      });
      return null;
    }

    return this.createForSocketPath(app.socketPath, appId);
  }

  /**
   * Create a DevSupervisorClient for a specific socket path
   * @param socketPath - The socket path to connect to
   * @param appId - Optional app ID for logging context
   * @returns DevSupervisorClient instance or null if not available
   */
  static createForSocketPath(socketPath: string, appId?: string): DevSupervisorClient | null {
    this.logger.debug('dev_supervisor.client.create.begin', {
      socketPath,
      appId,
      source: 'socket_path'
    });

    try {
      const client = createDevSupervisorClient(socketPath);
      
      if (client) {
        this.logger.debug('dev_supervisor.client.create.success', {
          socketPath,
          appId,
          available: true
        });
      } else {
        this.logger.info('dev_supervisor.client.create.unavailable', {
          socketPath,
          appId,
          available: false,
          socketExists: isDevSupervisorAvailable(socketPath)
        });
      }

      return client;
    } catch (error) {
      this.logger.error('dev_supervisor.client.create.failure', {
        socketPath,
        appId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return null;
    }
  }

  /**
   * Check if dev-supervisor is available for an app
   * @param appId - The app ID to check
   * @returns true if available, false otherwise
   */
  static isAvailableForApp(appId: string): boolean {
    try {
      // Try TCP mode first if configured
      if (shouldUseTcpMode()) {
        const tcpUrl = generateTcpConnectionUrl(appId);
        if (isDevSupervisorAvailable(tcpUrl)) {
          return true;
        }
      }

      // Fall back to Unix socket mode
      const app = this.getAppRepository().findById(appId);
      if (!app || !app.socketPath) {
        return false;
      }
      return isDevSupervisorAvailable(app.socketPath);
    } catch (error) {
      this.logger.error('dev_supervisor.client.availability_check.failure', {
        appId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return false;
    }
  }

  /**
   * Check if dev-supervisor is available for a socket path
   * @param socketPath - The socket path to check
   * @returns true if available, false otherwise
   */
  static isAvailableForSocketPath(socketPath: string): boolean {
    try {
      return isDevSupervisorAvailable(socketPath);
    } catch (error) {
      this.logger.error('dev_supervisor.client.availability_check.failure', {
        socketPath,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return false;
    }
  }

  /**
   * Get app information needed for dev-supervisor operations
   * @param appId - The app ID
   * @returns App info or null if not found
   */
  static getAppInfo(appId: string): { socketPath: string; port: number; path: string } | null {
    try {
      const app = this.getAppRepository().findById(appId);
      if (!app) {
        return null;
      }
      
      let connectionPath = app.socketPath || '';
      
      // If TCP mode is configured and available, use TCP connection
      if (shouldUseTcpMode()) {
        const tcpUrl = generateTcpConnectionUrl(appId);
        if (isDevSupervisorAvailable(tcpUrl)) {
          connectionPath = tcpUrl;
        }
      }
      
      return {
        socketPath: connectionPath,
        port: app.port || 0,
        path: app.path || ''
      };
    } catch (error) {
      this.logger.error('dev_supervisor.client.app_info.failure', {
        appId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return null;
    }
  }
}

/**
 * Convenience function to create a DevSupervisorClient for an app
 * @param appId - The app ID
 * @returns DevSupervisorClient instance or null if not available
 */
export function createDevSupervisorClientForApp(appId: string): DevSupervisorClient | null {
  return DevSupervisorClientFactory.createForApp(appId);
}

/**
 * Convenience function to create a DevSupervisorClient for a socket path
 * @param socketPath - The socket path
 * @param appId - Optional app ID for logging context
 * @returns DevSupervisorClient instance or null if not available
 */
export function createDevSupervisorClientForSocketPath(socketPath: string, appId?: string): DevSupervisorClient | null {
  return DevSupervisorClientFactory.createForSocketPath(socketPath, appId);
}
