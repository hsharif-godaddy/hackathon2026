import * as fs from 'node:fs';
import * as os from 'node:os';

import { execa } from 'execa';
import { appendFileSync, existsSync, promises as fsPromises, readdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';

import { PrismaSiteService } from '@/lib/database/prisma-site-service';
import { createAppAdapter, getAdapterType } from './adapters';
import type { IAppAdapter, ServerStatus } from './adapters/interfaces/IAppAdapter';
import { type DevAppInfo, DevDatabase } from './database/DevDatabase';
import { TemplateCopyService } from './services/TemplateCopyService';
import { getAllocPath, getAppPath, getAppsBaseDir, getBasePath } from './utils/app-paths';
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
    if (this.initialized) {return;}

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
      const previewPath = getAppPath(siteId); // Returns preview/ for V4 parity
      const publishPath = path.join(basePath, 'publish');
      const gitRepoPath = path.join(basePath, 'git-repo');
      const assetsPath = path.join(basePath, 'assets');
      const agentPath = path.join(basePath, 'agent');
      const distPath = path.join(basePath, 'dist');
      const allocPath = getAllocPath(siteId);

      // Create base directory
      if (!existsSync(basePath)) {
        await fsPromises.mkdir(basePath, { recursive: true });
      }

      // Create V4 unified job directory structure
      const directories = [
        { path: previewPath, name: 'preview workspace' },
        { path: publishPath, name: 'publish workspace' },
        { path: gitRepoPath, name: 'git repository' },
        { path: path.join(assetsPath, 'public'), name: 'assets/public' },
        { path: path.join(assetsPath, 'private'), name: 'assets/private' },
        { path: agentPath, name: 'agent database directory' },
        { path: distPath, name: 'distribution archives' },
        { path: allocPath, name: 'configuration' },
      ];

      for (const { path: dirPath, name } of directories) {
        if (!existsSync(dirPath)) {
          await fsPromises.mkdir(dirPath, { recursive: true });
          logger.info('dev-environment.directories.created', {
            siteId,
            path: dirPath,
            message: `Created ${name} directory`
          });
        }
      }

      // Note: Coming soon server is handled by dev-supervisor when no published version exists
      // No need to pre-create /dist/current directory - dev-supervisor will create symlink on first publish

      // Copy V4 unified job entrypoint script if using Docker mode with publish ports
      // Security: previewPath/templateVersion derived from system UUIDs, filenames are hardcoded
      if (!this.adapter?.getCapabilities().supportsProcessOperations && publishSupervisorPort && publishPort) {
        // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
        const entrypointScriptPath = path.join(previewPath, 'dev_entrypoint.sh');
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
        appPath: previewPath, // Agent writes to preview workspace
        templateVersion,
        status: 'creating'
      });

      // 5. Set up template (only runs for new/error apps now)
      // Set up the app using the template copy service
      await this.setupAppFromTemplate(siteId, previewPath, name);

      // Setup assets bind mount structure (after template copy)
      await this.setupAssetsBindMount(siteId, previewPath, assetsPath);

      // Create symlink so agent writes to preview/public/assets land in assets/public
      await this.setupPublicAssetsSymlink(siteId, previewPath, assetsPath);

      // Generate SSL certificates for HTTPS development
      await this.generateSSLCertificates(siteId, previewPath);

      // Copy SSL certificates to /alloc/.ssl/ for publish container access
      // The publish container doesn't have /app mounted, so it needs certs in /alloc
      await this.copySSLCertsToAlloc(siteId, previewPath, allocPath);

      // Initialize Git repository on host filesystem (V4 parity: git is external to container)
      // Previously skipped in Docker mode, but V4 architecture requires git-repo to exist
      // before container starts so it can be bind-mounted
      await this.initializeGitRepository(siteId, previewPath, name);

      // Setup git-repo bind mount structure (after git initialization)
      // Move .git to git-repo/ and create symlink preview/.git -> ../git-repo/.git
      await this.setupGitRepoBindMount(siteId, previewPath, gitRepoPath);

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
        appPath: previewPath,
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
   * Create bind mount structure for git-repo
   * Git initializes in preview/.git, then we move it to git-repo/ and symlink
   *
   * Handles race conditions and ensures idempotent operations.
   */
  private async setupGitRepoBindMount(appId: string, previewPath: string, gitRepoPath: string): Promise<void> {
    const previewGitPath = path.join(previewPath, '.git');
    const gitRepoGitPath = path.join(gitRepoPath, '.git');

    try {
      // Check if preview/.git exists and what it is
      let previewGitExists = false;
      let previewGitIsSymlink = false;

      try {
        const previewGitStat = await fsPromises.lstat(previewGitPath);
        previewGitExists = true;
        previewGitIsSymlink = previewGitStat.isSymbolicLink();
      } catch (error: any) {
        if (error.code !== 'ENOENT') {
          throw new Error(`Failed to stat ${previewGitPath}: ${error.message}`);
        }
      }

      // If preview/.git is already a symlink, assume setup is complete
      if (previewGitIsSymlink) {
        logger.debug('dev-environment.git-repo.already-linked', {
          appId,
          link: previewGitPath,
        });
        return;
      }

      // If .git exists in preview as a directory, move it to git-repo
      if (previewGitExists) {
        // Check if git-repo/.git already exists
        const gitRepoGitExists = existsSync(gitRepoGitPath);

        if (!gitRepoGitExists) {
          // Move .git to git-repo (atomic operation)
          await fsPromises.rename(previewGitPath, gitRepoGitPath);

          logger.info('dev-environment.git-repo.moved', {
            appId,
            from: previewGitPath,
            to: gitRepoGitPath,
          });
        } else {
          // git-repo/.git already exists, remove preview/.git to avoid conflict
          await fsPromises.rm(previewGitPath, { recursive: true, force: true });

          logger.warn('dev-environment.git-repo.removed-duplicate', {
            appId,
            path: previewGitPath,
            message: 'Removed duplicate .git directory in preview',
          });
        }
      }

      // Create symlink preview/.git -> ../git-repo/.git (idempotent)
      try {
        await this.createDirectorySymlink('../git-repo/.git', previewGitPath);

        logger.info('dev-environment.git-repo.linked', {
          appId,
          link: previewGitPath,
          target: '../git-repo/.git',
        });
      } catch (error: any) {
        // EEXIST is expected if another process created the symlink
        if (error.code === 'EEXIST') {
          logger.debug('dev-environment.git-repo.symlink-exists', {
            appId,
            link: previewGitPath,
            message: 'Symlink already exists (race condition handled)',
          });
        } else {
          throw error;
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('dev-environment.git-repo.setup-failure', {
        appId,
        previewPath,
        gitRepoPath,
        error: errorMessage,
      });

      // Re-throw with context for proper error handling upstream
      throw new Error(`Failed to setup git-repo bind mount for app ${appId}: ${errorMessage}`);
    }
  }

  /**
   * Setup assets bind mount structure
   * Moves assets from preview/ to assets/ and creates symlinks
   *
   * Uses merge strategy to prevent data loss - if assets already exist in both locations,
   * preserves existing files and only copies new ones. Handles race conditions and ensures
   * idempotent operations.
   */
  private async setupAssetsBindMount(appId: string, previewPath: string, assetsPath: string): Promise<void> {
    const previewAssetsPath = path.join(previewPath, 'assets');

    try {
      // Check if preview/assets exists and what it is
      let previewAssetsExists = false;
      let previewAssetsIsSymlink = false;

      try {
        const previewAssetsStat = await fsPromises.lstat(previewAssetsPath);
        previewAssetsExists = true;
        previewAssetsIsSymlink = previewAssetsStat.isSymbolicLink();
      } catch (error: any) {
        if (error.code !== 'ENOENT') {
          throw new Error(`Failed to stat ${previewAssetsPath}: ${error.message}`);
        }
      }

      // If preview/assets is already a symlink, remove it.
      // Docker bind mounts handle assets directly, and the symlink would be broken in-container.
      if (previewAssetsIsSymlink) {
        await fsPromises.unlink(previewAssetsPath);
        logger.info('dev-environment.assets.symlink-removed', {
          appId,
          link: previewAssetsPath,
          message: 'Removed preview/assets symlink to avoid broken path in container',
        });
        return;
      }

      // If assets exist in preview as a directory, merge them to assets/
      if (previewAssetsExists) {
        const publicSrc = path.join(previewAssetsPath, 'public');
        const privateSrc = path.join(previewAssetsPath, 'private');
        const publicDest = path.join(assetsPath, 'public');
        const privateDest = path.join(assetsPath, 'private');

        // Merge public assets if they exist (preserves existing files)
        if (existsSync(publicSrc) && readdirSync(publicSrc).length > 0) {
          const publicDestExists = existsSync(publicDest);

          if (publicDestExists) {
            // Merge: copy files that don't already exist in destination
            const srcFiles = await fsPromises.readdir(publicSrc, { recursive: true, withFileTypes: true });
            let mergedCount = 0;
            let skippedCount = 0;

            for (const entry of srcFiles) {
              if (entry.isFile()) {
                const relativePath = path.relative(publicSrc, path.join(entry.path, entry.name));
                const destFile = path.join(publicDest, relativePath);

                if (!existsSync(destFile)) {
                  const srcFile = path.join(entry.path, entry.name);
                  const destDir = path.dirname(destFile);

                  // Ensure destination directory exists
                  await fsPromises.mkdir(destDir, { recursive: true });
                  await fsPromises.copyFile(srcFile, destFile);
                  mergedCount++;
                } else {
                  skippedCount++;
                }
              }
            }

            logger.info('dev-environment.assets.merged', {
              appId,
              type: 'public',
              mergedFiles: mergedCount,
              skippedFiles: skippedCount,
            });
          } else {
            // No existing assets, just copy
            await fsPromises.cp(publicSrc, publicDest, { recursive: true, force: true });
            logger.info('dev-environment.assets.copied', {
              appId,
              type: 'public',
              from: publicSrc,
              to: publicDest,
            });
          }
        }

        // Merge private assets if they exist (preserves existing files)
        if (existsSync(privateSrc) && readdirSync(privateSrc).length > 0) {
          const privateDestExists = existsSync(privateDest);

          if (privateDestExists) {
            // Merge: copy files that don't already exist in destination
            const srcFiles = await fsPromises.readdir(privateSrc, { recursive: true, withFileTypes: true });
            let mergedCount = 0;
            let skippedCount = 0;

            for (const entry of srcFiles) {
              if (entry.isFile()) {
                const relativePath = path.relative(privateSrc, path.join(entry.path, entry.name));
                const destFile = path.join(privateDest, relativePath);

                if (!existsSync(destFile)) {
                  const srcFile = path.join(entry.path, entry.name);
                  const destDir = path.dirname(destFile);

                  // Ensure destination directory exists
                  await fsPromises.mkdir(destDir, { recursive: true });
                  await fsPromises.copyFile(srcFile, destFile);
                  mergedCount++;
                } else {
                  skippedCount++;
                }
              }
            }

            logger.info('dev-environment.assets.merged', {
              appId,
              type: 'private',
              mergedFiles: mergedCount,
              skippedFiles: skippedCount,
            });
          } else {
            // No existing assets, just copy
            await fsPromises.cp(privateSrc, privateDest, { recursive: true, force: true });
            logger.info('dev-environment.assets.copied', {
              appId,
              type: 'private',
              from: privateSrc,
              to: privateDest,
            });
          }
        }

        // Only remove preview/assets after successful copy/merge
        await fsPromises.rm(previewAssetsPath, { recursive: true, force: true });
      }

      // Do not recreate preview/assets symlink in Docker mode.
      // Bind mounts provide /app/public/assets and /private directly.
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('dev-environment.assets.setup-failure', {
        appId,
        previewPath,
        assetsPath,
        error: errorMessage,
      });

      // Re-throw with context for proper error handling upstream
      throw new Error(`Failed to setup assets bind mount for app ${appId}: ${errorMessage}`);
    }
  }

  /**
   * Create a symlink from preview/public/assets → ../../assets/public so that
   * agent writes to public/assets/ transparently land in the bind-mounted
   * assets/public/ directory that the Docker container actually serves.
   */
  private async setupPublicAssetsSymlink(appId: string, previewPath: string, assetsPath: string): Promise<void> {
    const publicDir = path.join(previewPath, 'public');
    const publicAssetsPath = path.join(publicDir, 'assets');
    const assetsPublicDir = path.join(assetsPath, 'public');
    const relativeTarget = path.relative(publicDir, assetsPublicDir);

    try {
      await fsPromises.mkdir(publicDir, { recursive: true });
      await fsPromises.mkdir(assetsPublicDir, { recursive: true });

      let stat;
      try {
        stat = await fsPromises.lstat(publicAssetsPath);
      } catch (e: any) {
        if (e.code !== 'ENOENT') {throw e;}
      }

      if (stat?.isSymbolicLink()) {
        const existingTarget = await fsPromises.readlink(publicAssetsPath);
        if (path.resolve(publicDir, existingTarget) === path.resolve(assetsPublicDir)) {
          return;
        }
        await fsPromises.unlink(publicAssetsPath);
      } else if (stat?.isDirectory()) {
        const entries = await fsPromises.readdir(publicAssetsPath);
        for (const entry of entries) {
          const src = path.join(publicAssetsPath, entry);
          const dest = path.join(assetsPublicDir, entry);
          if (!existsSync(dest)) {
            await fsPromises.rename(src, dest);
          }
        }
        await fsPromises.rm(publicAssetsPath, { recursive: true, force: true });
      }

      await fsPromises.symlink(relativeTarget, publicAssetsPath);

      logger.info('dev-environment.public-assets-symlink.created', {
        appId,
        link: publicAssetsPath,
        target: relativeTarget,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.warn('dev-environment.public-assets-symlink.failure', {
        appId,
        error: errorMessage,
      });
    }
  }

  /**
   * Create a directory symlink with platform-specific handling
   *
   * - Unix/Linux/macOS: Uses standard directory symlink
   * - Windows: Uses junction points for better compatibility (no admin required)
   *
   * @param target - Relative or absolute path to target directory
   * @param link - Path where symlink/junction should be created
   */
  private async createDirectorySymlink(target: string, link: string): Promise<void> {
    const platform = os.platform();

    if (platform === 'win32') {
      // Windows: Use junction points for directory symlinks
      // Junctions don't require admin privileges and work well for local filesystem
      // Note: Target must be absolute path for junctions
      const isRelative = !path.isAbsolute(target);
      const absoluteTarget = isRelative ? path.resolve(path.dirname(link), target) : target;

      await fsPromises.symlink(absoluteTarget, link, 'junction');
    } else {
      // Unix-like: Use standard directory symlink
      await fsPromises.symlink(target, link, 'dir');
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
          if (removed) {containersRemoved++;}
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
            } catch (error) {
              // Fall back to shell commands for stubborn files
              if (process.platform === 'win32') {
                await execa('rmdir', ['/s', '/q', basePath], { reject: false });
              } else {
                if (process.platform === 'darwin') {
                  // Strip macOS extended attributes (e.g. com.apple.provenance) and
                  // ACLs (e.g. deny-delete from Docker bind mounts) that block removal
                  const xattrResult = await execa('/usr/bin/xattr', ['-rc', basePath], { reject: false });
                  const aclResult = await execa('chmod', ['-RN', basePath], { reject: false });
                  if (xattrResult.exitCode !== 0 || aclResult.exitCode !== 0) {
                    logger.debug('dev-environment.reconcile.macos_cleanup_partial', {
                      appId,
                      xattrExitCode: xattrResult.exitCode,
                      aclExitCode: aclResult.exitCode,
                    });
                  }
                }
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
    if (newMatch) {return newMatch[1];}

    // Old pattern: airo-app-{appId}-app-1
    const oldMatch = containerName.match(/^airo-app-([a-f0-9-]+)-app-1$/);
    if (oldMatch) {return oldMatch[1];}

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
   * Get all app directories under apps base directory
   * Returns array of app IDs (directory names)
   */
  private async getAppDirectories(): Promise<string[]> {
    const appsDir = getAppsBaseDir();

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
