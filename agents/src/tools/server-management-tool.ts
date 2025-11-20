import { Logger } from '../logging/index.js';
import { toolServerHealthEvents } from '../logging/events/index.js';
import { DevSupervisorClientFactory } from '../utils/dev-supervisor-client-factory.js';

export interface RestartServerOptions {
  /** Optional reason for restart (for logging) */
  reason?: string;
}

export interface RestartServerResult {
  /** Whether the restart succeeded */
  success: boolean;
  /** App ID */
  appId: string;
  /** Result message */
  message: string;
  /** Error message if restart failed */
  error?: string;
}

export interface ServerStatusResult {
  /** Whether the operation succeeded */
  success: boolean;
  /** App ID */
  appId: string;
  /** Current server status */
  status: 'running' | 'stopped' | 'error' | 'not_found';
  /** Additional status message */
  message?: string;
  /** Error message if operation failed */
  error?: string;
}

/**
 * Tool for managing backend server operations via dev supervisor
 * Focuses on restart operations and basic status checks through dev supervisor
 */
export class ServerManagementTool {
  private logger: Logger;

  constructor() {
    this.logger = Logger.create({ service: 'server-management-tool' });
  }

  /**
   * Check basic server status via dev supervisor
   */
  async checkServerStatus(appId: string): Promise<ServerStatusResult> {
    toolServerHealthEvents.check(this.logger, {
      toolName: 'server-management-tool',
      appId,
      port: 0, // Will be updated when we get app info
    });

    try {
      // Get app info and create dev supervisor client
      const appInfo = DevSupervisorClientFactory.getAppInfo(appId);
      if (!appInfo) {
        this.logger.error('server.status.app_not_found', {
          appId,
          error: `App with ID ${appId} not found`,
        });
        return {
          success: false,
          appId,
          status: 'not_found',
          error: `App with ID ${appId} not found`,
        };
      }

      // Use dev supervisor to check process status if available
      const devSupervisor = DevSupervisorClientFactory.createForApp(appId);
      if (devSupervisor) {
        try {
          
          // Use built-in process status API instead of exec with ps/grep
          const processInfo = await devSupervisor.getProcessStatus();
          
          const isRunning = processInfo.state === 'running';
          const status = processInfo.state === 'running' ? 'running' : 
                        processInfo.state === 'error' ? 'error' : 'stopped';
          
          // Log health status
          if (isRunning) {
            toolServerHealthEvents.healthy(this.logger, {
              toolName: 'server-management-tool',
              appId,
              port: appInfo.port,
              isHealthy: true,
            });
          } else {
            toolServerHealthEvents.unhealthy(this.logger, {
              toolName: 'server-management-tool',
              appId,
              port: appInfo.port,
              isHealthy: false,
            });
          }
          
          return {
            success: true,
            appId,
            status,
            message: `Process state: ${processInfo.state}${processInfo.pid ? ` (PID: ${processInfo.pid})` : ''}`,
          };
        } catch (error) {
          this.logger.error('server.status.supervisor_error', {
            appId,
            socketPath: appInfo.socketPath,
            error: error instanceof Error ? error.message : 'Unknown supervisor error',
          });
          return {
            success: true,
            appId,
            status: 'error',
            message: 'Cannot communicate with dev supervisor',
            error: error instanceof Error ? error.message : 'Unknown supervisor error',
          };
        }
      } else {
        this.logger.info('server.status.supervisor_unavailable', {
          appId,
          socketPath: appInfo.socketPath,
          socketExists: DevSupervisorClientFactory.isAvailableForApp(appId),
        });
        return {
          success: true,
          appId,
          status: 'stopped',
          message: 'Dev supervisor not available for this app',
        };
      }
    } catch (error) {
      this.logger.error('server.status.error', {
        appId,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      });
      return {
        success: false,
        appId,
        status: 'error',
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  }

  /**
   * Restart the development server for a specific app via dev supervisor
   */
  async restartServer(options: RestartServerOptions, appId: string): Promise<RestartServerResult> {
    this.logger.info('server.restart.begin', {
      appId,
      reason: options.reason,
      toolName: 'server-management-tool',
    });

    try {
      const { reason } = options;

      // Get app info and create dev supervisor client
      const appInfo = DevSupervisorClientFactory.getAppInfo(appId);
      if (!appInfo) {
        this.logger.error('server.restart.app_not_found', {
          appId,
          error: `App with ID ${appId} not found`,
        });
        return {
          success: false,
          appId,
          message: 'Failed to restart server',
          error: `App with ID ${appId} not found`,
        };
      }

      // Use dev supervisor directly for restart if available
      const devSupervisor = DevSupervisorClientFactory.createForApp(appId);
      if (devSupervisor) {
        try {
          // Use built-in restart process API
          const restarted = await devSupervisor.restartProcess({ graceful: true });
          
          if (restarted) {
            toolServerHealthEvents.restart(this.logger, {
              toolName: 'server-management-tool',
              appId,
              port: appInfo.port,
              isHealthy: true,
            });
            this.logger.info('server.restart.success', {
              appId,
              reason,
              graceful: true,
            });
            return {
              success: true,
              appId,
              message: `Server restarted successfully for app ${appId}`,
            };
          } else {
            this.logger.error('server.restart.failed', {
              appId,
              reason,
              error: 'Server restart operation failed',
            });
            return {
              success: false,
              appId,
              message: `Failed to restart server for app ${appId}`,
              error: 'Server restart operation failed',
            };
          }
        } catch (error) {
          this.logger.error('server.restart.supervisor_error', {
            appId,
            socketPath: appInfo.socketPath,
            error: error instanceof Error ? error.message : 'Unknown dev supervisor error',
          });
          return {
            success: false,
            appId,
            message: `Failed to restart server for app ${appId}`,
            error: error instanceof Error ? error.message : 'Unknown dev supervisor error',
          };
        }
      } else {
        this.logger.error('server.restart.supervisor_unavailable', {
          appId,
          socketPath: appInfo.socketPath,
          socketExists: DevSupervisorClientFactory.isAvailableForApp(appId),
        });
        return {
          success: false,
          appId,
          message: `Failed to restart server for app ${appId}`,
          error: 'Dev supervisor not available for this app',
        };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      this.logger.error('server.restart.error', {
        appId,
        error: errorMessage,
      });
      return {
        success: false,
        appId,
        message: 'Failed to restart server',
        error: errorMessage,
      };
    }
  }
}
