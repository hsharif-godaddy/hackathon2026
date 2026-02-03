import { AIRO_OWNER_PRODUCTS, AIRO_PRODUCT_IDS, AiroMgmtClient } from '@/lib/mgmt-airo';
import { logger } from '@/lib/request-context';
import { getDatacenterFromMarketId } from '@/lib/utils/dc-mapping';
import { extractCustomerId } from '@/lib/utils/jwt-utils';
import { useSubscriptionCacheStore } from '@/stores/useSubscriptionCacheStore';
import { CreateSiteParams, CreateSiteResult, DeploySiteOptions, IControlPlaneAdapter, SecretOperations, SecretOperationsResult, SecretsDiffResult, SecretsResponse, SecretUpdate, SiteInfo, SiteStatus, SiteVariant } from './types';

/**
 * ID length constants for distinguishing job IDs from app IDs
 */
const APP_ID_LENGTH = 10; // App IDs are exactly 10 chars (nanoId format)

/**
 * Transform backend variants to SiteVariant format
 * Handles both old format (string[]) and new format (with lifecycle)
 */
function transformVariants(variants: unknown): SiteVariant[] | undefined {
  if (!variants || !Array.isArray(variants)) {
    return undefined;
  }

  return variants.map((v: unknown) => {
    // Old format: just a string like "preview" or "publish"
    if (typeof v === 'string') {
      return { variant: v, status: 'active' };
    }

    // New format: object with variant and lifecycle
    if (typeof v === 'object' && v !== null) {
      const obj = v as Record<string, unknown>;
      return {
        variant: String(obj.variant || ''),
        status: String(obj.status || 'active'),
        lifecycle: obj.lifecycle as SiteVariant['lifecycle'],
        lastActivityTime: obj.lastActivityTime as string | undefined,
      };
    }

    return { variant: String(v), status: 'active' };
  });
}

/**
 * Check if app has been published (has publish variant)
 * Works with both transformed SiteVariant[] and raw backend data
 */
function hasPublishVariant(variants: unknown): boolean {
  if (!variants || !Array.isArray(variants)) {
    return false;
  }

  return variants.some((v: unknown) => {
    if (typeof v === 'string') return v === 'publish';
    if (typeof v === 'object' && v !== null) {
      return (v as Record<string, unknown>).variant === 'publish';
    }
    return false;
  });
}

/**
 * V2 Control Plane Adapter
 *
 * Uses mgmt-airo + mgmt-hosting APIs via AiroMgmtClient.
 * During creation, returns temporary jobId which transitions to permanent appId once ready.
 */
export class V2ControlPlaneAdapter implements IControlPlaneAdapter {
  private mgmtAiroBaseUrl: string;

  constructor() {
    this.mgmtAiroBaseUrl = process.env.MGMT_AIRO_BASE_URL || 'https://mgmt.nstk.net';
  }

  private createClient(jwt: string): AiroMgmtClient {
    return new AiroMgmtClient({
      baseUrl: this.mgmtAiroBaseUrl,
      jwt,
      maxRetries: 3,
      retryDelayMs: 1000
    });
  }

