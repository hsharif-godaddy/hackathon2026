import { spawn } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import path from 'path';
import net from 'net';
import { execa } from 'execa';
import { DevDatabase } from '../database/DevDatabase';

export interface ProcessRecord {
  id: string;
  appId: string;
  pid: number;
  port: number;
  startedAt: string;
  status: 'running' | 'stopped';
}

export interface ProcessStatus {
  status: 'running' | 'stopped';
  message: string;
  metadata?: { pid: number };
}

export class ProcessService {
  private devDb: DevDatabase;
  private runningProcesses = new Map<string, any>(); // Store running dev servers

  constructor(devDb: DevDatabase) {
    this.devDb = devDb;
  }

  /**
   * Recover orphaned processes that may be running from previous sessions
   */
  async recoverOrphanedProcesses(): Promise<void> {
    const runningRecords = this.devDb.getRunningProcesses();
    
    console.log(`🔄 Recovering orphaned processes: found ${runningRecords.length} records`);
    
    for (const record of runningRecords) {
      const isAlive = await this.isProcessAlive(record.pid);
      
      if (isAlive) {
        // Check if the process is actually a dev server on the expected port
        const isValidDevServer = await this.isPortOccupied(record.port);
        
        if (isValidDevServer) {
          console.log(`✅ Recovered running process for app ${record.appId} (PID: ${record.pid})`);
          // Don't need to store the actual process object since we can't recreate it
          // Just track that it's running
        } else {
          console.log(`🧹 Cleaning invalid process for app ${record.appId} (PID: ${record.pid})`);
          await this.killProcess(record.pid);
          this.devDb.removeProcessRecord(record.appId);
        }
      } else {
        console.log(`🧹 Cleaning dead process record for app ${record.appId} (PID: ${record.pid})`);
        this.devDb.removeProcessRecord(record.appId);
      }
    }
  }

  /**
   * Check if a process is alive
   */
  async isProcessAlive(pid: number): Promise<boolean> {
    try {
      // On Unix systems, signal 0 checks if process exists without killing it
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Check if a port is occupied
   */
  async isPortOccupied(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const server = net.createServer();
      
      server.listen(port, () => {
        server.close(() => resolve(false));
      });
      
      server.on('error', () => resolve(true));
    });
  }

  /**
   * Get process information for a port (for debugging)
   */
  async getProcessInfoForPort(port: number): Promise<string | null> {
    try {
      const { stdout } = await execa('lsof', ['-i', `:${port}`]);
      return stdout;
    } catch (error) {
      // lsof returns non-zero exit code when no processes found, which is normal
      return null;
    }
  }

