import { IControlPlaneAdapter, CreateSiteParams, CreateSiteResult, SiteInfo, SiteStatus } from './types';
import { extractCustomerId, decodeJWT } from '@/lib/utils/jwt-utils';
import { hasBeenPublished } from '@/utils/site';
import { logger } from '@/lib/request-context';
import { AiroMgmtClient } from '@/lib/mgmt-airo';
import { useSubscriptionCacheStore } from '@/stores/useSubscriptionCacheStore';

/**
 * ID length constants for distinguishing job IDs from app IDs
 */
const APP_ID_LENGTH = 10; // App IDs are exactly 10 chars (nanoId format)

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
      const jwtPayload = decodeJWT(params.jwt);
      logger.info('v2-control-plane.create-site.start', {
        accountId: params.accountId,
        customerId: jwtPayload?.cid
      });

      const client = this.createClient(params.jwt);
      const generatedTitle = this.generateTitle(params.prompt);
      const alwaysNewSubscription = process.env.ALWAYS_NEW_SUBSCRIPTION === 'true';
      const targetSubscriptionId = process.env.AIRO_SUBSCRIPTION_ID;

      let selectedSubscription = null;

      if (!alwaysNewSubscription) {
        try {
          if (targetSubscriptionId) {
            // Find specific subscription by ID
            const allSubscriptions = await client.getSubscriptions();
            selectedSubscription = allSubscriptions.find(sub => sub.id === targetSubscriptionId);

            if (!selectedSubscription) {
              logger.warn('v2-control-plane.create-site.target-subscription-not-found', {
                targetSubscriptionId,
                availableSubscriptions: allSubscriptions.map(s => s.id)
              });
              // Fall back to active subscription
              selectedSubscription = await client.getActiveSubscription();
            } else {
              logger.info('v2-control-plane.create-site.using-target-subscription', {
                targetSubscriptionId,
                subscriptionStatus: selectedSubscription.status
              });
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
          // If we get 403, customer doesn't exist in mgmt-airo yet - proceed to signup
          if (error.status === 403) {
            logger.info('v2-control-plane.create-site.customer-not-found', {
              message: 'Customer not found in mgmt-airo (403), proceeding to signup',
              customerId: jwtPayload?.cid
            });
            selectedSubscription = null;
          } else {
            // Re-throw other errors
            throw error;
          }
        }
      }

      if (selectedSubscription && !alwaysNewSubscription) {
        logger.info('v2-control-plane.create-site.existing-subscription', {
          subscriptionId: selectedSubscription.id,
          workflow: 'airo-add-app'
        });

        const systems = await client.getSystems(selectedSubscription.id);
        if (systems.length === 0) {
          throw new Error('Subscription has no systems - cannot add app');
        }

        const systemId = systems[0].id;

        logger.info('v2-control-plane.create-site.add-app', {
          subscriptionId: selectedSubscription.id,
          systemId,
          systemsCount: systems.length
        });

        const response = await client.createApp(selectedSubscription.id, systemId, {
          appTemplateName: 'default',
          environments: ['dev'],
          variables: {
            initialPrompt: params.prompt,
            title: generatedTitle,
            airoSubscriptionId: selectedSubscription.id
          }
        });

        logger.info('v2-control-plane.create-site.add-app.success', {
          jobId: response.statusJobId
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

      if (alwaysNewSubscription && selectedSubscription) {
        logger.info('v2-control-plane.create-site.force-new-subscription', {
          workflow: 'airo-provision',
          reason: 'ALWAYS_NEW_SUBSCRIPTION=true',
          existingSubscriptionId: selectedSubscription.id
        });
      } else {
        logger.info('v2-control-plane.create-site.no-subscription', {
          workflow: 'airo-provision'
        });
      }

      const response = await client.signup({
        datacenter: process.env.MGMT_AIRO_DATACENTER || 'sxb1',
        isTrial: true,
        productId: process.env.MGMT_AIRO_PRODUCT_ID || 'aab-v1',
        initialPrompt: params.prompt,
        appConfigs: [{
          templateName: 'default',
          environments: ['dev'],
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
    jwt: string
  ): Promise<SiteInfo | null> {
    const client = this.createClient(jwt);
    const startTime = Date.now();

    try {
      // SINGLE API CALL - Direct app fetch with CDN info for domains
      const app = await client.getApp(subscriptionId, systemId, appId, true);

      logger.info('v2-control-plane.direct-app-lookup.success', {
        appId,
        subscriptionId,
        systemId,
        includeCdn: true,
        duration: Date.now() - startTime
      });

      const cache = useSubscriptionCacheStore.getState();
      return this.mapAppToSiteInfo(app, cache.customerId || undefined);
    } catch (error: any) {
      if (error.status === 404) {
        // App moved or deleted - invalidate cache
        logger.warn('v2-control-plane.direct-app-lookup.not-found', {
          appId,
          subscriptionId,
          systemId,
          error: error instanceof Error ? error.message : String(error)
        });

        const cache = useSubscriptionCacheStore.getState();
        cache.removeAppFromCache(appId);
        return null;
      }

      logger.error('v2-control-plane.direct-app-lookup.error', {
        appId,
        subscriptionId,
        systemId,
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime
      });

      throw error;
    }
  }

  /**
   * Fallback to job ID lookup for sites that are still being created
   */
  private async jobIdLookup(siteId: string, jwt: string): Promise<SiteInfo | null> {
    // Only try job lookup if length suggests it's a job ID
    // Job IDs are shorter than app IDs (app IDs are exactly APP_ID_LENGTH chars)
    if (siteId.length === APP_ID_LENGTH) {
      logger.info('v2-control-plane.job-id-lookup.skipping', {
        siteId,
        reason: `ID length indicates app ID (${APP_ID_LENGTH} chars), not job ID`
      });
      return null;
    }

    try {
      logger.info('v2-control-plane.job-id-lookup.trying', { siteId });
      const client = this.createClient(jwt);
      const jobStatus = await client.getAiroJobApps(siteId);

      if (jobStatus.apps && jobStatus.apps.length === 0) {
        const cache = useSubscriptionCacheStore.getState();
        return {
          id: siteId,
          name: 'Provisioning...',
          status: 'creating',
          account_id: cache.customerId || 'unknown',
          created_at: new Date(),
          updated_at: new Date()
        };
      }

      if (jobStatus.apps && jobStatus.apps.length > 0) {
        const jobApp = jobStatus.apps[0];

        logger.info('v2-control-plane.job-id-lookup.found', {
          siteId,
          appId: jobApp.id,
          hasSystemId: !!jobApp.systemId,
          hasSubscriptionId: !!jobApp.subscriptionId
        });

        // Only return job data if it's complete (has systemId and subscriptionId)
        // If systemId/subscriptionId is missing, try to look it up in cache first
        if (jobApp.systemId && jobApp.subscriptionId) {
        logger.info('v2-control-plane.job-id-lookup.complete', {
          siteId,
          appId: jobApp.id,
          systemId: jobApp.systemId,
          subscriptionId: jobApp.subscriptionId
        });
        const cache = useSubscriptionCacheStore.getState();
        return this.mapAppToSiteInfo(jobApp, cache.customerId || undefined);
        } else if (jobApp.id) {
          // We have an app ID but missing metadata - try to look it up in cache
          logger.info('v2-control-plane.job-id-lookup.trying-cache', {
            siteId,
            appId: jobApp.id,
            hasSystemId: !!jobApp.systemId,
            hasSubscriptionId: !!jobApp.subscriptionId,
            reason: 'Missing metadata, checking cache for app location'
          });

          const subscriptionCache = useSubscriptionCacheStore.getState();
          let appLocation = subscriptionCache.getAppLocation(jobApp.id);

          // If app not in cache, refresh cache to pick up newly created apps
          if (!appLocation) {
            logger.info('v2-control-plane.job-id-lookup.cache-miss-refreshing', {
              siteId,
              appId: jobApp.id,
              reason: 'App not in cache, refreshing to pick up new app'
            });

            await subscriptionCache.refresh(jwt, true);
            appLocation = subscriptionCache.getAppLocation(jobApp.id);
          }

          if (appLocation) {
            logger.info('v2-control-plane.job-id-lookup.cache-hit', {
              siteId,
              appId: jobApp.id,
              subscriptionId: appLocation.subscriptionId,
              systemId: appLocation.systemId
            });

            // Fetch the full app data using the cache location
            try {
              return await this.directAppLookup(
                jobApp.id,
                appLocation.subscriptionId,
                appLocation.systemId,
                jwt
              );
            } catch (error) {
              logger.warn('v2-control-plane.job-id-lookup.cache-fetch-failed', {
                appId: jobApp.id,
                error: error instanceof Error ? error.message : String(error)
              });
              // Fall through to "creating" status
            }
          }

          logger.info('v2-control-plane.job-id-lookup.incomplete', {
            siteId,
            appId: jobApp.id,
            reason: 'App ID found but still missing from cache after refresh - job still in progress'
          });
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
          logger.info('v2-control-plane.job-id-lookup.incomplete', {
            siteId,
            appId: jobApp.id,
            reason: 'Missing systemId or subscriptionId - job still in progress'
          });
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
    } catch (error) {
      logger.info('v2-control-plane.job-id-lookup.failed', {
        siteId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return null;
    }
  }

  async getSite(siteId: string, jwt: string): Promise<SiteInfo | null> {
    try {
      const startTime = Date.now();
      logger.info('v2-control-plane.get-site.start', { siteId, idLength: siteId.length });

      const customerId = extractCustomerId(jwt);
      if (!customerId) {
        throw new Error('Failed to extract customer ID from JWT');
      }

      // Get subscription cache
      const subscriptionCache = useSubscriptionCacheStore.getState();

      // Initialize cache on first use
      if (!subscriptionCache.customerId) {
        logger.info('v2-control-plane.get-site.initializing-cache', { siteId });
        await subscriptionCache.initialize(jwt);
      }

      // Refresh cache if stale (background refresh)
      if (this.isCacheStale(subscriptionCache)) {
        logger.info('v2-control-plane.get-site.refreshing-stale-cache', {
          siteId,
          lastRefresh: subscriptionCache.lastRefresh,
          age: subscriptionCache.lastRefresh ? Date.now() - subscriptionCache.lastRefresh : null
        });
        // Non-blocking refresh
        subscriptionCache.refresh(jwt, false);
      }

      // Try cache-based direct lookup
      const location = subscriptionCache.getAppLocation(siteId);
      if (location) {
        logger.info('v2-control-plane.get-site.using-cache', {
          siteId,
          subscriptionId: location.subscriptionId,
          systemId: location.systemId
        });

        try {
          const result = await this.directAppLookup(
            siteId,
            location.subscriptionId,
            location.systemId,
            jwt
          );

          if (result) {
            logger.info('v2-control-plane.get-site.cache-hit-success', {
              siteId,
              duration: Date.now() - startTime,
              apiCalls: 1
            });
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

      // Try job ID lookup first (for sites that are still being created)
      const jobResult = await this.jobIdLookup(siteId, jwt);
      if (jobResult) {
        // Check if job is complete or still creating
        if (jobResult.status === 'creating') {
          logger.info('v2-control-plane.get-site.job-still-creating', {
            siteId,
            duration: Date.now() - startTime,
            status: jobResult.status
          });
          return jobResult; // Return "creating" status - frontend will continue polling
        } else {
          logger.info('v2-control-plane.get-site.job-lookup-success', {
            siteId,
            duration: Date.now() - startTime,
            apiCalls: 1,
            status: jobResult.status
          });
          return jobResult; // Return complete job data
        }
      }

      // If cache miss or direct lookup failed, force refresh and try again
      logger.info('v2-control-plane.get-site.cache-miss-refreshing', { siteId });
      await subscriptionCache.refresh(jwt, true);

      const retryLocation = subscriptionCache.getAppLocation(siteId);
      if (retryLocation) {
        logger.info('v2-control-plane.get-site.retry-with-refreshed-cache', {
          siteId,
          subscriptionId: retryLocation.subscriptionId,
          systemId: retryLocation.systemId
        });

        try {
          const result = await this.directAppLookup(
            siteId,
            retryLocation.subscriptionId,
            retryLocation.systemId,
            jwt
          );

          if (result) {
            logger.info('v2-control-plane.get-site.cache-refresh-success', {
              siteId,
              duration: Date.now() - startTime,
              apiCalls: 'refresh + 1'
            });
            return result;
          }
        } catch (error) {
          logger.warn('v2-control-plane.get-site.refreshed-cache-lookup-failed', {
            siteId,
            error: error instanceof Error ? error.message : String(error)
          });
          // Fall through to full search
        }
      }

      // Final fallback: traditional full search
      logger.info('v2-control-plane.get-site.falling-back-to-full-search', { siteId });
      const client = this.createClient(jwt);

      // Try job ID lookup as fallback
      const fallbackJobResult = await this.jobIdLookup(siteId, jwt);
      if (fallbackJobResult) {
        return fallbackJobResult;
      }

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

      const subscriptions = await client.getSubscriptions();

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
              logger.info('v2-control-plane.get-site.found-match-in-search', {
                siteId,
                subscriptionId: sub.id,
                systemId: system.id,
                appId: matchingApp.id,
                hasSummaryVariables: !!matchingApp.variables,
              });

              // getAppsForSystem returns summary data without variables
              // Fetch full app details to get variables (including initialPrompt) and CDN info
              try {
                const fullApp = await client.getApp(sub.id, system.id, matchingApp.id, true);

                logger.info('v2-control-plane.get-site.full-app-fetched', {
                  siteId,
                  hasVariables: !!fullApp.variables,
                  variablesKeys: fullApp.variables ? Object.keys(fullApp.variables) : [],
                  hasInitialPrompt: !!fullApp.variables?.initialPrompt,
                  initialPromptValue: fullApp.variables?.initialPrompt,
                });

                return this.mapAppToSiteInfo(fullApp, subscriptionCache.customerId || undefined);
              } catch (fetchError) {
                logger.warn('v2-control-plane.get-site.full-app-fetch-failed', {
                  siteId,
                  error: fetchError,
                  errorMessage: fetchError instanceof Error ? fetchError.message : 'Unknown error',
                  reason: 'Using summary data as fallback'
                });
                return this.mapAppToSiteInfo(matchingApp, subscriptionCache.customerId || undefined);
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
        error,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        errorStack: error instanceof Error ? error.stack : undefined
      });
      return null;
    }
  }

  async listSites(jwt: string): Promise<SiteInfo[]> {
    try {
      logger.info('v2-control-plane.list-sites.start');
      const customerId = extractCustomerId(jwt);
      if (!customerId) {
        return [];
      }

      const client = this.createClient(jwt);
      const apps = await client.getAllAppsForCustomer();
      return apps.map(app => this.mapAppToSiteInfo(app, customerId));
    } catch (error: any) {
      // Re-throw 401 for auth redirect
      if (error.status === 401) {
        throw error;
      }
      logger.error('v2-control-plane.list-sites.error', { error });
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
      logger.info('v2-control-plane.find-app-metadata.start', { appId });

      const customerId = extractCustomerId(jwt);
      if (!customerId) {
        return null;
      }

      // Try cache first
      const subscriptionCache = useSubscriptionCacheStore.getState();
      const location = subscriptionCache.getAppLocation(appId);

      if (location) {
        logger.info('v2-control-plane.find-app-metadata.cache-hit', {
          appId,
          subscriptionId: location.subscriptionId,
          systemId: location.systemId
        });

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

      const subscriptions = await client.getSubscriptions();

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
              logger.info('v2-control-plane.find-app-metadata.found', {
                appId,
                systemId: system.id,
                subscriptionId: sub.id
              });

              // Update cache with found location
              subscriptionCache.refresh(jwt, false);

              return {
                systemId: system.id,
                subscriptionId: sub.id
              };
            }
          } catch (error) {
            logger.warn('v2-control-plane.find-app-metadata.system-search-failed', {
              appId,
              subscriptionId: sub.id,
              systemId: system.id
            });
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
        error,
        errorMessage: error instanceof Error ? error.message : 'Unknown error'
      });
      return null;
    }
  }

  async deleteSite(siteId: string, jwt: string, systemId?: string, subscriptionId?: string): Promise<{ success: boolean; error?: string }> {
    // Track start time for performance logging
    const startTime = Date.now();
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

      logger.info('v2-control-plane.delete-site.success', {
        siteId,
        duration: Date.now() - startTime
      });

      return { success: true };
    } catch (error: any) {
      // Re-throw 401 for auth redirect
      if (error.status === 401) {
        throw error;
      }
      logger.error('v2-control-plane.delete-site.error', {
        siteId,
        error,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        errorStack: error instanceof Error ? error.stack : undefined
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
   */
  async deploySite(siteId: string, jwt: string): Promise<{ success: boolean; site: SiteInfo; message: string; note?: string }> {
    try {
      logger.info('v2-control-plane.deploy-site.start', { siteId });

      // Get site to find systemId
      const site = await this.getSite(siteId, jwt);

      if (!site) {
        // If site is not found, it might be because:
        // 1. The siteId is a job ID and the workflow hasn't completed yet
        // 2. The site doesn't exist
        // Return a graceful response indicating deployment is in progress
        logger.info('v2-control-plane.deploy-site.in-progress', {
          siteId,
          message: 'Site not found yet - likely still being created via signup workflow'
        });

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
        logger.info('v2-control-plane.deploy-site.provisioning', {
          siteId,
          message: 'Site exists but system_id not available yet - provisioning in progress'
        });

        return {
          success: true,
          site,
          message: 'App provisioning in progress',
          note: 'System ID not yet available - app is being provisioned by V2 workflow'
        };
      }

      // Check if app is already running/active - V2 deploys automatically
      if (site.status === 'running' || site.status === 'created') {
        logger.info('v2-control-plane.deploy-site.already-active', {
          siteId,
          status: site.status,
          message: 'App is already active - V2 deployed automatically during creation'
        });

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
        message: 'Deployment triggered successfully'
      };
    } catch (error: any) {
      // Re-throw 401 for auth redirect (preserve original error with status)
      if (error.status === 401) {
        throw error;
      }
      logger.error('v2-control-plane.deploy-site.error', { siteId, error });
      throw new Error(`Deploy failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
      logger.info('v2-control-plane.update-site.start', {
        siteId,
        updates,
        updateKeys: Object.keys(updates)
      });

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
      logger.info('v2-control-plane.update-site.current-variables', {
        siteId,
        currentVariables
      });

      const updatedVariables = { ...currentVariables };

      if (updates.name !== undefined) {
        logger.info('v2-control-plane.update-site.updating-name', {
          siteId,
          oldTitle: updatedVariables.title,
          newTitle: updates.name
        });
        updatedVariables.title = updates.name;
      }
      if (updates.initial_prompt !== undefined) {
        updatedVariables.initialPrompt = updates.initial_prompt;
      }

      logger.info('v2-control-plane.update-site.merged-variables', {
        siteId,
        updatedVariables
      });

      const patchPayload: any = {};
      if (JSON.stringify(updatedVariables) !== JSON.stringify(currentVariables)) {
        patchPayload.variables = updatedVariables;
        logger.info('v2-control-plane.update-site.variables-changed', {
          siteId,
          message: 'Variables changed, will include in PATCH'
        });
      } else {
        logger.info('v2-control-plane.update-site.variables-unchanged', {
          siteId,
          message: 'Variables unchanged, skipping'
        });
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

      logger.info('v2-control-plane.update-site.patch-payload', {
        siteId,
        patchPayload,
        payloadKeys: Object.keys(patchPayload)
      });

      if (Object.keys(patchPayload).length === 0) {
        logger.info('v2-control-plane.update-site.no-changes', {
          siteId,
          message: 'No changes to apply, returning current site'
        });
        return site;
      }

      logger.info('v2-control-plane.update-site.sending-patch', {
        siteId,
        subscriptionId: site.subscription_id,
        systemId: site.system_id
      });

      await client.updateApp(site.subscription_id, site.system_id, siteId, patchPayload);

      logger.info('v2-control-plane.update-site.patch-complete', {
        siteId,
        message: 'PATCH completed, fetching updated app with variables'
      });

      const updatedApp = await client.getApp(site.subscription_id, site.system_id, siteId, true);

      logger.info('v2-control-plane.update-site.response-received', {
        siteId,
        hasVariables: !!updatedApp?.variables,
        variablesKeys: updatedApp?.variables ? Object.keys(updatedApp.variables) : []
      });

      logger.info('v2-control-plane.update-site.success', {
        siteId,
        updatedVariables: updatedApp.variables,
        updatedTitle: updatedApp.variables?.title
      });

      // Get customerId from site's account_id (was fetched in getSite earlier)
      return this.mapAppToSiteInfo(updatedApp, site.account_id);
    } catch (error: any) {
      // Re-throw 401 for auth redirect
      if (error.status === 401) {
        throw error;
      }
      logger.error('v2-control-plane.update-site.error', { siteId, error });
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
    if (!published_url && hasBeenPublished(app)) {
      published_url = urls.publish;
    }

    // Override published_url if custom domains are active (only for published sites)
    if (hasBeenPublished(app) && app.domains && Array.isArray(app.domains)) {
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
      variants: app.variants // Available variants (e.g., ["preview", "publish"])
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
}
