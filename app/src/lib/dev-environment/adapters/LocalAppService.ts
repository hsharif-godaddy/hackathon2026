import { spawn } from 'child_process';
import net from 'net';
import { DevDatabase } from '../database/DevDatabase';
import type { 
  IAppAdapter, 
  ServerInfo, 
  ServerStatus, 
  AppAdapterCapabilities 
} from './interfaces/IAppAdapter';
import { ProcessError } from './interfaces/common';

/**
 * Local Process-based App Deployment Service
 * 
 * Handles ONLY deployment operations using local Node.js processes.
 * App creation, database operations, and file system setup are handled by DevEnvironmentManager.
 */
export class LocalAppService implements IAppAdapter {
  private devDb: DevDatabase;
  private runningProcesses = new Map<string, any>(); // Store running dev servers
  private initialized = false;

  constructor(devDb: DevDatabase) {
    this.devDb = devDb;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    
    console.log('🔄 Initializing Local Process Deployment Service...');
    
    try {
      await this.recoverOrphanedProcesses();
      this.initialized = true;
      console.log('✅ Local Process Deployment Service initialization completed');
    } catch (error) {
      console.error('❌ Local Process Deployment Service initialization failed:', error);
      throw new ProcessError(`Local service initialization failed: ${(error as Error).message}`);
    }
  }

  getCapabilities(): AppAdapterCapabilities {
    return {
      supportsContainerOperations: false,
      supportsProcessOperations: true,
      supportsRebuild: false,
      supportsLogs: false
    };
  }

  /**
   * Deployment Operations
   */

  async startApp(appId: string): Promise<boolean> {
    try {
      const devApp = this.devDb.findDevAppById(appId);
      if (!devApp) {
        throw new ProcessError(`Dev app not found: ${appId}`, appId);
      }
      
      // Check if already running
      if (this.runningProcesses.has(appId)) {
        console.log(`📱 App ${appId} is already running`);
        return true;
      }
      
      await this.startDevServer(appId, devApp.appPath, devApp.port, devApp.templateVersion);
      return true;
    } catch (error) {
      console.error(`❌ Failed to start app ${appId}:`, error);
      throw new ProcessError(`Failed to start app: ${(error as Error).message}`, appId);
    }
  }

  async stopApp(appId: string): Promise<boolean> {
    try {
      return await this.stopDevServer(appId);
    } catch (error) {
      console.error(`❌ Failed to stop app ${appId}:`, error);
      throw new ProcessError(`Failed to stop app: ${(error as Error).message}`, appId);
    }
  }

  async restartApp(appId: string): Promise<boolean> {
    try {
      const devApp = this.devDb.findDevAppById(appId);
      if (!devApp) {
        throw new ProcessError(`Dev app not found: ${appId}`, appId);
      }
      
      // Stop if running
      await this.stopDevServer(appId);
      
      // Wait a moment for cleanup
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Start again
      await this.startDevServer(appId, devApp.appPath, devApp.port, devApp.templateVersion);
      return true;
    } catch (error) {
      console.error(`❌ Failed to restart app ${appId}:`, error);
      throw new ProcessError(`Failed to restart app: ${(error as Error).message}`, appId);
    }
  }

  /**
   * Status and Information
   */

  async getRunningServers(): Promise<ServerInfo[]> {
    const servers: ServerInfo[] = [];
    
    for (const [appId, processInfo] of this.runningProcesses) {
      const devApp = this.devDb.findDevAppById(appId);
      if (devApp) {
        servers.push({
          appId,
          port: devApp.port,
          url: `http://localhost:${devApp.port}`,
          status: 'running',
          type: 'local',
          metadata: {
            pid: processInfo.pid,
            startedAt: processInfo.startedAt
          }
        });
      }
    }
    
    return servers;
  }

  async stopAllServers(): Promise<number> {
    let stoppedCount = 0;
    
    console.log(`💻 Stopping ${this.runningProcesses.size} local process(es)...`);
    
    for (const [appId, process] of this.runningProcesses) {
      try {
        process.process.kill('SIGTERM');
        // Update database record to mark as stopped
        this.devDb.removeProcessRecord(appId);
        console.log(`✅ Stopped development server for app ${appId}`);
        stoppedCount++;
      } catch (error) {
        console.warn(`⚠️ Failed to stop dev server for app ${appId}:`, error);
      }
    }
    
    this.runningProcesses.clear();
    console.log(`✅ Stopped ${stoppedCount} local process(es)`);
    return stoppedCount;
  }

