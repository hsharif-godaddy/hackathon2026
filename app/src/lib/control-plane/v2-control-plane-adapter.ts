import { isGrantsHoldoutParticipant, logBmsLaunchAATriggered, logGrantsHoldoutTriggered } from '@/lib/budget-service-experiment';
import { AIRO_OWNER_PRODUCTS, AIRO_PRODUCT_IDS, AiroHttpError, AiroMgmtClient, extractKatanaVersion, getOwnerProductFromProductId } from '@/lib/mgmt-airo';
import type { AiroApp } from '@/lib/mgmt-airo/types';
import { logger } from '@/lib/request-context';
import { checkSwitchboardFlag } from '@/lib/switchboard/server';
import { getDatacenterFromMarketId } from '@/lib/utils/dc-mapping';
import { extractCustomerId } from '@/lib/utils/jwt-utils';
import { truncateToByteLimit } from '@/lib/waf-validation';
import { useSubscriptionCacheStore } from '@/stores/useSubscriptionCacheStore';
import { ArchiveRestoreResponse, ArchiveStatusResponse, CreateSiteParams, CreateSiteResult, DeploySiteOptions, DomainStatus, DomainType, IControlPlaneAdapter, ImageStatusResponse, ReloadImagesResponse, SecretOperations, SecretOperationsResult, SecretsDiffResult, SecretsResponse, SecretUpdate, SiteDomain, SiteInfo, SiteStatus, SiteVariant } from './types';
import gasket from '../../../gasket.ts';

/**
 * ID length constants for distinguishing job IDs from app IDs
 */
const APP_ID_LENGTH = 10; // App IDs are exactly 10 chars (nanoId format)

/**
 * Owned-app entries always win over shared-app entries with the same app id.
 * Owners of an app appear in their own owned list AND in any FGA `airo_app_*`
 * tuple they wrote on themselves; we only want to surface the owned record so
 * the UI doesn't tag their own apps as "shared with you".
 */
function mergeOwnedAndSharedSites(
  ownedSites: readonly SiteInfo[],
  sharedSites: readonly SiteInfo[]
): SiteInfo[] {
  const ownedIds = new Set(ownedSites.map((s) => s.id));
  return [
    ...ownedSites,
    ...sharedSites.filter((s) => s.id && !ownedIds.has(s.id)),
  ];
}

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

function teamVentureFromVariables(variables: unknown): string | undefined {
  if (!variables || typeof variables !== 'object') {
    return undefined;
  }
  const v = variables as Record<string, unknown>;
  const raw = v.aabTeamVentureId ?? v.aab_team_venture_id ?? v.teamVentureId;
  return typeof raw === 'string' && raw.length > 0 ? raw : undefined;
}

function ownerCustomerFromApp(app: MgmtAppRecord): string | undefined {
  // mgmt-airo's app object does not carry customerId at any level — the customer
  // lives at the subscription level (subscription -> system -> app). The local
  // control plane DOES inline `customerId` for convenience. Read app-level fields
  // first so the local path keeps working unchanged; the v2 adapter falls back to
  // the subscription-derived `customerId` parameter at the call site below.
  const raw = app.customerId ?? app.ownerCustomerId ?? app.accountId;
  if (typeof raw === 'string' && raw.length > 0) {
    return raw;
  }
  return undefined;
}

/**
 * V2 Control Plane Adapter
 *
 * Uses mgmt-airo + mgmt-hosting APIs via AiroMgmtClient.
 * During creation, returns temporary jobId which transitions to permanent appId once ready.
 */
/**
 * Shape of a single app record as returned by mgmt-airo / mgmt-hosting and
 * consumed by {@link V2ControlPlaneAdapter.mapAppToSiteInfo}. Extends the base
 * {@link AiroApp} with the hosting-enriched fields the mapping reads that aren't
 * on the base type (custom domains, ceph infra, the nested system object, and
 * the composition id). All additions are optional, so any `AiroApp` is assignable.
 */
interface MgmtAppRecord extends AiroApp {
  domains?: SiteDomain[];
  infrastructure?: { cephMountId?: string; cephDirNumber?: string };
  system?: { ownerProduct?: string; productId?: string };
  compositionId?: string;
  // Owner fields the local control plane inlines for convenience (absent on the
  // real mgmt-airo response — see ownerCustomerFromApp). Read opportunistically.
  customerId?: string;
  ownerCustomerId?: string;
  accountId?: string;
  // Auth-at-Edge SSO fields (mhp-core extending existing app GET).
  //   ssoRequired             — resolved bool (admin-tier + per-app collapsed)
  //   ssoConfigId             — bound enterprise SSO config row id
  //   ssoRequiredOverride     — raw per-app override (true/false/null) — only
  //                             the customer-toggle UI consumes this
  //   ssoOverrideAllowed      — true iff admin tier is 'optional' (customer
  //                             can flip the override)
  //   clientIdSecretName      — pointer-key NAME for the customer's IdP
  //                             client_id row (from the bound SSO config;
  //                             nil when unbound). Used by the BFF when
  //                             writing/reading the credential pointer rows
  //                             so AAB doesn't hardcode GD_SSO_OAUTH_*.
  //   clientSecretSecretName  — same for client_secret
  // All optional — absent on apps where the upstream response doesn't carry
  // them yet, in which case the UI gate stays hidden.
  ssoRequired?: boolean;
  ssoConfigId?: string;
  ssoRequiredOverride?: boolean | null;
  ssoOverrideAllowed?: boolean;
  clientIdSecretName?: string | null;
  clientSecretSecretName?: string | null;
}

