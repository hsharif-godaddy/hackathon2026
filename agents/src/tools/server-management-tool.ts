import { AppRepository } from '../database/index.js';
import { DevSupervisorClient } from '../services/DevSupervisorClient.js';
import { existsSync } from 'fs';

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
  private appRepo: AppRepository;

  constructor() {
    this.appRepo = new AppRepository();
  }

  /**
   * Check basic server status via dev supervisor
   */
  async checkServerStatus(appId: string): Promise<ServerStatusResult> {
    try {
      // Check if app exists
      const app = this.appRepo.findById(appId);
      if (!app) {
        return {
          success: false,
          appId,
          status: 'not_found',
          error: `App with ID ${appId} not found`,
        };
      }

      // Use dev supervisor to check process status if socket is available
      if (app.socketPath && existsSync(app.socketPath)) {
        try {
          const devSupervisor = new DevSupervisorClient(app.socketPath);
          
          // Try to execute a simple status command to see if dev server process is responsive
          const result = await devSupervisor.exec({
            command: 'ps aux | grep -E "(npm run dev|next dev|vite)" | grep -v grep || echo "NO_DEV_PROCESS"',
            working_dir: app.path,
            timeout: 5,
            capture_output: true
          });

          const isRunning = result.exit_code === 0 && !result.stdout.includes('NO_DEV_PROCESS');
          
          return {
            success: true,
            appId,
            status: isRunning ? 'running' : 'stopped',
            message: isRunning ? 'Dev server process detected' : 'No dev server process found',
          };
        } catch (error) {
          return {
            success: true,
            appId,
            status: 'error',
            message: 'Cannot communicate with dev supervisor',
            error: error instanceof Error ? error.message : 'Unknown supervisor error',
          };
        }
      } else {
        return {
          success: true,
          appId,
          status: 'stopped',
          message: 'Dev supervisor not available for this app',
        };
      }
    } catch (error) {
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
    try {
      const { reason } = options;

      // Check if app exists
      const app = this.appRepo.findById(appId);
      if (!app) {
        return {
          success: false,
          appId,
          message: 'Failed to restart server',
          error: `App with ID ${appId} not found`,
        };
      }

      console.log(`🔄 ServerManagementTool: Restarting server for app ${appId}${reason ? ` (Reason: ${reason})` : ''}`);

      // Use AppRepository's restartServer which delegates to dev supervisor
      const restarted = await this.appRepo.restartServer(appId);

      if (restarted) {
        const message = `Server restarted successfully for app ${appId}`;
        console.log(`✅ ${message}`);
        return {
          success: true,
          appId,
          message,
        };
      } else {
        const message = `Failed to restart server for app ${appId}`;
        console.error(`❌ ${message}`);
        return {
          success: false,
          appId,
          message,
          error: 'Server restart operation failed',
        };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      console.error(`❌ ServerManagementTool: Error restarting server for app ${appId}:`, error);
      return {
        success: false,
        appId,
        message: 'Failed to restart server',
        error: errorMessage,
      };
    }
  }
}