  async getAppStatus(appId: string): Promise<ServerStatus> {
    try {
      const processInfo = this.runningProcesses.get(appId);
      
      if (!processInfo) {
        return {
          status: 'stopped',
          message: 'No running process found'
        };
      }
      
      const isAlive = await this.isProcessAlive(processInfo.pid);
      if (isAlive) {
        return {
          status: 'running',
          message: 'Process is running',
          metadata: {
            pid: processInfo.pid,
            startedAt: processInfo.startedAt
          }
        };
      } else {
        // Process died, clean up
        this.runningProcesses.delete(appId);
        this.devDb.removeProcessRecord(appId);
        
        return {
          status: 'stopped',
          message: 'Process has stopped unexpectedly'
        };
      }
    } catch (error) {
      console.error(`❌ Failed to get app status for ${appId}:`, error);
      return {
        status: 'error',
        message: (error as Error).message
      };
    }
  }

  async cleanupOrphans(): Promise<{ message: string; cleaned: number }> {
    let cleanedCount = 0;
    
    try {
      // Get all running processes from database
      const runningRecords = this.devDb.getRunningProcesses();
      
      for (const record of runningRecords) {
        const isAlive = await this.isProcessAlive(record.pid);
        
        if (!isAlive) {
          // Remove dead process from tracking
          this.runningProcesses.delete(record.appId);
          this.devDb.removeProcessRecord(record.appId);
          cleanedCount++;
          console.log(`🧹 Cleaned up orphaned process for app ${record.appId} (PID: ${record.pid})`);
        }
      }
      
      return {
        message: `Local orphan cleanup completed. Cleaned ${cleanedCount} orphaned processes`,
        cleaned: cleanedCount
      };
    } catch (error) {
      console.error('❌ Failed to cleanup orphans:', error);
      throw new ProcessError(`Cleanup failed: ${(error as Error).message}`);
    }
  }

  async removeApp(appId: string): Promise<boolean> {
    try {
      console.log(`💻 Removing local app artifacts for app ${appId}...`);
      
      // Stop any running processes
      const processInfo = this.runningProcesses.get(appId);
      if (processInfo) {
        try {
          processInfo.process.kill('SIGTERM');
          console.log(`✅ Stopped local process for app ${appId}`);
        } catch (error) {
          console.log(`ℹ️ Process for app ${appId} was already stopped`);
        }
        this.runningProcesses.delete(appId);
      }
      
      // Remove from database
      this.devDb.removeProcessRecord(appId);
      
      console.log(`✅ Local artifacts removed for app ${appId}`);
      return true;
    } catch (error) {
      console.error(`❌ Failed to remove local artifacts for app ${appId}:`, error);
      throw new ProcessError(`Failed to remove local artifacts: ${(error as Error).message}`, appId);
    }
  }

  /**
   * Cleanup
   */

  async cleanup(): Promise<void> {
    try {
      console.log('🧹 Stopping all local development servers...');
      
      const stopPromises = Array.from(this.runningProcesses.keys()).map(appId => 
        this.stopDevServer(appId).catch(err => 
          console.error(`Failed to stop server for app ${appId}:`, err)
        )
      );
      
      await Promise.all(stopPromises);
      this.runningProcesses.clear();
      
      console.log('✅ Local Process Deployment Service cleanup completed');
    } catch (error) {
      console.error('❌ Local Process Deployment Service cleanup failed:', error);
    }
  }

  /**
   * Helper Methods (Process Management)
   */

  private async recoverOrphanedProcesses(): Promise<void> {
    console.log('🔍 Recovering orphaned processes...');
    
    try {
      const runningRecords = this.devDb.getRunningProcesses();
      console.log(`🔍 Found ${runningRecords.length} potentially running process(es) in database`);
    
      for (const record of runningRecords) {
        const isAlive = await this.isProcessAlive(record.pid);
        
        if (isAlive) {
          // Process is still running, add to our tracking
          this.runningProcesses.set(record.appId, {
            pid: record.pid,
            port: record.port,
            startedAt: record.startedAt
          });
          console.log(`✅ Recovered running process for app ${record.appId} (PID: ${record.pid})`);
        } else {
          // Process is dead, clean up
          this.devDb.removeProcessRecord(record.appId);
          console.log(`🧹 Cleaned up dead process record for app ${record.appId} (PID: ${record.pid})`);
        }
      }
    } catch (error) {
      console.error('🚨 Error in recoverOrphanedProcesses:', error);
      throw error;
    }
  }

  /**
   * Get spawn configuration for different template versions
   * Separated to avoid Next.js dynamic analysis issues
   */
  private getSpawnConfigForTemplate(templateVersion: string): { command: string; args: string[] } {
    // Use static string constants to avoid dynamic analysis
    const SCRIPT_DEV_START = 'scripts/dev-start.js';
    const CMD_NPM = 'npm';
    const CMD_PNPM = 'pnpm';
    const CMD_NODE = 'node';
    const ARG_RUN = 'run';
    const ARG_DEV = 'dev';
    const ARG_TURBO = '--turbopack';
    const ARG_SEPARATOR = '--';
    
    if (templateVersion === 'v3') {
      return {
        command: CMD_NODE,
        args: [SCRIPT_DEV_START]
      };
    } else if (templateVersion === 'v2') {
      return {
        command: CMD_NPM,
        args: [ARG_RUN, ARG_DEV, ARG_SEPARATOR, ARG_TURBO]
      };
    } else if (templateVersion === 'v7' || templateVersion === 'v8') {
      // v7/v8 uses Vite and needs pnpm
      return {
        command: CMD_PNPM,
        args: [ARG_RUN, ARG_DEV]
      };
    } else {
      // v1 or default
      return {
        command: CMD_NPM,
        args: [ARG_RUN, ARG_DEV]
      };
    }
  }