export class V2ControlPlaneAdapter implements IControlPlaneAdapter {
  private mgmtAiroBaseUrl: string;
  // Per-instance memo of the caller's shared-apps list, keyed by customerId.
  // A single getSite/appExists cascade asks for this list several times
  // (appExists fallback, getSite outer catch, reconcileSharedOwnership); without
  // memoization each is a fresh GET /customers/me/shared-apps. The adapter is
  // created fresh per getControlPlaneAdapter() call, so this never leaks across
  // requests. Stores the in-flight promise so concurrent callers share one fetch.
  private sharedSitesMemo = new Map<string, Promise<SiteInfo[]>>();

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
      // Forward x-katana-version (header or cookie) to signup/createApp so a dark-released
      // request chain targets the intended artifact. Supporting lookups are left untouched.
      const katanaVersion = params.headers ? extractKatanaVersion(params.headers) : undefined;
      const explicitDatacenter =
        typeof params.datacenter === 'string' ? params.datacenter.trim() : '';
      const resolvedDatacenter =
        explicitDatacenter.length > 0
          ? explicitDatacenter
          : process.env.MGMT_AIRO_DATACENTER || getDatacenterFromMarketId(params.marketId);
      const generatedTitle = this.generateTitle(params.prompt);
      const alwaysNewSubscription = process.env.ALWAYS_NEW_SUBSCRIPTION === 'true';
      const targetSubscriptionId = process.env.AIRO_SUBSCRIPTION_ID;

      let selectedSubscription = null;

      if (!alwaysNewSubscription) {
        try {
          // Priority: productId parameter takes precedence over AIRO_SUBSCRIPTION_ID env var
          // This allows API callers to override the default subscription selection by product
          if (params.productId) {
            const ownerProduct = getOwnerProductFromProductId(params.productId);
            selectedSubscription = await client.getActiveSubscription(ownerProduct);
          } else if (targetSubscriptionId) {
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
            airoSubscriptionId: selectedSubscription.id,
            ...(params.fqdn && { fqdn: params.fqdn })
          },
          datacenter: resolvedDatacenter,
          ...(params.fqdn && { fqdn: params.fqdn })
        }, katanaVersion);

        logger.info('v2-control-plane.create-site.createApp.success', {
          jobId: response.statusJobId,
          subscriptionId: selectedSubscription.id,
          fqdn: !!params.fqdn,
        }, {
          tags: ['security']
        });

