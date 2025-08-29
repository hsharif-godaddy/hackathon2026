import { spawn } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import path from 'path';
import net from 'net';
import { nanoid } from 'nanoid';
import { execa } from 'execa';
import type { Database } from 'better-sqlite3';
import { Logger } from '../logging/index.js';
import { getErrorMessage } from '../utils/error.js';
import {
  appProcessEvents,
  appServerEvents,
  appProcessManagementEvents,
  appCleanupEvents
} from '../logging/events/index.js';

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
  private db: Database;
  private runningProcesses = new Map<string, any>(); // Store running dev servers
  private logger = Logger.create({ service: 'process-service' });

  constructor(db: Database) {
    this.db = db;
  }

  /**
   * Recover orphaned processes that may be running from previous sessions
   */
  async recoverOrphanedProcesses(): Promise<void> {
    const stmt = this.db.prepare('SELECT * FROM running_processes WHERE status = ?');
    const runningRecords = stmt.all('running') as any[];
    
    appProcessEvents.recoverBegin(this.logger, {
      processCount: runningRecords.length
    });
    
    for (const record of runningRecords) {
      const processLogger = this.logger.child({ 
        appId: record.app_id, 
        pid: record.pid, 
        port: record.port 
      });
      
      const isAlive = await this.isProcessAlive(record.pid);
      
      if (isAlive) {
        // Check if the process is actually a dev server on the expected port
        const isValidDevServer = await this.isPortOccupied(record.port);
        
        if (isValidDevServer) {
          appProcessEvents.recoverSuccess(processLogger, {
            processId: record.pid,
            port: record.port,
            status: 'recovered',
            wasValid: true,
            portOccupied: true
          });
          // Don't need to store the actual process object since we can't recreate it
          // Just track that it's running
        } else {
          appProcessEvents.recoverSuccess(processLogger, {
            processId: record.pid,
            port: record.port,
            status: 'cleanup',
            wasValid: false,
            portOccupied: false
          });
          await this.killProcess(record.pid);
          this.updateProcessStatus(record.id, 'stopped');
        }
      } else {
        appProcessEvents.recoverSuccess(processLogger, {
          processId: record.pid,
          port: record.port,
          status: 'dead'
        });
        this.updateProcessStatus(record.id, 'stopped');
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
              appProcessManagementEvents.killSuccess(this.logger, {
                appId,
                processId: pid,
                operation: 'kill',
                signal: 'SIGKILL'
              });
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
   * Update process status in database
   */
  updateProcessStatus(processId: string, status: string): void {
    const stmt = this.db.prepare('UPDATE running_processes SET status = ? WHERE id = ?');
    stmt.run(status, processId);
  }

  /**
   * Add process to database tracking
   */
  addProcessRecord(appId: string, pid: number, port: number): string {
    // First verify the app exists before trying to reference it
    const appCheckStmt = this.db.prepare('SELECT id FROM apps WHERE id = ?');
    const appExists = appCheckStmt.get(appId);
    
    if (!appExists) {
      throw new Error(`Cannot add process record: App with id ${appId} does not exist in database`);
    }
    
    const processId = nanoid(12);
    
    const stmt = this.db.prepare(`
      INSERT INTO running_processes (id, app_id, pid, port, started_at, status)
      VALUES (?, ?, ?, ?, datetime('now'), 'running')
    `);
    
    try {
      stmt.run(processId, appId, pid, port);
    } catch (error: any) {
      if (error.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
        // Double-check if app still exists
        const appStillExists = appCheckStmt.get(appId);
        if (!appStillExists) {
          throw new Error(`Foreign key constraint failed: App ${appId} was deleted or never properly inserted`);
        } else {
          throw new Error(`Foreign key constraint failed for unknown reason. App ${appId} exists but constraint still failed`);
        }
      }
      throw error;
    }
    
    return processId;
  }

  /**
   * Remove process from database tracking
   */
  removeProcessRecord(appId: string): void {
    const stmt = this.db.prepare('UPDATE running_processes SET status = ? WHERE app_id = ? AND status = ?');
    stmt.run('stopped', appId, 'running');
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
      appServerEvents.startBegin(this.logger, {
        appId,
        port: preferredPort
      });
      
      // Check if package.json exists and has a dev script
      const packageJsonPath = path.join(appPath, 'package.json');
      if (!existsSync(packageJsonPath)) {
        this.logger.warn('app.server.no_package_json', {
          appId,
          path: packageJsonPath
        });
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
      
      this.logger.info('app.server.starting', {
        appId,
        packageManager,
        port: preferredPort,
        logPaths: {
          stdout: stdoutLogPath,
          stderr: stderrLogPath
        }
      });
      
      // Always use the smart dev script for consistent port management
      const command = `${packageManager} run dev >> "${stdoutLogPath}" 2>> "${stderrLogPath}"`;
      
      this.logger.debug('app.server.command', {
        appId,
        command,
        workingDirectory: appPath
      });
      
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
      
      this.logger.debug('app.server.process_record', {
        appId,
        processId: child.pid!,
        port: preferredPort
      });
      
      // Double-check app exists right before process record insertion
      const finalAppCheck = this.db.prepare('SELECT id FROM apps WHERE id = ?').get(appId);
      if (!finalAppCheck) {
        throw new Error(`App ${appId} no longer exists in database before process record insertion`);
      }
      this.logger.debug('app.server.verification', {
        appId
      });
      
      const processRecord = this.addProcessRecord(appId, child.pid!, preferredPort);
      this.logger.info('app.server.process_added', {
        appId,
        processRecordId: processRecord,
        processId: child.pid!
      });

      // Handle process errors and exits (minimal event handling)
      child.on('error', (error) => {
        appServerEvents.startFailure(this.logger, error as Error, {
          appId,
          port: preferredPort
        });
        this.runningProcesses.delete(appId);
        this.removeProcessRecord(appId);
      });

      child.on('exit', (code) => {
        this.logger.info('app.server.exited', {
          appId,
          exitCode: code
        });
        this.runningProcesses.delete(appId);
        this.removeProcessRecord(appId);
      });

      // Don't wait for the process to start, let it run in background
      appServerEvents.startSuccess(this.logger, {
        appId,
        processId: child.pid!,
        port: preferredPort,
        protocol: 'http',
        startTime: new Date().toISOString(),
        duration: 0
      });

    } catch (error) {
      appServerEvents.startFailure(this.logger, error as Error, {
        appId
      });
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
        this.removeProcessRecord(appId);
        this.logger.info('app.server.stopped', {
          appId
        });
      } catch (error) {
        this.logger.warn('app.server.stop_failed_local', {
          appId,
          error: getErrorMessage(error)
        });
      }
    } else {
      // Check if we have a database record but no in-memory process
      const stmt = this.db.prepare('SELECT * FROM running_processes WHERE app_id = ? AND status = ?');
      const record = stmt.get(appId, 'running') as any;
      
      if (record) {
        this.logger.info('app.process.orphan.cleanup.begin', {
          appId,
          processId: record.pid,
          port: record.port
        });
        this.killProcess(record.pid);
        this.removeProcessRecord(appId);
      }
    }
  }

  /**
   * Force cleanup of all orphaned processes by scanning the database
   */
  async forceCleanupOrphans(): Promise<number> {
    const stmt = this.db.prepare('SELECT * FROM running_processes WHERE status = ?');
    const runningRecords = stmt.all('running') as any[];
    
    appCleanupEvents.directoryBegin(this.logger, {
      appId: 'system'
    });
    
    let cleaned = 0;
    
    for (const record of runningRecords) {
      const processLogger = this.logger.child({ 
        appId: record.app_id, 
        processId: record.pid 
      });
      
      const isRunning = await this.isProcessRunning(record.pid);
      if (isRunning) {
        appProcessManagementEvents.killBegin(processLogger, {
          appId: record.app_id,
          processId: record.pid,
          signal: 'SIGTERM'
        });
        await this.killProcess(record.pid);
      } else {
        this.logger.debug('app.process.orphan.dead', {
          appId: record.app_id,
          processId: record.pid,
          status: 'already_dead'
        });
      }
      this.updateProcessStatus(record.id, 'stopped');
      cleaned++;
    }
    
    appCleanupEvents.directorySuccess(this.logger, {
      appId: 'system',
      operation: 'orphan',
      itemsCleaned: cleaned
    });
    
    return cleaned;
  }

  /**
   * Force cleanup processes for a specific app
   */
  async forceCleanupApp(appId: string): Promise<boolean> {
    const stmt = this.db.prepare('SELECT * FROM running_processes WHERE app_id = ? AND status = ?');
    const runningRecords = stmt.all(appId, 'running') as any[];
    
    appCleanupEvents.directoryBegin(this.logger, {
      appId
    });
    
    if (runningRecords.length === 0) {
      this.logger.debug('app.process.cleanup.no_processes', {
        appId,
        processCount: 0
      });
      return true;
    }
    
    for (const record of runningRecords) {
      const processLogger = this.logger.child({ 
        appId, 
        processId: record.pid 
      });
      
      const isRunning = await this.isProcessRunning(record.pid);
      if (isRunning) {
        appProcessManagementEvents.killBegin(processLogger, {
          appId,
          processId: record.pid,
          signal: 'SIGTERM'
        });
        await this.killProcess(record.pid);
      } else {
        this.logger.debug('app.process.cleanup.dead', {
          appId,
          processId: record.pid,
          status: 'already_dead'
        });
      }
      this.updateProcessStatus(record.id, 'stopped');
    }
    
    // Also remove from in-memory map if present
    this.runningProcesses.delete(appId);
    
    appCleanupEvents.directorySuccess(this.logger, {
      appId,
      operation: 'process',
      itemsCleaned: runningRecords.length
    });
    
    return true;
  }

  /**
   * Check if a server is currently running for an app
   */
  isServerRunning(appId: string): boolean {
    const stmt = this.db.prepare('SELECT status FROM running_processes WHERE app_id = ? AND status = ?');
    const result = stmt.get(appId, 'running') as { status: string } | undefined;
    return !!result;
  }

  /**
   * Get app status for local process mode
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
        this.logger.info('app.server.stopping', {
          appId
        });
        process.kill('SIGTERM');
        
        // Wait a bit for graceful shutdown, then force kill if needed
        setTimeout(() => {
          try {
            if (!process.killed) {
              appProcessManagementEvents.killBegin(this.logger, {
                appId,
                processId: process.pid || 0,
                signal: 'SIGKILL'
              });
              process.kill('SIGKILL');
            }
          } catch (error) {
            // Process might already be dead
          }
        }, 2000);
        
        this.runningProcesses.delete(appId);
        // Update database record to mark as stopped
        this.removeProcessRecord(appId);
        this.logger.info('app.server.stop.success', {
          appId,
          processId: process.pid || 0,
          port: 0,
          protocol: 'http' as const,
          startTime: new Date().toISOString(),
          duration: 0
        });
        
        return true;
      } catch (error) {
        this.logger.error('app.server.stop.failure', {
          appId,
          error: getErrorMessage(error)
        });
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
        this.removeProcessRecord(appId);
        
        appProcessManagementEvents.killSuccess(this.logger, {
          appId,
          processId: process.pid || 0,
          operation: 'stop',
          signal: 'SIGTERM'
        });
        
        stoppedCount++;
      } catch (error) {
        this.logger.warn('app.server.stop.failure', {
          appId,
          processId: process.pid || 0,
          error: getErrorMessage(error)
        });
      }
    }
    
    this.runningProcesses.clear();
    return stoppedCount;
  }

  /**
   * Cleanup all running processes gracefully
   */
  async cleanup(): Promise<void> {
    const processCount = this.runningProcesses.size;
    
    appCleanupEvents.directoryBegin(this.logger, {
      appId: 'system'
    });
    
    // Stop all in-memory processes
    for (const [appId, process] of this.runningProcesses) {
      const processLogger = this.logger.child({ appId });
      
      try {
        appProcessManagementEvents.killBegin(processLogger, {
          appId,
          processId: process.pid || 0,
          signal: 'SIGTERM'
        });
        
        process.kill('SIGTERM');
      } catch (error) {
        this.logger.warn('app.server.graceful_stop.failure', {
          appId,
          error: getErrorMessage(error)
        });
        
        try {
          appProcessManagementEvents.killBegin(processLogger, {
            appId,
            processId: process.pid || 0,
            signal: 'SIGKILL'
          });
          process.kill('SIGKILL');
        } catch (killError) {
          this.logger.error('app.server.force_kill.failure', {
            appId,
            error: getErrorMessage(killError)
          });
        }
      }
    }
    
    // Clean up database records
    const stmt = this.db.prepare('UPDATE running_processes SET status = ? WHERE status = ?');
    const result = stmt.run('stopped', 'running');
    
    appCleanupEvents.directorySuccess(this.logger, {
      appId: 'system',
      operation: 'process',
      itemsCleaned: result.changes
    });
    
    this.runningProcesses.clear();
  }

  /**
   * Get the running processes map (for repository access)
   */
  getRunningProcesses(): Map<string, any> {
    return this.runningProcesses;
  }
}