import { IControlPlaneAdapter, CreateSiteParams, CreateSiteResult, SiteInfo, SecretsResponse, SecretOperations, SecretOperationsResult, SecretsDiffResult, SecretUpdate } from './types';
import { PrismaSiteService } from '@/lib/database/prisma-site-service';
import { getDeploymentAdapter } from '@/lib/deployment';
import { getAllocPath } from '@/lib/dev-environment/utils/app-paths';
import { logger } from '@/lib/request-context';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

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


  /**
   * Get site by ID (handles both jobIds and real appIds)
   */
  async getSite(siteId: string, _jwt: string): Promise<SiteInfo | null> {
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
      orderBy: { created_at: 'desc' }
    });

    return sites.map((site: any) => this.mapToSiteInfo(site));
  }

  /**
   * Delete site using legacy deployment cleanup
   */
  async deleteSite(siteId: string, _jwt: string, _systemId?: string, _subscriptionId?: string): Promise<{ success: boolean; error?: string }> {
    try {
      // Destroy infrastructure
      const deploymentAdapter = getDeploymentAdapter();
      await deploymentAdapter.destroy(siteId);

      // Delete database record
      await this.siteService.deleteSite(siteId);

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
   */
  async deploySite(siteId: string, jwt: string): Promise<{ success: boolean; site: SiteInfo; message: string }> {
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

      // Update status to creating
      await this.siteService.updateSite(siteId, { status: 'creating' });

      // Start background deployment (fire and forget)
      this.deployInBackground(siteId, site.account_id, site.initial_prompt || '');

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
   * Background deployment handler
   * Triggers actual deployment and updates site status when complete
   */
  private async deployInBackground(siteId: string, accountId: string, prompt: string): Promise<void> {
    try {
      const deploymentAdapter = getDeploymentAdapter();
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
  async updateSite(siteId: string, updates: Partial<SiteInfo>, _jwt: string): Promise<SiteInfo | null> {
    try {
      // Update site in database
      const updatedSite = await this.siteService.updateSite(siteId, updates);

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
   * Map database site record to SiteInfo
   */
  private mapToSiteInfo(site: any): SiteInfo {
    return {
      id: site.id,
      name: site.title,
      status: site.status,
      account_id: site.account_id,
      initial_prompt: site.initial_prompt,
      agent_url: site.agent_url,
      backend_url: site.backend_url,
      preview_url: site.preview_url,
      ceph_mount_id: site.ceph_mount_id,
      ceph_dir_number: site.ceph_dir_number,
      created_at: site.created_at,
      updated_at: site.updated_at
    };
  }

  /**
   * Get secrets for an app (Legacy: reads from local JSON files)
   *
   * For preview variant: reads from /tmp/apps/{appId}/alloc/config.json
   * For publish variant: reads from /tmp/apps/{appId}/alloc/publish-config.json
   */
  async getSecrets(appId: string, variant: 'preview' | 'publish', jwt: string): Promise<SecretsResponse> {
    const allocPath = getAllocPath(appId);
    const configFileName = variant === 'preview' ? 'config.json' : 'publish-config.json';
    const configPath = join(allocPath, configFileName);

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
   * For preview variant: writes to /tmp/apps/{appId}/alloc/config.json
   * For publish variant: writes to /tmp/apps/{appId}/alloc/publish-config.json
   */
  async updateSecrets(
    appId: string,
    variant: 'preview' | 'publish',
    operations: SecretOperations,
    jwt: string
  ): Promise<SecretOperationsResult> {
    const { additions = [], updates = [], deletions = [] } = operations;

    const allocPath = getAllocPath(appId);
    await mkdir(allocPath, { recursive: true });

    const configFileName = variant === 'preview' ? 'config.json' : 'publish-config.json';
    const variantPath = join(allocPath, configFileName);

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
    destinationVariant: 'preview' | 'publish',
    jwt: string
  ): Promise<SecretsDiffResult> {
    const allocPath = getAllocPath(appId);

    // Get config file names for each variant
    const sourceFileName = sourceVariant === 'preview' ? 'config.json' : 'publish-config.json';
    const destFileName = destinationVariant === 'preview' ? 'config.json' : 'publish-config.json';

    const sourcePath = join(allocPath, sourceFileName);
    const destPath = join(allocPath, destFileName);

    // Read both files
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
   * @param jwt - Customer JWT token
   * @returns Sync result with operations result
   */
  async syncSecrets(
    appId: string,
    sourceVariant: 'preview' | 'publish',
    destinationVariant: 'preview' | 'publish',
    jwt: string
  ): Promise<SecretOperationsResult> {
    try {
      const allocPath = getAllocPath(appId);

      // Get config file names for each variant
      const sourceFileName = sourceVariant === 'preview' ? 'config.json' : 'publish-config.json';
      const destFileName = destinationVariant === 'preview' ? 'config.json' : 'publish-config.json';

      const sourcePath = join(allocPath, sourceFileName);
      const destPath = join(allocPath, destFileName);

      // Read both files
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

      return await this.updateSecrets(appId, destinationVariant, secretOperations, jwt);
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
