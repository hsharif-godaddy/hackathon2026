import { nanoid } from 'nanoid';
import { mkdirSync, rmSync, cpSync, existsSync } from 'fs';
import { spawn } from 'child_process';
import path from 'path';
import { getDatabase } from '../connection.js';
import { GitUtils } from '../../utils/git.js';
import { PortManager } from '../../utils/port-manager.js';
import type { App, CreateAppRequest, UpdateAppRequest, RunningProcess } from '../schema.js';
import net from 'net';
import { error } from 'console';

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
  private async getProcessInfoForPort(port: number): Promise<string | null> {
    return new Promise((resolve) => {
      const { exec } = require('child_process');
      exec(`lsof -i :${port}`, (error: any, stdout: string) => {
        if (error) {
          resolve(null);
        } else {
          resolve(stdout);
        }
      });
    });
  }

  /**
   * Check if a process is still running by PID
   */
  private async isProcessRunning(pid: number): Promise<boolean> {
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
  private async killProcess(pid: number): Promise<void> {
    try {
      process.kill(pid, 'SIGTERM');
      // Wait a bit, then force kill if needed
      setTimeout(async () => {
        try {
          const stillRunning = await this.isProcessRunning(pid);
          if (stillRunning) {
            console.log(`🔨 Force killing process ${pid} with SIGKILL`);
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
  private updateProcessStatus(processId: string, status: string): void {
    const stmt = this.db.prepare('UPDATE running_processes SET status = ? WHERE id = ?');
    stmt.run(status, processId);
  }

  /**
   * Add process to database tracking
   */
  private addProcessRecord(appId: string, pid: number, port: number): string {
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
    
    // Assign an available port for the frontend (smart script will handle backend port discovery)
    const port = await this.portManager.getNextAvailablePort();
    
    // Double-check the port is actually free
    const isPortFree = !(await this.isPortOccupied(port));
    if (!isPortFree) {
      throw new Error(`Port ${port} is already in use`);
    }
    
    // Get template directory from environment variable, default to app-templates/v3
    const templateDir = process.env.APP_TEMPLATE_DIR || 'app-templates/v3';
    const templatePath = path.isAbsolute(templateDir) 
      ? templateDir 
      : path.join(process.cwd(), '..', templateDir);
    
    // Create the directory for the app
    try {
      mkdirSync(appPath, { recursive: true });
      console.log(`📁 Created app directory: ${appPath}`);
      
      // Copy template contents if template directory exists
      if (existsSync(templatePath)) {
        try {
          // Copy all contents from template directory to app directory, excluding unnecessary files
          cpSync(templatePath, appPath, { 
            recursive: true,
            filter: (src, dest) => {
              const relativePath = path.relative(templatePath, src);
              
              // Skip node_modules and other build/cache directories
              if (relativePath.includes('node_modules') ||
                  relativePath.includes('dist') ||
                  relativePath.includes('.next') ||
                  relativePath.includes('.vite') ||
                  relativePath.includes('.cache') ||
                  relativePath.includes('coverage') ||
                  relativePath.includes('logs') ||
                  relativePath.endsWith('.log') ||
                  relativePath.includes('.dev-ports.json')) {
                return false;
              }
              
              return true;
            }
          });
          console.log(`📋 Copied template from ${templatePath} to ${appPath} (excluding node_modules and build artifacts)`);
        } catch (templateError) {
          console.warn(`Failed to copy template from ${templatePath}:`, templateError);
          // Don't fail app creation if template copying fails
        }
      } else {
        console.warn(`Template directory not found: ${templatePath}`);
      }

      // Save app to database BEFORE running setup (reserves the port)
      // Use a transaction to ensure atomicity
      this.db.exec('BEGIN TRANSACTION');
      
      try {
        const stmt = this.db.prepare(`
          INSERT INTO apps (id, name, path, port, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `);
        stmt.run(id, data.name, appPath, port, now, now);
        
        // Store additional port information in a separate table if needed
        // For now, we'll store backend port in environment during dev server start
        
        // Verify the app record was inserted successfully before proceeding
        const verifyStmt = this.db.prepare('SELECT id FROM apps WHERE id = ?');
        const appExists = verifyStmt.get(id);
        if (!appExists) {
          throw new Error(`Failed to insert app record for ${id}`);
        }
        
        // Commit the transaction
        this.db.exec('COMMIT');       
      } catch (error) {
        // Rollback on error
        this.db.exec('ROLLBACK');
        throw error;
      }

      // Run project setup (installs dependencies and configures registry)
      await this.runProjectSetup(appPath);

      // Initialize Git repository after template copy
      await this.initializeGitRepository(appPath, data.name);

      // Wait a moment to ensure all setup is complete
      console.log(`⏳ Waiting 2 seconds before starting dev server...`);
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Start the development servers using the smart script
      try {
        await this.startDevServer(id, appPath, port);
      } catch (devServerError) {
        console.error(`Failed to start dev servers for app ${id}:`, devServerError);
        // Don't fail app creation if dev servers fail to start
        // The app is still created successfully
      }

    } catch (error) {
      console.error(`Failed to create directory for app ${id}:`, error);
      // Clean up database entry if app creation fails
      try {
        // Ensure we're not in a transaction when cleaning up
        this.db.exec('ROLLBACK');
        const cleanupStmt = this.db.prepare('DELETE FROM apps WHERE id = ?');
        cleanupStmt.run(id);
      } catch (cleanupError) {
        console.warn(`Failed to cleanup database entry for app %s: %s`, id, cleanupError);
      }
      throw new Error(`Failed to create app directory: ${error}`);
    }
    
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
   * Run project setup script (configures registry and installs dependencies)
   */
  private async runProjectSetup(appPath: string): Promise<void> {
    try {
      // Check if package.json exists
      const packageJsonPath = path.join(appPath, 'package.json');
      if (!existsSync(packageJsonPath)) {
        console.warn(`No package.json found at ${packageJsonPath}, skipping project setup`);
        return;
      }

      // Check if setup script exists
      const setupScriptPath = path.join(appPath, 'setup-project.sh');
      if (existsSync(setupScriptPath)) {
        console.log(`Running project setup script for app at ${appPath}...`);
        
        // Run the setup script
        const setupProcess = spawn('bash', [setupScriptPath], {
          cwd: appPath,
          stdio: 'pipe'
        });

        // Capture output for logging
        let stdout = '';
        let stderr = '';

        setupProcess.stdout?.on('data', (data) => {
          stdout += data.toString();
        });

        setupProcess.stderr?.on('data', (data) => {
          stderr += data.toString();
        });

        // Wait for setup to complete
        await new Promise<void>((resolve, reject) => {
          setupProcess.on('close', (code) => {
            if (code === 0) {
              console.log(`✅ Project setup completed successfully for ${appPath}`);
              if (stdout) console.log(`Setup output:`, stdout);
              resolve();
            } else {
              console.error(`❌ Project setup failed with code ${code} for ${appPath}`);
              if (stderr) console.error(`Setup stderr:`, stderr);
              if (stdout) console.error(`Setup stdout:`, stdout);
              reject(new Error(`Project setup failed with code ${code}`));
            }
          });

          setupProcess.on('error', (error) => {
            console.error(`❌ Project setup process error for %s: %s`, appPath, error);
            reject(error);
          });
        });

      } else {
        // Fallback to manual dependency installation
        console.log(`No setup script found, falling back to manual installation for ${appPath}...`);
        await this.installDependenciesManual(appPath);
      }

    } catch (error) {
      console.error(`Failed to run project setup for %s: %s`, appPath, error);
      throw new Error(`Failed to run project setup: ${error}`);
    }
  }

  /**
   * Manual dependency installation (fallback when setup script is not available)
   */
  private async installDependenciesManual(appPath: string): Promise<void> {
    try {
      // Check if pnpm is available, fallback to npm
      const hasPnpm = await this.isCommandAvailable('pnpm');
      const packageManager = hasPnpm ? 'pnpm' : 'npm';
      
      console.log(`Installing dependencies with ${packageManager} for app at ${appPath}...`);

      // Configure registry first
      const configArgs = packageManager === 'pnpm' 
        ? ['config', 'set', 'registry', 'https://registry.npmjs.org/', '--location', 'project']
        : ['config', 'set', 'registry', 'https://registry.npmjs.org/', '--location', 'project'];

      const configProcess = spawn(packageManager, configArgs, {
        cwd: appPath,
        stdio: 'pipe'
      });

      await new Promise<void>((resolve, reject) => {
        configProcess.on('close', (code) => {
          if (code === 0) {
            console.log(`✅ Registry configured for ${packageManager}`);
            resolve();
          } else {
            console.warn(`⚠️  Failed to configure registry, continuing anyway...`);
            resolve(); // Don't fail on registry config
          }
        });

        configProcess.on('error', (error) => {
          console.warn(`⚠️  Registry config error, continuing anyway:`, error);
          resolve(); // Don't fail on registry config
        });
      });

      // Run package manager install with explicit registry
      const installArgs = packageManager === 'pnpm'
        ? ['install', '--registry', 'https://registry.npmjs.org/']
        : ['install', '--registry', 'https://registry.npmjs.org/'];

      const installProcess = spawn(packageManager, installArgs, {
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
          console.error(`❌ ${packageManager} install process error for %s: %s`, appPath, error);
          reject(error);
        });
      });

    } catch (error) {
      console.error(`Failed to install dependencies manually for %s: %s`, appPath, error);
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
   * Detect if app is using v3 template by checking for specific files
   */
  private isV3Template(appPath: string): boolean {
    const v3Indicators = [
      path.join(appPath, 'src', 'frontend'),
      path.join(appPath, 'src', 'backend'),
      path.join(appPath, 'vite.config.ts'),
    ];
    
    return v3Indicators.some(indicator => existsSync(indicator));
  }

  /**
   * Start development servers for an app using the smart script
   */
  private async startDevServer(appId: string, appPath: string, preferredPort: number): Promise<void> {
    try {
      console.log(`Starting development servers for app ${appId} with preferred frontend port ${preferredPort}...`);
      
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
      
      console.log(`🚀 Starting ${packageManager} dev servers for app ${appId} with preferred port ${preferredPort}`);
      console.log(`📝 Logs will be written to:`);
      console.log(`   stdout: ${stdoutLogPath}`);
      console.log(`   stderr: ${stderrLogPath}`);
      
      // Always use the smart dev script for consistent port management
      const command = `${packageManager} run dev >> "${stdoutLogPath}" 2>> "${stderrLogPath}"`;
      
      console.log(`🔧 Running command: ${command}`);
      console.log(`📁 Working directory: ${appPath}`);
      
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
      
      console.log(`📝 Adding process record for app ${appId} with PID ${child.pid} on preferred port ${preferredPort}`);
      
      // Double-check app exists right before process record insertion
      const finalAppCheck = this.db.prepare('SELECT id FROM apps WHERE id = ?').get(appId);
      if (!finalAppCheck) {
        throw new Error(`App ${appId} no longer exists in database before process record insertion`);
      }
      console.log(`🔍 Final verification: App ${appId} exists in database`);
      
      const processRecord = this.addProcessRecord(appId, child.pid!, preferredPort);
      console.log(`✅ Process record added with ID: ${processRecord}`);

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
      console.log(`Development servers started for app ${appId}:`);
      console.log(`  Smart script will allocate actual ports (preferred frontend: ${preferredPort})`);
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
  getRunningServers(): Array<{ appId: string; port: number; url: string; isV3?: boolean; backendPort?: number }> {
    const runningApps: Array<{ appId: string; port: number; url: string; isV3?: boolean; backendPort?: number }> = [];
    
    // Use database records as the source of truth
    const stmt = this.db.prepare('SELECT * FROM running_processes WHERE status = ?');
    const runningRecords = stmt.all('running') as any[];
    
    for (const record of runningRecords) {
      const app = this.findById(record.app_id);
      if (app) {
        const isV3 = this.isV3Template(app.path);
        const backendPort = isV3 ? (record.port === 5173 ? 3000 : record.port + 1000) : undefined;
        
        runningApps.push({
          appId: record.app_id,
          port: record.port,
          url: `http://localhost:${record.port}`,
          isV3,
          backendPort,
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
        console.log(`🛑 Stopping development server for app ${appId}...`);
        process.kill('SIGTERM');
        
        // Wait a bit for graceful shutdown, then force kill if needed
        setTimeout(() => {
          try {
            if (!process.killed) {
              console.log(`🔨 Force killing development server for app ${appId}...`);
              process.kill('SIGKILL');
            }
          } catch (error) {
            // Process might already be dead
          }
        }, 2000);
        
        this.runningProcesses.delete(appId);
        // Update database record to mark as stopped
        this.removeProcessRecord(appId);
        console.log(`✅ Stopped development server for app ${appId}`);
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
        // Update database record to mark as stopped
        this.removeProcessRecord(appId);
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
   * Check if a server is currently running for an app
   */
  private isServerRunning(appId: string): boolean {
    const stmt = this.db.prepare('SELECT status FROM running_processes WHERE app_id = ? AND status = ?');
    const result = stmt.get(appId, 'running') as { status: string } | undefined;
    return !!result;
  }

  /**
   * Restart development server for an app
   */
  async restartServer(appId: string): Promise<boolean> {
    const app = this.findById(appId);
    if (!app) {
      return false;
    }

    console.log(`🔄 Restarting development server for app ${appId}...`);

    // Stop the current server if running
    const wasRunning = this.stopServer(appId);

    if (wasRunning) {
      // Wait longer for the process to fully terminate and port to be released
      console.log(`⏳ Waiting for process to terminate...`);
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Double-check that the port is actually free
      const isPortFree = !(await this.isPortOccupied(app.port));
      if (!isPortFree) {
        console.warn(`⚠️ Port ${app.port} is still occupied, waiting a bit more...`);
        
        // Get debug info about what's using the port
        const portInfo = await this.getProcessInfoForPort(app.port);
        if (portInfo) {
          console.log(`🔍 Port ${app.port} is being used by:`, portInfo);
        }
        
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Final check
        const finalPortCheck = !(await this.isPortOccupied(app.port));
        if (!finalPortCheck) {
          console.warn(`⚠️ Port still occupied, attempting force cleanup...`);
          await this.forceCleanupApp(appId);
          await new Promise(resolve => setTimeout(resolve, 1000));
          
          // One more port check after force cleanup
          const finalCheckAfterCleanup = !(await this.isPortOccupied(app.port));
          if (!finalCheckAfterCleanup) {
            console.error(`❌ Port ${app.port} is still occupied after force cleanup`);
            
            // Get final debug info
            const finalPortInfo = await this.getProcessInfoForPort(app.port);
            if (finalPortInfo) {
              console.log(`🔍 Final port ${app.port} usage:`, finalPortInfo);
            }
            
            throw new Error(`Port ${app.port} is still occupied after force cleanup`);
          }
        }
      }
      
      // Also verify the database record was updated
      if (this.isServerRunning(appId)) {
        console.warn(`⚠️ Database still shows server as running, forcing cleanup...`);
        this.removeProcessRecord(appId);
      }
    }

    // Start the server again using the smart script
    try {
      await this.startDevServer(appId, app.path, app.port);
      console.log(`✅ Successfully restarted development servers for app ${appId}`);
      return true;
    } catch (error) {
      console.error(`Failed to restart servers for app ${appId}:`, error);
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
      const isRunning = await this.isProcessRunning(record.pid);
      if (isRunning) {
        console.log(`Attempting to kill orphaned process PID ${record.pid} for app ${record.app_id}`);
        await this.killProcess(record.pid);
      } else {
        console.log(`Orphaned process PID ${record.pid} for app ${record.app_id} is already dead`);
      }
      this.updateProcessStatus(record.id, 'stopped');
      cleaned++;
    }
    
    console.log(`🧹 Force cleanup completed, cleaned ${cleaned} orphaned process(es)`);
    return cleaned;
  }

  /**
   * Force cleanup processes for a specific app
   */
  async forceCleanupApp(appId: string): Promise<boolean> {
    console.log(`🚨 Force cleaning up processes for app ${appId}...`);
    
    const stmt = this.db.prepare('SELECT * FROM running_processes WHERE app_id = ? AND status = ?');
    const runningRecords = stmt.all(appId, 'running') as any[];
    
    if (runningRecords.length === 0) {
      console.log(`No running processes found for app ${appId}`);
      return true;
    }
    
    for (const record of runningRecords) {
      const isRunning = await this.isProcessRunning(record.pid);
      if (isRunning) {
        console.log(`Force killing process PID ${record.pid} for app ${appId}`);
        await this.killProcess(record.pid);
      } else {
        console.log(`Process PID ${record.pid} for app ${appId} is already dead`);
      }
      this.updateProcessStatus(record.id, 'stopped');
    }
    
    // Also remove from in-memory map if present
    this.runningProcesses.delete(appId);
    
    console.log(`✅ Force cleanup completed for app ${appId}`);
    return true;
  }
}
