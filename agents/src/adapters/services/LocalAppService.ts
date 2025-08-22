import { spawn } from 'child_process';
import path from 'path';
import net from 'net';
import { nanoid } from 'nanoid';
import { getDatabase } from '../../database/connection.js';
import type { App, RunningProcess } from '../../database/schema.js';
import type { 
  IAppAdapter, 
  ServerInfo, 
  ServerStatus, 
  AppAdapterCapabilities 
} from '../interfaces/IAppAdapter.js';
import { ProcessError } from '../interfaces/common.js';

/**
 * Local Process-based App Deployment Service
 * 
 * Handles ONLY deployment operations using local Node.js processes.
 * App creation, database operations, and file system setup are handled by AppRepository.
 */
export class LocalAppService implements IAppAdapter {
  private db = getDatabase();
  private runningProcesses = new Map<string, any>(); // Store running dev servers
  private initialized = false;

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
      const app = this.getAppFromDb(appId);
      if (!app) {
        throw new ProcessError(`App not found: ${appId}`, appId);
      }
      
      // Check if already running
      if (this.runningProcesses.has(appId)) {
        console.log(`📱 App ${appId} is already running`);
        return true;
      }
      
      await this.startDevServer(appId, app.path, app.port, app.templateVersion);
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
      const app = this.getAppFromDb(appId);
      if (!app) {
        throw new ProcessError(`App not found: ${appId}`, appId);
      }
      
      // Stop if running
      await this.stopDevServer(appId);
      
      // Wait a moment for cleanup
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Start again
      await this.startDevServer(appId, app.path, app.port, app.templateVersion);
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
      const app = this.getAppFromDb(appId);
      if (app) {
        servers.push({
          appId,
          port: app.port,
          url: `http://localhost:${app.port}`,
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
        this.removeProcessRecord(appId);
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
        this.removeProcessRecord(appId);
        
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
      const stmt = this.db.prepare('SELECT * FROM running_processes WHERE status = ?');
      const runningRecords = stmt.all('running') as RunningProcess[];
      
      for (const record of runningRecords) {
        const isAlive = await this.isProcessAlive(record.pid);
        
        if (!isAlive) {
          // Remove dead process from tracking
          this.runningProcesses.delete(record.appId);
          this.removeProcessRecord(record.appId);
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
      this.removeProcessRecord(appId);
      
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
    console.log('🔍 Database connection:', !!this.db);
    
    try {
      const stmt = this.db.prepare('SELECT * FROM running_processes WHERE status = ?');
      console.log('🔍 Prepared statement:', !!stmt);
      
      const runningRecords = stmt.all('running') as RunningProcess[];
      console.log('🔍 Query result:', runningRecords, 'Type:', typeof runningRecords);
      
      // Ensure runningRecords is an array
      const records = Array.isArray(runningRecords) ? runningRecords : [];
      console.log(`🔍 Found ${records.length} potentially running process(es) in database`);
    
    for (const record of records) {
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
        this.removeProcessRecord(record.appId);
        console.log(`🧹 Cleaned up dead process record for app ${record.appId} (PID: ${record.pid})`);
      }
    }
    } catch (error) {
      console.error('🚨 Error in recoverOrphanedProcesses:', error);
      throw error;
    }
  }

  private async startDevServer(appId: string, appPath: string, port: number, templateVersion: string = 'v1'): Promise<void> {
    console.log(`🚀 Starting development server for app ${appId} on port ${port}...`);
    
    // Check if port is already in use
    const isPortFree = await this.isPortAvailable(port);
    if (!isPortFree) {
      throw new Error(`Port ${port} is already in use`);
    }
    
    let command: string;
    let args: string[];
    
    // Set command based on template version
    if (templateVersion === 'v3') {
      command = 'node';
      args = ['scripts/dev-start.js'];
    } else if (templateVersion === 'v2') {
      command = 'npm';
      args = ['run', 'dev', '--', '--turbopack'];
    } else {
      // v1 or default
      command = 'npm';
      args = ['run', 'dev'];
    }
    
    // Start the process
    const child = spawn(command, args, {
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
    this.addProcessRecord(appId, child.pid!, port);
    
    // Handle process events
    child.on('exit', (code) => {
      console.log(`📱 Dev server for app ${appId} exited with code ${code}`);
      this.runningProcesses.delete(appId);
      this.removeProcessRecord(appId);
    });
    
    child.on('error', (error) => {
      console.error(`❌ Error starting dev server for app ${appId}:`, error);
      this.runningProcesses.delete(appId);
      this.removeProcessRecord(appId);
    });
    
    // Log output
    child.stdout?.on('data', (data) => {
      console.log(`[${appId}] ${data.toString().trim()}`);
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
      this.removeProcessRecord(appId);
      
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

  private getAppFromDb(appId: string): App | null {
    const stmt = this.db.prepare('SELECT * FROM apps WHERE id = ?');
    const result = stmt.get(appId) as any;
    
    if (!result) return null;
    
    return {
      id: result.id,
      name: result.name,
      path: result.path,
      port: result.port,
      initialPrompt: result.initial_prompt,
      templateVersion: result.template_version,
      status: result.status,
      createdAt: new Date(result.created_at),
      updatedAt: new Date(result.updated_at)
    };
  }

  private addProcessRecord(appId: string, pid: number, port: number): void {
    const stmt = this.db.prepare(
      'INSERT OR REPLACE INTO running_processes (id, app_id, pid, port, started_at, status) VALUES (?, ?, ?, ?, ?, ?)'
    );
    stmt.run(nanoid(), appId, pid, port, new Date().toISOString(), 'running');
  }

  private removeProcessRecord(appId: string): void {
    const stmt = this.db.prepare('DELETE FROM running_processes WHERE app_id = ?');
    stmt.run(appId);
  }
}