  /**
   * Check if a process is still running by PID
   */
  async isProcessRunning(pid: number): Promise<boolean> {
    try {
      process.kill(pid, 0); // Signal 0 doesn't kill, just checks if process exists
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Kill a process by PID
   */
  async killProcess(pid: number, appId?: string): Promise<void> {
    try {
      process.kill(pid, 'SIGTERM');
      // Wait a bit, then force kill if needed
      setTimeout(async () => {
        try {
          const stillRunning = await this.isProcessRunning(pid);
          if (stillRunning) {
            if (appId) {
              console.log(`🔫 Force killing process for app ${appId} (PID: ${pid})`);
            }
            process.kill(pid, 'SIGKILL');
          }
        } catch (error) {
          // Process already dead, that's fine
        }
      }, 5000);
    } catch (error) {
      // Process might already be dead
    }
  }

  /**
   * Check if a command is available in the system
   */
  private async isCommandAvailable(command: string): Promise<boolean> {
    try {
      await execa('which', [command]);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Start development servers for an app using the smart script, for local setup
   */
  async startDevServer(appId: string, appPath: string, preferredPort: number): Promise<void> {
    try {
      console.log(`🚀 Starting dev server for app ${appId} on port ${preferredPort}`);
      
      // Check if package.json exists and has a dev script
      const packageJsonPath = path.join(appPath, 'package.json');
      if (!existsSync(packageJsonPath)) {
        console.warn(`⚠️ No package.json found for app ${appId} at ${packageJsonPath}`);
        return;
      }

      // Create logs directory if it doesn't exist
      const logsDir = path.join(appPath, 'logs');
      if (!existsSync(logsDir)) {
        mkdirSync(logsDir, { recursive: true });
      }

      // Create log file paths
      const stdoutLogPath = path.join(logsDir, 'dev-server.stdout.log');
      const stderrLogPath = path.join(logsDir, 'dev-server.stderr.log');

      // Set preferred frontend port for the smart script to use
      const env = {
        ...process.env,
        PREFERRED_FRONTEND_PORT: preferredPort.toString(),
        // Legacy support
        PORT: preferredPort.toString(),
        VITE_PORT: preferredPort.toString(),
        NEXT_PUBLIC_PORT: preferredPort.toString(),
      };

      // Detect package manager and use appropriate command
      const hasPnpm = await this.isCommandAvailable('pnpm');
      const packageManager = hasPnpm ? 'pnpm' : 'npm';
      
      console.log(`📦 Using ${packageManager} for app ${appId}`);
      
      // Always use the smart dev script for consistent port management
      const command = `${packageManager} run dev >> "${stdoutLogPath}" 2>> "${stderrLogPath}"`;
      
      console.log(`🔧 Command for app ${appId}: ${command}`);
      
      // Start the dev server with shell redirection (fully detached)
      const child = spawn('sh', ['-c', command], {
        cwd: appPath,
        env,
        stdio: 'ignore', // Completely detached - no pipes to parent
        detached: true,
      });

      // Fully detach the process from the parent
      child.unref();

      // Store the process in memory and database
      this.runningProcesses.set(appId, child);
      
      console.log(`📊 Adding process record for app ${appId} (PID: ${child.pid})`);
      
      // Check if dev app exists before adding process record
      if (!this.devDb.devAppExists(appId)) {
        throw new Error(`Dev app ${appId} does not exist in database before process record insertion`);
      }
      
      const processRecord = this.devDb.addProcessRecord(appId, child.pid!, preferredPort);
      console.log(`✅ Process record added for app ${appId}: ${processRecord}`);

      // Handle process errors and exits (minimal event handling)
      child.on('error', (error) => {
        console.error(`❌ Dev server process error for app ${appId}:`, error);
        this.runningProcesses.delete(appId);
        this.devDb.removeProcessRecord(appId);
      });

      child.on('exit', (code) => {
        console.log(`📱 Dev server for app ${appId} exited with code ${code}`);
        this.runningProcesses.delete(appId);
        this.devDb.removeProcessRecord(appId);
      });

      console.log(`✅ Dev server started for app ${appId} (PID: ${child.pid})`);

    } catch (error) {
      console.error(`❌ Failed to start dev server for app ${appId}:`, error);
      // Don't fail app creation if dev server fails to start
    }
  }

  /**
   * Stop development server for an app
   */
  stopDevServer(appId: string): void {
    const process = this.runningProcesses.get(appId);
    if (process) {
      try {
        process.kill('SIGTERM');
        this.runningProcesses.delete(appId);
        this.devDb.removeProcessRecord(appId);
        console.log(`✅ Dev server stopped for app ${appId}`);
      } catch (error) {
        console.warn(`⚠️ Failed to stop dev server for app ${appId}:`, error);
      }
    } else {
      // Check if we have a database record but no in-memory process
      const runningRecords = this.devDb.getRunningProcesses();
      const record = runningRecords.find(r => r.appId === appId && r.status === 'running');
      
      if (record) {
        console.log(`🧹 Cleaning orphaned process for app ${appId} (PID: ${record.pid})`);
        this.killProcess(record.pid);
        this.devDb.removeProcessRecord(appId);
      }
    }
  }

  /**
   * Force cleanup of all orphaned processes by scanning the database
   */
  async forceCleanupOrphans(): Promise<number> {
    const runningRecords = this.devDb.getRunningProcesses();
    
    console.log(`🧹 Force cleanup: found ${runningRecords.length} running records`);
    
    let cleaned = 0;
    
    for (const record of runningRecords) {
      const isRunning = await this.isProcessRunning(record.pid);
      if (isRunning) {
        console.log(`🔫 Killing orphaned process for app ${record.appId} (PID: ${record.pid})`);
        await this.killProcess(record.pid);
      } else {
        console.log(`🧹 Process already dead for app ${record.appId} (PID: ${record.pid})`);
      }
      this.devDb.removeProcessRecord(record.appId);
      cleaned++;
    }
    
    console.log(`✅ Cleaned up ${cleaned} orphaned processes`);
    
    return cleaned;
  }

  /**
   * Force cleanup processes for a specific app
   */
  async forceCleanupApp(appId: string): Promise<boolean> {
    const runningRecords = this.devDb.getRunningProcesses();
    const appRecords = runningRecords.filter(r => r.appId === appId && r.status === 'running');
    
    console.log(`🧹 Force cleanup for app ${appId}: found ${appRecords.length} processes`);
    
    if (appRecords.length === 0) {
      console.log(`ℹ️ No processes to cleanup for app ${appId}`);
      return true;
    }
    
    for (const record of appRecords) {
      const isRunning = await this.isProcessRunning(record.pid);
      if (isRunning) {
        console.log(`🔫 Killing process for app ${appId} (PID: ${record.pid})`);
        await this.killProcess(record.pid);
      } else {
        console.log(`🧹 Process already dead for app ${appId} (PID: ${record.pid})`);
      }
      this.devDb.removeProcessRecord(appId);
    }
    
    // Also remove from in-memory map if present
    this.runningProcesses.delete(appId);
    
    console.log(`✅ Cleaned up ${appRecords.length} processes for app ${appId}`);
    
    return true;
  }

  /**
   * Check if a server is currently running for an app
   */
  isServerRunning(appId: string): boolean {
    const runningRecords = this.devDb.getRunningProcesses();
    return runningRecords.some(r => r.appId === appId && r.status === 'running');
  }

  /**
   * Get app status for process mode
   */
  getAppStatus(appId: string): ProcessStatus {
    const processInfo = this.runningProcesses.get(appId);
    if (!processInfo) {
      return { status: 'stopped', message: 'No running process found' };
    }
    return { status: 'running', message: 'Process is running', metadata: { pid: processInfo.pid } };
  }

  /**
   * Stop a single server by app ID
   */
  async stopServer(appId: string): Promise<boolean> {
    const process = this.runningProcesses.get(appId);
    if (process) {
      try {
        console.log(`🛑 Stopping server for app ${appId}`);
        process.kill('SIGTERM');
        
        // Wait a bit for graceful shutdown, then force kill if needed
        setTimeout(() => {
          try {
            if (!process.killed) {
              console.log(`🔫 Force killing process for app ${appId} (PID: ${process.pid})`);
              process.kill('SIGKILL');
            }
          } catch (error) {
            // Process might already be dead
          }
        }, 2000);
        
        this.runningProcesses.delete(appId);
        // Update database record to mark as stopped
        this.devDb.removeProcessRecord(appId);
        
        console.log(`✅ Server stopped for app ${appId}`);
        
        return true;
      } catch (error) {
        console.error(`❌ Failed to stop server for app ${appId}:`, error);
        return false;
      }
    }
    return false;
  }

  /**
   * Stop all running development servers
   */
  async stopAllServers(): Promise<number> {
    let stoppedCount = 0;
    
    for (const [appId, process] of this.runningProcesses) {
      try {
        process.kill('SIGTERM');
        // Update database record to mark as stopped
        this.devDb.removeProcessRecord(appId);
        
        console.log(`✅ Stopped server for app ${appId} (PID: ${process.pid})`);
        
        stoppedCount++;
      } catch (error) {
        console.warn(`⚠️ Failed to stop server for app ${appId}:`, error);
      }
    }
    
    this.runningProcesses.clear();
    return stoppedCount;
  }

  /**
   * Cleanup all running processes gracefully
   */
  async cleanup(): Promise<void> {
    console.log(`🧹 ProcessService cleanup: stopping ${this.runningProcesses.size} processes`);
    
    // Stop all in-memory processes
    for (const [appId, process] of this.runningProcesses) {
      try {
        console.log(`🛑 Stopping process for app ${appId} (PID: ${process.pid})`);
        
        process.kill('SIGTERM');
      } catch (error) {
        console.warn(`⚠️ Failed to gracefully stop process for app ${appId}:`, error);
        
        try {
          console.log(`🔫 Force killing process for app ${appId} (PID: ${process.pid})`);
          process.kill('SIGKILL');
        } catch (killError) {
          console.error(`❌ Failed to force kill process for app ${appId}:`, killError);
        }
      }
    }
    
    // Clean up database records
    const runningRecords = this.devDb.getRunningProcesses();
    for (const record of runningRecords) {
      this.devDb.removeProcessRecord(record.appId);
    }
    
    console.log(`✅ ProcessService cleanup completed: ${runningRecords.length} records cleaned`);
    
    this.runningProcesses.clear();
  }

  /**
   * Get the running processes map (for repository access)
   */
  getRunningProcesses(): Map<string, any> {
    return this.runningProcesses;
  }
}