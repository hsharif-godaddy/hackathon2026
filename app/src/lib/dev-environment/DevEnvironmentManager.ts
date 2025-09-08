import type { Database } from 'better-sqlite3';
import { DevDatabase, type DevAppInfo } from './database/DevDatabase';
import { PortManager } from './utils/port-manager';
import { GitUtils } from './utils/git';
import { TemplateCopyService } from './services/TemplateCopyService';
import { createAppAdapter, getAdapterType } from './adapters';
import type { IAppAdapter } from './adapters/interfaces/IAppAdapter';

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
 */
export class DevEnvironmentManager {
  private devDb: DevDatabase;
  private portManager: PortManager;
  private gitUtils: GitUtils;
  private templateService: TemplateCopyService;
  private adapter: IAppAdapter | null = null;
  private initialized = false;

  constructor(database: Database) {
    this.devDb = new DevDatabase(database);
    this.portManager = new PortManager(this.devDb);
    this.gitUtils = new GitUtils();
    this.templateService = new TemplateCopyService();
  }

  /**
   * Initialize the dev environment manager
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Initialize dev-specific database tables
    this.devDb.initializeTables();

    // Initialize the appropriate adapter using the factory
    const adapterType = getAdapterType();
    // Only log adapter initialization in development to reduce noise
    if (process.env.NODE_ENV === 'development') {
      console.log(`🔧 Initializing ${adapterType} adapter for dev environment`);
    }

    this.adapter = await createAppAdapter(this.devDb);
    await this.adapter.initialize();

    this.initialized = true;
    // Only log in development to reduce noise
    if (process.env.NODE_ENV === 'development') {
      console.log('✅ DevEnvironmentManager initialized');
    }
  }

  /**
   * Create a new development app
   * Handles the complete lifecycle: directory, template, dependencies, git, dev server
   */
  async createDevApp(request: CreateDevAppRequest): Promise<DevAppResult> {
    await this.initialize();

    const { siteId, name, initialPrompt, templateVersion = 'v8' } = request;

    try {
      console.log(`🚀 Creating dev app: ${name} (${siteId})`);

      // 1. Allocate a port
      const port = await this.portManager.getNextAvailablePort();
      console.log(`📡 Allocated port ${port} for app ${siteId}`);

      // 2. Determine app path
      const baseAppsDir = process.env.LOCAL_APPS_DIR || '/tmp/apps';
      const appPath = `${baseAppsDir}/${siteId}`;

      // 3. Create dev app record
      const devApp = this.devDb.createDevApp({
        appId: siteId,
        port,
        appPath,
        templateVersion,
        status: 'creating'
      });

      console.log(`💾 Created dev app record for ${siteId}`);

      // 4. Set up the app using the template copy service
      await this.setupAppFromTemplate(siteId, appPath, name, templateVersion);

      // 5. Initialize Git repository
      await this.initializeGitRepository(siteId, appPath, name);

      // 6. Update status to created
      this.devDb.updateDevAppStatus(siteId, 'created');

      // 7. Generate URLs
      const urls = {
        frontend: `http://localhost:${port}`,
        ...(templateVersion === 'v3' && { backend: `http://localhost:${port + 1000}` })
      };

      console.log(`✅ Dev app ${siteId} created successfully`);

      return {
        success: true,
        appId: siteId,
        port,
        appPath,
        templateVersion,
        urls
      };

    } catch (error) {
      console.error(`❌ Failed to create dev app ${siteId}:`, error);

      // Cleanup on failure
      try {
        await this.cleanupDevApp(siteId);
      } catch (cleanupError) {
        console.error(`Failed to cleanup after error:`, cleanupError);
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
      console.error('No adapter available to start dev server');
      return false;
    }

    try {
      const success = await this.adapter.startApp(appId);
      if (success) {
        this.devDb.updateDevAppStatus(appId, 'running');
      }
      return success;
    } catch (error) {
      console.error(`Failed to start dev server for ${appId}:`, error);
      return false;
    }
  }

  /**
   * Stop the development server for an app
   */
  async stopDevServer(appId: string): Promise<boolean> {
    await this.initialize();

    if (!this.adapter) {
      console.error('No adapter available to stop dev server');
      return false;
    }

    try {
      const success = await this.adapter.stopApp(appId);
      if (success) {
        this.devDb.updateDevAppStatus(appId, 'stopped');
      }
      return success;
    } catch (error) {
      console.error(`Failed to stop dev server for ${appId}:`, error);
      return false;
    }
  }

  /**
   * Get the status of a dev app
   */
  async getDevAppStatus(appId: string) {
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

    return { status: devApp.status, message: 'No adapter available' };
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
    } catch (error) {
      console.error('Failed to get running servers:', error);
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

      console.log(`🗑️ Dev app ${appId} deleted successfully`);
      return true;

    } catch (error) {
      console.error(`Failed to delete dev app ${appId}:`, error);
      return false;
    }
  }

