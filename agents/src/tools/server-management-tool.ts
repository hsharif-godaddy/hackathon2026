import { AppRepository } from '../database/index.js';

export interface ServerStatusOptions {
  /** No options needed - app ID comes from execution context */
}

export interface RestartServerOptions {
  /** Optional reason for restart (for logging) */
  reason?: string;
}



export interface StopServerOptions {
  /** Optional reason for stop (for logging) */
  reason?: string;
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
  /** Server details if running */
  details?: {
    port?: number;
    url?: string;
    isV3?: boolean;
    backendPort?: number;
  };
  /** Error message if operation failed */
  error?: string;
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



export interface StopServerResult {
  /** Whether the stop succeeded */
  success: boolean;
  /** App ID */
  appId: string;
  /** Result message */
  message: string;
  /** Error message if stop failed */
  error?: string;
}

/**
 * Tool for managing backend server operations
 * Provides restart, status check, and server management capabilities
 */
export class ServerManagementTool {
  private appRepo: AppRepository;

  constructor() {
    this.appRepo = new AppRepository();
  }

  /**
   * Check the status of a server for a specific app
   */
  async checkServerStatus(options: ServerStatusOptions, appId: string): Promise<ServerStatusResult> {
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

      // Get app status using the repository
      const appStatus = await this.appRepo.getAppStatus(appId);
      
      if (!appStatus) {
        return {
          success: true,
          appId,
          status: 'stopped',
          message: 'Server is not running',
        };
      }

      // Check if server is in running servers list for additional details
      const runningServers = await this.appRepo.getRunningServers();
      const serverInfo = runningServers.find(server => server.appId === appId);

      const result: ServerStatusResult = {
        success: true,
        appId,
        status: appStatus.status === 'running' ? 'running' : 'stopped',
        message: appStatus.message || 'Status retrieved successfully',
      };

      if (serverInfo) {
        result.details = {
          port: serverInfo.port,
          url: serverInfo.url,
          isV3: Boolean(serverInfo.isV3),
          ...(serverInfo.backendPort !== undefined && { backendPort: serverInfo.backendPort }),
        };
      }

      return result;
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
   * Restart the development server for a specific app
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

      // Use the existing restart server functionality
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



  /**
   * Stop the development server for a specific app
   */
  async stopServer(options: StopServerOptions, appId: string): Promise<StopServerResult> {
    try {
      const { reason } = options;

      // Check if app exists
      const app = this.appRepo.findById(appId);
      if (!app) {
        return {
          success: false,
          appId,
          message: 'Failed to stop server',
          error: `App with ID ${appId} not found`,
        };
      }

      console.log(`🛑 ServerManagementTool: Stopping server for app ${appId}${reason ? ` (Reason: ${reason})` : ''}`);

      // Use the existing stop server functionality
      const stopped = await this.appRepo.stopServer(appId);

      if (stopped) {
        const message = `Server stopped successfully for app ${appId}`;
        console.log(`✅ ${message}`);
        return {
          success: true,
          appId,
          message,
        };
      } else {
        const message = `Server was not running for app ${appId}`;
        console.log(`ℹ️ ${message}`);
        return {
          success: true,
          appId,
          message,
        };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      console.error(`❌ ServerManagementTool: Error stopping server for app ${appId}:`, error);
      return {
        success: false,
        appId,
        message: 'Failed to stop server',
        error: errorMessage,
      };
    }
  }

  /**
   * Check if backend server is running for an app (convenience method)
   */
  async isServerRunning(appId: string): Promise<boolean> {
    try {
      const status = await this.checkServerStatus({}, appId);
      return status.success && status.status === 'running';
    } catch (error) {
      console.error(`Error checking if server is running for app ${appId}:`, error);
      return false;
    }
  }

  /**
   * Ensure server is running for an app (start if not running)
   */
  async ensureServerRunning(appId: string, reason?: string): Promise<RestartServerResult> {
    try {
      const isRunning = await this.isServerRunning(appId);
      
      if (isRunning) {
        return {
          success: true,
          appId,
          message: `Server is already running for app ${appId}`,
        };
      }

      // Server is not running, restart it
      return await this.restartServer({ 
        reason: reason || 'Ensuring server is running' 
      }, appId);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      return {
        success: false,
        appId,
        message: 'Failed to ensure server is running',
        error: errorMessage,
      };
    }
  }

  /**
   * Get health status for a specific app server
   */
  async getServerHealth(appId: string): Promise<ServerStatusResult> {
    try {
      const status = await this.checkServerStatus({}, appId);
      
      if (!status.success || status.status !== 'running') {
        return status;
      }

      // If we have server details, we can provide more health information
      if (status.details?.url) {
        status.message = `Server is healthy and accessible at ${status.details.url}`;
      }

      return status;
    } catch (error) {
      return {
        success: false,
        appId,
        status: 'error',
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  }
}
