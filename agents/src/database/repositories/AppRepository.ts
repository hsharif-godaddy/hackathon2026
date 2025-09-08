import { nanoid } from 'nanoid';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { spawn } from 'child_process';
import path from 'path';
import { getDatabase } from '../connection.js';
import { GitUtils } from '../../utils/git.js';
import type { App, CreateAppRequest, UpdateAppRequest } from '../schema.js';
import { getNameSuggestionService } from '../../services/name-suggestion.js';
import { Logger, log } from '../../logging/index.js';
import { getErrorMessage } from '../../utils/error.js';
import {
  appRepositoryEvents,
  appCreationEvents,
  appNameEvents,
  appDirectoryEvents,
  appSetupEvents,
  appServerEvents,
  appLifecycleEvents,
  appCleanupEvents
} from '../../logging/events/index.js';

export class AppRepository {
  private db = getDatabase();
  private gitUtils = new GitUtils();
  private logger = Logger.create({ service: 'app-repository' });

  // Dev functionality has been moved to app service - these are now stubs
  private initialized = true;
  private portManager = { getNextAvailablePort: () => Promise.resolve(3000) };
  private processService = {
    isPortOccupied: () => Promise.resolve(false),
    startDevServer: () => Promise.resolve(),
    stopServer: () => Promise.resolve(true),
    stopAllServers: () => Promise.resolve(0),
    isServerRunning: () => false,
    removeProcessRecord: () => {},
    getProcessInfoForPort: () => Promise.resolve(null),
    forceCleanupApp: () => Promise.resolve(true),
    cleanup: () => Promise.resolve(),
    forceCleanupOrphans: () => Promise.resolve(0),
    getAppStatus: () => Promise.resolve({ status: 'created', message: 'App created' })
  };
  private deploymentAdapter: any = null;

  // Helper function for Docker mode detection (stub)
  private isDockerMode(): boolean {
    return process.env.DOC_APPS === 'true';
  }

  /**
   * Initialize the repository (dev functionality moved to app service)
   */
  async initialize(): Promise<void> {
    // Dev environment initialization has been moved to the app service
    // This repository now only handles basic app metadata operations
    this.logger.info('app.repository.init', { 
      message: 'AppRepository initialized - dev functionality moved to app service'
    });
  }

