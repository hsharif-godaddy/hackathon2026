import * as fs from 'node:fs';

import { execa } from 'execa';
import { appendFileSync, existsSync, promises as fsPromises, readdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';

import { PrismaSiteService } from '@/lib/database/prisma-site-service';
import { createAppAdapter, getAdapterType } from './adapters';
import type { IAppAdapter, ServerStatus } from './adapters/interfaces/IAppAdapter';
import { type DevAppInfo, DevDatabase } from './database/DevDatabase';
import { TemplateCopyService } from './services/TemplateCopyService';
import { getAllocPath, getAppPath, getBasePath } from './utils/app-paths';
import { GitUtils } from './utils/git';
import { PortManager } from './utils/port-manager';
import { SSLCertificateGenerator } from './utils/ssl-cert-generator';
import { logger } from '../request-context';

export interface CreateDevAppRequest {
  siteId: string;
  name: string;
  initialPrompt?: string;
  templateVersion?: string;
}

export interface DevAppResult {
  success: boolean;
  appId: string;
  port?: number;
  appPath?: string;
  templateVersion?: string;
  urls?: {
    frontend: string;
    backend?: string;
  };
  error?: string;
}

/**
 * Main orchestrator for the development environment
 * Coordinates all dev services without mixing concerns
 * Singleton to ensure consistent state across all usages
 */
export class DevEnvironmentManager {
  private static instance: DevEnvironmentManager | null = null;

  private devDb: DevDatabase;
  private portManager: PortManager;
  private gitUtils: GitUtils;
  private templateService: TemplateCopyService;
  private siteService: PrismaSiteService;
  private adapter: IAppAdapter | null = null;
  private initialized = false;

  private constructor() {
    // Use singleton instance to ensure all managers share the same state
    this.devDb = DevDatabase.getInstance();
    this.portManager = new PortManager(this.devDb);
    this.gitUtils = new GitUtils();
    this.templateService = new TemplateCopyService();
    this.siteService = new PrismaSiteService();
  }

  /**
   * Get singleton instance of DevEnvironmentManager
   * Ensures all application code shares the same adapter and initialization state
   */
  static getInstance(): DevEnvironmentManager {
    if (!DevEnvironmentManager.instance) {
      DevEnvironmentManager.instance = new DevEnvironmentManager();
    }
    return DevEnvironmentManager.instance;
  }

  /**
   * Initialize the dev environment manager
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Initialize in-memory dev database (no database tables needed)
    this.devDb.initializeTables();

    // Initialize the appropriate adapter using the factory (only once)
    if (!this.adapter) {
      this.adapter = await createAppAdapter(this.devDb);
      await this.adapter.initialize();
    }

    this.initialized = true;

    // Run reconciliation to clean up orphans from previous sessions
    // Don't await - let it run in background to avoid blocking startup
    this.reconcileState().catch(error => {
      logger.error('dev-environment.reconcile.startup_failure', {
        error: error instanceof Error ? error.message : String(error)
      });
    });
  }

  /**
   * Create a new development app
   * Handles the complete lifecycle: directory, template, dependencies, git, dev server
   */
  async createDevApp(request: CreateDevAppRequest): Promise<DevAppResult> {
    await this.initialize();

    const { siteId, name, templateVersion = 'v8' } = request;

    try {
      // 1. Check if app already exists - if so, return early
      const existingApp = this.devDb.findDevAppById(siteId);

      if (existingApp && (existingApp.status === 'created' || existingApp.status === 'running')) {
        // Generate URLs for existing app
        const urls = {
          frontend: `https://localhost:${existingApp.port}`
        };

        return {
          success: true,
          appId: siteId,
          appPath: existingApp.appPath,
          port: existingApp.port,
          urls,
          templateVersion: existingApp.templateVersion
        };
      }

      // 2. App doesn't exist or is in error state - create/recreate it
      let port: number;
      let supervisorPort: number | undefined;
      let publishSupervisorPort: number | undefined;
      let publishPort: number | undefined;

      if (existingApp) {
        // Reuse existing ports for error recovery
        port = existingApp.port;
        supervisorPort = existingApp.supervisorPort;
        publishSupervisorPort = existingApp.publishSupervisorPort;
        publishPort = existingApp.publishPort;
      } else {
        // Allocate new ports for new app
        port = await this.portManager.getNextAvailablePort();

        // Allocate supervisor port if using Docker mode
        if (!this.adapter?.getCapabilities().supportsProcessOperations) {
          supervisorPort = await this.portManager.getNextAvailableSupervisorPort();
          
          // Allocate publish supervisor and HTTP ports for V4 unified job architecture
          publishSupervisorPort = await this.portManager.getNextAvailablePublishSupervisorPort();
          publishPort = await this.portManager.getNextAvailablePublishPort();
        }
      }

      // 3. Determine app paths using centralized utility
      const basePath = getBasePath(siteId);
      const appPath = getAppPath(siteId);
      const allocPath = getAllocPath(siteId);

      // Ensure base and subdirectories exist
      if (!existsSync(basePath)) {
        await fsPromises.mkdir(basePath, { recursive: true });
      }
      if (!existsSync(allocPath)) {
        await fsPromises.mkdir(allocPath, { recursive: true });
      }

      // Create V4 unified job directory structure (assets and dist)
      // Security: siteId is a system-generated UUID from database, not user input.
      // Subdirectories are hardcoded constants. Path traversal not possible.
      // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
      const assetsPublicPath = path.join(appPath, 'assets', 'public');
      // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
      const assetsPrivatePath = path.join(appPath, 'assets', 'private');
      // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
      const distPath = path.join(appPath, 'dist');
      // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
      const publishDistPath = path.join(basePath, 'dist');

      if (!existsSync(assetsPublicPath)) {
        await fsPromises.mkdir(assetsPublicPath, { recursive: true });
        logger.info('dev-environment.directories.created', {
          siteId,
          path: assetsPublicPath,
          message: 'Created assets/public directory'
        });
      }
      if (!existsSync(assetsPrivatePath)) {
        await fsPromises.mkdir(assetsPrivatePath, { recursive: true });
        logger.info('dev-environment.directories.created', {
          siteId,
          path: assetsPrivatePath,
          message: 'Created assets/private directory'
        });
      }
      if (!existsSync(distPath)) {
        await fsPromises.mkdir(distPath, { recursive: true });
        logger.info('dev-environment.directories.created', {
          siteId,
          path: distPath,
          message: 'Created dist directory for versioned releases'
        });
      }
      if (!existsSync(publishDistPath)) {
        await fsPromises.mkdir(publishDistPath, { recursive: true });
        logger.info('dev-environment.directories.created', {
          siteId,
          path: publishDistPath,
          message: 'Created dist directory for published apps'
        });
      }

      // Note: Coming soon server is handled by dev-supervisor when no published version exists
      // No need to pre-create /dist/current directory - dev-supervisor will create symlink on first publish

      // Copy V4 unified job entrypoint script if using Docker mode with publish ports
      // Security: appPath/templateVersion derived from system UUIDs, filenames are hardcoded
      if (!this.adapter?.getCapabilities().supportsProcessOperations && publishSupervisorPort && publishPort) {
        // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
        const entrypointScriptPath = path.join(appPath, 'dev_entrypoint.sh');
        // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
        const templateScriptPath = path.join(process.cwd(), 'app-templates', templateVersion, 'dev_entrypoint.sh');
        
        if (existsSync(templateScriptPath)) {
          const scriptContent = readFileSync(templateScriptPath, 'utf-8');
          writeFileSync(entrypointScriptPath, scriptContent, 'utf-8');
          // Make script executable
          await fsPromises.chmod(entrypointScriptPath, 0o755);
          logger.info('dev-environment.entrypoint-script.created', {
            siteId,
            path: entrypointScriptPath,
            message: 'Created V4 unified job entrypoint script'
          });
        } else {
          logger.warn('dev-environment.entrypoint-script.not-found', {
            siteId,
            templateScriptPath,
            message: 'Entrypoint script template not found, V4 features may not work'
          });
        }
      }

      // 4. Create or update dev app record
      const devApp = this.devDb.createDevApp({ // eslint-disable-line @typescript-eslint/no-unused-vars
        appId: siteId,
        port,
        supervisorPort,
        publishSupervisorPort,
        publishPort,
        appPath,
        templateVersion,
        status: 'creating'
      });

      // 5. Set up template (only runs for new/error apps now)
      // Set up the app using the template copy service
      await this.setupAppFromTemplate(siteId, appPath, name);

      // Generate SSL certificates for HTTPS development
      await this.generateSSLCertificates(siteId, appPath);

      // Copy SSL certificates to /alloc/.ssl/ for publish container access
      // The publish container doesn't have /app mounted, so it needs certs in /alloc
      await this.copySSLCertsToAlloc(siteId, appPath, allocPath);

      // Initialize Git repository (skip for Docker mode - container handles it via script)
      if (this.adapter?.getCapabilities().supportsProcessOperations) {
        await this.initializeGitRepository(siteId, appPath, name);
      }

      // Update status to created
      this.devDb.updateDevAppStatus(siteId, 'created');

      // 7. Generate URLs
      const urls = {
        frontend: `https://localhost:${port}`
      };

      return {
        success: true,
        appId: siteId,
        port,
        appPath,
        templateVersion,
        urls
      };

    } catch (error) {
      logger.error('dev-environment.create.failed', {
        siteId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      // Cleanup on failure
      try {
        await this.cleanupDevApp(siteId);
      } catch {
        // Cleanup failed - ignore
      }

      return {
        success: false,
        appId: siteId,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Start the development server for an app
   */
  async startDevServer(appId: string): Promise<boolean> {
    await this.initialize();

    if (!this.adapter) {
      return false;
    }

    try {
      const success = await this.adapter.startApp(appId);
      if (success) {
        this.devDb.updateDevAppStatus(appId, 'running');
      }
      return success;
    } catch (error) {
      logger.error('dev-environment.start.failed', {
        appId,
        error: error instanceof Error ? error.message : String(error)
      });
      return false;
    }
  }

  /**
   * Stop the development server for an app
   */
  async stopDevServer(appId: string): Promise<boolean> {
    await this.initialize();

    if (!this.adapter) {
      return false;
    }

    try {
      const success = await this.adapter.stopApp(appId);
      if (success) {
        this.devDb.updateDevAppStatus(appId, 'stopped');
      }
      return success;
    } catch (error) {
      logger.error('dev-environment.stop.failed', {
        appId,
        error: error instanceof Error ? error.message : String(error)
      });
      return false;
    }
  }

  /**
   * Get the status of a dev app
   */
  async getDevAppStatus(appId: string): Promise<ServerStatus> {
    await this.initialize();

    const devApp = this.devDb.findDevAppById(appId);
    if (!devApp) {
      return { status: 'not_found', message: 'Dev app not found' };
    }

    if (this.adapter) {
      try {
        return await this.adapter.getAppStatus(appId);
      } catch (error) {
        return { status: 'error', message: error instanceof Error ? error.message : 'Unknown error' };
      }
    }

    // Map database status to ServerStatus (when no adapter available)
    // 'creating' and 'created' map to 'stopped' since adapter isn't running
    const status: ServerStatus['status'] =
      devApp.status === 'creating' || devApp.status === 'created' ? 'stopped' : devApp.status;

    return { status, message: 'No adapter available' };
  }

  /**
   * Get all running dev servers
   */
  async getRunningDevServers() {
    await this.initialize();

    if (!this.adapter) {
      return [];
    }

    try {
      return await this.adapter.getRunningServers();
    } catch {
      return [];
    }
  }

  /**
   * Delete a dev app and clean up all resources
   */
  async deleteDevApp(appId: string): Promise<boolean> {
    await this.initialize();

    try {
      // Stop the server if running
      if (this.adapter) {
        await this.adapter.stopApp(appId);
        await this.adapter.removeApp(appId);
      }

      // Remove from dev database
      this.devDb.deleteDevApp(appId);

      return true;

    } catch (error) {
      logger.error('dev-environment.delete.failed', {
        appId,
        error: error instanceof Error ? error.message : String(error)
      });
      return false;
    }
  }

  /**
   * Set up app from template using TemplateCopyService
   */
  private async setupAppFromTemplate(appId: string, appPath: string, appName: string): Promise<void> {
    try {
      const result = await this.templateService.copyTemplate({
        appId,
        appPath,
        appName,
        templateDir: process.env.APP_TEMPLATE_DIR || 'app-templates/v8'
      });

      if (result.success) {
        // Note: Commerce API credentials are hardcoded in generated code by Develop Agent
        // See agents/src/prompts/develop/commerce-checkout-guide.md for details

        // Create .is_ready file for Docker mode to signal template is ready
        if (!this.adapter?.getCapabilities().supportsProcessOperations) {
          // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
          const readyFilePath = path.join(appPath, '.is_ready');
          writeFileSync(readyFilePath, '');
        }
      } else {
        throw new Error('Template copy failed');
      }
    } catch (error) {
      logger.error('dev-environment.template-setup.failed', {
        appId,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Update .gitignore to exclude dev-supervisor binary and build artifacts
   * Security: appPath derived from system UUID, filename is hardcoded
   */
  private async updateGitignoreForDevSupervisor(appPath: string): Promise<void> {
    // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
    const gitignorePath = path.join(appPath, '.gitignore');

    // Entries to add to .gitignore for dev-supervisor
    const devSupervisorIgnores = [
      '',
      '# Dev supervisor binary and artifacts (added by Airo AI Builder)',
      'dev-supervisor/',
      'dev-supervisor/dev-supervisor',
      'dev-supervisor/*.exe',
      'dev-supervisor/dist/',
      'dev-supervisor/target/',
      ''
    ].join('\n');

    try {
      // Check if .gitignore exists
      if (existsSync(gitignorePath)) {
        // Read existing content
        const existingContent = readFileSync(gitignorePath, 'utf-8');

        // Only add if not already present
        if (!existingContent.includes('dev-supervisor/')) {
          appendFileSync(gitignorePath, devSupervisorIgnores);
        }
      } else {
        // Create .gitignore with dev-supervisor rules
        writeFileSync(gitignorePath, devSupervisorIgnores);
      }
    } catch (error) {
      logger.warn('dev_app.gitignore.update.failure', { error: error instanceof Error ? error.message : String(error), message: 'Failed to update .gitignore' });
      throw error;
    }
  }

  /**
   * Generate SSL certificates for HTTPS development
   */
  private async generateSSLCertificates(appId: string, appPath: string): Promise<void> {
    try {
      const result = await SSLCertificateGenerator.ensureCertificates(appPath);

      if (result.success) {
        logger.info('dev_app.ssl.ready', { appId, certPath: result.certPath });

        const { CAManager } = await import('./utils/ca-manager');
        const caManager = new CAManager();
        const caPath = caManager.getCAPath();

        logger.info(`📋 To trust these certificates in your browser, install the CA certificate:`);
        logger.info(`   CA Location: ${caPath}`);
        logger.info(`   Run: ./scripts/trust-dev-ca.sh (or manually import into your browser/system)`);
      } else {
        logger.warn('dev_app.ssl.generation.failure', { appId, error: result.error, message: 'SSL certificate generation failed' });
        logger.warn(`App will fall back to HTTP mode`);
      }
    } catch (error) {
      logger.warn('dev-environment.ssl.failed', {
        appId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Copy SSL certificates to /alloc/.ssl/ for publish container access
   * The publish container doesn't have /app mounted, so it needs certs in /alloc
   *
   * Security: All path.join operations in this method are safe from path traversal:
   * - appPath/allocPath are derived from system-generated UUID (siteId) via getAppPath/getAllocPath
   * - All subdirectories and filenames are hardcoded string literals
   * nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
   */
  private async copySSLCertsToAlloc(appId: string, appPath: string, allocPath: string): Promise<void> {
    try {
      const sslSourceDir = path.join(appPath, '.ssl');
      const sslDestDir = path.join(allocPath, '.ssl');

      // Check if source SSL certs exist
      const certPath = path.join(sslSourceDir, 'cert.pem');
      const keyPath = path.join(sslSourceDir, 'key.pem');

      if (!existsSync(certPath) || !existsSync(keyPath)) {
        logger.warn('dev_app.ssl.copy.skip', {
          appId,
          message: 'SSL certificates not found, skipping copy to alloc'
        });
        return;
      }

      // Create destination directory
      if (!existsSync(sslDestDir)) {
        await fsPromises.mkdir(sslDestDir, { recursive: true });
      }

      // Copy cert and key files
      await fsPromises.copyFile(certPath, path.join(sslDestDir, 'cert.pem'));
      await fsPromises.copyFile(keyPath, path.join(sslDestDir, 'key.pem'));

      logger.info('dev_app.ssl.copy.success', {
        appId,
        source: sslSourceDir,
        destination: sslDestDir,
        message: 'SSL certificates copied to alloc directory for publish container'
      });
    } catch (error) {
      logger.warn('dev_app.ssl.copy.failure', {
        appId,
        error: error instanceof Error ? error.message : String(error),
        message: 'Failed to copy SSL certificates to alloc directory'
      });
    }
  }

  /**
   * Initialize Git repository for the app
   */
  private async initializeGitRepository(appId: string, appPath: string, appName: string): Promise<void> {
    try {
      // Initialize the Git repository
      const initResult = await this.gitUtils.initRepository(appPath);
      if (!initResult.success) {
        return;
      }

      // Configure Git user
      try {
        await this.gitUtils.configureUser(appPath, 'Airo AI Builder', 'ai@airo.dev');
      } catch {
        // Git config failed - continue
      }

      // Update .gitignore to exclude dev-supervisor binary
      try {
        await this.updateGitignoreForDevSupervisor(appPath);
      } catch {
        // Gitignore update failed - continue
      }

      // Create initial commit
      try {
        await this.gitUtils.createInitialCommit(
          appPath,
          `Initial commit for ${appName}\n\nGenerated by Airo AI Builder with template files.`
        );
      } catch {
        // Git commit failed - continue
      }

    } catch {
      // Git setup failed - non-critical
    }
  }

  /**
   * Clean up a dev app (used on creation failure)
   */
  private async cleanupDevApp(appId: string): Promise<void> {
    // Stop and remove via adapter
    if (this.adapter) {
      try {
        await this.adapter.stopApp(appId);
        await this.adapter.removeApp(appId);
      } catch {
        // Adapter cleanup failed - continue
      }
    }

    // Remove from dev database
    try {
      this.devDb.deleteDevApp(appId);
    } catch {
      // Database cleanup failed - ignore
    }
  }

  /**
   * Get dev app info
   */
  getDevApp(appId: string): DevAppInfo | null {
    return this.devDb.findDevAppById(appId);
  }

  /**
   * Check if adapter is Docker mode
   */
  isDockerMode(): boolean {
    return getAdapterType() === 'docker';
  }

  /**
   * Get adapter capabilities
   */
  getAdapterCapabilities() {
    return this.adapter?.getCapabilities() || null;
  }

  /**
   * Get dev-supervisor connection path (TCP URL or Unix socket path)
   * Returns null if adapter doesn't support this operation
   */
  getConnectionPath(appId: string): string | null {
    if (!this.adapter) {
      return null;
    }

    // Check if adapter has getConnectionPath method (Docker-specific)
    if ('getConnectionPath' in this.adapter && typeof this.adapter.getConnectionPath === 'function') {
      return this.adapter.getConnectionPath(appId);
    }

    return null;
  }

  /**
   * Get publish supervisor connection path (TCP URL) for V4 unified job
   * Returns null if not available or not using V4 unified job architecture
   */
  getPublishSupervisorConnectionPath(appId: string): string | null {
    const devApp = this.devDb.findDevAppById(appId);
    if (!devApp?.publishSupervisorPort) {
      return null;
    }

    // For dev environment, publish supervisor uses TCP
    return `tcp://localhost:${devApp.publishSupervisorPort}`;
  }

  /**
   * Reconcile Docker/MySQL state with database on startup
   * Cleans up orphaned containers and databases for deleted apps
   * Handles both old (airo-app-*-app-1) and new (preview-*, publish-*) naming patterns
   */
  async reconcileState(): Promise<{ containersRemoved: number; databasesDropped: number; filesystemCleaned: number }> {
    await this.initialize();

    logger.info('dev-environment.reconcile.begin', { message: 'Starting reconciliation of Docker/MySQL state' });

    let containersRemoved = 0;
    let databasesDropped = 0;
    let filesystemCleaned = 0;

    try {
      // Get all active site IDs from MySQL Prisma database
      const siteIds = await this.siteService.getAllSiteIds();
      const activeSiteIds = new Set(siteIds);

      logger.info('dev-environment.reconcile.active_sites', { count: activeSiteIds.size });

      // Get all Docker containers matching airo patterns
      const { stdout } = await execa('docker', ['ps', '-a', '--format', '{{.Names}}']);
      const containers = stdout.split('\n').filter(Boolean);

      const airoContainers = containers.filter(name =>
        name.match(/^(preview|publish)-[a-f0-9-]+/) || // New pattern
        name.match(/^airo-app-[a-f0-9-]+-app-1$/)      // Old pattern
      );

      logger.info('dev-environment.reconcile.found_containers', { count: airoContainers.length });

      // Extract unique app IDs from container names
      const containerAppIds = new Set<string>();
      for (const containerName of airoContainers) {
        const appId = this.extractAppIdFromContainerName(containerName);
        if (appId) {
          containerAppIds.add(appId);
        }
      }

      // Get all MySQL databases
      const databases = await this.getAiroMySQLDatabases();
      logger.info('dev-environment.reconcile.found_databases', { count: databases.length });

      const dbAppIds = new Set(databases.map(db =>
        db.replace('airo_', '').replace(/_/g, '-')
      ));

      // Get all filesystem directories under /tmp/apps
      const appDirs = await this.getAppDirectories();
      logger.info('dev-environment.reconcile.found_directories', { count: appDirs.length });

      // Clean up orphaned containers
      for (const appId of containerAppIds) {
        if (!activeSiteIds.has(appId)) {
          logger.info('dev-environment.reconcile.removing_orphan', { appId });
          const removed = await this.deleteDevApp(appId);
          if (removed) containersRemoved++;
        }
      }

      // Clean up orphaned databases (only if container doesn't exist)
      for (const appId of dbAppIds) {
        if (!activeSiteIds.has(appId) && !containerAppIds.has(appId)) {
          logger.info('dev-environment.reconcile.dropping_orphan_db', { appId });
          try {
            if (this.adapter) {
              await this.adapter.removeApp(appId);
              databasesDropped++;
            }
          } catch (error) {
            logger.warn('dev-environment.reconcile.drop_failed', {
              appId,
              error: error instanceof Error ? error.message : String(error)
            });
          }
        }
      }

      // Clean up orphaned filesystem directories
      for (const appId of appDirs) {
        if (!activeSiteIds.has(appId) && !containerAppIds.has(appId)) {
          logger.info('dev-environment.reconcile.removing_orphan_files', { appId });
          try {
            const basePath = getBasePath(appId);

            // Try native fs.rmSync first
            try {
              fs.rmSync(basePath, { recursive: true, force: true });
            } catch (nativeError) {
              // Fall back to shell commands for stubborn files
              if (process.platform === 'win32') {
                await execa('rmdir', ['/s', '/q', basePath], { reject: false });
              } else {
                await execa('chmod', ['-R', '755', basePath], { reject: false });
                await execa('rm', ['-rf', basePath]);
              }
            }

            filesystemCleaned++;
            logger.info('dev-environment.reconcile.files_removed', { appId, path: basePath });
          } catch (error) {
            logger.warn('dev-environment.reconcile.files_remove_failed', {
              appId,
              error: error instanceof Error ? error.message : String(error)
            });
          }
        }
      }

      logger.info('dev-environment.reconcile.complete', {
        containersRemoved,
        databasesDropped,
        filesystemCleaned,
        message: `Reconciliation complete: ${containersRemoved} containers, ${databasesDropped} databases, ${filesystemCleaned} directories cleaned`
      });

      return { containersRemoved, databasesDropped, filesystemCleaned };

    } catch (error) {
      logger.error('dev-environment.reconcile.failure', {
        error: error instanceof Error ? error.message : String(error)
      });
      return { containersRemoved, databasesDropped, filesystemCleaned };
    }
  }

  /**
   * Extract appId from container name
   * Handles both old and new naming patterns
   */
  private extractAppIdFromContainerName(containerName: string): string | null {
    // New pattern: preview-{appId}-1 or publish-{appId}-1
    const newMatch = containerName.match(/^(?:preview|publish)-([a-f0-9-]+)-1$/);
    if (newMatch) return newMatch[1];

    // Old pattern: airo-app-{appId}-app-1
    const oldMatch = containerName.match(/^airo-app-([a-f0-9-]+)-app-1$/);
    if (oldMatch) return oldMatch[1];

    return null;
  }

  /**
   * Get all airo MySQL databases
   * Returns database names like "airo_<uuid>"
   */
  private async getAiroMySQLDatabases(): Promise<string[]> {
    try {
      const mysqlPassword = process.env.MYSQL_ROOT_PASSWORD || 'rootpassword';
      const { stdout } = await execa('docker', [
        'exec',
        'airo-app-mysql',
        'mysql',
        '-uroot',
        `-p${mysqlPassword}`,
        '-e',
        'SHOW DATABASES LIKE "airo_%"'
      ]);

      return stdout
        .split('\n')
        .slice(1) // Skip header
        .filter(Boolean)
        .filter(db => db !== 'airo_app'); // Skip main app database
    } catch (error) {
      logger.error('dev-environment.get_databases.failure', {
        error: error instanceof Error ? error.message : String(error)
      });
      return [];
    }
  }

  /**
   * Get all app directories under /tmp/apps
   * Returns array of app IDs (directory names)
   */
  private async getAppDirectories(): Promise<string[]> {
    const appsDir = '/tmp/apps';

    if (!fs.existsSync(appsDir)) {
      return [];
    }

    const entries = readdirSync(appsDir, { withFileTypes: true });

    return entries
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
      .filter(name => name.match(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/)); // UUID format
  }

  /**
   * Clean up all resources
   */
  async cleanup(): Promise<void> {
    if (this.adapter) {
      await this.adapter.cleanup();
    }
  }
}