  private generateTitle(prompt: string): string {
    if (!prompt || prompt.trim().length === 0) {
      return 'Untitled Project';
    }
    let title = prompt.trim().substring(0, 50).replace(/\s+/g, ' ').trim();
    if (prompt.length > 50) title += '...';
    return title;
  }
  async createSite(params: CreateSiteParams): Promise<CreateSiteResult> {
    try {
      const client = this.createClient(params.jwt);
      const generatedTitle = this.generateTitle(params.prompt);
      const alwaysNewSubscription = process.env.ALWAYS_NEW_SUBSCRIPTION === 'true';
      const targetSubscriptionId = process.env.AIRO_SUBSCRIPTION_ID;

      let selectedSubscription = null;

      if (!alwaysNewSubscription) {
        try {
          if (targetSubscriptionId) {
            // Find specific subscription by ID
            const allSubscriptions = await client.getSubscriptions(AIRO_OWNER_PRODUCTS.AIRO_APP_BUILDER);
            selectedSubscription = allSubscriptions.find(sub => sub.id === targetSubscriptionId);

            if (!selectedSubscription) {
              logger.warn('v2-control-plane.create-site.target-subscription-not-found', {
                targetSubscriptionId,
                availableSubscriptions: allSubscriptions.map(s => s.id)
              });
              // Fall back to active subscription
              selectedSubscription = await client.getActiveSubscription();
            }
          } else {
            // Use active subscription (existing behavior)
            selectedSubscription = await client.getActiveSubscription();
          }
        } catch (error: any) {
          // Re-throw 401 for auth redirect
          if (error.status === 401) {
            throw error;
          }
          // If we get 403 or 404, customer doesn't exist in mgmt-airo yet - proceed to signup
          // 403 = forbidden (no customer record)
          // 404 = not found (customer record doesn't exist for brand new accounts)
          if (error.status === 403 || error.status === 404) {
            selectedSubscription = null;
          } else {
            // Re-throw other errors
            throw error;
          }
        }
      }

      if (selectedSubscription && !alwaysNewSubscription) {
        const systems = await client.getSystems(selectedSubscription.id);
        if (systems.length === 0) {
          throw new Error('Subscription has no systems - cannot add app');
        }

        const systemId = systems[0].id;

        const response = await client.createApp(selectedSubscription.id, systemId, {
          appTemplateName: 'default',
          variants: ['preview'],
          variables: {
            initialPrompt: params.prompt,
            title: generatedTitle,
            airoSubscriptionId: selectedSubscription.id
          }
        });

        const createdAt = new Date();
        return {
          success: true,
          siteId: response.statusJobId,
          status: 'creating',
          created_at: createdAt,
          name: generatedTitle,
          account_id: params.accountId,
          updated_at: createdAt,
          type: 'job'
        };
      }

      const response = await client.signup({
        datacenter: process.env.MGMT_AIRO_DATACENTER || getDatacenterFromMarketId(params.marketId),
        isTrial: true,
        productId: params.productId || process.env.MGMT_AIRO_PRODUCT_ID || AIRO_PRODUCT_IDS.AAB_V1,
        initialPrompt: params.prompt,
        appConfigs: [{
          templateName: 'default',
          variants: ['preview'],
          variables: {
            initialPrompt: params.prompt,
            title: generatedTitle
          }
        }]
      });

      logger.info('v2-control-plane.create-site.signup.success', {
        jobId: response.statusJobId
      }, {
        tags: ['security']
      });

      const createdAt = new Date();
      return {
        success: true,
        siteId: response.statusJobId,
        status: 'creating',
        created_at: createdAt,
        name: generatedTitle,
        account_id: params.accountId,
        updated_at: createdAt,
        type: 'job'
      };
    } catch (error: any) {
      // Re-throw 401 for auth redirect
      if (error.status === 401) {
        throw error;
      }
      logger.error('v2-control-plane.create-site.error', {
        error
      }, {
        tags: ['security']
      });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        status: 'failed'
      };
    }
  }



  /**
   * Check if subscription cache is stale and needs refreshing
   */
  private isCacheStale(cache: ReturnType<typeof useSubscriptionCacheStore.getState>): boolean {
    if (!cache.lastRefresh) return true;
    return Date.now() - cache.lastRefresh > cache.CACHE_TTL;
  }

  /**
   * Direct app lookup using cached subscription and system IDs
   * Makes a single API call instead of searching through all subscriptions and systems
   */
  private async directAppLookup(
    appId: string,
    subscriptionId: string,
    systemId: string,
    jwt: string,
    customerId?: string
  ): Promise<SiteInfo | null> {
    const client = this.createClient(jwt);

    try {
      // SINGLE API CALL - Direct app fetch with CDN info for domains
      const app = await client.getApp(subscriptionId, systemId, appId, true);

      // Use provided customerId or fallback to cache
      const cache = useSubscriptionCacheStore.getState();
      return this.mapAppToSiteInfo(app, customerId || cache.customerId || undefined);
    } catch (error: any) {
      if (error.status === 404) {
        // App moved or deleted - invalidate cache
        const cache = useSubscriptionCacheStore.getState();
        cache.removeAppFromCache(appId);
        return null;
      }

      throw error;
    }
  }

  /**
   * Fallback to job ID lookup for sites that are still being created
   */
  private async jobIdLookup(siteId: string, jwt: string, customerId?: string): Promise<SiteInfo | null> {
    // Only try job lookup if length suggests it's a job ID
    // Job IDs are shorter than app IDs (app IDs are exactly APP_ID_LENGTH chars)
    if (siteId.length === APP_ID_LENGTH) {
      return null;
    }

    try {
      const client = this.createClient(jwt);
      const jobStatus = await client.getAiroJobApps(siteId);

      if (jobStatus.apps && jobStatus.apps.length === 0) {
        return {
          id: siteId,
          name: 'Provisioning...',
          status: 'creating',
          account_id: customerId || 'unknown',
          created_at: new Date(),
          updated_at: new Date()
        };
      }

      if (jobStatus.apps && jobStatus.apps.length > 0) {
        const jobApp = jobStatus.apps[0];

        // Only return job data if it's complete (has systemId and subscriptionId)
        // If systemId/subscriptionId is missing, try to look it up in cache first
        if (jobApp.systemId && jobApp.subscriptionId) {
          return this.mapAppToSiteInfo(jobApp, customerId);
        } else if (jobApp.id) {
          // We have an app ID but missing metadata - try to look it up in cache
          const subscriptionCache = useSubscriptionCacheStore.getState();
          let appLocation = subscriptionCache.getAppLocation(jobApp.id);

          // If app not in cache, refresh cache to pick up newly created apps
          if (!appLocation) {
            await subscriptionCache.refresh(jwt, true);
            appLocation = subscriptionCache.getAppLocation(jobApp.id);
          }

          if (appLocation) {
            // Fetch the full app data using the cache location
            try {
              return await this.directAppLookup(
                jobApp.id,
                appLocation.subscriptionId,
                appLocation.systemId,
                jwt,
                customerId
              );
            } catch (error) {
              logger.warn('v2-control-plane.job-id-lookup.cache-fetch-failed', {
                appId: jobApp.id,
                error: error instanceof Error ? error.message : String(error)
              });
              // Fall through to "creating" status
            }
          }

          // Return "creating" status with REAL APP ID so frontend can transition from job ID to app ID
          return {
            id: jobApp.id, // Use real app ID, not job ID
            name: 'Provisioning...',
            status: 'creating',
            account_id: 'unknown',
            created_at: new Date(),
            updated_at: new Date()
          };
        } else {
          // Return "creating" status so frontend continues polling
          return {
            id: siteId,
            name: 'Provisioning...',
            status: 'creating',
            account_id: 'unknown',
            created_at: new Date(),
            updated_at: new Date()
          };
        }
      }

      return null;
    } catch {
      return null;
    }
  }

  async getSite(siteId: string, jwt: string, owningProduct?: string): Promise<SiteInfo | null> {
    try {
      const customerId = extractCustomerId(jwt);
      if (!customerId) {
        throw new Error('Failed to extract customer ID from JWT');
      }

      // Skip cache if looking for non-AIRO products
      // Cache only contains AIRO_APP_BUILDER apps, so cross-product queries must bypass it
      const shouldSkipCache = owningProduct && owningProduct !== AIRO_OWNER_PRODUCTS.AIRO_APP_BUILDER;

      // Try cache-based lookup first (fastest - in-memory, only for AAB apps)
      if (!shouldSkipCache) {
        // Get subscription cache
        const subscriptionCache = useSubscriptionCacheStore.getState();

        // Initialize cache on first use
        if (!subscriptionCache.customerId) {
          await subscriptionCache.initialize(jwt);
        }

        // Refresh cache if stale (background refresh)
        if (this.isCacheStale(subscriptionCache)) {
          // Non-blocking refresh
          subscriptionCache.refresh(jwt, false);
        }

        // Try cache-based direct lookup
        const location = subscriptionCache.getAppLocation(siteId);
        if (location) {
          try {
            const result = await this.directAppLookup(
              siteId,
              location.subscriptionId,
              location.systemId,
              jwt,
              customerId || undefined
            );

            if (result) {
              return result;
            }
          } catch (error) {
            logger.warn('v2-control-plane.get-site.cache-lookup-failed', {
              siteId,
              error: error instanceof Error ? error.message : String(error)
            });
            // Continue to fallback methods
          }
        }

        // If cache miss or direct lookup failed, force refresh and try again
        await subscriptionCache.refresh(jwt, true);

        const retryLocation = subscriptionCache.getAppLocation(siteId);
        if (retryLocation) {
          try {
            const result = await this.directAppLookup(
              siteId,
              retryLocation.subscriptionId,
              retryLocation.systemId,
              jwt,
              customerId || undefined
            );

            if (result) {
              return result;
            }
          } catch (error) {
            logger.warn('v2-control-plane.get-site.refreshed-cache-lookup-failed', {
              siteId,
              error: error instanceof Error ? error.message : String(error)
            });
            // Continue to full search logic (job lookup happens after cache attempts)
          }
        }
      }

      // Try job ID lookup second (for sites that are still being created)
      const jobResult = await this.jobIdLookup(siteId, jwt, customerId || undefined);
      if (jobResult) {
        // Filter by owningProduct if specified AND job result has ownerProduct
        // Skip filtering if ownerProduct is missing (site still being created)
        if (owningProduct && jobResult.ownerProduct && jobResult.ownerProduct !== owningProduct) {
          return null;
        }
        return jobResult;
      }

      // Final fallback: traditional full search across subscriptions
      const client = this.createClient(jwt);

      // Search by app ID across subscriptions
      try {
        await client.checkCustomer();
      } catch (error: any) {
        // Re-throw 401 for auth redirect
        if (error.status === 401) {
          throw error;
        }
        if (error.message?.includes('Rate limited')) {
          throw error;
        }
        return null;
      }

      // Use ownerProduct for forward compatibility
      const productFilter = owningProduct || AIRO_OWNER_PRODUCTS.AIRO_APP_BUILDER;
      const subscriptions = await client.getSubscriptions(productFilter);

      for (const sub of subscriptions) {
        const systems = await client.getSystems(sub.id);

        if (systems.length === 0) {
          continue;
        }

        for (const system of systems) {
          try {
            const apps = await client.getAppsForSystem(sub.id, system.id);
            const matchingApp = apps.find(app => app.id === siteId);

            if (matchingApp) {
              // getAppsForSystem returns summary data without variables
              // Fetch full app details to get variables (including initialPrompt) and CDN info
              try {
                const fullApp = await client.getApp(sub.id, system.id, matchingApp.id, true);
                return this.mapAppToSiteInfo(fullApp, customerId);
              } catch (fetchError) {
                logger.warn('v2-control-plane.get-site.full-app-fetch-failed', {
                  siteId,
                  error: fetchError instanceof Error ? fetchError.message : 'Unknown error'
                });
                return this.mapAppToSiteInfo(matchingApp, customerId);
              }
            }
          } catch (error) {
            logger.warn('v2-control-plane.get-site.system-search-failed', {
              siteId,
              subscriptionId: sub.id,
              systemId: system.id
            });
          }
        }
      }

      return null;
    } catch (error: any) {
      // Re-throw 401 for auth redirect
      if (error.status === 401) {
        throw error;
      }
      logger.error('v2-control-plane.get-site.error', {
        siteId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return null;
    }
  }

  async listSites(jwt: string): Promise<SiteInfo[]> {
    try {
      const customerId = extractCustomerId(jwt);
      if (!customerId) {
        return [];
      }

      const client = this.createClient(jwt);
      const apps = await client.getAllAppsForCustomer(AIRO_OWNER_PRODUCTS.AIRO_APP_BUILDER);
      const sites = apps.map(app => this.mapAppToSiteInfo(app, customerId));

      return sites.sort((a, b) => {
        const updatedA = new Date(a.updated_at).getTime();
        const updatedB = new Date(b.updated_at).getTime();
        const updatedDiff = updatedB - updatedA;
        if (updatedDiff !== 0) {
          return updatedDiff;
        }
        const createdA = new Date(a.created_at).getTime();
        const createdB = new Date(b.created_at).getTime();
        return createdB - createdA;
      });
    } catch (error: any) {
      // Re-throw 401 for auth redirect
      if (error.status === 401) {
        throw error;
      }
      logger.error('v2-control-plane.list-sites.error', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return [];
    }
  }

  /**
   * Find app metadata (systemId and subscriptionId) by app ID
   *
   * This is a lightweight lookup that skips job ID polling logic.
   * Used by deleteSite and other operations that need metadata for existing apps.
   *
   * @param appId - The app ID to search for
   * @param jwt - JWT token for authentication
   * @returns Object with systemId and subscriptionId, or null if not found
   */
  private async findAppMetadata(
    appId: string,
    jwt: string
  ): Promise<{ systemId: string; subscriptionId: string } | null> {
    try {
      const customerId = extractCustomerId(jwt);
      if (!customerId) {
        return null;
      }

      // Try cache first
      const subscriptionCache = useSubscriptionCacheStore.getState();
      const location = subscriptionCache.getAppLocation(appId);

      if (location) {
        return {
          systemId: location.systemId,
          subscriptionId: location.subscriptionId
        };
      }

      // If cache miss, initialize/refresh cache
      if (!subscriptionCache.customerId) {
        await subscriptionCache.initialize(jwt);

        // Check cache again after initialization
        const refreshedLocation = subscriptionCache.getAppLocation(appId);
        if (refreshedLocation) {
          return {
            systemId: refreshedLocation.systemId,
            subscriptionId: refreshedLocation.subscriptionId
          };
        }
      } else if (this.isCacheStale(subscriptionCache)) {
        // Force refresh if stale
        await subscriptionCache.refresh(jwt, true);

        // Check cache again after refresh
        const refreshedLocation = subscriptionCache.getAppLocation(appId);
        if (refreshedLocation) {
          return {
            systemId: refreshedLocation.systemId,
            subscriptionId: refreshedLocation.subscriptionId
          };
        }
      }

      // Fallback to traditional search
      const client = this.createClient(jwt);

      try {
        await client.checkCustomer();
      } catch (error: any) {
        // Re-throw 401 for auth redirect
        if (error.status === 401) {
          throw error;
        }
        if (error.message?.includes('Rate limited')) {
          throw error;
        }
        return null;
      }

      // Use ownerProduct for forward compatibility
      const subscriptions = await client.getSubscriptions(AIRO_OWNER_PRODUCTS.AIRO_APP_BUILDER);

      for (const sub of subscriptions) {
        const systems = await client.getSystems(sub.id);

        if (systems.length === 0) {
          continue;
        }

        for (const system of systems) {
          try {
            const apps = await client.getAppsForSystem(sub.id, system.id);
            const matchingApp = apps.find(app => app.id === appId);

            if (matchingApp) {
              // Update cache with found location
              subscriptionCache.refresh(jwt, false);

              return {
                systemId: system.id,
                subscriptionId: sub.id
              };
            }
          } catch {
            // System search failed, continue to next
          }
        }
      }

      logger.warn('v2-control-plane.find-app-metadata.not-found', { appId });
      return null;
    } catch (error: any) {
      // Re-throw 401 for auth redirect
      if (error.status === 401) {
        throw error;
      }
      logger.error('v2-control-plane.find-app-metadata.error', {
        appId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return null;
    }
  }

  async deleteSite(siteId: string, jwt: string, systemId?: string, subscriptionId?: string): Promise<{ success: boolean; error?: string }> {
    try {
      const client = this.createClient(jwt);

      let effectiveSystemId = systemId;
      let effectiveSubscriptionId = subscriptionId;

      if (!effectiveSystemId || !effectiveSubscriptionId) {
        const siteMetadata = await this.findAppMetadata(siteId, jwt);
        if (!siteMetadata) {
          return { success: false, error: 'Site not found or missing required IDs' };
        }
        effectiveSystemId = siteMetadata.systemId;
        effectiveSubscriptionId = siteMetadata.subscriptionId;
      }

      await client.deleteApp(effectiveSubscriptionId, effectiveSystemId, siteId);

      // Invalidate and reprime cache after deletion to ensure consistency
      const subscriptionCache = useSubscriptionCacheStore.getState();
      subscriptionCache.invalidate();
      await subscriptionCache.refresh(jwt, true);

      return { success: true };
    } catch (error: any) {
      // Re-throw 401 for auth redirect
      if (error.status === 401) {
        throw error;
      }
      logger.error('v2-control-plane.delete-site.error', {
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
   * Uses: PUT /airo/v1/systems/:systemId/apps/:appId/deploy
   * Triggers redeployment of the app (e.g., after code changes or configuration updates)
   *
   * IMPORTANT: In V2, deployment happens automatically during signup.
   * This method is primarily for re-deployments after the app exists.
   * If called during initial creation (with job ID), it gracefully indicates deployment is in progress.
   *
   * @param siteId - Site identifier
   * @param jwt - Customer JWT token
   * @param options - Optional deployment options (variant, resumeFromHibernation)
   */
  async deploySite(siteId: string, jwt: string, options?: DeploySiteOptions): Promise<{ success: boolean; site: SiteInfo; message: string; note?: string }> {
    try {
      // Get site to find systemId
      const site = await this.getSite(siteId, jwt);

      if (!site) {
        // If site is not found, it might be because:
        // 1. The siteId is a job ID and the workflow hasn't completed yet
        // 2. The site doesn't exist
        // Return a graceful response indicating deployment is in progress
        return {
          success: true,
          site: {
            id: siteId,
            name: 'Creating...',
            status: 'creating',
            account_id: 'pending',
            created_at: new Date(),
            updated_at: new Date()
          },
          message: 'Deployment in progress via V2 signup workflow',
          note: 'V2 apps deploy automatically during creation - no manual trigger needed'
        };
      }

      if (!site.system_id) {
        // Site exists but doesn't have system_id yet - still being provisioned
        return {
          success: true,
          site,
          message: 'App provisioning in progress',
          note: 'System ID not yet available - app is being provisioned by V2 workflow'
        };
      }

      // Check if app is already running/active - V2 deploys automatically
      if (site.status === 'running' || site.status === 'created') {
        return {
          success: true,
          site,
          message: 'App is already deployed and running',
          note: 'V2 apps deploy automatically during creation - app is ready'
        };
      }

      if (!site.subscription_id) {
        return {
          success: false,
          site,
          message: 'Subscription ID not found - cannot deploy app'
        };
      }

      const client = this.createClient(jwt);
      await client.deployApp(site.subscription_id, site.system_id, siteId);

      const updatedSite = await this.getSite(siteId, jwt);
      return {
        success: true,
        site: updatedSite || site,
        message: options?.resumeFromHibernation ? 'Resume from hibernation triggered successfully' : 'Deployment triggered successfully'
      };
    } catch (error: any) {
      // Re-throw 401 for auth redirect (preserve original error with status)
      if (error.status === 401) {
        throw error;
      }
      logger.error('v2-control-plane.deploy-site.error', {
        siteId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw new Error(`Deploy failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Resume site variant from hibernation
   *
   * Uses: PUT /airo/v1/subscriptions/:subscriptionId/systems/:systemId/apps/:appId/deploy
   * with environment and variant set to the target variant
   *
   * @param siteId - Site identifier
   * @param variant - Variant to resume (e.g., 'preview', 'publish')
   * @param jwt - Customer JWT token
   */
  async resumeSite(siteId: string, variant: string, jwt: string): Promise<{ success: boolean; message: string }> {
    try {
      const site = await this.getSite(siteId, jwt);

      if (!site) {
        return {
          success: false,
          message: 'Site not found'
        };
      }

      if (!site.system_id || !site.subscription_id) {
        return {
          success: false,
          message: 'Site missing system_id or subscription_id - cannot resume'
        };
      }

      const client = this.createClient(jwt);
      await client.deployApp(site.subscription_id, site.system_id, siteId, {
        environment: variant,
        variant: variant,
      });

      logger.info('v2-control-plane.resume-site.success', {
        siteId,
        variant
      });

      return {
        success: true,
        message: `Resume triggered for variant: ${variant}`
      };
    } catch (error: any) {
      if (error.status === 401) {
        throw error;
      }
      logger.error('v2-control-plane.resume-site.error', {
        siteId,
        variant,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw new Error(`Resume failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Update site with variables upsert pattern
   *
   * Uses: PATCH /airo/v1/systems/:systemId/apps/:appId
   *
   * UPSERT PATTERN:
   * 1. Fetch current app to get existing variables
   * 2. Merge updates with existing variables (client-side)
   * 3. Send complete variables object to server
   * 4. Server replaces entire variables object
   */
  async updateSite(siteId: string, updates: Partial<SiteInfo>, jwt: string): Promise<SiteInfo | null> {
    try {
      const client = this.createClient(jwt);
      const site = await this.getSite(siteId, jwt);

      if (!site || !site.system_id || !site.subscription_id) {
        logger.warn('v2-control-plane.update-site.missing-ids', {
          siteId,
          hasSystemId: !!site?.system_id,
          hasSubscriptionId: !!site?.subscription_id
        });
        return null;
      }

      const currentApp = await client.getApp(site.subscription_id, site.system_id, siteId, true);
      const currentVariables = currentApp.variables || {};
      const updatedVariables = { ...currentVariables };

      if (updates.name !== undefined) {
        updatedVariables.title = updates.name;
      }
      if (updates.initial_prompt !== undefined) {
        updatedVariables.initialPrompt = updates.initial_prompt;
      }

      const patchPayload: any = {};
      if (JSON.stringify(updatedVariables) !== JSON.stringify(currentVariables)) {
        patchPayload.variables = updatedVariables;
      }

      if (updates.status) {
        const statusMap: Record<string, string> = {
          'init': 'provisioning',
          'creating': 'provisioning',
          'running': 'active',
          'failed': 'error'
        };
        patchPayload.status = statusMap[updates.status] || updates.status;
      }

      if (Object.keys(patchPayload).length === 0) {
        return site;
      }

      await client.updateApp(site.subscription_id, site.system_id, siteId, patchPayload);
      const updatedApp = await client.getApp(site.subscription_id, site.system_id, siteId, true);

      // Get customerId from site's account_id (was fetched in getSite earlier)
      return this.mapAppToSiteInfo(updatedApp, site.account_id);
    } catch (error: any) {
      // Re-throw 401 for auth redirect
      if (error.status === 401) {
        throw error;
      }
      logger.error('v2-control-plane.update-site.error', {
        siteId,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  /**
   * Update site variables (metadata) using upsert pattern
   *
   * This method specifically handles SiteMetadata updates:
   * - userTitle, aiGeneratedTitle, customDomain, tags, etc.
   *
   * @param siteId - Site/app ID
   * @param variableUpdates - Variables to upsert
   * @param jwt - Authentication token
   * @returns Updated site info or null if failed
   */
  async updateSiteVariables(siteId: string, variableUpdates: Record<string, any>, jwt: string): Promise<SiteInfo | null> {
    try {
      const client = this.createClient(jwt);
      const site = await this.getSite(siteId, jwt);

      if (!site || !site.system_id || !site.subscription_id) {
        return null;
      }

      const currentApp = await client.getApp(site.subscription_id, site.system_id, siteId, true);
      const currentVariables = currentApp.variables || {};
      const updatedVariables = { ...currentVariables, ...variableUpdates };

      Object.keys(updatedVariables).forEach(key => {
        if (updatedVariables[key] === undefined) {
          delete updatedVariables[key];
        }
      });

      if (JSON.stringify(updatedVariables) === JSON.stringify(currentVariables)) {
        return site;
      }

      await client.updateApp(site.subscription_id, site.system_id, siteId, {
        variables: updatedVariables
      });

      const updatedApp = await client.getApp(site.subscription_id, site.system_id, siteId, true);
      // Get customerId from site's account_id (was fetched in getSite earlier)
      return this.mapAppToSiteInfo(updatedApp, site.account_id);
    } catch (error: any) {
      // Re-throw 401 for auth redirect
      if (error.status === 401) {
        throw error;
      }
      logger.error('v2-control-plane.update-site-variables.error', { siteId, error });
      return null;
    }
  }

  /**
   * Map mgmt-hosting app to SiteInfo format
   *
   * CRITICAL: Uses app.id (the real appId from hosting_apps) as the siteId
   * NOT the jobId - that's just a temporary handle during creation
   *
   * Includes custom domains from mgmt-hosting if available (app.domains)
   *
   * @param app - App data from mgmt-hosting
   * @param customerId - Customer ID from subscription cache (defaults to 'customer' if not provided)
   */
  private mapAppToSiteInfo(app: any, customerId?: string): SiteInfo {
    // Use URLs from V2 response if available, otherwise construct them as fallback
    let agent_url: string | undefined;
    let preview_url: string | undefined;
    let published_url: string | undefined;

    if (app.urls) {
      // V2 provides URLs in the response - use them directly
      agent_url = app.urls.agent;
      preview_url = app.urls.preview;
      published_url = app.urls.publish;
    }

    // Construct missing URLs as fallback
    const urls = this.constructUrls(app.id, app.status, app.cellId);
    agent_url = agent_url || urls.agent;
    preview_url = preview_url || urls.preview;

    // Only construct published_url if app has been published (has "publish" variant)
    if (!published_url && hasPublishVariant(app.variants)) {
      published_url = urls.publish;
    }

    // Override published_url if custom domains are active (only for published sites)
    if (hasPublishVariant(app.variants) && app.domains && Array.isArray(app.domains)) {
      // Find active custom domain
      const customDomain = app.domains.find(
        (d: any) => d.domainType !== 'prefix' && d.status === 'active'
      );

      // Find active prefix domain (project domain)
      const prefixDomain = app.domains.find(
        (d: any) => d.domainType === 'prefix' && d.status === 'active'
      );

      // Priority: custom domain > prefix domain > default
      if (customDomain) {
        published_url = `https://${customDomain.fqdn}`;
      } else if (prefixDomain) {
        published_url = `https://${prefixDomain.fqdn}`;
      }
    }
    return {
      id: app.id,
      name: app.variables?.title || app.id,
      status: this.mapAppStatus(app.status),
      account_id: customerId || 'customer', // Use provided customerId or fallback to 'customer'
      initial_prompt: app.variables?.initialPrompt,
      agent_url,
      preview_url,
      published_url,
      ceph_mount_id: app.infrastructure?.cephMountId,
      ceph_dir_number: app.infrastructure?.cephDirNumber,
      created_at: new Date(app.createdAt),
      updated_at: new Date(app.updatedAt),
      system_id: app.systemId, // Store systemId for delete/update/deploy operations
      subscription_id: app.subscriptionId, // Store subscriptionId for hierarchical URLs
      domains: app.domains, // Custom domains from mgmt-hosting
      // ownerProduct is nested in system object, compositionId indicates the product type
      ownerProduct: app.system?.ownerProduct,
      compositionId: app.compositionId, // e.g., 'ai-builder', 'node-app'
      productId: app.system?.productId,
      variants: app.variants, // Simple string array ['preview', 'publish']
      variantsWithLifecycle: transformVariants(app.variantsWithLifecycle),
    };
  }

  /**
   * Construct URLs for an app
   *
   * V2 URL pattern: https://{appId}.{type}.{cellPrefix}.test-airoapp.ai
   * Example: https://egy3rfaop6.agent.c4.test-airoapp.ai
   * URLs are returned for pending/provisioning/active apps (optimistic URL construction)
   */
  private constructUrls(appId: string, appStatus: string | null, cellId?: string): {
    agent?: string;
    preview?: string;
    publish?: string;
  } {
    // Return URLs for pending, provisioning, and active statuses
    // Don't return URLs for error or null status
    if (appStatus === 'error' || appStatus === null) {
      return {};
    }

    // Extract cell prefix from cellId (e.g., "c4-dev-sxb1-eu-central-1" -> "c4")
    // Fallback to "c4" if cellId is not provided
    let cellPrefix = 'c4';
    if (cellId) {
      const match = cellId.match(/^([^-]+)/);
      if (match) {
        cellPrefix = match[1];
      }
    }

    const domain = `${cellPrefix}.test-airoapp.ai`;

    return {
      agent: `https://${appId}.agent.${domain}`,
      preview: `https://${appId}.preview.${domain}`,
      publish: `https://${appId}.${domain}`
    };
  }

  /**
   * Map mgmt-hosting app status to SiteStatus
   */
  private mapAppStatus(appStatus: string | null): SiteStatus {
    switch (appStatus) {
      case 'pending': return 'creating';
      case 'provisioning': return 'creating';
      case 'active': return 'running';
      case 'error': return 'failed';
      case null:
      default: return 'init';
    }
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
   * Get secrets for an app (V2: uses mgmt-airo API)
   *
   * Retrieves secret metadata from mgmt-airo for the specified app and variant.
   *
   * @param appId - Application ID
   * @param variant - Variant (preview or publish)
   * @param jwt - Customer JWT token
   * @returns Secrets response with metadata
   */
  async getSecrets(appId: string, variant: 'preview' | 'publish', jwt: string): Promise<SecretsResponse> {
    try {
      const client = this.createClient(jwt);
      const site = await this.getSite(appId, jwt);

      if (!site || !site.system_id || !site.subscription_id) {
        logger.warn('v2-control-plane.get-secrets.missing-ids', {
          appId,
          hasSystemId: !!site?.system_id,
          hasSubscriptionId: !!site?.subscription_id
        });
        throw new Error(`Unable to retrieve system/subscription IDs for app ${appId}`);
      }

      // Call mgmt-airo API to get secrets (returns raw nested structure)
      const rawResponse = await client.getSecrets(
        site.subscription_id,
        site.system_id,
        appId,
        variant
      );

      // Combine shared secrets and variant-specific secrets
      const sharedSecrets = rawResponse.shared?.secrets || [];
      const variantSecrets = rawResponse.variants?.[variant]?.secrets || [];
      const allSecrets = [...sharedSecrets, ...variantSecrets];

      // Create a Set of shared secret names for O(1) lookups
      const sharedSecretNames = new Set(sharedSecrets.map(s => s.name));

      // Transform to our format
      const secrets = allSecrets.map(secret => ({
        name: secret.name,
        systemManaged: secret.systemManaged,
        variants: sharedSecretNames.has(secret.name)
          ? ['preview', 'publish'] as ('preview' | 'publish')[]
          : [variant] as ('preview' | 'publish')[]
      }));

      return {
        appId: rawResponse.appId,
        secrets,
        count: secrets.length
      };
    } catch (error: any) {
      // Re-throw 401 for auth redirect
      if (error.status === 401) {
        throw error;
      }
      logger.error('v2-control-plane.get-secrets.error', {
        appId,
        variant,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Perform bulk secret operations (V2: uses mgmt-airo API)
   *
   * Transforms operations to mgmt-airo format and executes via workflow.
   * - additions and updates are combined into 'upsert' operations
   * - deletions map to 'delete' operations
   *
   * @param appId - Application ID
   * @param variant - Variant (preview or publish)
   * @param operations - Secret operations (additions, updates, deletions)
   * @param jwt - Customer JWT token
   * @returns Operation results
   */
  async updateSecrets(
    appId: string,
    variant: 'preview' | 'publish',
    operations: SecretOperations,
    jwt: string
  ): Promise<SecretOperationsResult> {
    try {
      const { additions = [], updates = [], deletions = [] } = operations;
      const client = this.createClient(jwt);
      const site = await this.getSite(appId, jwt);

      if (!site || !site.system_id || !site.subscription_id) {
        logger.warn('v2-control-plane.update-secrets.missing-ids', { appId });
        throw new Error(`Unable to retrieve system/subscription IDs for app ${appId}`);
      }

      // Transform operations to mgmt-airo format
      const airoOperations = [];

      // Both additions and updates map to 'upsert' type
      for (const addition of additions) {
        airoOperations.push({
          type: 'upsert' as const,
          secret: {
            name: addition.name,
            value: this.parseSecretValue(addition.value),
            variants: [variant],
            systemManaged: false
          }
        });
      }

      for (const update of updates) {
        airoOperations.push({
          type: 'upsert' as const,
          secret: {
            name: update.name,
            value: this.parseSecretValue(update.value),
            variants: [variant],
            systemManaged: false
          }
        });
      }

      // Deletions map to 'delete' type
      for (const name of deletions) {
        airoOperations.push({
          type: 'delete' as const,
          secret: {
            name,
            variants: [variant],
            systemManaged: false
          }
        });
      }

      if (airoOperations.length === 0) {
        return {
          success: true,
          message: 'No operations to perform',
          operations: {
            added: 0,
            updated: 0,
            deleted: 0
          }
        };
      }

      // Call mgmt-airo API to update secrets
      const airoResponse = await client.updateSecrets(
        site.subscription_id,
        site.system_id,
        appId,
        {
          operations: airoOperations,
          workflowName: 'airo-app-secrets'
        }
      );

      // Transform response to our format
      return {
        success: true,
        message: airoResponse.message,
        operations: {
          added: additions.length,
          updated: updates.length,
          deleted: deletions.length
        }
      };
    } catch (error: any) {
      // Re-throw 401 for auth redirect
      if (error.status === 401) {
        throw error;
      }
      logger.error('v2-control-plane.update-secrets.error', {
        appId,
        variant,
        error
      });
      throw error;
    }
  }

  /**
   * Compare secrets between two variants (V2: uses mgmt-airo API)
   *
   * @param appId - Application identifier
   * @param sourceVariant - Source variant to compare from
   * @param destinationVariant - Destination variant to compare to
   * @param jwt - Customer JWT token
   * @returns Diff result with added, updated, and deleted secret names
   */
  async compareSecrets(
    appId: string,
    sourceVariant: 'preview' | 'publish',
    destinationVariant: 'preview' | 'publish',
    jwt: string
  ): Promise<SecretsDiffResult> {
    try {
      const client = this.createClient(jwt);
      const site = await this.getSite(appId, jwt);

      if (!site || !site.system_id || !site.subscription_id) {
        logger.warn('v2-control-plane.get-secrets.missing-ids', {
          appId,
          hasSystemId: !!site?.system_id,
          hasSubscriptionId: !!site?.subscription_id
        });
        throw new Error(`Unable to retrieve system/subscription IDs for app ${appId}`);
      }

      // Call mgmt-airo API to get secrets (returns raw nested structure)
      const rawResponse = await client.getSecrets(
        site.subscription_id,
        site.system_id,
        appId,
        undefined,
        true
      );

      const sharedSecrets = rawResponse.shared?.secrets || [];
      const sourceSecrets = [...sharedSecrets, ...(rawResponse.variants?.[sourceVariant]?.secrets || [])];
      const destSecrets = [...sharedSecrets, ...(rawResponse.variants?.[destinationVariant]?.secrets || [])];

      // Filter to only non-system-managed secrets
      const sourceUserSecrets: Record<string, string | object> = {};
      const destUserSecrets: Record<string, string | object> = {};

      for (const sourceSecret of sourceSecrets) {
        if (!sourceSecret.systemManaged) {
          sourceUserSecrets[sourceSecret.name] = sourceSecret.value;
        }
      }

      for (const destSecret of destSecrets) {
        if (!destSecret.systemManaged) {
          destUserSecrets[destSecret.name] = destSecret.value;
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
    } catch (error: any) {
      // Re-throw 401 for auth redirect
      if (error.status === 401) {
        throw error;
      }
      logger.error('v2-control-plane.compare-secrets.error', {
        appId,
        sourceVariant,
        destinationVariant,
        error
      });
      throw error;
    }
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
      const client = this.createClient(jwt);
      const site = await this.getSite(appId, jwt);

      if (!site || !site.system_id || !site.subscription_id) {
        logger.warn('v2-control-plane.get-secrets.missing-ids', {
          appId,
          hasSystemId: !!site?.system_id,
          hasSubscriptionId: !!site?.subscription_id
        });
        throw new Error(`Unable to retrieve system/subscription IDs for app ${appId}`);
      }

      // Call mgmt-airo API to get secrets (returns raw nested structure)
      const rawResponse = await client.getSecrets(
        site.subscription_id,
        site.system_id,
        appId,
        undefined,
        true
      );
      const sourceSecrets = rawResponse.variants?.[sourceVariant]?.secrets || [];
      const destSecrets = rawResponse.variants?.[destinationVariant]?.secrets || [];

      // Filter to only non-system-managed secrets
      const sourceUserSecrets: Record<string, string | object> = {};
      const destUserSecrets: Record<string, string | object> = {};

      for (const sourceSecret of sourceSecrets) {
        if (!sourceSecret.systemManaged) {
          sourceUserSecrets[sourceSecret.name] = sourceSecret.value;
        }
      }

      for (const destSecret of destSecrets) {
        if (!destSecret.systemManaged) {
          destUserSecrets[destSecret.name] = destSecret.value;
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
      logger.error('v2-control-plane.sync-secrets.error', {
        appId,
        sourceVariant,
        destinationVariant,
        error
      });
      throw error;
    }
  }
}