  /**
   * Create a new app using siteId as identifier with predefined customer path
   */
  async create(data: CreateAppRequest): Promise<App> {
    await this.initialize();
    
    if (!data.siteId) {
      throw new Error('Site ID is required for app creation');
    }
    
    const id = data.siteId;
    const now = new Date().toISOString();
    
    // Create a logger for this specific app creation
    const appLogger = this.logger.child({ appId: id, appName: data.name });
    
    const customerDataDir = process.env.APPS_BASE_DIR || '/tmp/apps';
    let appPath = '';
    if (process.env.NOMAD_TASK_NAME) {
      appPath = customerDataDir;
    } else {
      appPath = path.join(customerDataDir, id);
    }

    let appName = data.name.trim();
    let nameSuggested = false;
    
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
          nameSuggested = true;
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
      }
    }
    
    // Assign an available port for the frontend
    const port = await this.portManager.getNextAvailablePort();
    
    // Double-check the port is actually free
    const isPortFree = !(await this.processService.isPortOccupied(port));
    if (!isPortFree) {
      throw new Error(`Port ${port} is already in use`);
    }
    
    try {
      // Save app to database (no directory creation or template copying)
      this.db.exec('BEGIN TRANSACTION');
      
      try {
        const stmt = this.db.prepare(`
          INSERT INTO apps (id, name, path, port, initial_prompt, template_version, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        
        // Use 'v3' as default template version since template is already present
        const templateVersion = 'v3';
        stmt.run(id, appName, appPath, port, data.initialPrompt || null, templateVersion, 'creating', now, now);
        
        // Verify the app record was inserted successfully
        const verifyStmt = this.db.prepare('SELECT id FROM apps WHERE id = ?');
        const appExists = verifyStmt.get(id);
        if (!appExists) {
          throw new Error(`Failed to insert app record for ${id}`);
        }
        
        // Commit the transaction
        this.db.exec('COMMIT');
        
        appLogger.info('App created successfully', {
          appId: id,
          name: appName,
          path: appPath,
          port,
          templateVersion,
          skipDirectoryCreation: true,
          skipTemplateCopy: true
        });
        
      } catch (dbError) {
        this.db.exec('ROLLBACK');
        throw dbError;
      }

      // Log app creation events
      appCreationEvents.begin(appLogger, {
        appId: id,
        name: appName,
        templateVersion: 'v3',
        baseDir: customerDataDir,
        port,
        ...(data.initialPrompt && { initialPrompt: data.initialPrompt })
      });

      // Skip async setup since template is already present
      // No need to run npm install etc.
      
      // Initialize Git repository after template copy
      await this.initializeGitRepository(id, appPath, appName);
      
      // Update status to 'created' since we're skipping async setup
      this.updateStatus(id, 'created');
      appLogger.info('App status updated to created (no async setup required)', {
        appId: id,
        name: appName
      });
      
      // Get the updated app AFTER status change
      const app = this.findById(id)!;
      
      appCreationEvents.success(appLogger, {
        appId: id,
        name: appName,
        templateVersion: 'v3',
        baseDir: customerDataDir,
        port,
        duration: 0,
        ...(data.initialPrompt && { initialPrompt: data.initialPrompt })
      });
      
      // Extend the app object with AI name generation info
      const result: App & { aiGeneratedName?: string; nameSuggested: boolean; originalName: string } = {
        ...app,
        nameSuggested,
        originalName: data.name
      };
      
      if (nameSuggested && appName) {
        result.aiGeneratedName = appName;
      }
      
      return result;
      
    } catch (error) {
      appCreationEvents.failure(appLogger, error as Error, {
        appId: id,
        name: appName,
        templateVersion: 'v3',
        baseDir: customerDataDir,
        port
      });
      
      // Clean up database entry if app creation fails
      try {
        // Check if app was actually inserted into database before trying to delete
        const existingApp = this.findById(id);
        if (existingApp) {
          const cleanupStmt = this.db.prepare('DELETE FROM apps WHERE id = ?');
          cleanupStmt.run(id);
          appLogger.info('Database cleanup completed after app creation failure');
        }
      } catch (cleanupError) {
        log.error(appLogger, 'app.database.cleanup.failed', cleanupError);
      }
      
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to create app: ${errorMessage}`);
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
        if (this.deploymentAdapter && this.isDockerMode()) {
          await this.deploymentAdapter.startApp(id);
        } else {
          appServerEvents.startBegin(setupLogger, {
            appId: id,
            port
          });
          await this.processService.startDevServer(id, appPath, port);
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
      try {
        this.updateStatus(id, 'error');
      } catch (updateError) {
        // In test environments, database might not be available for async operations
        // Log the error but don't throw to prevent unhandled rejections
        this.logger.warn('app.status.update.async_failed', {
          appId: id,
          targetStatus: 'error',
          error: getErrorMessage(updateError)
        });
      }
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
      // Check if pnpm is available, fallback to npm (handled by ProcessService)
      const packageManager = 'pnpm'; // ProcessService will detect this
      
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
      
      await new Promise<void>((resolve, _reject) => {
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

      // Capture output for logging (not used but kept for potential future logging)
      installProcess.stdout?.on('data', (_data) => {
        // stdout logging could be added here
      });

      installProcess.stderr?.on('data', (_data) => {
        // stderr logging could be added here
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
      initialBuildComplete: !!row.initial_build_complete,
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
      initialBuildComplete: !!row.initial_build_complete,
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
    try {
      const existing = this.findById(id);
      if (!existing) return null;

      const stmt = this.db.prepare(`
        UPDATE apps 
        SET status = ?, updated_at = ?
        WHERE id = ?
      `);
      
      stmt.run(status, new Date().toISOString(), id);
      
      return this.findById(id)!;
    } catch (error) {
      // In test environments, database operations might fail
      // Log but don't throw to prevent unhandled rejections
      this.logger.warn('app.status.update.failed', {
        appId: id,
        targetStatus: status,
        error: getErrorMessage(error)
      });
      return null;
    }
  }

  /**
   * Mark the initial build as complete (called when first git commit happens)
   */
  markInitialBuildComplete(id: string): App | null {
    try {
      const existing = this.findById(id);
      if (!existing) return null;

      // Only mark as complete if it's not already marked
      if (existing.initialBuildComplete) {
        return existing;
      }

      const stmt = this.db.prepare(`
        UPDATE apps 
        SET initial_build_complete = TRUE, updated_at = ?
        WHERE id = ?
      `);
      
      stmt.run(new Date().toISOString(), id);
      
      this.logger.info('app.initial.build.complete', {
        appId: id,
        appName: existing.name,
        message: 'Initial build marked as complete'
      });
      
      return this.findById(id)!;
    } catch (error) {
      this.logger.warn('app.initial.build.complete.failed', {
        appId: id,
        error: getErrorMessage(error)
      });
      return null;
    }
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
   * Get running development servers
   */
  async getRunningServers(): Promise<Array<{ appId: string; port: number; url: string; isV3?: boolean; backendPort?: number }>> {
    // Ensure this repository is initialized
    await this.initialize();

    // If in Docker mode, use the adapter
    if (this.deploymentAdapter && this.isDockerMode()) {
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
        this.logger.error('app.server.get_running.adapter_failed', {
          adapterType: 'docker',
          error: getErrorMessage(error)
        });
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
    if (this.deploymentAdapter && this.isDockerMode()) {
      try {
        this.logger.info('app.server.stop.docker.begin', {
          appId,
          adapterType: 'docker'
        });
        return await this.deploymentAdapter.stopApp(appId);
      } catch (error) {
        this.logger.error('app.server.stop.docker.failed', {
          appId,
          adapterType: 'docker',
          error: getErrorMessage(error)
        });
        return false;
      }
    }

    // Local process management
    return await this.processService.stopServer(appId);
  }

  /**
   * Stop all running development servers
   */
  async stopAllServers(): Promise<number> {
    // Ensure this repository is initialized
    await this.initialize();

    // If in Docker mode, use the adapter
    if (this.deploymentAdapter && this.isDockerMode()) {
      try {
        return await this.deploymentAdapter.stopAllServers();
      } catch (error) {
        this.logger.error('app.server.stop_all.adapter_failed', {
          adapterType: 'docker',
          error: getErrorMessage(error)
        });
        return 0;
      }
    }

    // Local mode - use existing logic
    return await this.processService.stopAllServers();
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

    this.logger.info('app.server.restart.begin', {
      appId
    });

    // Use adapter if in Docker mode
    if (this.deploymentAdapter && this.isDockerMode()) {
      try {
        this.logger.info('app.server.restart.docker.begin', {
          appId,
          adapterType: 'docker'
        });
        return await this.deploymentAdapter.restartApp(appId);
      } catch (error) {
        this.logger.error('app.server.restart.docker.failed', {
          appId,
          adapterType: 'docker',
          error: getErrorMessage(error)
        });
        return false;
      }
    }

    // Local process management - Stop the current server if running
    const wasRunning = await this.stopServer(appId);

    if (wasRunning) {
      // Wait longer for the process to fully terminate and port to be released
      this.logger.info('app.server.restart.wait_terminate', {
        appId,
        waitDuration: 3000
      });
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Double-check that the port is actually free
      const isPortFree = !(await this.processService.isPortOccupied(app.port));
      if (!isPortFree) {
        this.logger.warn('app.server.restart.port_still_occupied', {
          appId,
          port: app.port
        });
        
        // Get debug info about what's using the port
        const portInfo = await this.processService.getProcessInfoForPort(app.port);
        if (portInfo) {
          this.logger.debug('app.server.restart.port_info', {
            appId,
            port: app.port,
            portInfo
          });
        }
        
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Final check
        const finalPortCheck = !(await this.processService.isPortOccupied(app.port));
        if (!finalPortCheck) {
          this.logger.warn('app.server.restart.force_cleanup', {
            appId,
            port: app.port
          });
          await this.processService.forceCleanupApp(appId);
          await new Promise(resolve => setTimeout(resolve, 1000));
          
          // One more port check after force cleanup
          const finalCheckAfterCleanup = !(await this.processService.isPortOccupied(app.port));
          if (!finalCheckAfterCleanup) {
            this.logger.error('app.server.restart.port_cleanup_failed', {
              appId,
              port: app.port
            });
            
            // Get final debug info
            const finalPortInfo = await this.processService.getProcessInfoForPort(app.port);
            if (finalPortInfo) {
              this.logger.debug('app.server.restart.final_port_info', {
                appId,
                port: app.port,
                portInfo: finalPortInfo
              });
            }
            
            throw new Error(`Port ${app.port} is still occupied after force cleanup`);
          }
        }
      }
      
      // Also verify the database record was updated
      if (this.processService.isServerRunning(appId)) {
        this.logger.warn('app.server.restart.database_cleanup', {
          appId
        });
        this.processService.removeProcessRecord(appId);
      }
    }

    // Start the server again using the adapter (for local mode)
    try {
      if (this.deploymentAdapter) {
        await this.deploymentAdapter.startApp(appId);
      } else {
        await this.processService.startDevServer(appId, app.path, app.port);
      }
      this.logger.info('app.server.restart.success', {
        appId
      });
      return true;
    } catch (error) {
      this.logger.error('app.server.restart.failed', {
        appId,
        error: getErrorMessage(error)
      });
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
    const runningServers = await this.getRunningServers();
    this.logger.info('app.cleanup.begin', {
      serverCount: runningServers.length
    });
    
    // Delegate to ProcessService
    await this.processService.cleanup();
  }

  /**
   * Force cleanup of all orphaned processes by scanning the database
   */
  async forceCleanupOrphans(): Promise<number> {
    // Ensure this repository is initialized
    await this.initialize();

    // If in Docker mode, use the adapter
    if (this.deploymentAdapter && this.isDockerMode()) {
      try {
        this.logger.info('app.cleanup.orphans.docker.begin', {
          adapterType: 'docker'
        });
        const result = await this.deploymentAdapter.cleanupOrphans();
        this.logger.info('app.cleanup.orphans.docker.success', {
          adapterType: 'docker',
          message: result.message,
          cleaned: result.cleaned
        });
        return result.cleaned;
      } catch (error) {
        this.logger.error('app.cleanup.orphans.docker.failed', {
          adapterType: 'docker',
          error: getErrorMessage(error)
        });
        return 0;
      }
    }

    // Local mode - delegate to ProcessService
    return await this.processService.forceCleanupOrphans();
  }

  /**
   * Force cleanup processes for a specific app
   */
  async forceCleanupApp(appId: string): Promise<boolean> {
    return await this.processService.forceCleanupApp(appId);
  }

  /**
   * Adapter-specific methods (Docker container operations)
   * These methods delegate to the deployment adapter when available
   */

  async getAppStatus(appId: string) {
     // Ensure this repository is initialized before creating apps
     await this.initialize();

    if (this.deploymentAdapter && this.isDockerMode()) {
      return this.deploymentAdapter.getAppStatus(appId);
    }
    // Fallback to local process status
    return this.processService.getAppStatus(appId);
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

  // Public method for external access to Docker mode detection
  public isDockerModePublic(): boolean {
    return this.isDockerMode();
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
