import { nanoid } from 'nanoid';
import { mkdirSync, rmSync, cpSync, existsSync } from 'fs';
import { spawn } from 'child_process';
import path from 'path';
import { getDatabase } from '../connection.js';
import { GitUtils } from '../../utils/git.js';
import { PortManager } from '../../utils/port-manager.js';
import type { App, CreateAppRequest, UpdateAppRequest, RunningProcess } from '../schema.js';

export class AppRepository {
  private db = getDatabase();
  private gitUtils = new GitUtils();
  private portManager = new PortManager();
  private runningProcesses = new Map<string, any>(); // Store running dev servers
  private initialized = false;

  /**
   * Initialize the repository and recover orphaned processes
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    
    console.log('🔄 Initializing AppRepository and recovering orphaned processes...');
    
    try {
      await this.recoverOrphanedProcesses();
      this.initialized = true;
      console.log('✅ AppRepository initialization completed');
    } catch (error) {
      console.error('❌ AppRepository initialization failed:', error);
      throw error;
    }
  }

  /**
   * Recover orphaned processes that may be running from previous sessions
   */
  private async recoverOrphanedProcesses(): Promise<void> {
    const stmt = this.db.prepare('SELECT * FROM running_processes WHERE status = ?');
    const runningRecords = stmt.all('running') as any[];
    
    console.log(`🔍 Found ${runningRecords.length} potentially running process(es) in database`);
    
    for (const record of runningRecords) {
      const isAlive = await this.isProcessAlive(record.pid);
      
      if (isAlive) {
        // Check if the process is actually a dev server on the expected port
        const isValidDevServer = await this.isPortOccupied(record.port);
        
        if (isValidDevServer) {
          console.log(`♻️  Recovered running dev server for app ${record.app_id} (PID: ${record.pid}, Port: ${record.port})`);
          // Don't need to store the actual process object since we can't recreate it
          // Just track that it's running
        } else {
          console.log(`🧹 Process ${record.pid} alive but not serving on port ${record.port}, cleaning up`);
          await this.killProcess(record.pid);
          this.updateProcessStatus(record.id, 'stopped');
        }
      } else {
        console.log(`💀 Process ${record.pid} for app ${record.app_id} is no longer running, updating status`);
        this.updateProcessStatus(record.id, 'stopped');
      }
    }
  }

