import { appendFileSync,existsSync, promises as fsPromises, readFileSync, writeFileSync } from 'fs';
import path from 'path';

import { createAppAdapter, getAdapterType } from './adapters';
import type { IAppAdapter, ServerStatus } from './adapters/interfaces/IAppAdapter';
import { type DevAppInfo,DevDatabase } from './database/DevDatabase';
import { TemplateCopyService } from './services/TemplateCopyService';
import { getAllocPath,getAppPath, getBasePath } from './utils/app-paths';
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
  private adapter: IAppAdapter | null = null;
  private initialized = false;

  private constructor() {
    // Use singleton instance to ensure all managers share the same state
    this.devDb = DevDatabase.getInstance();
    this.portManager = new PortManager(this.devDb);
    this.gitUtils = new GitUtils();
    this.templateService = new TemplateCopyService();
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

      if (existingApp) {
        // Reuse existing ports for error recovery
        port = existingApp.port;
        supervisorPort = existingApp.supervisorPort;
      } else {
        // Allocate new ports for new app
        port = await this.portManager.getNextAvailablePort();

        // Allocate supervisor port if using Docker mode
        if (!this.adapter?.getCapabilities().supportsProcessOperations) {
          supervisorPort = await this.portManager.getNextAvailableSupervisorPort();
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

      // 4. Create or update dev app record
      const devApp = this.devDb.createDevApp({ // eslint-disable-line @typescript-eslint/no-unused-vars
        appId: siteId,
        port,
        supervisorPort,
        appPath,
        templateVersion,
        status: 'creating'
      });

      // 5. Set up template (only runs for new/error apps now)
      // Set up the app using the template copy service
      await this.setupAppFromTemplate(siteId, appPath, name);

      // Generate SSL certificates for HTTPS development
      await this.generateSSLCertificates(siteId, appPath);

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
   */
  private async updateGitignoreForDevSupervisor(appPath: string): Promise<void> {
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
   * Clean up all resources
   */
  async cleanup(): Promise<void> {
    if (this.adapter) {
      await this.adapter.cleanup();
    }
  }
}
