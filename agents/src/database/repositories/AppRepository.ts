import path from 'path';
import { getDatabase } from '../connection.js';
import { GitUtils } from '../../utils/git.js';
import type { App, UpdateAppRequest } from '../schema.js';
import { createForWorkspace } from '../../workspace/index.js';
import { Logger } from '../../logging/index.js';
import { getErrorMessage } from '../../utils/error.js';
import { stripShareToken } from '../../utils/share-token.js';

/**
 * Parameters for registering or updating an app
 */
export interface RegisterAppParams {
  siteId: string;
  name?: string;
  appPath?: string;
  port?: number;
  initialPrompt?: string;
  previewUrl?: string;
  socketPath?: string; // Preview supervisor connection path (TCP URL or Unix socket path)
  publishSupervisorPath?: string; // Publish supervisor connection path (TCP URL) for V4 unified job
  subscriptionId?: string; // Subscription ID from main app
  customerId?: string; // Customer ID from main app
}

/**
 * Result of app registration or update
 */
export interface RegisterAppResult {
  success: boolean;
  message: string;
  app: App;
  created: boolean;
}

export class AppRepository {
  private db = getDatabase();
  private gitUtils = new GitUtils();
  private logger = Logger.create({ component: 'app-repository' });

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
   * Initialize Git repository for a new app, public method for external access
   */
  async initGitRepo(appId: string): Promise<void> {
    const app = this.findById(appId);
    if (!app) {
      this.logger.warn('app.git.init.failed', {
        appId,
        error: 'App not found'
      });
      return;
    }
    await this.initializeGitRepository(appId, app.path, app.name);
  }