  private async startDevServer(appId: string, appPath: string, port: number, templateVersion: string = 'v1'): Promise<void> {
    console.log(`🚀 Starting development server for app ${appId} on port ${port}...`);
    
    // Check if port is already in use
    const isPortFree = await this.isPortAvailable(port);
    if (!isPortFree) {
      throw new Error(`Port ${port} is already in use`);
    }
    
    // Create spawn configuration to avoid Next.js dynamic analysis issues
    const spawnConfig = this.getSpawnConfigForTemplate(templateVersion);
    
    // Start the process
    const child = spawn(spawnConfig.command, spawnConfig.args, {
      cwd: appPath,
      env: {
        ...process.env,
        PORT: port.toString(),
        PREFERRED_FRONTEND_PORT: port.toString() // For v3 templates
      },
      detached: false,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    
    const processInfo = {
      pid: child.pid!,
      port,
      startedAt: new Date(),
      process: child
    };
    
    // Track the process
    this.runningProcesses.set(appId, processInfo);
    this.devDb.addProcessRecord(appId, child.pid!, port);
    
    // Handle process events
    child.on('exit', (code) => {
      console.log(`📱 Dev server for app ${appId} exited with code ${code}`);
      this.runningProcesses.delete(appId);
      this.devDb.removeProcessRecord(appId);
    });
    
    child.on('error', (error) => {
      console.error(`❌ Error starting dev server for app ${appId}:`, error);
      this.runningProcesses.delete(appId);
      this.devDb.removeProcessRecord(appId);
    });
    
    // Log output and detect actual running port
    child.stdout?.on('data', (data) => {
      const output = data.toString().trim();
      console.log(`[${appId}] ${output}`);
      
      // Parse actual port from Vite output
      const vitePortMatch = output.match(/Local:\s+http:\/\/localhost:(\d+)/);
      if (vitePortMatch) {
        const actualPort = parseInt(vitePortMatch[1]);
        if (actualPort !== port) {
          console.log(`🔄 Port changed for app ${appId}: ${port} → ${actualPort}`);
          // Update the process info with actual port
          const processInfo = this.runningProcesses.get(appId);
          if (processInfo) {
            processInfo.port = actualPort;
          }
        }
      }
    });
    
    child.stderr?.on('data', (data) => {
      console.error(`[${appId}] ${data.toString().trim()}`);
    });
    
    console.log(`✅ Development server started for app ${appId} (PID: ${child.pid})`);
  }

  private async stopDevServer(appId: string): Promise<boolean> {
    const processInfo = this.runningProcesses.get(appId);
    
    if (!processInfo) {
      console.log(`📱 No running process found for app ${appId}`);
      return true; // Already stopped
    }
    
    try {
      console.log(`🛑 Stopping development server for app ${appId} (PID: ${processInfo.pid})`);
      
      // Kill the process
      if (processInfo.process) {
        processInfo.process.kill('SIGTERM');
      } else {
        process.kill(processInfo.pid, 'SIGTERM');
      }
      
      // Wait for graceful shutdown
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Force kill if still running
      const isAlive = await this.isProcessAlive(processInfo.pid);
      if (isAlive) {
        console.log(`🔫 Force killing process for app ${appId}`);
        if (processInfo.process) {
          processInfo.process.kill('SIGKILL');
        } else {
          process.kill(processInfo.pid, 'SIGKILL');
        }
      }
      
      // Clean up tracking
      this.runningProcesses.delete(appId);
      this.devDb.removeProcessRecord(appId);
      
      console.log(`✅ Development server stopped for app ${appId}`);
      return true;
    } catch (error) {
      console.error(`❌ Error stopping dev server for app ${appId}:`, error);
      return false;
    }
  }

  private async isProcessAlive(pid: number): Promise<boolean> {
    try {
      process.kill(pid, 0); // Signal 0 just checks if process exists
      return true;
    } catch (error) {
      return false;
    }
  }

  private async isPortAvailable(port: number): Promise<boolean> {
    return new Promise(resolve => {
      const server = net.createServer();
      
      server.listen(port, () => {
        server.close(() => resolve(true));
      });
      
      server.on('error', () => resolve(false));
    });
  }
}