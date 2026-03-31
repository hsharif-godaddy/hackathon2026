import { Logger } from '../logging/index.js';
import { toolServerHealthEvents } from '../logging/events/index.js';
import { DevSupervisorClientFactory } from '../utils/dev-supervisor-client-factory.js';
import type { DevSupervisorClient } from '../services/DevSupervisorClient.js';

export const HEALTH_POLL_INTERVAL_MS = 2_000;
export const HEALTH_POLL_MAX_ATTEMPTS = 15; // ~30s of polling; wall-clock may exceed this if individual status requests are slow

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

          // Map dev-supervisor states to tool status
          // CRITICAL FIX for AIROBUILD-178: Treat transition states ('starting', 'stopping')
          // as 'running' to prevent the agent from interfering with in-progress restarts.
          //
          // Bug: If we map 'starting' → 'stopped', the agent thinks the server crashed
          // mid-restart and tries to start it again. This causes the SAME Node.js process
          // to call listen() twice → ERR_SERVER_ALREADY_LISTEN.
          //
          // Solution: Treat transition states as "don't intervene" by mapping to 'running'.
          // These are temporary states that will eventually resolve to a terminal state
          // (running, stopped, or error).
          const status = processInfo.state === 'error' ? 'error' :
                        processInfo.state === 'running' ? 'running' :
                        processInfo.state === 'starting' ? 'running' : // In-progress start
                        processInfo.state === 'stopping' ? 'running' : // In-progress stop
                        'stopped';

          // Log health status based on the computed status (not raw state)
          // This ensures transition states are logged as healthy, matching the returned status
          if (status === 'running') {
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
   * Poll dev supervisor until the process reaches a terminal state after restart.
   */
  private async waitForProcessRunning(
    devSupervisor: DevSupervisorClient,
    appId: string,
  ): Promise<{ running: boolean; error?: string }> {
    for (let attempt = 0; attempt < HEALTH_POLL_MAX_ATTEMPTS; attempt++) {
      if (attempt > 0) {
        await new Promise(resolve => setTimeout(resolve, HEALTH_POLL_INTERVAL_MS));
      }

      try {
        const processInfo = await devSupervisor.getProcessStatus();

        if (processInfo.state === 'running') {
          return { running: true };
        }

        if (processInfo.state === 'error' || processInfo.state === 'stopped') {
          this.logger.info('server.restart.health_poll', {
            appId,
            attempt: attempt + 1,
            state: processInfo.state,
            error: processInfo.error,
          });
          return {
            running: false,
            error: processInfo.error || `Process entered ${processInfo.state} state after restart`,
          };
        }

        // 'starting' or 'stopping' - keep polling
        this.logger.info('server.restart.health_poll', {
          appId,
          attempt: attempt + 1,
          state: processInfo.state,
        });
      } catch (error) {
        // Transient poll error - log and keep trying
        this.logger.warn('server.restart.health_poll_error', {
          appId,
          attempt: attempt + 1,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    return { running: false, error: 'Timeout waiting for process to reach running state' };
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
          const restartResult = await devSupervisor.restartProcess({ graceful: true });

          if (!restartResult.success) {
            this.logger.error('server.restart.failed', {
              appId,
              reason,
              error: restartResult.error,
            });
            return {
              success: false,
              appId,
              message: `Failed to restart server for app ${appId}`,
              error: restartResult.error || 'Server restart operation failed',
            };
          }

          // Verify the process actually reaches running state
          const health = await this.waitForProcessRunning(devSupervisor, appId);

          if (!health.running) {
            this.logger.error('server.restart.health_failed', {
              appId,
              reason,
              error: health.error,
            });
            toolServerHealthEvents.restart(this.logger, {
              toolName: 'server-management-tool',
              appId,
              port: appInfo.port,
              isHealthy: false,
            });
            return {
              success: false,
              appId,
              message: `Server restart initiated but process failed to become healthy for app ${appId}`,
              error: health.error,
            };
          }

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