  /**
   * Set up app from template using TemplateCopyService
   */
  private async setupAppFromTemplate(appId: string, appPath: string, appName: string, templateVersion: string): Promise<void> {
    console.log(`📋 Setting up app ${appId} from template ${templateVersion} at ${appPath}`);
    
    try {
      const result = await this.templateService.copyTemplate({
        appId,
        appPath,
        appName,
        templateDir: process.env.APP_TEMPLATE_DIR || `app-templates/${templateVersion}`
      });

      if (result.success) {
        console.log(`✅ Template setup completed for app ${appId}`);
      } else {
        throw new Error('Template copy failed');
      }
    } catch (error) {
      console.error(`❌ Template setup failed for app ${appId}:`, error);
      throw error;
    }
  }

  /**
   * Initialize Git repository for the app
   */
  private async initializeGitRepository(appId: string, appPath: string, appName: string): Promise<void> {
    try {
      console.log(`🔧 Initializing Git repository for ${appId}`);

      // Initialize the Git repository
      const initResult = await this.gitUtils.initRepository(appPath);
      if (!initResult.success) {
        console.warn(`Git init failed for ${appId}:`, initResult.stderr);
        return;
      }

      // Configure Git user
      try {
        await this.gitUtils.configureUser(appPath, 'Airo AI Builder', 'ai@airo.dev');
      } catch (configError) {
        console.warn(`Git config failed for ${appId}:`, configError);
      }

      // Create initial commit
      try {
        const commitResult = await this.gitUtils.createInitialCommit(
          appPath,
          `Initial commit for ${appName}\n\nGenerated by Airo AI Builder with template files.`
        );

        if (commitResult.success) {
          console.log(`✅ Initial commit created for ${appId}`);
        } else {
          console.warn(`Initial commit failed for ${appId}:`, commitResult.stderr);
        }
      } catch (commitError) {
        console.warn(`Git commit failed for ${appId}:`, commitError);
      }

    } catch (error) {
      console.warn(`Git setup failed for ${appId}:`, error);
    }
  }

  /**
   * Clean up a dev app (used on creation failure)
   */
  private async cleanupDevApp(appId: string): Promise<void> {
    console.log(`🧹 Cleaning up dev app ${appId}`);

    // Stop and remove via adapter
    if (this.adapter) {
      try {
        await this.adapter.stopApp(appId);
        await this.adapter.removeApp(appId);
      } catch (error) {
        console.warn(`Adapter cleanup failed for ${appId}:`, error);
      }
    }

    // Remove from dev database
    try {
      this.devDb.deleteDevApp(appId);
    } catch (error) {
      console.warn(`Database cleanup failed for ${appId}:`, error);
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
   * Clean up all resources
   */
  async cleanup(): Promise<void> {
    if (this.adapter) {
      await this.adapter.cleanup();
    }
  }
}