  /**
   * Register a new app or update an existing one
   *
   * This function handles the core logic for app registration, including:
   * - Validation and sanitization of inputs
   * - Environment variable constraint checks
   * - Default value calculation
   * - Creating or updating app records
   * - Git repository initialization
   *
   * @param params - Registration parameters including siteId, name, paths, etc.
   * @returns Promise resolving to registration result with app details
   *
   * @throws {Error} If validation fails or database operations fail
   *
   * @example
   * ```typescript
   * const result = await appRepo.registerOrUpdateApp({
   *   siteId: 'my-site',
   *   name: 'My App',
   *   previewUrl: 'https://my-site.example.com'
   * });
   * ```
   */
  async registerOrUpdateApp(params: RegisterAppParams): Promise<RegisterAppResult> {
    const { siteId, name, appPath, port, initialPrompt, previewUrl: rawPreviewUrl, socketPath, publishSupervisorPath, subscriptionId, customerId } = params;
    const previewUrl = rawPreviewUrl !== undefined ? stripShareToken(rawPreviewUrl) : undefined;

    const sanitizedSiteId = siteId.trim();
    const sanitizedName = name?.trim();
    const sanitizedAppPath = appPath?.trim();
    const sanitizedSubscriptionId = subscriptionId?.trim();
    const sanitizedCustomerId = customerId?.trim();

    if (process.env.SITE_ID && process.env.SITE_ID !== sanitizedSiteId) {
      throw new Error('Site ID mismatch: This agent is locked to a specific site and cannot register other sites');
    }

    // In production, CUSTOMER_APP_DIR points directly to preview root
    // In local/dev, we use /preview subdirectory structure for V4 parity
    const finalAppPath = sanitizedAppPath ||
      process.env.CUSTOMER_APP_DIR ||  // Production: use as-is
      (process.env.APPS_BASE_DIR
        ? `${process.env.APPS_BASE_DIR}/${sanitizedSiteId}/preview`  // Local with custom APPS_BASE_DIR
        : `/tmp/airo-app-builder/${sanitizedSiteId}/preview`);  // Local default - stable across restarts

    if (process.env.CUSTOMER_APP_DIR && finalAppPath !== process.env.CUSTOMER_APP_DIR) {
      throw new Error('App path mismatch: This agent is locked to a specific app directory');
    }

    this.logger.info('app.register.begin', {
      appId: sanitizedSiteId,
      hasName: !!sanitizedName,
      hasPath: !!sanitizedAppPath,
      hasPort: !!port,
      hasPreviewUrl: !!previewUrl,
      customerId: sanitizedCustomerId || 'not-provided',
      subscriptionId: sanitizedSubscriptionId || 'not-provided'
    });

    const existingApp = this.findById(sanitizedSiteId);

    if (existingApp) {
      this.logger.info('app.register.exists', {
        appId: sanitizedSiteId,
        updating: !!(sanitizedName || sanitizedAppPath || port || initialPrompt || previewUrl || socketPath || sanitizedSubscriptionId || sanitizedCustomerId)
      });

      const updates: string[] = [];
      const values: any[] = [];

      if (sanitizedName) {
        updates.push('name = ?');
        values.push(sanitizedName);
      }

      if (port !== undefined) {
        updates.push('port = ?');
        values.push(port);
      }

      if (initialPrompt !== undefined) {
        updates.push('initial_prompt = ?');
        values.push(initialPrompt);
      }

      if (previewUrl !== undefined) {
        updates.push('preview_url = ?');
        values.push(previewUrl);
      }

      if (socketPath !== undefined) {
        updates.push('socket_path = ?');
        values.push(socketPath);
      }

      if (publishSupervisorPath !== undefined) {
        updates.push('publish_supervisor_path = ?');
        values.push(publishSupervisorPath);
      }

      if (sanitizedAppPath !== undefined) {
        updates.push('path = ?');
        values.push(sanitizedAppPath);
      }

      // Only set subscription_id if not already set (immutable once stored)
      if (sanitizedSubscriptionId && !existingApp.subscriptionId) {
        updates.push('subscription_id = ?');
        values.push(sanitizedSubscriptionId);
      } else if (existingApp.subscriptionId && sanitizedSubscriptionId && sanitizedSubscriptionId !== existingApp.subscriptionId) {
        this.logger.warn('app.register.subscription_id_change_rejected', {
          appId: sanitizedSiteId,
          reason: 'Cannot change subscription_id once set',
          existingSubscriptionId: existingApp.subscriptionId,
          attemptedSubscriptionId: sanitizedSubscriptionId,
        });
      }

      // Only set customer_id if not already set (immutable once stored)
      if (sanitizedCustomerId && !existingApp.customerId) {
        updates.push('customer_id = ?');
        values.push(sanitizedCustomerId);
      } else if (existingApp.customerId && sanitizedCustomerId && sanitizedCustomerId !== existingApp.customerId) {
        this.logger.warn('app.register.customer_id_change_rejected', {
          appId: sanitizedSiteId,
          reason: 'Cannot change customer_id once set',
          existingCustomerId: existingApp.customerId,
          attemptedCustomerId: sanitizedCustomerId,
        });
      }

      if (updates.length > 0) {
        updates.push('updated_at = ?');
        values.push(new Date().toISOString());
        values.push(sanitizedSiteId);

        const stmt = this.db.prepare(`
          UPDATE apps
          SET ${updates.join(', ')}
          WHERE id = ?
        `);

        stmt.run(...values);

        const updatedApp = this.findById(sanitizedSiteId);
        if (!updatedApp) {
          throw new Error('Failed to retrieve updated app');
        }

        this.logger.info('app.register.updated', {
          appId: sanitizedSiteId,
          fieldsUpdated: updates.length - 1
        });

        return {
          success: true,
          message: 'App updated successfully',
          app: updatedApp,
          created: false
        };
      }

      return {
        success: true,
        message: 'App already registered',
        app: existingApp,
        created: false
      };
    }

    const now = new Date().toISOString();
    const finalPort = port || 3000;
    const finalName = sanitizedName || `App ${sanitizedSiteId}`;
    // Use provided socketPath if available, otherwise generate default path for nomad/prod
    // V4 unified jobs use preview-supervisor.sock and publish-supervisor.sock
    // V3 uses dev-supervisor.sock only
    // For local development with TCP mode, socketPath should be provided by caller
    let finalSocketPath: string | undefined;
    let finalPublishSupervisorPath: string | undefined = publishSupervisorPath;

    if (process.env.NOMAD_ALLOC_DIR) {
      // Nomad/prod: Detect v4 unified job by checking for environment variables
      const previewSocketPathEnv = process.env.AIRO_SUPERVISOR_PREVIEW_SOCKET_PATH;
      const publishSocketPathEnv = process.env.AIRO_SUPERVISOR_PUBLISH_SOCKET_PATH;
      const isV4Unified = !!(previewSocketPathEnv && publishSocketPathEnv);

      // Set socket paths based on architecture
      if (isV4Unified) {
        // V4: Use environment variables directly (no hardcoded fallback)
        finalSocketPath = socketPath || previewSocketPathEnv;
        if (!finalPublishSupervisorPath) {
          finalPublishSupervisorPath = publishSocketPathEnv;
        }
      } else {
        // V3: Use dev supervisor socket path (hardcoded fallback for v3 only)
        finalSocketPath = socketPath || path.join(process.env.NOMAD_ALLOC_DIR, 'tmp', `${sanitizedSiteId}-dev-supervisor.sock`);
        // V3 doesn't have publish supervisor path
      }
    } else if (socketPath) {
      // Local development: Use provided socketPath
      finalSocketPath = socketPath;
    }
    // Local development: Leave undefined if not provided (TCP mode will be used)

    this.logger.info('app.register.create', {
      appId: sanitizedSiteId,
      name: finalName,
      path: finalAppPath,
      port: finalPort,
      socketPath: finalSocketPath,
      publishSupervisorPath: finalPublishSupervisorPath,
      customerId: sanitizedCustomerId || 'not-set',
      subscriptionId: sanitizedSubscriptionId || 'not-set'
    });

    const stmt = this.db.prepare(`
      INSERT INTO apps (id, name, path, port, socket_path, publish_supervisor_path, preview_url, initial_prompt, subscription_id, customer_id, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      sanitizedSiteId,
      finalName,
      finalAppPath,
      finalPort,
      finalSocketPath,
      finalPublishSupervisorPath || null,
      previewUrl || null,
      initialPrompt || null,
      sanitizedSubscriptionId || null,
      sanitizedCustomerId || null,
      'created',
      now,
      now
    );

    const app = this.findById(sanitizedSiteId);
    if (!app) {
      throw new Error('Failed to create app record');
    }

    this.logger.info('app.register.success', {
      appId: sanitizedSiteId,
      name: finalName
    });

    return {
      success: true,
      message: 'App registered successfully',
      app,
      created: true
    };
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
      SELECT id, name, path, port, socket_path, publish_supervisor_path, preview_url, published_url, initial_prompt, template_version, subscription_id, customer_id, status, initial_build_complete, created_at, updated_at
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
      socketPath: row.socket_path,
      publishSupervisorPath: row.publish_supervisor_path,
      previewUrl: row.preview_url,
      publishedUrl: row.published_url,
      initialPrompt: row.initial_prompt,
      templateVersion: row.template_version,
      subscriptionId: row.subscription_id,
      customerId: row.customer_id,
      status: row.status,
      initialBuildComplete: !!row.initial_build_complete,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  /**
   * Find an app by path
   */
  findByPath(path: string): App | null {
    const stmt = this.db.prepare(`
      SELECT id, name, path, port, socket_path, publish_supervisor_path, preview_url, published_url, initial_prompt, template_version, subscription_id, customer_id, status, initial_build_complete, created_at, updated_at
      FROM apps
      WHERE path = ?
    `);

    const row = stmt.get(path) as any;
    if (!row) return null;

    return {
      id: row.id,
      name: row.name,
      path: row.path,
      port: row.port,
      socketPath: row.socket_path,
      publishSupervisorPath: row.publish_supervisor_path,
      previewUrl: row.preview_url,
      publishedUrl: row.published_url,
      initialPrompt: row.initial_prompt,
      templateVersion: row.template_version,
      subscriptionId: row.subscription_id,
      customerId: row.customer_id,
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
      SELECT id, name, path, port, socket_path, publish_supervisor_path, preview_url, published_url, initial_prompt, template_version, subscription_id, customer_id, status, initial_build_complete, created_at, updated_at
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
      socketPath: row.socket_path,
      publishSupervisorPath: row.publish_supervisor_path,
      previewUrl: row.preview_url,
      publishedUrl: row.published_url,
      initialPrompt: row.initial_prompt,
      templateVersion: row.template_version,
      subscriptionId: row.subscription_id,
      customerId: row.customer_id,
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
   * Update the published URL for an app
   */
  updatePublishedUrl(id: string, publishedUrl: string | null): App | null {
    try {
      const existing = this.findById(id);
      if (!existing) return null;

      const stmt = this.db.prepare(`
        UPDATE apps
        SET published_url = ?, updated_at = ?
        WHERE id = ?
      `);

      stmt.run(publishedUrl, new Date().toISOString(), id);

      this.logger.info('app.publishedUrl.updated', {
        appId: id,
        publishedUrl: publishedUrl ? publishedUrl.slice(0, 200) : null,
      });

      return this.findById(id)!;
    } catch (error) {
      this.logger.warn('app.publishedUrl.update.failed', {
        appId: id,
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
   * Delete an app row.
   *
   * Container teardown is owned by the control plane (mhp-core in production,
   * local-control-plane in dev) — the agents service only owns its own DB row.
   * Local dev currently leaks the host workspace directory at
   * /tmp/airo-app-builder/<id>; that's the control plane's job to clean up.
   */
  async delete(id: string): Promise<boolean> {
    await this.initialize();

    if (!this.findById(id)) return false;

    const stmt = this.db.prepare('DELETE FROM apps WHERE id = ?');
    const result = stmt.run(id);

    return result.changes > 0;
  }



  /**
   * Restart development server for an app
   */
  async restartServer(appId: string): Promise<boolean> {
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

    const workspace = createForWorkspace(appId, 'preview');
    if (workspace) {
      try {
        this.logger.info('app.server.restart.workspace.begin', { appId });

        const result = await workspace.tasks.runCommandSync({
          command: 'npm run dev',
          workingDir: '/app',
          timeoutSeconds: 30,
        });

        this.logger.info('app.server.restart.success', {
          appId,
          exitCode: result.exitCode
        });

        return result.exitCode === 0;
      } catch (error) {
        this.logger.error('app.server.restart.workspace.failed', {
          appId,
          error: getErrorMessage(error)
        });
        return false;
      }
    } else {
      this.logger.warn('app.server.restart.no_workspace', { appId });
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
   * Count apps by siteId
   */
  countBySiteId(siteId: string): number {
    const stmt = this.db.prepare('SELECT COUNT(*) as count FROM apps WHERE id = ?');
    const result = stmt.get(siteId) as { count: number };
    return result.count;
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
    // Fallback to basic status (local process management removed)
    return { status: 'created', message: 'App exists in database' };
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
    const adapterType = this.isDockerMode() ? 'Docker' : 'Local';
    return {
      type: adapterType,
      isInitialized: true, // Always initialized now
      capabilities: this.deploymentAdapter?.getCapabilities() || null,
      environmentVariable: process.env.DOC_APPS || 'unset (defaults to Local)'
    };
  }
}
