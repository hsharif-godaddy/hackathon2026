import { nanoid } from 'nanoid';
import { mkdirSync, rmSync, cpSync, existsSync } from 'fs';
import { spawn } from 'child_process';
import path from 'path';
import { getDatabase } from '../connection.js';
import { GitUtils } from '../../utils/git.js';
import { PortManager } from '../../utils/port-manager.js';
import { extractTemplateVersion } from '../../utils/template-version.js';
import type { App, CreateAppRequest, UpdateAppRequest, RunningProcess } from '../schema.js';
import net from 'net';
// Adapter imports
import { getAppAdapter, isDockerMode } from '../../adapters/index.js';
import type { IAppAdapter } from '../../adapters/index.js';
import { getNameSuggestionService } from '../../services/name-suggestion.js';
import { Logger, log, createTimer } from '../../logging/index.js';
import { getErrorMessage } from '../../utils/error.js';
import {
  appRepositoryEvents,
  appProcessEvents, 
  appCreationEvents,
  appNameEvents,
  appTemplateEvents,
  appDirectoryEvents,
  appSetupEvents,
  appServerEvents,
  appLifecycleEvents,
  appProcessManagementEvents,
  appCleanupEvents
} from '../../logging/events/index.js';

export class AppRepository {
  private db = getDatabase();
  private gitUtils = new GitUtils();
  private portManager = new PortManager();
  private runningProcesses = new Map<string, any>(); // Store running dev servers
  private deploymentAdapter: IAppAdapter | null = null; // Adapter for deployment operations
  private initialized = false;
  private logger = Logger.create({ service: 'app-repository' });

