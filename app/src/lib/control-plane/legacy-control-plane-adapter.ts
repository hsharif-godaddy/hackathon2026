import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { PrismaSiteService } from '@/lib/database/prisma-site-service';
import { deploymentAdapter } from '@/lib/deployment';
import { getTaskLocalPath } from '@/lib/dev-environment/utils/app-paths';
import { logger } from '@/lib/request-context';
import { CreateSiteParams, CreateSiteResult, DeploySiteOptions, IControlPlaneAdapter, ImageStatusResponse, ReloadImagesResponse, SecretOperations, SecretOperationsResult, SecretsDiffResult, SecretsResponse, SecretUpdate, SiteInfo } from './types';

/**
 * Legacy Control Plane Adapter - Uses database + Nomad/SQS
 *
 * Implements control plane interface using existing database and deployment systems.
 * Provides backward compatibility with V1 architecture.
 *
 * IMPORTANT: Uses dev-job-{appId} pattern - no separate job storage needed!
 * JobId is just the real appId with a prefix, stripped on lookup.
 */
export class LegacyControlPlaneAdapter implements IControlPlaneAdapter {
  private siteService: PrismaSiteService;
  private static readonly JOB_ID_PREFIX = 'dev-job-'; // Match DevSiteAdapter prefix

  constructor() {
    this.siteService = new PrismaSiteService();
  }

  /**
   * Create site using legacy database + deployment system
   * Returns dev-job-{appId} as jobId (no separate job storage needed!)
   */
  async createSite(params: CreateSiteParams): Promise<CreateSiteResult> {
    try {
      logger.info('legacy-control-plane.create-site.start', {
        accountId: params.accountId
      }, {
        tags: ['security']
      });

      // Create site record in database immediately
      const site = await this.siteService.createSite({
        account_id: params.accountId,
        initial_prompt: params.prompt
      });

      // Create "jobId" by prefixing the real appId (no storage needed!)
      const jobId = `${LegacyControlPlaneAdapter.JOB_ID_PREFIX}${site.id}`;

      // Start deployment in background (non-blocking)
      this.deployInBackground(site.id, params.accountId, params.prompt);

      // Return jobId immediately (matches V2 flow)
      const createdAt = new Date();
      return {
        success: true,
        siteId: jobId, // Return jobId (dev-job-{appId})
        status: 'creating',
        created_at: createdAt,
        name: site.title,
        account_id: params.accountId,
        updated_at: createdAt,
        type: 'job' // Marks as job to trigger polling UX
      };
    } catch (error) {
      logger.error('legacy-control-plane.create-site.error', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        status: 'failed'
      };
    }
  }


  async appExists(siteId: string, jwt: string, _owningProduct?: string): Promise<boolean> {
    const site = await this.getSite(siteId, jwt);
    return site !== null;
  }

  /**
   * Get site by ID (handles both jobIds and real appIds)
   * Note: owningProduct parameter is not used in legacy mode (database-only)
   */
  async getSite(siteId: string, _jwt: string, _owningProduct?: string, _options?: { includeCdn?: boolean }): Promise<SiteInfo | null> {
    // Check if this is a jobId (matches V2 flow)
    if (this.isJobId(siteId)) {
      return await this.jobIdLookup(siteId);
    }

    // Normal appId lookup
    const site = await this.siteService.getSiteById(siteId);

    if (!site) {
      return null;
    }

    return this.mapToSiteInfo(site);
  }

  /**
   * Check if ID is a jobId
   */
  private isJobId(siteId: string): boolean {
    return siteId.startsWith(LegacyControlPlaneAdapter.JOB_ID_PREFIX);
  }

  /**
   * Job ID lookup - strips dev-job- prefix and looks up real site
   * Simple stateless approach - no job registry needed!
   */
  private async jobIdLookup(jobId: string): Promise<SiteInfo | null> {
    // Extract real appId by stripping prefix
    const realAppId = jobId.replace(LegacyControlPlaneAdapter.JOB_ID_PREFIX, '');

    // Look up the actual site
    const site = await this.siteService.getSiteById(realAppId);

    if (!site) {
      return null;
    }

    // Return site with real appId (triggers frontend transition)
    return this.mapToSiteInfo(site);
  }