  /**
   * Check if a process is alive
   */
  private async isProcessAlive(pid: number): Promise<boolean> {
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
  private async isPortOccupied(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const net = require('net');
      const server = net.createServer();
      
      server.listen(port, () => {
        server.close(() => resolve(false));
      });
      
      server.on('error', () => resolve(true));
    });
  }

  /**
   * Kill a process by PID
   */
  private async killProcess(pid: number): Promise<void> {
    try {
      process.kill(pid, 'SIGTERM');
      // Wait a bit, then force kill if needed
      setTimeout(() => {
        try {
          process.kill(pid, 'SIGKILL');
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
  private updateProcessStatus(processId: string, status: string): void {
    const stmt = this.db.prepare('UPDATE running_processes SET status = ? WHERE id = ?');
    stmt.run(status, processId);
  }

  /**
   * Add process to database tracking
   */
  private addProcessRecord(appId: string, pid: number, port: number): string {
    const processId = nanoid(12);
    const stmt = this.db.prepare(`
      INSERT INTO running_processes (id, app_id, pid, port, started_at, status)
      VALUES (?, ?, ?, ?, datetime('now'), 'running')
    `);
    stmt.run(processId, appId, pid, port);
    return processId;
  }

  /**
   * Remove process from database tracking
   */
  private removeProcessRecord(appId: string): void {
    const stmt = this.db.prepare('UPDATE running_processes SET status = ? WHERE app_id = ? AND status = ?');
    stmt.run('stopped', appId, 'running');
  }

  /**
   * Create a new app with a websafe short identifier and filesystem directory
   */
  async create(data: CreateAppRequest): Promise<App> {
    const id = nanoid(12); // 12 characters, websafe, URL-friendly
    const now = new Date().toISOString();
    
    // Get base directory from environment variable, default to /tmp/apps
    const baseDir = process.env.APPS_BASE_DIR || '/tmp/apps';
    const appPath = path.join(baseDir, id);
    
    // Assign an available port
    const port = await this.portManager.getNextAvailablePort();
    
    // Get template directory from environment variable, default to app-templates/v1
    const templateDir = process.env.APP_TEMPLATE_DIR || 'app-templates/v1';
    const templatePath = path.isAbsolute(templateDir) 
      ? templateDir 
      : path.join(process.cwd(), '..', templateDir);
    
    // Create the directory for the app
    try {
      mkdirSync(appPath, { recursive: true });
      
      // Copy template contents if template directory exists
      if (existsSync(templatePath)) {
        try {
          // Copy all contents from template directory to app directory
          cpSync(templatePath, appPath, { recursive: true });
          console.log(`Copied template from ${templatePath} to ${appPath}`);
        } catch (templateError) {
          console.warn(`Failed to copy template from ${templatePath}:`, templateError);
          // Don't fail app creation if template copying fails
        }
      } else {
        console.warn(`Template directory not found: ${templatePath}`);
      }

      // Install npm dependencies after copying template
      await this.installDependencies(appPath);

      // Initialize Git repository after template copy
      await this.initializeGitRepository(appPath, data.name);

      // Start the development server
      await this.startDevServer(id, appPath, port);

    } catch (error) {
      console.error(`Failed to create directory for app ${id}:`, error);
      throw new Error(`Failed to create app directory: ${error}`);
    }
    
    const stmt = this.db.prepare(`
      INSERT INTO apps (id, name, path, port, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(id, data.name, appPath, port, now, now);
    
    return this.findById(id)!;
  }

  /**
   * Check if a command is available in the system
   */
  private async isCommandAvailable(command: string): Promise<boolean> {
    try {
      const child = spawn('which', [command], { stdio: 'pipe' });
      return new Promise<boolean>((resolve) => {
        child.on('close', (code) => {
          resolve(code === 0);
        });
        child.on('error', () => {
          resolve(false);
        });
      });
    } catch {
      return false;
    }
  }

  /**
   * Install dependencies for a new app (prefers pnpm, falls back to npm)
   */
  private async installDependencies(appPath: string): Promise<void> {
    try {
      // Check if package.json exists
      const packageJsonPath = path.join(appPath, 'package.json');
      if (!existsSync(packageJsonPath)) {
        console.warn(`No package.json found at ${packageJsonPath}, skipping dependency install`);
        return;
      }

      // Check if pnpm is available, fallback to npm
      const hasPnpm = await this.isCommandAvailable('pnpm');
      const packageManager = hasPnpm ? 'pnpm' : 'npm';
      
      console.log(`Installing dependencies with ${packageManager} for app at ${appPath}...`);

      // Run package manager install
      const installProcess = spawn(packageManager, ['install'], {
        cwd: appPath,
        stdio: 'pipe'
      });

      // Capture output for logging
      let stdout = '';
      let stderr = '';

      installProcess.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      installProcess.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      // Wait for install to complete
      await new Promise<void>((resolve, reject) => {
        installProcess.on('close', (code) => {
          if (code === 0) {
            console.log(`✅ ${packageManager} install completed successfully for ${appPath}`);
            if (stdout) console.log(`${packageManager} install output:`, stdout);
            resolve();
          } else {
            console.error(`❌ ${packageManager} install failed with code ${code} for ${appPath}`);
            if (stderr) console.error(`${packageManager} install stderr:`, stderr);
            if (stdout) console.error(`${packageManager} install stdout:`, stdout);
            reject(new Error(`${packageManager} install failed with code ${code}`));
          }
        });

        installProcess.on('error', (error) => {
          console.error(`❌ ${packageManager} install process error for ${appPath}:`, error);
          reject(error);
        });
      });

    } catch (error) {
      console.error(`Failed to install dependencies for ${appPath}:`, error);
      throw new Error(`Failed to install dependencies: ${error}`);
    }
  }

  /**
   * Initialize Git repository for a new app
   */
  private async initializeGitRepository(appPath: string, appName: string): Promise<void> {
    try {
      console.log(`Initializing Git repository for app at ${appPath}...`);
      
      // Initialize the Git repository
      const initResult = await this.gitUtils.initRepository(appPath);
      if (!initResult.success) {
        console.warn(`Failed to initialize Git repository: ${initResult.stderr}`);
        return; // Don't fail app creation if git init fails
      }

      // Configure Git user (use generic defaults)
      try {
        await this.gitUtils.configureUser(
          appPath,
          'Airo AI Builder',
          'ai@airo.dev'
        );
      } catch (configError) {
        console.warn(`Failed to configure Git user: ${configError}`);
        // Continue anyway
      }

      // Create initial commit with all template files
      try {
        const commitResult = await this.gitUtils.createInitialCommit(
          appPath,
          `Initial commit for ${appName}\n\nGenerated by Airo AI Builder with template files.`
        );
        
        if (commitResult.success) {
          console.log(`Created initial commit for ${appName}`);
        } else {
          console.warn(`Failed to create initial commit: ${commitResult.stderr}`);
        }
      } catch (commitError) {
        console.warn(`Failed to create initial commit: ${commitError}`);
        // Continue anyway - the repo is still initialized
      }

    } catch (error) {
      console.warn(`Git initialization failed for ${appPath}:`, error);
      // Don't fail app creation if Git setup fails
    }
  }

  /**
   * Find an app by ID
   */
  findById(id: string): App | null {
    const stmt = this.db.prepare(`
      SELECT id, name, path, port, created_at, updated_at
      FROM apps
      WHERE id = ?
    `);
    
    const row = stmt.get(id) as any;
    if (!row) return null;
    
    return {
      id: row.id,
      name: row.name,
      path: row.path,
      port: row.port,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  /**
   * List all apps with optional pagination
   */
  findAll(limit = 50, offset = 0): App[] {
    const stmt = this.db.prepare(`
      SELECT id, name, path, port, created_at, updated_at
      FROM apps
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `);
    
    const rows = stmt.all(limit, offset) as any[];
    
    return rows.map(row => ({
      id: row.id,
      name: row.name,
      path: row.path,
      port: row.port,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    }));
  }

  /**
   * Update an app
   */
  update(id: string, data: UpdateAppRequest): App | null {
    const existing = this.findById(id);
    if (!existing) return null;

    const updates: string[] = [];
    const values: any[] = [];

    if (data.name !== undefined) {
      updates.push('name = ?');
      values.push(data.name);
    }

    if (updates.length === 0) {
      return existing; // No changes
    }

    // Add updated_at
    updates.push('updated_at = ?');
    values.push(new Date().toISOString());
    
    // Add WHERE clause
    values.push(id);

    const stmt = this.db.prepare(`
      UPDATE apps 
      SET ${updates.join(', ')}
      WHERE id = ?
    `);
    
    stmt.run(...values);
    
    return this.findById(id)!;
  }

  /**
   * Delete an app and its directory
   */
  delete(id: string): boolean {
    // Get the app first to retrieve its path
    const app = this.findById(id);
    if (!app) return false;

    // Stop the development server if running
    this.stopDevServer(id);

    const stmt = this.db.prepare('DELETE FROM apps WHERE id = ?');
    const result = stmt.run(id);
    
    if (result.changes > 0) {
      // Try to remove the app directory
      try {
        rmSync(app.path, { recursive: true, force: true });
      } catch (error) {
        console.warn(`Failed to remove directory for app ${id} at ${app.path}:`, error);
        // Don't fail the operation if directory cleanup fails
      }
    }
    
    return result.changes > 0;
  }

  /**
   * Start development server for an app
   */
  private async startDevServer(appId: string, appPath: string, port: number): Promise<void> {
    try {
      console.log(`Starting development server for app ${appId} on port ${port}...`);
      
      // Check if package.json exists and has a dev script
      const packageJsonPath = path.join(appPath, 'package.json');
      if (!existsSync(packageJsonPath)) {
        console.warn(`No package.json found for app ${appId}, skipping dev server start`);
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

      // Set the port in environment variables
      const env = {
        ...process.env,
        PORT: port.toString(),
        NEXT_PUBLIC_PORT: port.toString(),
      };

      // Use shell to handle redirection so it persists even if parent dies
      const command = `npm run dev >> "${stdoutLogPath}" 2>> "${stderrLogPath}"`;
      
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
      const processRecord = this.addProcessRecord(appId, child.pid!, port);

      // Handle process errors and exits (minimal event handling)
      child.on('error', (error) => {
        console.error(`Dev server error for app ${appId}:`, error);
        this.runningProcesses.delete(appId);
        this.removeProcessRecord(appId);
      });

      child.on('exit', (code) => {
        console.log(`Dev server for app ${appId} exited with code ${code}`);
        this.runningProcesses.delete(appId);
        this.removeProcessRecord(appId);
      });

      // Don't wait for the process to start, let it run in background
      console.log(`Development server started for app ${appId} on http://localhost:${port}`);
      console.log(`  Logs: stdout -> ${stdoutLogPath}, stderr -> ${stderrLogPath}`);

    } catch (error) {
      console.error(`Failed to start dev server for app ${appId}:`, error);
      // Don't fail app creation if dev server fails to start
    }
  }

  /**
   * Stop development server for an app
   */
  private stopDevServer(appId: string): void {
    const process = this.runningProcesses.get(appId);
    if (process) {
      try {
        process.kill('SIGTERM');
        this.runningProcesses.delete(appId);
        this.removeProcessRecord(appId);
        console.log(`Stopped development server for app ${appId}`);
      } catch (error) {
        console.warn(`Failed to stop dev server for app ${appId}:`, error);
      }
    } else {
      // Check if we have a database record but no in-memory process
      const stmt = this.db.prepare('SELECT * FROM running_processes WHERE app_id = ? AND status = ?');
      const record = stmt.get(appId, 'running') as any;
      
      if (record) {
        console.log(`Found orphaned process record for app ${appId}, attempting to kill PID ${record.pid}`);
        this.killProcess(record.pid);
        this.removeProcessRecord(appId);
      }
    }
  }

  /**
   * Get running development servers
   */
  getRunningServers(): Array<{ appId: string; port: number; url: string }> {
    const runningApps: Array<{ appId: string; port: number; url: string }> = [];
    
    // Use database records as the source of truth
    const stmt = this.db.prepare('SELECT * FROM running_processes WHERE status = ?');
    const runningRecords = stmt.all('running') as any[];
    
    for (const record of runningRecords) {
      const app = this.findById(record.app_id);
      if (app) {
        runningApps.push({
          appId: record.app_id,
          port: record.port,
          url: `http://localhost:${record.port}`,
        });
      }
    }
    
    return runningApps;
  }

  /**
   * Stop development server for an app (public method)
   */
  stopServer(appId: string): boolean {
    const process = this.runningProcesses.get(appId);
    if (process) {
      try {
        process.kill('SIGTERM');
        this.runningProcesses.delete(appId);
        console.log(`Stopped development server for app ${appId}`);
        return true;
      } catch (error) {
        console.warn(`Failed to stop dev server for app ${appId}:`, error);
        return false;
      }
    }
    return false;
  }

  /**
   * Stop all running development servers
   */
  stopAllServers(): number {
    let stoppedCount = 0;
    
    for (const [appId, process] of this.runningProcesses) {
      try {
        process.kill('SIGTERM');
        console.log(`Stopped development server for app ${appId}`);
        stoppedCount++;
      } catch (error) {
        console.warn(`Failed to stop dev server for app ${appId}:`, error);
      }
    }
    
    this.runningProcesses.clear();
    return stoppedCount;
  }

  /**
   * Restart development server for an app
   */
  async restartServer(appId: string): Promise<boolean> {
    const app = this.findById(appId);
    if (!app) {
      return false;
    }

    // Stop the current server if running
    this.stopServer(appId);

    // Wait a moment for the process to fully terminate
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Start the server again
    try {
      await this.startDevServer(appId, app.path, app.port);
      return true;
    } catch (error) {
      console.error(`Failed to restart server for app ${appId}:`, error);
      return false;
    }
  }

  /**
   * Count total apps
   */
  count(): number {
    const stmt = this.db.prepare('SELECT COUNT(*) as count FROM apps');
    const result = stmt.get() as { count: number };
    return result.count;
  }

  /**
   * Cleanup all running processes gracefully
   */
  async cleanup(): Promise<void> {
    console.log('🧹 Cleaning up running development servers...');
    
    const runningServers = this.getRunningServers();
    console.log(`Found ${runningServers.length} running server(s) to clean up`);
    
    // Stop all in-memory processes
    for (const [appId, process] of this.runningProcesses) {
      try {
        console.log(`Stopping dev server for app ${appId}...`);
        process.kill('SIGTERM');
      } catch (error) {
        console.warn(`Failed to gracefully stop server for app ${appId}:`, error);
        try {
          process.kill('SIGKILL');
        } catch (killError) {
          console.warn(`Failed to force kill server for app ${appId}:`, killError);
        }
      }
    }
    
    // Clean up database records
    const stmt = this.db.prepare('UPDATE running_processes SET status = ? WHERE status = ?');
    const result = stmt.run('stopped', 'running');
    
    console.log(`✅ Cleanup completed, updated ${result.changes} process record(s)`);
    this.runningProcesses.clear();
  }

  /**
   * Force cleanup of all orphaned processes by scanning the database
   */
  async forceCleanupOrphans(): Promise<number> {
    console.log('🚨 Force cleaning up orphaned processes...');
    
    const stmt = this.db.prepare('SELECT * FROM running_processes WHERE status = ?');
    const runningRecords = stmt.all('running') as any[];
    let cleaned = 0;
    
    for (const record of runningRecords) {
      console.log(`Attempting to kill orphaned process PID ${record.pid} for app ${record.app_id}`);
      await this.killProcess(record.pid);
      this.updateProcessStatus(record.id, 'stopped');
      cleaned++;
    }
    
    console.log(`🧹 Force cleanup completed, cleaned ${cleaned} orphaned process(es)`);
    return cleaned;
  }
}