  /**
   * Initialize the repository and recover orphaned processes
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    
    const adapterType = isDockerMode() ? 'Docker' : 'Local';
    appRepositoryEvents.initBegin(this.logger, {
      adapterType,
      duration: 0
    });
    
    try {
      // Initialize deployment adapter
      this.deploymentAdapter = await getAppAdapter();
      
      // Keep existing local process recovery for backward compatibility
      await this.recoverOrphanedProcesses();
      
      this.initialized = true;
      appRepositoryEvents.initSuccess(this.logger, {
        adapterType,
        duration: Date.now() - (performance.now() || Date.now()),
        startTime: new Date().toISOString()
      });
    } catch (error) {
      appRepositoryEvents.initFailure(this.logger, error as Error, {
        adapterType
      });
      throw error;
    }
  }

  /**
   * Recover orphaned processes that may be running from previous sessions
   */
  private async recoverOrphanedProcesses(): Promise<void> {
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
  private async killProcess(pid: number, appId?: string): Promise<void> {
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
    // Ensure this repository is initialized before creating apps
    await this.initialize();
    
    const id = nanoid(12); // 12 characters, websafe, URL-friendly
    const now = new Date().toISOString();
    
    // Create a logger for this specific app creation
    const appLogger = this.logger.child({ appId: id, appName: data.name });
    
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
    
    // Try to get a better app name using AI if an initial prompt is provided
    let appName = data.name;
    if (data.initialPrompt) {
      try {
        const nameSuggestionService = getNameSuggestionService();
        const suggestedName = await nameSuggestionService.suggestName(data.initialPrompt);
        
        if (suggestedName) {
          appNameEvents.suggestSuccess(this.logger, {
            appId: id,
            originalName: data.name,
            suggestedName,
            hasPrompt: true
          });
          appName = suggestedName;
        } else {
          appNameEvents.suggestSuccess(this.logger, {
            appId: id,
            originalName: data.name,
            hasPrompt: true
          });
        }
      } catch (nameError) {
        appNameEvents.suggestFailure(this.logger, nameError as Error, {
          appId: id,
          originalName: data.name
        });
        // Continue with the original name if name suggestion fails
      }
    }
    
    // Get template directory from environment variable, default to app-templates/v3
    const templateDir = process.env.APP_TEMPLATE_DIR || 'app-templates/v3';
    
    // Calculate template path - ensure we're looking in the correct project directory
    let templatePath: string;
    if (path.isAbsolute(templateDir)) {
      templatePath = templateDir;
    } else {
      const currentDir = process.cwd();
      // Template resolving will be logged after template version is determined
      
      // Handle relative paths properly
      if (templateDir.startsWith('../')) {
        // If template dir starts with ../, resolve it relative to current directory
        templatePath = path.resolve(currentDir, templateDir);
      } else {
        // Otherwise, resolve it relative to project root (one level up from agents)
        const projectRoot = path.dirname(currentDir);
        templatePath = path.join(projectRoot, templateDir);
      }
    }
    
    // Extract template version from template directory
    const templateVersion = extractTemplateVersion(templateDir);
    
    appTemplateEvents.resolveSuccess(this.logger, {
      appId: id,
      templateVersion,
      operation: 'resolve' as const,
      path: templatePath,
      templatePath
    });
    
    // Create the directory for the app
    try {
      mkdirSync(appPath, { recursive: true });
      appDirectoryEvents.createSuccess(appLogger, {
        appId: id,
        path: appPath,
        permissions: '0755',
        parentExists: true
      });
      
      // Copy template contents - THIS IS CRITICAL FOR PROPER APP CREATION
      if (existsSync(templatePath)) {
        appTemplateEvents.copyBegin(appLogger, {
          appId: id,
          templateVersion,
          operation: 'copy' as const,
          path: appPath,
          templatePath
        });
        
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
          
          // Validate that critical template files were copied successfully
          const templatePackageJson = path.join(appPath, 'package.json');
          const templateSrcDir = path.join(appPath, 'src');
          
          if (!existsSync(templatePackageJson)) {
            throw new Error(`Template package.json was not copied to ${templatePackageJson}`);
          }
          
          if (!existsSync(templateSrcDir)) {
            throw new Error(`Template src directory was not copied to ${templateSrcDir}`);
          }
          
          // Additional validation for v3 template structure
          if (templateVersion === 'v3') {
            const frontendDir = path.join(appPath, 'src', 'frontend');
            const backendDir = path.join(appPath, 'src', 'backend');
            
            if (!existsSync(frontendDir)) {
              throw new Error(`V3 template frontend directory was not copied to ${frontendDir}`);
            }
            
            if (!existsSync(backendDir)) {
              throw new Error(`V3 template backend directory was not copied to ${backendDir}`);
            }
          }
          
          appTemplateEvents.copySuccess(appLogger, {
            appId: id,
            templateVersion,
            operation: 'copy' as const,
            path: appPath,
            templatePath
          });
          
        } catch (templateError) {
          appTemplateEvents.copyFailure(appLogger, templateError as Error, {
            appId: id,
            templateVersion,
            operation: 'copy' as const,
            path: appPath,
            templatePath
          });
          
          // Clean up the partially created app directory
          try {
            rmSync(appPath, { recursive: true, force: true });
            appDirectoryEvents.cleanupSuccess(appLogger, {
              appId: id,
              path: appPath,
              permissions: '',
              parentExists: false
            });
          } catch (cleanupError) {
            appDirectoryEvents.createFailure(appLogger, cleanupError as Error, {
              appId: id,
              path: appPath
            });
          }
          
          throw new Error(`Template copying failed: ${templateError instanceof Error ? templateError.message : String(templateError)}`);
        }
      } else {
        const error = `Template directory not found: ${templatePath}`;
        // Template not found is logged as part of the error throw below
        
        // Clean up the app directory
        try {
          rmSync(appPath, { recursive: true, force: true });
        } catch (cleanupError) {
          appDirectoryEvents.createFailure(appLogger, cleanupError as Error, {
            appId: id,
            path: appPath
          });
        }
        
        throw new Error(error);
      }

      // Save app to database BEFORE running setup (reserves the port)
      // Use a transaction to ensure atomicity
      this.db.exec('BEGIN TRANSACTION');
      
      try {
        const stmt = this.db.prepare(`
          INSERT INTO apps (id, name, path, port, initial_prompt, template_version, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        stmt.run(id, appName, appPath, port, data.initialPrompt || null, templateVersion, 'creating', now, now);
        
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

      // Log app creation begin and success
      appCreationEvents.begin(appLogger, {
        appId: id,
        name: appName,
        templateVersion,
        baseDir,
        port,
        ...(data.initialPrompt && { initialPrompt: data.initialPrompt })
      });

      // Return the app immediately after DB insert
      const app = this.findById(id)!;
      
      // Run setup asynchronously in the background
      this.runAppSetupAsync(id, appPath, port, data.name);
      
      appCreationEvents.success(appLogger, {
        appId: id,
        name: appName,
        templateVersion,
        baseDir,
        port,
        duration: 0,
        ...(data.initialPrompt && { initialPrompt: data.initialPrompt })
      });
      
      return app;
      
    } catch (error) {
      appCreationEvents.failure(appLogger, error as Error, {
        appId: id,
        name: appName,
        templateVersion,
        baseDir,
        port
      });
      
      // Clean up database entry if app creation fails
      try {
        // Only attempt rollback if we actually started a transaction
        // Template copying failures happen before transaction starts
        try {
          this.db.exec('ROLLBACK');
          // Transaction rollback logged as part of cleanup
        } catch (rollbackError: any) {
          if (rollbackError.code === 'SQLITE_ERROR' && rollbackError.message?.includes('no transaction is active')) {
            // This is fine - no transaction was started yet
            // No active transaction - this is expected
          } else {
            log.error(appLogger, 'app.transaction.rollback.failed', rollbackError);
          }
        }
        
        // Check if app was actually inserted into database before trying to delete
        const existingApp = this.findById(id);
        if (existingApp) {
          const cleanupStmt = this.db.prepare('DELETE FROM apps WHERE id = ?');
          cleanupStmt.run(id);
          // Database cleanup successful
        } else {
          // No database entry to clean up
        }
        
      } catch (cleanupError) {
        log.error(appLogger, 'app.database.cleanup.failed', cleanupError);
      }
      
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to create app directory: ${errorMessage}`);
    }
  }

  /**
   * Run app setup asynchronously after database insert
   */
  private async runAppSetupAsync(id: string, appPath: string, port: number, appName: string): Promise<void> {
    const setupLogger = this.logger.child({ appId: id, appName, port });
    
    try {
      appSetupEvents.initBegin(setupLogger, {
        appId: id
      });
      
      // Run project setup (installs dependencies and configures registry)
      await this.runProjectSetup(id, appPath);

      // Initialize Git repository after template copy
      await this.initializeGitRepository(id, appPath, appName);

      // Wait a moment to ensure all setup is complete
      appSetupEvents.initProgress(setupLogger, {
        appId: id,
        operation: 'setup' as const,
        startTime: new Date().toISOString(),
        duration: 0
      });
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Start the development servers using the adapter
      try {
        if (this.deploymentAdapter && isDockerMode()) {
          await this.deploymentAdapter.startApp(id);
        } else {
          appServerEvents.startBegin(setupLogger, {
            appId: id,
            port
          });
          await this.startDevServer(id, appPath, port);
          appServerEvents.startSuccess(setupLogger, {
            appId: id,
            processId: 0,
            port,
            protocol: 'http' as const,
            startTime: new Date().toISOString(),
            duration: 0
          });
        }
      } catch (devServerError) {
        appServerEvents.startFailure(setupLogger, devServerError as Error, {
          appId: id,
          port
        });
        // Don't fail app creation if dev servers fail to start
      }
      
      // Update status to 'created' on success
      this.updateStatus(id, 'created');
      appSetupEvents.initSuccess(setupLogger, {
        appId: id,
        operation: 'setup' as const,
        startTime: new Date().toISOString(),
        duration: Date.now() - performance.now()
      });
      appLifecycleEvents.ready(setupLogger, {
        appId: id,
        newStatus: 'created',
        duration: 0,
        startTime: new Date().toISOString()
      });
      
    } catch (error) {
      // Update status to 'error' (error already logged in runProjectSetup with details)
      this.updateStatus(id, 'error');
    }
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
  private async runProjectSetup(appId: string, appPath: string): Promise<void> {
    try {
      // Check if package.json exists
      const packageJsonPath = path.join(appPath, 'package.json');
      if (!existsSync(packageJsonPath)) {
        this.logger.warn('app.setup.no_package_json', {
          appId,
          path: packageJsonPath
        });
        return;
      }

      // Check if setup script exists
      const setupScriptPath = path.join(appPath, 'setup-project.sh');
      if (existsSync(setupScriptPath)) {
        appSetupEvents.initBegin(this.logger, {
          appId
        });
        
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
              appSetupEvents.initSuccess(this.logger, {
                appId,
                operation: 'setup',
                startTime: new Date().toISOString(),
                duration: 0
              });
              resolve();
            } else {
              const error = new Error(`Project setup failed with code ${code}`);
              appSetupEvents.initFailure(this.logger, error, {
                appId,
                operation: 'setup',
                exitCode: code ?? undefined,
                stdout: stdout.trim(),
                stderr: stderr.trim(),
                command: 'bash setup-project.sh'
              });
              reject(new Error(`Project setup failed with code ${code}`));
            }
          });

          setupProcess.on('error', (error) => {
            appSetupEvents.initFailure(this.logger, error, {
              appId,
              operation: 'setup',
              stdout: stdout.trim(),
              stderr: stderr.trim(),
              command: 'bash setup-project.sh'
            });
            reject(error);
          });
        });

      } else {
        // Fallback to manual dependency installation
        this.logger.info('app.setup.fallback_manual', { appId, path: appPath });
        await this.installDependenciesManual(appId, appPath);
      }

    } catch (error) {
      throw new Error(`Failed to run project setup: ${getErrorMessage(error)}`);
    }
  }

  /**
   * Manual dependency installation (fallback when setup script is not available)
   */
  private async installDependenciesManual(appId: string, appPath: string): Promise<void> {
    try {
      // Check if pnpm is available, fallback to npm
      const hasPnpm = await this.isCommandAvailable('pnpm');
      const packageManager = hasPnpm ? 'pnpm' : 'npm';
      
      appSetupEvents.initProgress(this.logger, {
        appId,
        operation: 'install',
        startTime: new Date().toISOString(),
        duration: 0
      });

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
            this.logger.debug('app.setup.registry_configured', {
              appId,
              packageManager
            });
            resolve();
          } else {
            this.logger.warn('app.setup.registry_failed', {
              appId,
              packageManager
            });
            resolve(); // Don't fail on registry config
          }
        });

        configProcess.on('error', (error) => {
          this.logger.warn('app.setup.registry_error', {
            appId,
            packageManager,
            error: error.message
          });
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
            appSetupEvents.initSuccess(this.logger, {
              appId,
              operation: 'install',
              startTime: new Date().toISOString(),
              duration: 0
            });
            resolve();
          } else {
            const installError = new Error(`${packageManager} install failed with code ${code}`);
            appSetupEvents.initFailure(this.logger, installError, {
              appId,
              operation: 'install'
            });
            reject(new Error(`${packageManager} install failed with code ${code}`));
          }
        });

        installProcess.on('error', (error) => {
          appSetupEvents.initFailure(this.logger, error, {
            appId,
            operation: 'install'
          });
          reject(error);
        });
      });

    } catch (error) {
      appSetupEvents.initFailure(this.logger, new Error(`Failed to install dependencies: ${error}`), {
        appId,
        operation: 'install'
      });
      throw new Error(`Failed to install dependencies: ${error}`);
    }
  }

  /**
   * Initialize Git repository for a new app
   */
  private async initializeGitRepository(appId: string, appPath: string, appName: string): Promise<void> {
    try {
      this.logger.info('app.git.init.begin', {
        appId,
        path: appPath
      });
      
      // Initialize the Git repository
      const initResult = await this.gitUtils.initRepository(appPath);
      if (!initResult.success) {
        this.logger.warn('app.git.init.failed', {
          appId,
          error: initResult.stderr
        });
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
        this.logger.warn('app.git.config.failed', {
          appId,
          error: getErrorMessage(configError)
        });
        // Continue anyway
      }

      // Create initial commit with all template files
      try {
        const commitResult = await this.gitUtils.createInitialCommit(
          appPath,
          `Initial commit for ${appName}\n\nGenerated by Airo AI Builder with template files.`
        );
        
        if (commitResult.success) {
          this.logger.info('app.git.commit.success', {
            appId,
            name: appName
          });
        } else {
          this.logger.warn('app.git.commit.failed', {
            appId,
            error: commitResult.stderr
          });
        }
      } catch (commitError) {
        this.logger.warn('app.git.commit.error', {
          appId,
          error: getErrorMessage(commitError)
        });
        // Continue anyway - the repo is still initialized
      }

    } catch (error) {
      this.logger.warn('app.git.init.error', {
        appId,
        path: appPath,
        error: getErrorMessage(error)
      });
      // Don't fail app creation if Git setup fails
    }
  }

  /**
   * Find an app by ID
   */
  findById(id: string): App | null {
    const stmt = this.db.prepare(`
      SELECT id, name, path, port, initial_prompt, status, created_at, updated_at
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
      initialPrompt: row.initial_prompt,
      status: row.status,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  /**
   * List all apps with optional pagination
   */
  findAll(limit = 50, offset = 0): App[] {
    const stmt = this.db.prepare(`
      SELECT id, name, path, port, initial_prompt, status, created_at, updated_at
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
      initialPrompt: row.initial_prompt,
      status: row.status,
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
   * Update app status
   */
  updateStatus(id: string, status: 'creating' | 'created' | 'error'): App | null {
    const existing = this.findById(id);
    if (!existing) return null;

    const stmt = this.db.prepare(`
      UPDATE apps 
      SET status = ?, updated_at = ?
      WHERE id = ?
    `);
    
    stmt.run(status, new Date().toISOString(), id);
    
    return this.findById(id)!;
  }

  /**
   * Delete an app and its directory
   */
  async delete(id: string): Promise<boolean> {
    // Ensure this repository is initialized
    await this.initialize();

    // Get the app first to retrieve its path
    const app = this.findById(id);
    if (!app) return false;

    // Stop the development server if running
    await this.stopServer(id);

    // Remove deployment artifacts (containers, images, etc.)
    if (this.deploymentAdapter) {
      try {
        await this.deploymentAdapter.removeApp(id);
        appCleanupEvents.directorySuccess(this.logger, {
          appId: id,
          operation: 'docker',
          itemsCleaned: 1
        });
      } catch (error) {
        this.logger.warn('app.cleanup.docker.failed', {
          appId: id,
          error: getErrorMessage(error)
        });
        // Don't fail the delete operation if artifact cleanup fails
      }
    }

    const stmt = this.db.prepare('DELETE FROM apps WHERE id = ?');
    const result = stmt.run(id);
    
    if (result.changes > 0) {
      // Try to remove the app directory
      try {
        rmSync(app.path, { recursive: true, force: true });
        appCleanupEvents.directorySuccess(this.logger, {
          appId: id,
          operation: 'directory',
          itemsCleaned: 1
        });
      } catch (error) {
        this.logger.warn('app.cleanup.directory.failed', {
          appId: id,
          path: app.path,
          error: getErrorMessage(error)
        });
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
   * Check if an app is using V3 template by app ID
   */
  private isV3TemplateById(appId: string): boolean {
    const app = this.findById(appId);
    if (!app) {
      return false;
    }
    return this.isV3Template(app.path);
  }

  /**
   * Start development servers for an app using the smart script, for local setup
   */
  private async startDevServer(appId: string, appPath: string, preferredPort: number): Promise<void> {
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
  private stopDevServer(appId: string): void {
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
        console.log(`Found orphaned process record for app ${appId}, attempting to kill PID ${record.pid}`);
        this.killProcess(record.pid);
        this.removeProcessRecord(appId);
      }
    }
  }

  /**
   * Get running development servers
   */
  async getRunningServers(): Promise<Array<{ appId: string; port: number; url: string; isV3?: boolean; backendPort?: number }>> {
    // Ensure this repository is initialized
    await this.initialize();

    // If in Docker mode, use the adapter
    if (this.deploymentAdapter && isDockerMode()) {
      try {
        const dockerServers = await this.deploymentAdapter.getRunningServers();
        return dockerServers.map(server => {
          const isV3 = this.isV3TemplateById(server.appId);
          const result: { appId: string; port: number; url: string; isV3?: boolean; backendPort?: number } = {
            appId: server.appId,
            port: server.port,
            url: server.url,
          };
          
          if (isV3) {
            result.isV3 = true;
            result.backendPort = 3000;
          }
          
          return result;
        });
      } catch (error) {
        console.error('❌ Failed to get running servers via adapter:', error);
        return [];
      }
    }

    // Local mode - use existing logic
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
  async stopServer(appId: string): Promise<boolean> {
    // Ensure this repository is initialized
    await this.initialize();
    
    // Use adapter if in Docker mode
    if (this.deploymentAdapter && isDockerMode()) {
      try {
        console.log(`🐳 Stopping Docker container for app ${appId}...`);
        return await this.deploymentAdapter.stopApp(appId);
      } catch (error) {
        console.error(`Failed to stop Docker container for app ${appId}:`, error);
        return false;
      }
    }

    // Local process management
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
  async stopAllServers(): Promise<number> {
    // Ensure this repository is initialized
    await this.initialize();

    // If in Docker mode, use the adapter
    if (this.deploymentAdapter && isDockerMode()) {
      try {
        return await this.deploymentAdapter.stopAllServers();
      } catch (error) {
        console.error('❌ Failed to stop all servers via adapter:', error);
        return 0;
      }
    }

    // Local mode - use existing logic
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
    // Ensure this repository is initialized
    await this.initialize();
    
    const app = this.findById(appId);
    if (!app) {
      return false;
    }

    console.log(`🔄 Restarting development server for app ${appId}...`);

    // Use adapter if in Docker mode
    if (this.deploymentAdapter && isDockerMode()) {
      try {
        console.log(`🐳 Restarting Docker container for app ${appId}...`);
        return await this.deploymentAdapter.restartApp(appId);
      } catch (error) {
        console.error(`Failed to restart Docker container for app ${appId}:`, error);
        return false;
      }
    }

    // Local process management - Stop the current server if running
    const wasRunning = await this.stopServer(appId);

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

    // Start the server again using the adapter (for local mode)
    try {
      if (this.deploymentAdapter) {
        await this.deploymentAdapter.startApp(appId);
      } else {
        await this.startDevServer(appId, app.path, app.port);
      }
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
    
    const runningServers = await this.getRunningServers();
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
    // Ensure this repository is initialized
    await this.initialize();

    // If in Docker mode, use the adapter
    if (this.deploymentAdapter && isDockerMode()) {
      try {
        console.log('🐳 Using Docker adapter for orphan cleanup...');
        const result = await this.deploymentAdapter.cleanupOrphans();
        console.log(`✅ Docker orphan cleanup: ${result.message}`);
        return result.cleaned;
      } catch (error) {
        console.error('❌ Failed to cleanup Docker orphans via adapter:', error);
        return 0;
      }
    }

    // Local mode - check running_processes table
    console.log('💻 Force cleaning up orphaned local processes...');
    
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

  /**
   * Adapter-specific methods (Docker container operations)
   * These methods delegate to the deployment adapter when available
   */

  async getAppStatus(appId: string) {
     // Ensure this repository is initialized before creating apps
     await this.initialize();

    if (this.deploymentAdapter && isDockerMode()) {
      return this.deploymentAdapter.getAppStatus(appId);
    }
    // Fallback to local process status
    const processInfo = this.runningProcesses.get(appId);
    if (!processInfo) {
      return { status: 'stopped', message: 'No running process found' };
    }
    return { status: 'running', message: 'Process is running', metadata: { pid: processInfo.pid } };
  }

  async getAppLogs(appId: string): Promise<string[]> {
     // Ensure this repository is initialized before creating apps
     await this.initialize();

    if (this.deploymentAdapter && this.deploymentAdapter.getAppLogs) {
      return this.deploymentAdapter.getAppLogs(appId);
    }
    throw new Error('Log retrieval not supported in current deployment mode');
  }

  async rebuildAppContainer(appId: string): Promise<boolean> {
     // Ensure this repository is initialized before creating apps
     await this.initialize();
     
    if (this.deploymentAdapter && this.deploymentAdapter.rebuildApp) {
      return this.deploymentAdapter.rebuildApp(appId);
    }
    throw new Error('Container rebuilding not supported in current deployment mode');
  }

  isDockerMode(): boolean {
    return isDockerMode();
  }

  getAdapterInfo() {
    const adapterType = isDockerMode() ? 'Docker' : 'Local';
    return {
      type: adapterType,
      isInitialized: this.initialized,
      capabilities: this.deploymentAdapter?.getCapabilities() || null,
      environmentVariable: process.env.DOC_APPS || 'unset (defaults to Local)'
    };
  }
}