  /**
   * List all sites for account
   */
  async listSites(_jwt: string): Promise<SiteInfo[]> {
    // Note: In legacy mode, we'd need to extract accountId from JWT
    // For now, return all sites (would need JWT parsing implementation)
    // TODO: Parse JWT to extract accountId and use getSitesByAccountId()

    // Get all sites directly from database
    const prismaClient = (this.siteService as any).client;
    const sites = await prismaClient.sites.findMany({
      orderBy: [
        { updated_at: 'desc' },
        { created_at: 'desc' }
      ]
    });

    return sites.map((site: any) => this.mapToSiteInfo(site));
  }

  /**
   * Delete site using legacy deployment cleanup
   */
  async deleteSite(siteId: string, jwt: string, _systemId?: string, _subscriptionId?: string): Promise<{ success: boolean; error?: string }> {
    try {
      // Resolve siteId (may be a jobId like "dev-job-xxx") to real appId
      const site = await this.getSite(siteId, jwt);
      const resolvedId = site?.id ?? siteId;

      // Destroy infrastructure
      await deploymentAdapter.destroy(resolvedId);

      // Delete database record
      await this.siteService.deleteSite(resolvedId);

      return { success: true };
    } catch (error) {
      logger.error('legacy-control-plane.delete-site.error', {
        siteId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Deploy site
   *
   * Legacy Mode: Triggers manual deployment via background task.
   * Updates site status to 'creating' and starts async deployment.
   *
   * @param siteId - Site identifier
   * @param jwt - Customer JWT token
   * @param _options - Deployment options (unused in legacy mode)
   */
  async deploySite(siteId: string, jwt: string, _options?: DeploySiteOptions): Promise<{ success: boolean; site: SiteInfo; message: string }> {
    try {
      // Get site to validate status
      const site = await this.getSite(siteId, jwt);

      if (!site) {
        throw new Error('Site not found');
      }

      // Check if already deployed or in progress
      if (site.status === 'running') {
        return {
          success: true,
          site,
          message: 'Site is already deployed and running'
        };
      }

      if (site.status === 'creating') {
        return {
          success: true,
          site,
          message: 'Site deployment is already in progress'
        };
      }

      // Only allow deployment for 'init', 'stopped', 'failed' statuses
      if (!['init', 'stopped', 'failed'].includes(site.status)) {
        throw new Error(`Site status '${site.status}' does not allow deployment`);
      }

      // Update status to creating (use site.id, not siteId — siteId may be a jobId like "dev-job-xxx")
      await this.siteService.updateSite(site.id, { status: 'creating' });

      // Start background deployment (fire and forget)
      this.deployInBackground(site.id, site.account_id, site.initial_prompt || '');

      const updatedSite = {
        ...site,
        status: 'creating' as SiteInfo['status']
      };

      return {
        success: true,
        site: updatedSite,
        message: 'Deployment started'
      };
    } catch (error) {
      logger.error('legacy-control-plane.deploy-site.error', {
        siteId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw new Error(`Deploy failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Resume site from hibernation
   *
   * Legacy Mode: Not implemented - hibernation is V2 only
   *
   * @param siteId - Site identifier
   * @param variant - Variant to resume
   * @param _jwt - Customer JWT token (unused)
   */
  async resumeSite(siteId: string, variant: string, _jwt: string): Promise<{ success: boolean; message: string }> {
    logger.warn('legacy-control-plane.resume-site.not-implemented', {
      siteId,
      variant,
      message: 'Hibernation resume is not supported in legacy mode'
    });
    return {
      success: false,
      message: 'Hibernation resume is not supported in legacy mode'
    };
  }

  /**
   * Get image status
   *
   * Legacy Mode: Not implemented - returns 'current' to allow fast-path
   */
  async getImageStatus(siteId: string, _jwt: string): Promise<ImageStatusResponse> {
    logger.warn('legacy-control-plane.get-image-status.not-implemented', {
      siteId,
      message: 'Image status check is not supported in legacy mode'
    });
    return {
      appId: siteId,
      compositionId: '',
      compositionVersion: '',
      unifiedVariantJob: false,
      status: 'current',
    };
  }

  /**
   * Reload images
   *
   * Legacy Mode: Not implemented - returns 'current' to allow fast-path
   */
  async reloadImages(siteId: string, _jwt: string): Promise<ReloadImagesResponse> {
    logger.warn('legacy-control-plane.reload-images.not-implemented', {
      siteId,
      message: 'Image reload is not supported in legacy mode'
    });
    return {
      appId: siteId,
      status: 'current',
      message: 'Not supported in legacy mode',
    };
  }

  /**
   * Background deployment handler
   * Triggers actual deployment and updates site status when complete
   */
  private async deployInBackground(siteId: string, accountId: string, prompt: string): Promise<void> {
    try {
      const site = await this.siteService.getSiteById(siteId);

      if (!site) {
        throw new Error('Site not found');
      }

      const deployResult = await deploymentAdapter.deploy({
        siteId,
        accountId,
        prompt: site.initial_prompt || prompt,
        title: site.title
      });

      if (deployResult.success) {
        // Update site with deployment results
        await this.siteService.updateSite(siteId, {
          status: deployResult.status,
          agent_url: deployResult.urls?.agent,
          backend_url: deployResult.urls?.backend,
          preview_url: deployResult.urls?.preview,
          ...(deployResult.infrastructure?.cephMountId && {
            ceph_mount_id: deployResult.infrastructure.cephMountId,
            ceph_dir_number: deployResult.infrastructure.cephDirNumber
          })
        });
      } else {
        // Deployment failed
        await this.siteService.updateSite(siteId, { status: 'failed' });
        logger.error('legacy-control-plane.deploy-background.failed', {
          siteId,
          error: deployResult.error
        });
      }
    } catch (error) {
      logger.error('legacy-control-plane.deploy-background.error', {
        siteId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      // Update status to failed
      try {
        await this.siteService.updateSite(siteId, { status: 'failed' });
      } catch {
        // Update failed - ignore
      }
    }
  }

  /**
   * Update site
   *
   * Legacy Mode: Updates site metadata in database.
   */
  async updateSite(siteId: string, updates: Partial<SiteInfo>, jwt: string): Promise<SiteInfo | null> {
    try {
      // Resolve siteId (may be a jobId like "dev-job-xxx") to real appId
      const site = await this.getSite(siteId, jwt);
      const resolvedId = site?.id ?? siteId;

      // Update site in database
      const updatedSite = await this.siteService.updateSite(resolvedId, updates);

      if (!updatedSite) {
        return null;
      }

      return this.mapToSiteInfo(updatedSite);
    } catch (error) {
      logger.error('legacy-control-plane.update-site.error', {
        siteId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw new Error(`Update failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Update site variables
   *
   * Legacy Mode: Delegates to updateSite since variables are stored as site metadata.
   * This ensures updated_at is always refreshed.
   */
  async updateSiteVariables(siteId: string, _variableUpdates: Record<string, any>, jwt: string): Promise<SiteInfo | null> {
    // In legacy mode, just call updateSite with empty updates to refresh updated_at
    // The PrismaSiteService always sets updated_at: new Date() on any update
    return this.updateSite(siteId, {}, jwt);
  }

  /**
   * Map database site record to SiteInfo
   */
  private mapToSiteInfo(site: any): SiteInfo {
    // Compute variants based on available URLs
    // If published_url exists, include 'publish' variant (local dev always has preview)
    const variants: string[] = ['preview'];
    if (site.published_url) {
      variants.push('publish');
    }

    return {
      id: site.id,
      name: site.title,
      status: site.status,
      account_id: site.account_id,
      initial_prompt: site.initial_prompt,
      agent_url: site.agent_url,
      backend_url: site.backend_url,
      preview_url: site.preview_url,
      published_url: site.published_url,
      ceph_mount_id: site.ceph_mount_id,
      ceph_dir_number: site.ceph_dir_number,
      created_at: site.created_at,
      updated_at: site.updated_at,
      variants // Include computed variants for local dev
    };
  }

  /**
   * Get secrets for an app (Legacy: reads from local JSON files)
   *
   * Reads from task-local path: /tmp/apps/{appId}/local/{variant}/config.json
   * This is the stable host-readable path that maps to NOMAD_TASK_DIR inside containers.
   */
  async getSecrets(appId: string, variant: 'preview' | 'publish'): Promise<SecretsResponse> {
    const configPath = join(getTaskLocalPath(appId, variant), 'config.json');

    const variantSecrets = await this.readSecretsFile(configPath);

    const secrets = Object.entries(variantSecrets).map(([name, secret]) => ({
      name,
      systemManaged: secret.SYSTEM_MANAGED,
      variants: [variant] as ('preview' | 'publish')[]
    }));

    return {
      appId,
      secrets,
      count: secrets.length
    };
  }

  /**
   * Perform bulk secret operations (Legacy: writes to local JSON files)
   *
   * Writes to task-local path: /tmp/apps/{appId}/local/{variant}/config.json
   * This path is bind-mounted into the container at /local/config.json (NOMAD_TASK_DIR).
   */
  async updateSecrets(
    appId: string,
    variant: 'preview' | 'publish',
    operations: SecretOperations
  ): Promise<SecretOperationsResult> {
    const { additions = [], updates = [], deletions = [] } = operations;

    const taskLocalPath = getTaskLocalPath(appId, variant);
    await mkdir(taskLocalPath, { recursive: true });

    const variantPath = join(taskLocalPath, 'config.json');

    const currentSecrets = await this.readSecretsFile(variantPath);

    let addedCount = 0;
    let updatedCount = 0;
    let deletedCount = 0;

    for (const addition of additions) {
      if (!addition.name || !addition.value) {
        throw new Error('Invalid addition: name and value are required');
      }
      currentSecrets[addition.name] = {
        VALUE: this.parseSecretValue(addition.value),
        SYSTEM_MANAGED: false
      };
      addedCount++;
    }

    for (const update of updates) {
      if (!update.name || !update.value) {
        throw new Error('Invalid update: name and value are required');
      }
      if (currentSecrets[update.name]?.SYSTEM_MANAGED) {
        throw new Error(`Cannot update system-managed secret '${update.name}'`);
      }
      currentSecrets[update.name] = {
        SYSTEM_MANAGED: false,
        VALUE: this.parseSecretValue(update.value)
      };
      updatedCount++;
    }

    for (const name of deletions) {
      if (!name) {
        throw new Error('Invalid deletion: name is required');
      }
      if (name in currentSecrets && !currentSecrets[name].SYSTEM_MANAGED) {
        delete currentSecrets[name];
        deletedCount++;
      }
    }

    // Write secrets to file (which is mounted in container for preview variant)
    await this.writeSecretsFile(variantPath, currentSecrets);

    return {
      success: true,
      message: 'Secret operations completed successfully',
      operations: {
        added: addedCount,
        updated: updatedCount,
        deleted: deletedCount
      }
    };
  }

  /**
   * Read secrets from a JSON file
   */
  private async readSecretsFile(filePath: string): Promise<SecretsStorage> {
    try {
      const content = await readFile(filePath, 'utf8');
      return JSON.parse(content);
    } catch {
      return {};
    }
  }

  /**
   * Write secrets to a JSON file
   */
  private async writeSecretsFile(filePath: string, secrets: SecretsStorage): Promise<void> {
    const dir = dirname(filePath);
    await mkdir(dir, { recursive: true });
    await writeFile(filePath, JSON.stringify(secrets, null, 2));
  }

  /**
   * Parse secret value as JSON if possible, otherwise return as string
   */
  private parseSecretValue(value: string): string | object {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }

  /**
   * Compare secrets between two variants (Legacy: compares local JSON files)
   *
   * Compares non-system-managed secrets only:
   * - added: Secrets in source variant but not in destination
   * - updated: Secrets in both variants but with different values
   * - deleted: Secrets in destination variant but not in source
   *
   * @param appId - Application identifier
   * @param sourceVariant - Source variant to compare from
   * @param destinationVariant - Destination variant to compare to
   * @param jwt - Customer JWT token (not used in legacy mode)
   * @returns Diff result with added, updated, and deleted secret names
   */
  async compareSecrets(
    appId: string,
    sourceVariant: 'preview' | 'publish',
    destinationVariant: 'preview' | 'publish'
  ): Promise<SecretsDiffResult> {
    const sourcePath = join(getTaskLocalPath(appId, sourceVariant), 'config.json');
    const destPath = join(getTaskLocalPath(appId, destinationVariant), 'config.json');

    const sourceSecrets = await this.readSecretsFile(sourcePath);
    const destSecrets = await this.readSecretsFile(destPath);

    // Filter to only non-system-managed secrets
    const sourceUserSecrets: Record<string, string | object> = {};
    const destUserSecrets: Record<string, string | object> = {};

    for (const [name, secret] of Object.entries(sourceSecrets)) {
      if (!secret.SYSTEM_MANAGED) {
        sourceUserSecrets[name] = secret.VALUE;
      }
    }

    for (const [name, secret] of Object.entries(destSecrets)) {
      if (!secret.SYSTEM_MANAGED) {
        destUserSecrets[name] = secret.VALUE;
      }
    }

    // Calculate differences
    const added: string[] = [];
    const updated: string[] = [];
    const deleted: string[] = [];

    // Find added and updated secrets
    for (const [name, sourceSecret] of Object.entries(sourceUserSecrets)) {
      if (!(name in destUserSecrets)) {
        // Secret exists in source but not in destination
        added.push(name);
      } else {
        // Secret exists in both - check if values are different
        const sourceValue = JSON.stringify(sourceSecret);
        const destValue = JSON.stringify(destUserSecrets[name]);

        if (sourceValue !== destValue) {
          updated.push(name);
        }
      }
    }

    // Find deleted secrets (in destination but not in source)
    for (const name of Object.keys(destUserSecrets)) {
      if (!(name in sourceUserSecrets)) {
        deleted.push(name);
      }
    }

    return {
      added,
      updated,
      deleted
    };
  }


  /**
   * Sync secrets between two variants (V2: uses mgmt-airo API)
   *
   * @param appId - Application identifier
   * @param sourceVariant - Source variant to sync from
   * @param destinationVariant - Destination variant to sync to
   * @returns Sync result with operations result
   */
  async syncSecrets(
    appId: string,
    sourceVariant: 'preview' | 'publish',
    destinationVariant: 'preview' | 'publish'
  ): Promise<SecretOperationsResult> {
    try {
      const sourcePath = join(getTaskLocalPath(appId, sourceVariant), 'config.json');
      const destPath = join(getTaskLocalPath(appId, destinationVariant), 'config.json');

      const sourceSecrets = await this.readSecretsFile(sourcePath);
      const destSecrets = await this.readSecretsFile(destPath);

      // Filter to only non-system-managed secrets
      const sourceUserSecrets: Record<string, string | object> = {};
      const destUserSecrets: Record<string, string | object> = {};

      for (const [name, secret] of Object.entries(sourceSecrets)) {
        if (!secret.SYSTEM_MANAGED) {
          sourceUserSecrets[name] = secret.VALUE;
        }
      }

      for (const [name, secret] of Object.entries(destSecrets)) {
        if (!secret.SYSTEM_MANAGED) {
          destUserSecrets[name] = secret.VALUE;
        }
      }

      // Calculate differences
      const added: SecretUpdate[] = [];
      const updated: SecretUpdate[] = [];
      const deleted: string[] = [];

      // Find added and updated secrets
      for (const [name, sourceSecret] of Object.entries(sourceUserSecrets)) {
        if (!(name in destUserSecrets)) {
          // Secret exists in source but not in destination
          added.push({name, value: typeof sourceSecret === 'string' ? sourceSecret : JSON.stringify(sourceSecret)});
        } else {
          // Secret exists in both - check if values are different
          const sourceValue = JSON.stringify(sourceSecret);
          const destValue = JSON.stringify(destUserSecrets[name]);

          if (sourceValue !== destValue) {
            updated.push({name, value: typeof sourceSecret === 'string' ? sourceSecret : JSON.stringify(sourceSecret)});
          }
        }
      }

      // Find deleted secrets (exists in destination but not in source)
      for (const name of Object.keys(destUserSecrets)) {
        if (!(name in sourceUserSecrets)) {
          deleted.push(name);
        }
      }

      const secretOperations: SecretOperations = {
        additions: added,
        updates: updated,
        deletions: deleted
      };

      return await this.updateSecrets(appId, destinationVariant, secretOperations);
    } catch (error: any) {
      // Re-throw 401 for auth redirect
      if (error.status === 401) {
        throw error;
      }
      logger.error('legacy-control-plane.sync-secrets.error', {
        appId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }
}

/**
 * Secret stored in JSON files
 */
interface StoredSecret {
  VALUE: string | object;
  SYSTEM_MANAGED: boolean;
}

/**
 * Secrets storage structure from JSON files
 */
interface SecretsStorage {
  [key: string]: StoredSecret;
}