        const createdAt = new Date();
        return {
          success: true,
          siteId: response.statusJobId,
          status: SiteStatus.Creating,
          created_at: createdAt,
          name: generatedTitle,
          account_id: params.accountId,
          updated_at: createdAt,
          type: 'job'
        };
      }

      // Check BMS feature flag to determine if new subscription should use Budget Service.
      // Soft-fail so a switchboard outage can't block signup; legacy path is always safe.
      let isBmsEnabled = false;
      if (params.headers) {
        try {
          isBmsEnabled = await checkSwitchboardFlag('app-builder-budget-service', { headers: params.headers });
        } catch (error) {
          logger.warn('v2-control-plane.create-site.bms-flag.lookup-failed', {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      const inHoldout = isGrantsHoldoutParticipant(params.grantsHoldoutCohort);
      if (inHoldout) {
        logGrantsHoldoutTriggered(params.grantsHoldoutCohort, { customerId: params.accountId });
      }
      if (isBmsEnabled && params.bmsLaunchAACohort) {
        logBmsLaunchAATriggered(params.bmsLaunchAACohort, { customerId: params.accountId });
      }
      const bmsActive = isBmsEnabled && !inHoldout;
      const response = await client.signup({
        datacenter: resolvedDatacenter,
        isTrial: true,
        productId: params.productId || process.env.MGMT_AIRO_PRODUCT_ID || AIRO_PRODUCT_IDS.AAB_V1,
        initialPrompt: params.prompt,
        appConfigs: [{
          templateName: 'default',
          variants: ['preview'],
          variables: {
            initialPrompt: params.prompt,
            title: generatedTitle,
            ...(params.fqdn && { fqdn: params.fqdn })
          }
        }],
        bmsActive,
        ...(params.itc && { itc: params.itc }),
        ...(params.fqdn && { fqdn: params.fqdn }),
      }, katanaVersion);

      logger.info('v2-control-plane.create-site.signup.success', {
        jobId: response.statusJobId,
        bmsActive,
        fqdn: !!params.fqdn,
      }, {
        tags: ['security']
      });

      const createdAt = new Date();
      return {
        success: true,
        siteId: response.statusJobId,
        status: SiteStatus.Creating,
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
        status: SiteStatus.Failed
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
    customerId?: string,
    includeCdn = false
  ): Promise<SiteInfo | null> {
    const client = this.createClient(jwt);

    try {
      const app = await client.getApp(subscriptionId, systemId, appId, includeCdn);

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
          status: SiteStatus.Creating,
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
            status: SiteStatus.Creating,
            account_id: 'unknown',
            created_at: new Date(),
            updated_at: new Date()
          };
        } else {
          // Return "creating" status so frontend continues polling
          return {
            id: siteId,
            name: 'Provisioning...',
            status: SiteStatus.Creating,
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

  /**
   * Lightweight existence check — avoids the expensive getApp() API call.
   *
   * Cache strategy: initialize on cold BFF, check cache, refresh once on miss
   * for APP_ID_LENGTH siteIds (covers apps created on a different BFF instance).
   * Unlike getSite(), does NOT call directAppLookup/getApp after finding the
   * location — just confirms the app is in the customer's tree.
   *
   * Note: only queries AAB apps via subscription cache. Non-AAB owningProduct
   * falls back to getSite() for full cross-product search.
   */
  async appExists(siteId: string, jwt: string, owningProduct?: string, multiUserEnabled?: boolean): Promise<boolean> {
    try {
      const customerId = extractCustomerId(jwt);
      if (!customerId) {
        return false;
      }

      // Non-AAB products require full search — fall back to getSite() (which
      // already includes the shared-apps fallback for invited users).
      const shouldSkipCache = owningProduct && owningProduct !== AIRO_OWNER_PRODUCTS.AIRO_APP_BUILDER;
      if (shouldSkipCache) {
        const site = await this.getSite(siteId, jwt, owningProduct, { multiUserEnabled });
        return site !== null;
      }

      const subscriptionCache = useSubscriptionCacheStore.getState();

      // Initialize cache on first use (cold BFF). Throws for invited users
      // with no AAB subscription — caught by the outer try/catch which
      // delegates to the shared-app fallback below.
      if (!subscriptionCache.customerId) {
        await subscriptionCache.initialize(jwt);
      }

      // Check cache — fast path
      const location = subscriptionCache.getAppLocation(siteId);
      if (location) {
        return true;
      }

      // For APP_ID_LENGTH siteIds: single forced refresh to pick up apps created
      // on other BFF instances (e.g., new app created → first agent-token request
      // lands on a different BFF). Still avoids getApp() call.
      if (siteId.length === APP_ID_LENGTH) {
        await subscriptionCache.refresh(jwt, true);
        const retryLocation = subscriptionCache.getAppLocation(siteId);
        if (retryLocation) {
          return true;
        }
        // Caller has an AAB subscription but no matching app in their
        // tree — could still have access via the multi-user invite flow.
        return await this.appExistsViaSharedApps(siteId, jwt, multiUserEnabled);
      }

      // Non-APP_ID_LENGTH: try job lookup (apps still being created)
      const jobResult = await this.jobIdLookup(siteId, jwt);
      if (jobResult) {
        if (owningProduct && jobResult.ownerProduct && jobResult.ownerProduct !== owningProduct) {
          return false;
        }
        return true;
      }

      return await this.appExistsViaSharedApps(siteId, jwt, multiUserEnabled);
    } catch (error: any) {
      if (error.status === 401) {
        throw error;
      }
      // Most common case here: invited user with no AAB subscription —
      // subscriptionCache.initialize threw because mgmt-airo /customers/me
      // 404'd. Don't return false yet; check the shared-apps listing. (Without
      // this the agent-token route returns 404 even when the invitee is a
      // collaborator on the app, breaking the open-app flow.)
      logger.warn('v2-control-plane.app-exists.outer-catch-shared-fallback', {
        siteId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      try {
        const exists = await this.appExistsViaSharedApps(siteId, jwt, multiUserEnabled);
        if (exists) return true;
      } catch (fallbackError) {
        logger.warn('v2-control-plane.app-exists.shared-fallback-also-failed', {
          siteId,
          error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
        });
      }
      logger.error('v2-control-plane.app-exists.error', {
        siteId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return false;
    }
  }

  /**
   * Lightweight equivalent of `tryGetSharedSite` for `appExists` — returns true
   * iff the caller collaborates on `siteId` (per mgmt-airo's shared-apps
   * listing), without bothering to build the full SiteInfo.
   */
  private async appExistsViaSharedApps(siteId: string, jwt: string, multiUserEnabled?: boolean): Promise<boolean> {
    const site = await this.tryGetSharedSite(siteId, jwt, multiUserEnabled);
    return site !== null;
  }

  async getSite(siteId: string, jwt: string, owningProduct?: string, options?: { includeCdn?: boolean; multiUserEnabled?: boolean }): Promise<SiteInfo | null> {
    const multiUserEnabled = options?.multiUserEnabled;
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
              customerId || undefined,
              options?.includeCdn
            );

            if (result) {
              // The cache/tree can contain an app the caller only collaborates on
              // (not owns); directAppLookup stamps owner=caller + no sharedWithMe.
              // Reconcile against shared-apps so an invitee's single-app getSite
              // matches the list path (owner-pays paywall bypass + FGA perms).
              return this.reconcileSharedOwnership(result, jwt, customerId, multiUserEnabled);
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
              customerId || undefined,
              options?.includeCdn
            );

            if (result) {
              return this.reconcileSharedOwnership(result, jwt, customerId, multiUserEnabled);
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
        // No mgmt-airo customer record (most commonly an invited user who's
        // never created their own AAB app). Fall through to shared-app
        // index — they may have FGA `airo_app_view` on a venture that maps
        // to this app. Returns null if that lookup also misses.
        return this.tryGetSharedSite(siteId, jwt, multiUserEnabled);
      }

      // Use ownerProduct for forward compatibility
      const productFilter = owningProduct || AIRO_OWNER_PRODUCTS.AIRO_APP_BUILDER;
      const subscriptions = await client.getSubscriptions(productFilter);

      for (const sub of subscriptions) {
        const systems = await client.getSystems(sub.id);

        if (systems.length === 0) {
          continue;
        }

        // Search all systems in parallel within this subscription
        const systemResults = await Promise.allSettled(
          systems.map(async (system) => {
            const apps = await client.getAppsForSystem(sub.id, system.id);
            const matchingApp = apps.find(app => app.id === siteId);
            return matchingApp ? { system, app: matchingApp } : null;
          })
        );

        for (const [index, result] of systemResults.entries()) {
          if (result.status === 'rejected') {
            logger.warn('v2-control-plane.get-site.system-search-failed', {
              siteId,
              subscriptionId: sub.id,
              systemId: systems[index]?.id,
            });
            continue;
          }

          const match = result.value;
          if (match) {
            // getAppsForSystem returns summary data without variables
            // Fetch full app details to get variables (including initialPrompt)
            try {
              const fullApp = await client.getApp(sub.id, match.system.id, match.app.id, options?.includeCdn);
              return this.reconcileSharedOwnership(this.tagSharedOwnership(this.mapAppToSiteInfo(fullApp, customerId), sub.customerId, customerId), jwt, customerId, multiUserEnabled);
            } catch (fetchError) {
              logger.warn('v2-control-plane.get-site.full-app-fetch-failed', {
                siteId,
                error: fetchError instanceof Error ? fetchError.message : 'Unknown error'
              });
              return this.reconcileSharedOwnership(this.tagSharedOwnership(this.mapAppToSiteInfo(match.app, customerId), sub.customerId, customerId), jwt, customerId, multiUserEnabled);
            }
          }
        }
      }

      // Caller has an AAB customer record but doesn't own this app. Could
      // still have it via the multi-user invite flow — check the shared-apps listing.
      return this.tryGetSharedSite(siteId, jwt, multiUserEnabled);
    } catch (error: any) {
      // Re-throw 401 for auth redirect
      if (error.status === 401) {
        throw error;
      }
      // Anything else thrown inside the try block (most commonly:
      // `subscriptionCache.initialize(jwt)` 404/403-ing for an invited user
      // with no AAB customer record, before we reach the explicit
      // tryGetSharedSite call after the full-search section). Don't give up
      // here — try the shared-app fallback once more before returning null,
      // so invited users opening a shared app actually get a SiteInfo.
      logger.warn('v2-control-plane.get-site.outer-catch-shared-fallback', {
        siteId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      try {
        const sharedSite = await this.tryGetSharedSite(siteId, jwt, multiUserEnabled);
        if (sharedSite) return sharedSite;
      } catch (fallbackError) {
        logger.warn('v2-control-plane.get-site.shared-fallback-also-failed', {
          siteId,
          error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
        });
      }
      logger.error('v2-control-plane.get-site.error', {
        siteId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return null;
    }
  }

  async listSites(jwt: string, multiUserEnabled?: boolean): Promise<SiteInfo[]> {
    try {
      const customerId = extractCustomerId(jwt);
      if (!customerId) {
        return [];
      }

      const client = this.createClient(jwt);

      // Owned apps (mgmt-airo `/customers/me/apps`) and shared apps
      // (`/customers/me/shared-apps`) run in parallel. Each side is wrapped in its own
      // .catch so a failure on one side never zeroes out the other:
      //   - Owned: an invited user has no AAB subscription in mgmt-airo, so
      //     `/customers/me/apps?ownerProduct=AiroAppBuilder` returns 404/403
      //     and the client throws AiroHttpError. Without this catch, the
      //     Promise.all rejects, the outer try/catch returns [], and the
      //     invited user sees nothing on /apps even though they have shared
      //     apps. Treat 404/403 as "no owned apps" and let shared flow
      //     through. 401 still bubbles up for SSO redirect.
      //   - Shared: any FGA / Postgres failure shouldn't kill the owner's
      //     listing either.
      // See docs/multi-user-shared-app-listing.md.
      const [ownedApps, sharedSites] = await Promise.all([
        client
          .getAllAppsForCustomer(AIRO_OWNER_PRODUCTS.AIRO_APP_BUILDER)
          .catch((err) => {
            if (err instanceof AiroHttpError && err.status === 401) {
              throw err; // SSO redirect — preserve existing behavior
            }
            if (
              err instanceof AiroHttpError &&
              (err.status === 403 || err.status === 404)
            ) {
              logger.info('v2-control-plane.list-sites.no-aab-subscription', {
                status: err.status,
                customerId,
              });
              return [] as AiroApp[];
            }
            logger.warn('v2-control-plane.list-sites.owned-fetch-failed', {
              error: err instanceof Error ? err.message : String(err),
              status: err instanceof AiroHttpError ? err.status : undefined,
            });
            return [] as AiroApp[];
          }),
        this.listSharedSites(jwt, multiUserEnabled).catch((err) => {
          logger.warn('v2-control-plane.list-shared-sites.failed', {
            error: err instanceof Error ? err.message : String(err),
          });
          return [] as SiteInfo[];
        }),
      ]);

      const ownedSites = ownedApps.map(app => this.mapAppToSiteInfo(app, customerId));

      const merged = mergeOwnedAndSharedSites(ownedSites, sharedSites);

      return merged.sort((a, b) => {
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
   * Build SiteInfo[] for apps the caller collaborates on but doesn't own, via
   * mgmt-airo's `GET /customers/me/shared-apps` (backed by airo_app_collaborators).
   * The collaborator row already carries (subscriptionId, appId), so mgmt-airo
   * enriches each app server-side and stamps the real `ownerCustomerId`.
   *
   * Each returned SiteInfo has `sharedWithMe: true`. Returns [] when the feature
   * is off, the JWT yields no customer, or the endpoint reports no shared apps.
   */
  private async listSharedSites(jwt: string, multiUserEnabled?: boolean): Promise<SiteInfo[]> {
    // Hard gate: when the caller resolved `aab-multi-user` to false, skip the
    // shared-app lookup entirely. Keeps the feature fully inert for the GA
    // population while the flag is off. `undefined` preserves prior behavior.
    if (multiUserEnabled === false) {
      return [];
    }

    const customerId = extractCustomerId(jwt);
    if (!customerId) {
      return [];
    }

    // Reuse an in-flight/resolved fetch for this customer within this request-
    // scoped adapter instance (see sharedSitesMemo). On failure we drop the memo
    // entry so a later call can retry rather than replay a stale rejection.
    const memoized = this.sharedSitesMemo.get(customerId);
    if (memoized) {
      return memoized;
    }
    const promise = this.fetchSharedSites(jwt, customerId).catch((err) => {
      this.sharedSitesMemo.delete(customerId);
      throw err;
    });
    this.sharedSitesMemo.set(customerId, promise);
    return promise;
  }

  private async fetchSharedSites(jwt: string, customerId: string): Promise<SiteInfo[]> {
    try {
      const sharedApps = await this.createClient(jwt).getSharedAppsForCustomer();
      return sharedApps.map<SiteInfo>((app) => {
        const site = this.mapAppToSiteInfo(app, customerId);
        // mapAppToSiteInfo doesn't set sharedWithMe; the endpoint already stamps
        // the real ownerCustomerId, so owner_customer_id is the owner (not the
        // caller) — preserving the FGA-bypass distinction in enforce checks.
        site.sharedWithMe = true;
        return site;
      });
    } catch (err) {
      if (err instanceof AiroHttpError && err.status === 401) {
        throw err; // SSO redirect — preserve existing behavior
      }
      logger.warn('v2-control-plane.list-shared-sites.fetch-failed', {
        customerId,
        status: err instanceof AiroHttpError ? err.status : undefined,
        error: err instanceof Error ? err.message : String(err),
      });
      return [];
    }
  }

  /**
   * Single-app fallback for `getSite`: resolve a `SiteInfo` for an app the
   * caller collaborates on but can't see via mgmt-airo's owned (`/me`) listing
   * (typically an invited user). Delegates to `listSharedSites` (mgmt-airo
   * `GET /customers/me/shared-apps`) and filters to the requested appId, so the
   * caller can only resolve apps they actually collaborate on.
   *
   * Returns null when the JWT yields no customerId, the feature is off, or the
   * app isn't in the caller's shared-apps list.
   */
  private async tryGetSharedSite(siteId: string, jwt: string, multiUserEnabled?: boolean): Promise<SiteInfo | null> {
    // Hard gate: skip entirely when aab-multi-user resolved to false.
    if (multiUserEnabled === false) {
      return null;
    }

    const customerId = extractCustomerId(jwt);
    if (!customerId) {
      logger.info('v2-control-plane.try-get-shared-site.skip-no-customer', { siteId });
      return null;
    }

    // Delegate entirely to listSharedSites — the single source of truth for the
    // caller's shared apps (mgmt-airo /customers/me/shared-apps). We filter its
    // results to the requested siteId instead of duplicating the lookup.
    const sharedSites = await this.listSharedSites(jwt, multiUserEnabled);
    const site = sharedSites.find((s) => s.id === siteId) ?? null;

    logger.info('v2-control-plane.try-get-shared-site.list-result', {
      siteId,
      customerId,
      sharedCount: sharedSites.length,
      found: site !== null,
    });

    return site;
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
            status: SiteStatus.Creating,
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
      if (site.status === SiteStatus.Running || site.status === SiteStatus.Created) {
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

  async getArchiveStatus(siteId: string, jwt: string): Promise<ArchiveStatusResponse> {
    try {
      const site = await this.getSite(siteId, jwt);

      if (!site) {
        return { isArchived: false, canRestore: false };
      }

      if (!site.system_id || !site.subscription_id) {
        return { isArchived: false, canRestore: false };
      }

      const client = this.createClient(jwt);
      return await client.getArchiveStatus(site.subscription_id, site.system_id, siteId);
    } catch (error: any) {
      if (typeof error?.status === 'number') {
        throw error;
      }
      logger.error('v2-control-plane.archive-status.error', {
        siteId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  async startArchiveRestore(siteId: string, jwt: string, options?: { targetCell?: string }): Promise<ArchiveRestoreResponse> {
    try {
      const site = await this.getSite(siteId, jwt);

      if (!site?.system_id || !site.subscription_id) {
        throw new Error('Site not found or missing system_id/subscription_id');
      }

      const client = this.createClient(jwt);
      const result = await client.restoreArchivedApp(site.subscription_id, site.system_id, siteId, options);

      logger.info('v2-control-plane.archive-restore.started', {
        siteId,
        statusJobId: result.statusJobId,
      });

      return result;
    } catch (error: any) {
      if (typeof error?.status === 'number') {
        throw error;
      }
      logger.error('v2-control-plane.archive-restore.error', {
        siteId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw new Error(`Archive restore failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async getImageStatus(siteId: string, jwt: string, katanaVersion?: string): Promise<ImageStatusResponse> {
    try {
      const site = await this.getSite(siteId, jwt);

      if (!site) {
        throw new Error('Site not found');
      }

      if (!site.system_id || !site.subscription_id) {
        throw new Error('Site missing system_id or subscription_id');
      }

      const client = this.createClient(jwt);
      const result = await client.getImageStatus(site.subscription_id, site.system_id, siteId, katanaVersion);

      logger.info('v2-control-plane.get-image-status.success', {
        siteId,
        status: result.status
      });

      return result;
    } catch (error: any) {
      if (typeof error?.status === 'number') {
        throw error;
      }
      logger.error('v2-control-plane.get-image-status.error', {
        siteId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw new Error(`Get image status failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async reloadImages(siteId: string, jwt: string): Promise<ReloadImagesResponse> {
    try {
      const site = await this.getSite(siteId, jwt);

      if (!site) {
        throw new Error('Site not found');
      }

      if (!site.system_id || !site.subscription_id) {
        throw new Error('Site missing system_id or subscription_id');
      }

      const client = this.createClient(jwt);
      const result = await client.reloadImages(site.subscription_id, site.system_id, siteId);

      logger.info('v2-control-plane.reload-images.success', {
        siteId,
        status: result.status
      });

      return result;
    } catch (error: any) {
      if (typeof error?.status === 'number') {
        throw error;
      }
      logger.error('v2-control-plane.reload-images.error', {
        siteId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw new Error(`Reload images failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
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

      const currentApp = await client.getApp(site.subscription_id, site.system_id, siteId);
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
        const statusMap: Partial<Record<SiteStatus, string>> = {
          [SiteStatus.Init]: 'provisioning',
          [SiteStatus.Creating]: 'provisioning',
          [SiteStatus.Running]: 'active',
          [SiteStatus.Failed]: 'error'
        };
        patchPayload.status = statusMap[updates.status] ?? updates.status;
      }

      if (Object.keys(patchPayload).length === 0) {
        return site;
      }

      await client.updateApp(site.subscription_id, site.system_id, siteId, patchPayload);
      const updatedApp = await client.getApp(site.subscription_id, site.system_id, siteId);

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

      const currentApp = await client.getApp(site.subscription_id, site.system_id, siteId);
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

      const updatedApp = await client.getApp(site.subscription_id, site.system_id, siteId);
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

  /**
   * Correct ownership on an owned-path SiteInfo. mgmt-airo's `/subscriptions`
   * listing returns subscriptions the caller can ACCESS (including ones they only
   * collaborate on), so the full-search can resolve an app the caller doesn't own.
   * mapAppToSiteInfo then defaults `owner_customer_id` to the caller — wrongly
   * marking a collaborator as the owner. The subscription's `customerId` is the
   * REAL owner: when it isn't the caller, this is a shared app — stamp the real
   * owner and `sharedWithMe` so the owner-pays paywall bypass and listing work.
   */
  private tagSharedOwnership(
    site: SiteInfo,
    subscriptionOwnerId: string | undefined,
    callerCustomerId: string
  ): SiteInfo {
    if (subscriptionOwnerId && subscriptionOwnerId !== callerCustomerId) {
      site.owner_customer_id = subscriptionOwnerId;
      site.sharedWithMe = true;
    }
    return site;
  }

  /**
   * Safety net for the full-search path. `tagSharedOwnership` relies on the
   * subscription's `customerId` being the REAL owner; if mgmt-airo returns the
   * collaborator-accessed subscription without that owner (or equal to the
   * caller), the tag can't fire and a shared app comes back stamped as
   * caller-owned with `sharedWithMe` unset — which wrongly runs the owner
   * paywall on publish (loading the plans bundle, which then crashes) and skips
   * FGA enforcement. The authoritative source is mgmt-airo's shared-apps listing
   * (`/customers/me/shared-apps`, backed by `airo_app_collaborators`), which
   * carries the real owner and `sharedWithMe: true`. When a resolved site still
   * looks caller-owned and isn't yet flagged shared, reconcile against it. A
   * genuine owner's app isn't in their shared-apps list, so this is a no-op for
   * them; fully inert when `aab-multi-user` is off.
   */
  private async reconcileSharedOwnership(
    site: SiteInfo,
    jwt: string,
    callerCustomerId: string,
    multiUserEnabled?: boolean
  ): Promise<SiteInfo> {
    // Only run the shared-ownership safety net when the caller explicitly
    // resolved aab-multi-user to true. When it's undefined (route didn't resolve
    // the flag) we skip — an owner viewing their own app never appears in their
    // own shared-apps list, so firing listSharedSites here just adds latency to
    // every owned-path getSite for no behavioral change.
    if (multiUserEnabled !== true || site.sharedWithMe || site.owner_customer_id !== callerCustomerId) {
      return site;
    }
    try {
      const shared = await this.tryGetSharedSite(site.id, jwt, multiUserEnabled);
      if (shared) {
        logger.info('v2-control-plane.reconcile-shared-ownership.tagged', {
          siteId: site.id,
          owner: shared.owner_customer_id,
        });
        return shared;
      }
    } catch (error) {
      // Fail CLOSED. mapAppToSiteInfo optimistically stamps owner_customer_id =
      // caller, and reconcile is the step that corrects a mis-stamped shared app
      // to its real owner. If the shared-apps lookup throws (FGA/mgmt-airo
      // timeout, 5xx, OAuth failure) we cannot confirm ownership — returning the
      // caller-owned stamp would trigger the owner-bypass in
      // enforceAabMultiUserVentureRelation for an actual collaborator. Clear
      // owner_customer_id so downstream authz defers to FGA (the authoritative
      // source): a real owner still passes via the venture `owner` tuple; an
      // unverifiable caller is denied. Matches the fail-closed posture of the
      // sibling read paths.
      logger.warn('v2-control-plane.reconcile-shared-ownership.fail-closed', {
        siteId: site.id,
        error: error instanceof Error ? error.message : String(error),
      });
      return { ...site, owner_customer_id: undefined };
    }
    return site;
  }

  private mapAppToSiteInfo(app: MgmtAppRecord, customerId?: string): SiteInfo {
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

    // Override published_url with active custom/prefix domains.
    // Priority: custom domain > prefix domain (project domain) > default.
    // This runs regardless of publish status so the preview header always
    // shows the best available domain (e.g. prompt-design-lab.c24.airoapp.ai).
    if (app.domains && Array.isArray(app.domains)) {
      const customDomain = (app.domains as SiteDomain[]).find(
        (d) => d.domainType !== DomainType.PREFIX && d.status === DomainStatus.ACTIVE
      );

      const prefixDomain = (app.domains as SiteDomain[]).find(
        (d) => d.domainType === DomainType.PREFIX && d.status === DomainStatus.ACTIVE
      );

      if (customDomain) {
        published_url = `https://${customDomain.fqdn}`;
      } else if (prefixDomain) {
        published_url = `https://${prefixDomain.fqdn}`;
      }
    }
    // Clamp at boundary; direct mgmt-airo writes bypass the BFF/WAF.
    const rawInitialPrompt = app.variables?.initialPrompt;
    const initial_prompt = typeof rawInitialPrompt === 'string'
      ? truncateToByteLimit(rawInitialPrompt)
      : undefined;

    // Type-guard untyped JSON; trimmed-length check matches route.ts validateFqdn.
    const rawFqdn = app.variables?.fqdn;
    const trimmedFqdn = typeof rawFqdn === 'string' ? rawFqdn.trim() : '';
    const fqdn = trimmedFqdn.length > 0 && trimmedFqdn.length <= 253
      ? trimmedFqdn
      : undefined;

    return {
      id: app.id,
      name: app.variables?.title || app.id,
      status: this.mapAppStatus(app.status),
      account_id: customerId || 'customer', // Use provided customerId or fallback to 'customer'
      team_venture_id: teamVentureFromVariables(app.variables),
      owner_customer_id: ownerCustomerFromApp(app) ?? customerId,
      initial_prompt,
      fqdn,
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
      cellId: app.cellId,
      screenshots: app.screenshots, // Pre-rendered screenshot URLs from mgmt-hosting (preview/publish × desktop/mobile)
      published: app.published, // Authoritative publish state from mgmt-airo; see getAppScreenshotUrl
      // Auth-at-Edge SSO context — resolved enforcement bool + raw override
      // (used by the customer-toggle UI when override is permitted) + the
      // capability flag derived from the admin tier + per-config credential
      // pointer-key names (used by the BFF for the credential write/read so
      // AAB no longer hardcodes GD_SSO_OAUTH_* defaults). All optional and
      // gracefully absent on apps where mhp-core hasn't surfaced them yet.
      ssoRequired: app.ssoRequired,
      ssoConfigId: app.ssoConfigId,
      ssoRequiredOverride: app.ssoRequiredOverride,
      ssoOverrideAllowed: app.ssoOverrideAllowed,
      clientIdSecretName: app.clientIdSecretName,
      clientSecretSecretName: app.clientSecretSecretName,
    };
  }

  /**
   * Construct URLs for an app
   *
   * V2 URL pattern: https://{appId}.{type}.{cellPrefix}.{baseDomain}
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

    const baseDomain = (gasket.config as any).airoAppDomain || 'test-airoapp.ai';
    const domain = `${cellPrefix}.${baseDomain}`;

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
      case 'pending': return SiteStatus.Creating;
      case 'provisioning': return SiteStatus.Creating;
      case 'active': return SiteStatus.Running;
      case 'paused': return SiteStatus.Stopped;
      case 'suspended': return SiteStatus.Suspended;
      case 'error': return SiteStatus.Failed;
      case null:
      default: return SiteStatus.Init;
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

  /** Normalize mgmt-airo secret material for JSON responses to the app UI. */
  private formatSecretValueForClient(value: string | object | undefined | null): string | undefined {
    if (value === undefined || value === null) {
      return undefined;
    }
    if (typeof value === 'string') {
      return value;
    }
    return JSON.stringify(value);
  }

  /**
   * Get secrets for an app (V2: uses mgmt-airo API)
   *
   * Retrieves secret metadata and values from mgmt-airo for the specified app and variant.
   *
   * @param appId - Application ID
   * @param variant - Variant (preview or publish)
   * @param jwt - Customer JWT token
   * @returns Secrets response with metadata and values when upstream returns them
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

      // includeValues: customer-authenticated UI needs plaintext for show/copy in Settings
      const rawResponse = await client.getSecrets(
        site.subscription_id,
        site.system_id,
        appId,
        variant,
        true
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
          : [variant] as ('preview' | 'publish')[],
        value: this.formatSecretValueForClient(secret.value)
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
    jwt: string,
    multiUserEnabled?: boolean
  ): Promise<SecretsDiffResult> {
    try {
      const client = this.createClient(jwt);
      // Thread the multi-user flag so a shared (invited) app resolves via the
      // shared-apps listing; without it this internal re-fetch returns no site for
      // invited users and we'd throw "missing system/subscription IDs" (500).
      const site = await this.getSite(appId, jwt, undefined, { multiUserEnabled });

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

  async getProtectedSecrets(appId: string, jwt: string): Promise<SecretsResponse> {
    try {
      const client = this.createClient(jwt);
      const site = await this.getSite(appId, jwt);

      if (!site || !site.system_id || !site.subscription_id) {
        logger.warn('v2-control-plane.get-protected-secrets.missing-ids', { appId });
        throw new Error(`Unable to retrieve system/subscription IDs for app ${appId}`);
      }

      const rawResponse = await client.getSecrets(
        site.subscription_id,
        site.system_id,
        appId,
        undefined,
        true
      );

      const protectedSecrets = rawResponse.protected?.secrets || [];
      const previewSecrets = rawResponse.variants?.preview?.secrets || [];
      const allSecrets = [...protectedSecrets, ...previewSecrets];

      const secrets = allSecrets.map(secret => ({
        name: secret.name,
        systemManaged: secret.systemManaged,
        variants: ['preview', 'publish'] as ('preview' | 'publish')[],
        value: this.formatSecretValueForClient(secret.value)
      }));

      return {
        appId: rawResponse.appId,
        secrets,
        count: secrets.length
      };
    } catch (error: any) {
      if (error.status === 401) {
        throw error;
      }
      logger.error('v2-control-plane.get-protected-secrets.error', {
        appId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  async updateProtectedSecrets(
    appId: string,
    variants: ('preview' | 'publish')[],
    operations: SecretOperations,
    jwt: string
  ): Promise<SecretOperationsResult> {
    try {
      const { additions = [], updates = [], deletions = [] } = operations;
      const client = this.createClient(jwt);
      const site = await this.getSite(appId, jwt);

      if (!site || !site.system_id || !site.subscription_id) {
        logger.warn('v2-control-plane.update-protected-secrets.missing-ids', { appId });
        throw new Error(`Unable to retrieve system/subscription IDs for app ${appId}`);
      }

      const airoOperations = [];

      for (const addition of additions) {
        airoOperations.push({
          type: 'upsert' as const,
          secret: {
            name: addition.name,
            value: this.parseSecretValue(addition.value),
            variants,
            systemManaged: false,
            protected: true
          }
        });
      }

      for (const update of updates) {
        airoOperations.push({
          type: 'upsert' as const,
          secret: {
            name: update.name,
            value: this.parseSecretValue(update.value),
            variants,
            systemManaged: false,
            protected: true
          }
        });
      }

      for (const name of deletions) {
        airoOperations.push({
          type: 'delete' as const,
          secret: {
            name,
            variants,
            systemManaged: false,
            protected: true
          }
        });
      }

      if (airoOperations.length === 0) {
        return {
          success: true,
          message: 'No operations to perform',
          operations: { added: 0, updated: 0, deleted: 0 }
        };
      }

      const airoResponse = await client.updateSecrets(
        site.subscription_id,
        site.system_id,
        appId,
        {
          operations: airoOperations,
          workflowName: 'airo-app-secrets'
        }
      );

      return {
        success: true,
        message: airoResponse.statusJobId
          ? `Secrets workflow started: ${airoResponse.statusJobId}`
          : 'Protected secrets updated',
        operations: {
          added: additions.length,
          updated: updates.length,
          deleted: deletions.length
        }
      };
    } catch (error: any) {
      if (error.status === 401) {
        throw error;
      }
      logger.error('v2-control-plane.update-protected-secrets.error', {
        appId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }
}
