import { context as otelContext, propagation } from '@opentelemetry/api';

import { logger } from '@/lib/request-context';
import { extractCustomerId as extractCustomerIdFromJWT } from '@/lib/utils/jwt-utils';
import { KATANA_VERSION_HEADER } from './katana-version';
import {
  type AiroApiError,
  type AiroApiErrorV2,
  type AiroApp,
  type AiroAppDetails,
  type AiroArchiveRestoreResponse,
  type AiroArchiveStatusResponse,
  type AiroAttribute,
  type AiroBulkAppsResponse,
  type AiroCaaRemediationPayload,
  type AiroCollaborator,
  type AiroCreateAppPayload,
  type AiroCreateAppResponse,
  type AiroCreateAttributePayload,
  type AiroCreateBuilderPlanPayload,
  type AiroCreateBuilderPlanResponse,
  type AiroCreditGrant,
  type AiroCustomer,
  type AiroDeleteAppResponse,
  type AiroDeployAppResponse,
  type AiroDeploymentsResponse,
  type AiroDnsConflictCheckResponse,
  type AiroDomainCheckResponse,
  type AiroDomainDnsOwnershipResponse,
  type AiroDomainErrorResponse,
  type AiroDomainJobResponse,
  type AiroEventPayload,
  type AiroEventResponse,
  type AiroGetCreditGrantsResponse,
  type AiroGrantCollaboratorPayload,
  type AiroGrantCollaboratorResponse,
  AiroHttpError,
  type AiroImageStatusResponse,
  type AiroJob,
  type AiroJobStatus,
  type AiroListCollaboratorsResponse,
  type AiroMgmtClientConfig,
  type AiroModifyDomainsPayload,
  type AiroModifyDomainsResponse,
  type AiroPublishAppResponse,
  type AiroPurgeCacheResponse,
  type AiroRawSecretsResponse,
  type AiroReloadImagesResponse,
  type AiroSignupPayload,
  type AiroSignupResponse,
  type AiroSubscription,
  type AiroSystem,
  type AiroTokenBudgetResponse,
  type AiroTransferAcceptResponse,
  type AiroTransferCancelResponse,
  type AiroTransferInitiateResponse,
  type AiroTransferMetadata,
  type AiroUnpublishAppResponse,
  type AiroUpdateAppPayload,
  type AiroUpdateAttributePayload,
  type AiroUpdateProjectDomainPayload,
  type AiroUpdateProjectDomainResponse,
  type AiroUpdateSecretsPayload,
  type AiroUpdateSecretsResponse,
  ATTRIBUTE_KEYS,
  type CustomerTree,
  DEFAULT_OWNER_PRODUCT,
  DomainMode} from './types';

/**
 * Authorization scheme used by mgmt-airo API
 * mgmt-airo expects 'sso-jwt' instead of standard 'Bearer' scheme
 *
 * Note: This client does NOT use gasket-config's appFetch because it uses
 * server-to-server 'sso-jwt' auth scheme (not cookie-based SSO) and has
 * its own retry/timeout logic. No 401-retry: auth failures require user action.
 */
const MGMT_AIRO_AUTH_SCHEME = 'sso-jwt';

/**
 * Result of a self-scoped collaborator reconcile (invitee-pull): how many shared
 * apps were granted to the caller and how many were skipped (already present).
 */
export interface ReconcileSharedResult {
  granted: number;
  skipped: number;
}

/**
 * Low-level HTTP client for mgmt-airo API
 *
 * Handles:
 * - HTTP requests with proper authentication
 * - Retry logic with exponential backoff
 * - Error logging and transformation
 * - Type-safe API methods
 *
 * Does NOT handle:
 * - Business logic
 * - Data mapping/transformation
 * - Status translation
 */
export class AiroMgmtClient {
  private baseUrl: string;
  private jwt: string;
  private maxRetries: number;
  private retryDelayMs: number;
  private timeoutMs: number;

  /**
   * Create a new mgmt-airo API client
   *
   * @param config - Client configuration
   */
  constructor(config: AiroMgmtClientConfig) {
    this.baseUrl = config.baseUrl;
    this.jwt = config.jwt;
    this.maxRetries = config.maxRetries ?? 3;
    this.retryDelayMs = config.retryDelayMs ?? 1000;
    this.timeoutMs = config.timeoutMs ?? 10000; // 10 second default timeout
  }

  private normalizeErrorBody(errorText: string): AiroApiError | AiroApiErrorV2 | string {
    try {
      const parsed = JSON.parse(errorText) as unknown;
      return this.isAiroApiErrorV2(parsed) || this.isAiroApiError(parsed) ? parsed : errorText;
    } catch {
      return errorText;
    }
  }

  private isAiroApiError(value: unknown): value is AiroApiError {
    return typeof (value as { message?: unknown } | null)?.message === 'string';
  }

  private isAiroApiErrorV2(value: unknown): value is AiroApiErrorV2 {
    return typeof (value as { error?: { code?: unknown; message?: unknown } } | null)?.error?.code === 'string'
      && typeof (value as { error?: { code?: unknown; message?: unknown } } | null)?.error?.message === 'string';
  }

  /**
   * Make an authenticated HTTP request with retry logic
   */
  private async request<T>(
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    path: string,
    body?: any,
    options: { retryOn404?: boolean; logEvent?: string; noCache?: boolean; extraHeaders?: Record<string, string> } = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const { retryOn404 = false, logEvent = 'api.request', noCache = false, extraHeaders } = options;

    // Start timing for this specific API call
    const apiCallStart = Date.now();
    const apiCallId = `${method} ${path}`;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      const attemptStart = Date.now();

      try {
        const headers: Record<string, string> = {
          // mgmt-airo expects 'sso-jwt' authorization scheme (not 'Bearer')
          // The JWT is validated by mgmt-airo against sso.test-godaddy.com
          'Authorization': `${MGMT_AIRO_AUTH_SCHEME} ${this.jwt}`,
          ...(body ? { 'Content-Type': 'application/json' } : {})
        }

        // Propagate trace context to downstream services for end-to-end tracing.
        // This is a no-op if no active span exists.
        try {
          propagation.inject(otelContext.active(), headers);
        } catch {
          // Ignore propagation errors
        }

        // Forward caller-supplied headers (e.g. x-katana-version for dark-release
        // targeting) after trace propagation so an explicit value is never clobbered.
        if (extraHeaders) {
          Object.assign(headers, extraHeaders);
        }

        const response = await fetch(url, {
          method,
          headers,
          signal: AbortSignal.timeout(this.timeoutMs),
          ...(noCache ? { cache: 'no-store' as RequestCache } : {}),
          ...(body ? { body: JSON.stringify(body) } : {})
        });

        if (!response.ok) {
          // Handle 404 with retry if enabled
          if (response.status === 404 && retryOn404 && attempt < this.maxRetries) {
            const delay = this.retryDelayMs * Math.pow(2, attempt - 1);
            logger.warn(`${logEvent}.retry-404`, {
              url,
              attempt,
              nextAttempt: attempt + 1,
              delayMs: delay
            });
            await this.sleep(delay);
            continue;
          }

          // Try to get error body
          const errorText = await response.text();
          const errorBody = this.normalizeErrorBody(errorText);

          // Log expected failures at warn level:
          // - 401/403: expected for unauthenticated/unsubscribed users
          // - 404 without retryOn404: resource genuinely doesn't exist (e.g., getAttribute on stub)
          const isExpectedFailure = response.status === 401 || response.status === 403 || (response.status === 404 && !retryOn404);
          const logLevel = isExpectedFailure ? 'warn' : 'error';
          logger[logLevel](`${logEvent}.error`, {
            url,
            method,
            status: response.status,
            statusText: response.statusText,
            errorBody
          });

          throw new AiroHttpError(response.status, response.statusText, errorBody);
        }

        // Success - parse and return
        const result = await response.json() as T;

        return result;
      } catch (error) {
        const attemptDuration = Date.now() - attemptStart;
        const totalDuration = Date.now() - apiCallStart;

        // Do not retry auth/authz failures - they require user action and retrying only adds latency/noise.
        // 401 = authentication (invalid/expired token), 403 = authorization (no permission)
        if (error instanceof AiroHttpError && (error.status === 401 || error.status === 403)) {
          logger.warn('mgmt-airo.api.auth-error.no-retry', {
            message: `${apiCallId} failed with ${error.status}, skipping retries`,
            url,
            attempt,
            attemptDuration,
            totalDuration,
          });
          throw error;
        }

        // Do not retry 404s when retryOn404 is disabled - the resource genuinely doesn't exist.
        if (error instanceof AiroHttpError && error.status === 404 && !retryOn404) {
          throw error;
        }

        logger.error('mgmt-airo.api.attempt-error', {
          message: `${apiCallId} attempt ${attempt} failed`,
          url,
          attempt,
          attemptDuration,
          totalDuration,
          error: error instanceof Error ? error.message : String(error)
        });

        if (attempt === this.maxRetries) {
          logger.error(`${logEvent}.final-error`, {
            url,
            method,
            attempt,
            totalDuration,
            error: error instanceof Error ? error.message : String(error)
          });
          throw error;
        }

        const delay = this.retryDelayMs * Math.pow(2, attempt - 1);
        logger.warn(`${logEvent}.retry`, {
          url,
          method,
          attempt,
          nextAttempt: attempt + 1,
          delayMs: delay,
          totalDuration,
          error: error instanceof Error ? error.message : String(error)
        });
        await this.sleep(delay);
      }
    }

    throw new Error(`Request failed after ${this.maxRetries} attempts`);
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Extract customer ID from JWT using shared jwt-utils
   *
   * Note: This uses the jwt-utils module for proper JWT parsing without signature verification.
   * Signature verification is handled by mgmt-airo when the JWT is passed in the Authorization header.
   */
  private extractCustomerId(): string | null {
    return extractCustomerIdFromJWT(this.jwt);
  }

  /**
   * Check if customer exists in mgmt-airo
   *
   * @throws {AiroHttpError} Re-throws 401 errors for authentication redirect
   * @returns Customer info with exists status
   */
  async checkCustomer(): Promise<AiroCustomer> {
    try {
      await this.request('GET', '/api/airo/v1/customers/me', undefined, {
        logEvent: 'mgmt-airo.check-customer'
      });
      return {
        customerId: this.extractCustomerId() || 'unknown',
        exists: true
      };
    } catch (error: any) {
      // Re-throw 401 so it can propagate up for auth redirect
      if (error.status === 401) {
        throw error;
      }
      // 403 or other errors mean customer doesn't exist
      return {
        customerId: this.extractCustomerId() || 'unknown',
        exists: false
      };
    }
  }

  /**
   * Get all subscriptions for the customer
   *
   * Filters by ownerProduct=AiroAppBuilder by default to only return aab-v1 subscriptions.
   * This ensures we don't show PaaS or other product subscriptions in the AI App Builder UI.
   *
   * @param ownerProduct - Filter by product family (defaults to AiroAppBuilder)
   */
  async getSubscriptions(
    ownerProduct: string = DEFAULT_OWNER_PRODUCT,
    options: { includeAttributes?: boolean } = {}
  ): Promise<AiroSubscription[]> {
    const params = new URLSearchParams({ ownerProduct });
    if (options.includeAttributes) {
      params.set('includeAttributes', 'true');
    }
    const response = await this.request<AiroSubscription[] | { subscriptions: AiroSubscription[] }>(
      'GET',
      `/api/airo/v1/subscriptions?${params.toString()}`,
      undefined,
      { logEvent: 'mgmt-airo.get-subscriptions' }
    );

    return Array.isArray(response) ? response : response.subscriptions || [];
  }

  /**
   * Get the first active subscription
   */
  async getActiveSubscription(ownerProduct: string = DEFAULT_OWNER_PRODUCT): Promise<AiroSubscription | null> {
    const subscriptions = await this.getSubscriptions(ownerProduct);
    return subscriptions.length > 0 ? subscriptions[0] : null;
  }

  /**
   * Get a single subscription by ID
   *
   * GET /api/airo/v1/subscriptions/:subscriptionId
   *
   * @param subscriptionId - The subscription ID to fetch
   * @param options - Optional configuration
   * @param options.noCache - Bypass cache and fetch fresh data
   * @returns Promise resolving to the subscription data
   */
  async getSubscription(
    subscriptionId: string,
    options: { noCache?: boolean; includeAttributes?: boolean } = {}
  ): Promise<AiroSubscription> {
    const params = options.includeAttributes ? '?includeAttributes=true' : '';
    return this.request<AiroSubscription>(
      'GET',
      `/api/airo/v1/subscriptions/${subscriptionId}${params}`,
      undefined,
      { logEvent: 'mgmt-airo.get-subscription', noCache: options.noCache }
    );
  }

  /**
   * Get all systems for a subscription
   */
  async getSystems(subscriptionId: string): Promise<Array<AiroSystem & { id: string }>> {
    const response = await this.request<AiroSystem[] | { systems: AiroSystem[] }>(
      'GET',
      `/api/airo/v1/subscriptions/${subscriptionId}/systems`,
      undefined,
      { logEvent: 'mgmt-airo.get-systems' }
    );

    const systems = Array.isArray(response) ? response : response.systems || [];

    // Map systemId to id for consistency
    return systems.map(s => ({
      ...s,
      id: s.systemId
    }));
  }

  /**
   * Get apps for a subscription (flat list across all systems)
   */
  async getApps(subscriptionId: string): Promise<AiroApp[]> {
    const response = await this.request<{ apps: AiroApp[] }>(
      'GET',
      `/api/airo/v1/subscriptions/${subscriptionId}/apps`,
      undefined,
      { logEvent: 'mgmt-airo.get-apps' }
    );

    return response.apps || [];
  }
  /**
   * Get entitlement for a subscription
   */
  async getEntitlements(subscriptionId: string): Promise<AiroSubscription> {
    const response = await this.request<AiroSubscription>(
      'GET',
      `/api/airo/v1/subscriptions/${subscriptionId}/entitlement`,
      undefined,
      { logEvent: 'mgmt-airo.get-entitlement' }
    );

    return response;
  }
  /**
   * Get apps for a specific system
   */
  async getAppsForSystem(subscriptionId: string, systemId: string): Promise<AiroApp[]> {
    const response = await this.request<{ apps: AiroApp[] }>(
      'GET',
      `/api/airo/v1/subscriptions/${subscriptionId}/systems/${systemId}/apps`,
      undefined,
      { logEvent: 'mgmt-airo.get-apps-for-system' }
    );

    return response.apps || [];
  }

  /**
   * Get full app details (including variables from mgmt-hosting)
   *
   * @param subscriptionId - Subscription ID
   * @param systemId - System ID
   * @param appId - App ID
   * @param includeCdn - Whether to include CDN status and anycast IP information for domains
   * @returns Promise resolving to app details with optional domain information
   */
  async getApp(
    subscriptionId: string,
    systemId: string,
    appId: string,
    includeCdn = false
  ): Promise<AiroAppDetails> {
    const queryParams = includeCdn ? '?includeCdn=true' : '';
    return this.request<AiroAppDetails>(
      'GET',
      `/api/airo/v1/subscriptions/${subscriptionId}/systems/${systemId}/apps/${appId}${queryParams}`,
      undefined,
      {
        logEvent: 'mgmt-airo.get-app',
        retryOn404: true, // App might not be synced yet
        noCache: true // Disable caching to get fresh data during polling
      }
    );
  }

  /**
   * Get Airo job with tracked apps
   */
  async getAiroJobApps(jobId: string): Promise<AiroJobStatus> {
    return this.request<AiroJobStatus>(
      'GET',
      `/api/airo/v1/jobs/${jobId}/apps`,
      undefined,
      { logEvent: 'mgmt-airo.get-airo-job-apps' }
    );
  }

  /**
   * Initiate a CDN cache purge for an app.
   *
   * @param subscriptionId - Subscription ID
   * @param systemId - System ID
   * @param appId - Application ID
   * @returns Response containing the statusJobId for polling
   * @throws AiroHttpError with 409 if a purge is already in progress (body may contain statusJobId)
   */
  async purgeCache(
    subscriptionId: string,
    systemId: string,
    appId: string
  ): Promise<AiroPurgeCacheResponse> {
    return this.request<AiroPurgeCacheResponse>(
      'POST',
      `/api/airo/v1/subscriptions/${subscriptionId}/systems/${systemId}/apps/${appId}/purge-cache`,
      undefined,
      { logEvent: 'mgmt-airo.purge-cache' }
    );
  }

  /**
   * Whether the app is in cold archive and may be restored.
   */
  async getArchiveStatus(
    subscriptionId: string,
    systemId: string,
    appId: string
  ): Promise<AiroArchiveStatusResponse> {
    return this.request<AiroArchiveStatusResponse>(
      'GET',
      `/api/airo/v1/subscriptions/${subscriptionId}/systems/${systemId}/apps/${appId}/archive-status`,
      undefined,
      { logEvent: 'mgmt-airo.archive-status' }
    );
  }

  /**
   * Start async restore from cold archive.
   */
  async restoreArchivedApp(
    subscriptionId: string,
    systemId: string,
    appId: string,
    payload?: { targetCell?: string }
  ): Promise<AiroArchiveRestoreResponse> {
    return this.request<AiroArchiveRestoreResponse>(
      'POST',
      `/api/airo/v1/subscriptions/${subscriptionId}/systems/${systemId}/apps/${appId}/restore`,
      payload,
      { logEvent: 'mgmt-airo.archive-restore' }
    );
  }

  /**
   * Get the status of an async job (e.g. CDN purge, deployment).
   *
   * @param jobId - Job ID returned from an async operation
   * @returns Job status object with id, status, and optional completedAt
   */
  async getJob(jobId: string): Promise<AiroJob> {
    return this.request<AiroJob>(
      'GET',
      `/api/airo/v1/jobs/${jobId}`,
      undefined,
      { logEvent: 'mgmt-airo.get-job', noCache: true }
    );
  }

  /**
   * Build the optional `x-katana-version` header map used to target a specific Katana
   * artifact (dark-release). Returns `undefined` when no version is supplied so the
   * header is omitted entirely.
   */
  private katanaVersionHeaders(katanaVersion?: string): Record<string, string> | undefined {
    return katanaVersion ? { [KATANA_VERSION_HEADER]: katanaVersion } : undefined;
  }

  /**
   * Create a new subscription with app (signup/provision workflow)
   */
  async signup(payload: AiroSignupPayload, katanaVersion?: string): Promise<AiroSignupResponse> {
    return this.request<AiroSignupResponse>(
      'POST',
      '/api/airo/v1/signup',
      payload,
      { logEvent: 'mgmt-airo.signup', extraHeaders: this.katanaVersionHeaders(katanaVersion) }
    );
  }

  /**
   * Add app to existing subscription + system (airo-add-app workflow)
   */
  async createApp(
    subscriptionId: string,
    systemId: string,
    payload: AiroCreateAppPayload,
    katanaVersion?: string
  ): Promise<AiroCreateAppResponse> {
    return this.request<AiroCreateAppResponse>(
      'POST',
      `/api/airo/v1/subscriptions/${subscriptionId}/systems/${systemId}/apps`,
      payload,
      { logEvent: 'mgmt-airo.create-app', extraHeaders: this.katanaVersionHeaders(katanaVersion) }
    );
  }

  /**
   * Update app details
   */
  async updateApp(
    subscriptionId: string,
    systemId: string,
    appId: string,
    payload: AiroUpdateAppPayload
  ): Promise<AiroAppDetails> {
    return this.request<AiroAppDetails>(
      'PATCH',
      `/api/airo/v1/subscriptions/${subscriptionId}/systems/${systemId}/apps/${appId}`,
      payload,
      { logEvent: 'mgmt-airo.update-app' }
    );
  }

  /**
   * Update app project domain
   *
   * Updates the project domain (subdomain) for an app
   *
   * @param subscriptionId - Subscription ID
   * @param systemId - System ID
   * @param appId - App ID
   * @param payload - Project domain update payload
   * @returns Project domain update response
   */
  async updateProjectDomain(
    subscriptionId: string,
    systemId: string,
    appId: string,
    payload: AiroUpdateProjectDomainPayload
  ): Promise<AiroUpdateProjectDomainResponse> {
    return this.request<AiroUpdateProjectDomainResponse>(
      'PUT',
      `/api/airo/v1/subscriptions/${subscriptionId}/systems/${systemId}/apps/${appId}/project-domain`,
      payload,
      { logEvent: 'mgmt-airo.update-project-domain' }
    );
  }

  /**
   * Check domain availability
   *
   * Validates if a domain (project prefix or custom domain) is available
   *
   * @param subscriptionId - Subscription ID
   * @param systemId - System ID
   * @param appId - App ID
   * @param options - Domain check options
   * @param options.mode - Domain mode (DomainMode.PROJECT or DomainMode.CUSTOM)
   * @param options.projectPrefix - Project prefix (required if mode is DomainMode.PROJECT)
   * @param options.fqdn - Fully qualified domain name (required if mode is DomainMode.CUSTOM)
   * @returns Domain validation response with availability status and error details
   */
  async checkDomainAvailability(
    subscriptionId: string,
    systemId: string,
    appId: string,
    options: { mode: DomainMode.PROJECT; projectPrefix: string } | { mode: DomainMode.CUSTOM; fqdn: string }
  ): Promise<AiroDomainCheckResponse> {
    const queryParams = new URLSearchParams({ mode: options.mode });

    if (options.mode === DomainMode.PROJECT) {
      queryParams.append('projectPrefix', options.projectPrefix);
    } else {
      queryParams.append('fqdn', options.fqdn);
    }

    return this.request<AiroDomainCheckResponse>(
      'GET',
      `/api/airo/v1/subscriptions/${subscriptionId}/systems/${systemId}/apps/${appId}/domain/check?${queryParams.toString()}`,
      undefined,
      { logEvent: 'mgmt-airo.check-domain-availability' }
    );
  }

  /**
   * Deploy app
   *
   * PUT /api/airo/v1/subscriptions/:subscriptionId/systems/:systemId/apps/:appId/deploy
   *
   * @param subscriptionId - Subscription ID
   * @param systemId - System ID
   * @param appId - App ID
   * @param options - Optional deploy options (environment, variant for hibernation resume)
   */
  async deployApp(
    subscriptionId: string,
    systemId: string,
    appId: string,
    options?: { environment?: string; variant?: string }
  ): Promise<AiroDeployAppResponse> {
    return this.request<AiroDeployAppResponse>(
      'PUT',
      `/api/airo/v1/subscriptions/${subscriptionId}/systems/${systemId}/apps/${appId}/deploy`,
      options,
      { logEvent: 'mgmt-airo.deploy-app' }
    );
  }

  /**
   * Publish app - notify mgmt-airo of new git archive
   *
   * PUT /api/airo/v1/subscriptions/:subscriptionId/systems/:systemId/apps/:appId/publish
   *
   * @param subscriptionId - Subscription ID
   * @param systemId - System ID
   * @param appId - App ID
   * @param gitHash - Full git SHA-1 hash (40 characters)
   * @returns Deployment job information with status tracking IDs
   */
  async publishApp(
    subscriptionId: string,
    systemId: string,
    appId: string,
    gitHash: string,
    dnsUpdateConsent?: boolean
  ): Promise<AiroPublishAppResponse> {
    const payload = {
      gitHash,
      ...(dnsUpdateConsent === undefined ? {} : { dnsUpdateConsent }),
    };

    return this.request<AiroPublishAppResponse>(
      'PUT',
      `/api/airo/v1/subscriptions/${subscriptionId}/systems/${systemId}/apps/${appId}/publish`,
      payload,
      { logEvent: 'mgmt-airo.publish-app' }
    );
  }

  /**
   * Check if an app's domain currently conflicts with Airo Builder DNS targets.
   *
   * GET /api/airo/v1/subscriptions/:subscriptionId/systems/:systemId/apps/:appId/dns-check-conflict?fqdn=<domain>
   */
  async checkDnsConflict(
    subscriptionId: string,
    systemId: string,
    appId: string,
    fqdn: string
  ): Promise<AiroDnsConflictCheckResponse> {
    return this.request<AiroDnsConflictCheckResponse>(
      'GET',
      `/api/airo/v1/subscriptions/${subscriptionId}/systems/${systemId}/apps/${appId}/dns-check-conflict?fqdn=${encodeURIComponent(fqdn)}`,
      undefined,
      { logEvent: 'mgmt-airo.dns-check-conflict' }
    );
  }

  /**
   * Unpublish app - mark publish variant as inactive
   *
   * POST /api/airo/v1/subscriptions/:subscriptionId/systems/:systemId/apps/:appId/unpublish
   *
   * The app remains accessible via preview URL. Re-publishing restores the publish variant.
   *
   * @param subscriptionId - Subscription ID
   * @param systemId - System ID
   * @param appId - App ID
   * @returns Promise resolving to unpublish response
   */
  async unpublishApp(
    subscriptionId: string,
    systemId: string,
    appId: string
  ): Promise<AiroUnpublishAppResponse> {
    return this.request<AiroUnpublishAppResponse>(
      'POST',
      `/api/airo/v1/subscriptions/${subscriptionId}/systems/${systemId}/apps/${appId}/unpublish`,
      undefined,
      { logEvent: 'mgmt-airo.unpublish-app' }
    );
  }

  /**
   * Modify app domains - create or delete domains for an app
   *
   * PUT /api/airo/v1/subscriptions/:subscriptionId/systems/:systemId/apps/:appId/domains
   *
   * @param subscriptionId - Subscription ID
   * @param systemId - System ID
   * @param appId - App ID
   * @param payload - Domain modification data including domains to create/delete and CDN options
   * @returns Promise resolving to domain modification job information with status tracking ID
   */
  async modifyDomains(
    subscriptionId: string,
    systemId: string,
    appId: string,
    payload: AiroModifyDomainsPayload
  ): Promise<AiroModifyDomainsResponse> {
    return this.request<AiroModifyDomainsResponse>(
      'PUT',
      `/api/airo/v1/subscriptions/${subscriptionId}/systems/${systemId}/apps/${appId}/domains`,
      payload,
      { logEvent: 'mgmt-airo.modify-domains' }
    );
  }

  /**
   * Trigger consent-gated CAA remediation for a GoDaddy-managed domain.
   *
   * POST /api/airo/v1/subscriptions/:subscriptionId/systems/:systemId/apps/:appId/domains/caa-remediation
   *
   * Additively authorizes a supported issuer on the domain's existing CAA RRset
   * and re-runs the attach. Returns the same status-job shape as modifyDomains.
   *
   * @param subscriptionId - Subscription ID
   * @param systemId - System ID
   * @param appId - App ID
   * @param payload - Same create-side payload as the attach call, plus explicit consent
   * @returns Promise resolving to domain modification job information with status tracking ID
   */
  async caaRemediation(
    subscriptionId: string,
    systemId: string,
    appId: string,
    payload: AiroCaaRemediationPayload
  ): Promise<AiroModifyDomainsResponse> {
    return this.request<AiroModifyDomainsResponse>(
      'POST',
      `/api/airo/v1/subscriptions/${subscriptionId}/systems/${systemId}/apps/${appId}/domains/caa-remediation`,
      payload,
      { logEvent: 'mgmt-airo.caa-remediation' }
    );
  }

  /**
   * Get domain error details for a specific domain
   *
   * GET /api/airo/v1/subscriptions/:subscriptionId/systems/:systemId/apps/:appId/domain-error?fqdn=<domain>
   *
   * Retrieves error details for a specific domain if one exists.
   * Throws AiroHttpError with status 404 if no error exists for the given domain.
   *
   * @param subscriptionId - Subscription ID
   * @param systemId - System ID
   * @param appId - Application ID
   * @param fqdn - Fully qualified domain name to check for errors
   * @returns Promise resolving to domain error details
   * @throws AiroHttpError with status 404 if no error exists
   */
  async getDomainError(
    subscriptionId: string,
    systemId: string,
    appId: string,
    fqdn: string
  ): Promise<AiroDomainErrorResponse> {
    return this.request<AiroDomainErrorResponse>(
      'GET',
      `/api/airo/v1/subscriptions/${subscriptionId}/systems/${systemId}/apps/${appId}/domain-error?fqdn=${encodeURIComponent(fqdn)}`,
      undefined,
      { logEvent: 'mgmt-airo.get-domain-error' }
    );
  }

  /**
   * Get domain modification job status for an FQDN
   *
   * GET /api/airo/v1/subscriptions/:subscriptionId/systems/:systemId/apps/:appId/domain-job?fqdn=<fqdn>
   */
  async getDomainJob(
    subscriptionId: string,
    systemId: string,
    appId: string,
    fqdn: string
  ): Promise<AiroDomainJobResponse> {
    return this.request<AiroDomainJobResponse>(
      'GET',
      `/api/airo/v1/subscriptions/${subscriptionId}/systems/${systemId}/apps/${appId}/domain-job?fqdn=${encodeURIComponent(fqdn)}`,
      undefined,
      { logEvent: 'mgmt-airo.get-domain-job' }
    );
  }

  /**
   * Get domain DNS ownership details for one or more FQDNs (comma-separated in query)
   *
   * GET /api/airo/v1/subscriptions/:subscriptionId/systems/:systemId/apps/:appId/domain-dns-ownership
   *
   * @param subscriptionId - Subscription ID
   * @param systemId - System ID
   * @param appId - Application ID
   * @param query - fqdns (comma-separated), customerId, shopperId
   */
  async getDomainDnsOwnership(
    subscriptionId: string,
    systemId: string,
    appId: string,
    query: { fqdns: string; customerId: string; shopperId: string }
  ): Promise<AiroDomainDnsOwnershipResponse> {
    const params = new URLSearchParams({
      fqdns: query.fqdns,
      customerId: query.customerId,
      shopperId: query.shopperId,
    });
    return this.request<AiroDomainDnsOwnershipResponse>(
      'GET',
      `/api/airo/v1/subscriptions/${subscriptionId}/systems/${systemId}/apps/${appId}/domain-dns-ownership?${params.toString()}`,
      undefined,
      { logEvent: 'mgmt-airo.get-domain-dns-ownership' }
    );
  }

  async updateEntitlement(
    subscriptionId: string,
    payload: { entitlementId: string }
  ): Promise<AiroSubscription> {
    return this.request<AiroSubscription>(
      'PUT',
      `/api/airo/v1/subscriptions/${subscriptionId}/entitlement`,
      payload,
      { logEvent: 'mgmt-airo.update-entitlement' }
    );
  }

  async acknowledgeConversion(subscription: AiroSubscription): Promise<AiroAttribute> {
    const attribute = subscription.attributes?.find(a => a.key === ATTRIBUTE_KEYS.FREE_PLAN);
    if (!attribute) {
      throw new AiroHttpError(404, 'Not Found', 'free-plan attribute not found');
    }
    if (attribute.value?.conversionEventDate) {
      return attribute;
    }
    return this.updateAttribute(attribute.id, {
      value: { ...attribute.value, conversionEventDate: new Date().toISOString() },
    });
  }

  /**
   * Create a builder plan for a subscription
   *
   * POST /api/airo/v1/subscriptions/:subscriptionId/builder-plan
   *
   * Creates a free builder plan for users who don't have one.
   * This ensures all users accessing the develop page have a valid plan.
   *
   * @param subscriptionId - Subscription ID
   * @param payload - Optional payload with plan type (defaults to free)
   * @returns Promise resolving to the created builder plan details
   */
  async createBuilderPlan(
    subscriptionId: string,
    payload?: AiroCreateBuilderPlanPayload
  ): Promise<AiroCreateBuilderPlanResponse> {
    return this.request<AiroCreateBuilderPlanResponse>(
      'POST',
      `/api/airo/v1/subscriptions/${subscriptionId}/builder-plan`,
      payload || {},
      { logEvent: 'mgmt-airo.create-builder-plan' }
    );
  }

  /**
   * Get credit grants for a subscription
   *
   * GET /api/airo/v1/subscriptions/:subscriptionId/credits/grants
   *
   * Returns the credit grants (monthly plan and credit packs) for a subscription.
   * Grants are ordered by `useBefore` date to determine which should be used first.
   *
   * @param subscriptionId - Subscription ID
   * @param syncSpend - Whether to sync spend data before returning (default: true)
   * @returns Promise resolving to array of credit grants
   */
  async getCreditGrants(
    subscriptionId: string,
    syncSpend = true
  ): Promise<AiroCreditGrant[]> {
    const params = new URLSearchParams({ syncSpend: syncSpend.toString() });
    const response = await this.request<AiroGetCreditGrantsResponse>(
      'GET',
      `/api/airo/v1/subscriptions/${subscriptionId}/credits/grants?${params.toString()}`,
      undefined,
      { logEvent: 'mgmt-airo.get-credit-grants', noCache: true }
    );

    return response.grants || [];
  }

  /**
   * Delete app
   */
  async deleteApp(
    subscriptionId: string,
    systemId: string,
    appId: string
  ): Promise<AiroDeleteAppResponse> {
    return this.request<AiroDeleteAppResponse>(
      'DELETE',
      `/api/airo/v1/subscriptions/${subscriptionId}/systems/${systemId}/apps/${appId}`,
      undefined,
      { logEvent: 'mgmt-airo.delete-app' }
    );
  }

  /**
   * Get all apps for customer across all subscriptions and systems (bulk endpoint)
   *
   * This is a performance optimization that replaces the N+1 query pattern:
   * - Old: GET /subscriptions → N * GET /systems → N*M * GET /apps
   * - New: GET /customers/me/apps (single request)
   *
   * Filters by ownerProduct=AiroAppBuilder by default to only return aab-v1 apps.
   * This ensures we don't show PaaS or other product apps in the AI App Builder UI.
   *
   * @param ownerProduct - Filter by product family (defaults to AiroAppBuilder)
   */
  async getAllAppsForCustomer(ownerProduct: string = DEFAULT_OWNER_PRODUCT): Promise<AiroApp[]> {
    const params = new URLSearchParams({ ownerProduct });
    const response = await this.request<AiroBulkAppsResponse>(
      'GET',
      `/api/airo/v1/customers/me/apps?${params.toString()}`,
      undefined,
      { logEvent: 'mgmt-airo.get-all-apps-for-customer' }
    );

    return response.apps || [];
  }

  /**
   * Get apps the customer collaborates on but does not own (AAB multi-user
   * "shared with me"). Returns the same enriched app shape as
   * `getAllAppsForCustomer`, each tagged `sharedWithMe: true` and carrying
   * `ownerCustomerId` (the real owner — never the caller).
   *
   * GET /api/airo/v1/customers/me/shared-apps
   */
  async getSharedAppsForCustomer(): Promise<AiroApp[]> {
    const response = await this.request<AiroBulkAppsResponse>(
      'GET',
      `/api/airo/v1/customers/me/shared-apps`,
      undefined,
      { logEvent: 'mgmt-airo.get-shared-apps-for-customer', noCache: true }
    );

    return response.apps || [];
  }

  /**
   * Get complete customer tree (subscriptions → systems → apps)
   *
   * This is the ultimate performance optimization that replaces many sequential API calls:
   * - Old: GET /customers/me + GET /subscriptions + N * GET /systems + N*M * GET /apps
   * - New: GET /customers/me/tree (single request)
   *
   * Expected performance improvement:
   * - API calls: many → 1 (99.2% reduction)
   * - Load time: many seconds → ~800ms (97% faster)
   * - Backend hops: many → 1 (98% reduction)
   *
   * Filters by ownerProduct=AiroAppBuilder by default to only return aab-v1 data.
   * This ensures we don't show PaaS or other product data in the AI App Builder UI.
   *
   * @param ownerProduct - Filter by product family (defaults to AiroAppBuilder)
   * @returns Promise resolving to complete customer tree with all subscriptions, systems, and apps
   */
  async getCustomerTree(ownerProduct: string = DEFAULT_OWNER_PRODUCT): Promise<CustomerTree> {
    const params = new URLSearchParams({ ownerProduct });
    return this.request<CustomerTree>(
      'GET',
      `/api/airo/v1/customers/me/tree?${params.toString()}`,
      undefined,
      { logEvent: 'mgmt-airo.get-customer-tree' }
    );
  }

  /**
   * Get deployments for a specific app
   *
   * @param subscriptionId - Subscription ID
   * @param systemId - System ID
   * @param appId - App ID
   * @param limit - Maximum number of deployments to return (default: 20)
   * @param includeJobData - Whether to include job data in response (default: true)
   * @param dedupe - Whether to deduplicate by gitHash (default: true)
   * @returns Promise resolving to deployments response
   */
  async getDeployments(
    subscriptionId: string,
    systemId: string,
    appId: string,
    limit = 20,
    includeJobData = true,
    dedupe = true
  ): Promise<AiroDeploymentsResponse> {
    const params = new URLSearchParams({
      limit: limit.toString(),
      includeJobData: includeJobData.toString(),
    });
    if (!dedupe) {
      params.set('dedupe', 'false');
    }

    return this.request<AiroDeploymentsResponse>(
      'GET',
      `/api/airo/v1/subscriptions/${subscriptionId}/systems/${systemId}/apps/${appId}/deployments?${params.toString()}`,
      undefined,
      { logEvent: 'mgmt-airo.get-deployments', noCache: true }
    );
  }

  /**
   * Get attribute by key for owner
   *
   * @param ownerType - Type of owner (e.g., 'user')
   * @param ownerId - ID of the owner (e.g., customer ID)
   * @param key - Attribute key (e.g., 'ventures')
   * @returns Promise resolving to attribute or null if not found
   */
  async getAttribute(
    ownerType: string,
    ownerId: string,
    key: string
  ): Promise<AiroAttribute | null> {
    try {
      return await this.request<AiroAttribute>(
        'GET',
        `/api/airo/v1/attributes/${ownerType}/${ownerId}/${key}`,
        undefined,
        {
          logEvent: 'mgmt-airo.get-attribute',
          retryOn404: false
        }
      );
    } catch (error: any) {
      // Return null for 404 (attribute doesn't exist)
      if (error instanceof AiroHttpError && error.status === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Create attribute for owner
   *
   * @param ownerType - Type of owner (e.g., 'user')
   * @param ownerId - ID of the owner (e.g., customer ID)
   * @param payload - Attribute payload with key and value
   * @returns Promise resolving to created attribute
   */
  async createAttribute(
    ownerType: string,
    ownerId: string,
    payload: AiroCreateAttributePayload
  ): Promise<AiroAttribute> {
    return this.request<AiroAttribute>(
      'POST',
      `/api/airo/v1/attributes/${ownerType}/${ownerId}`,
      payload,
      { logEvent: 'mgmt-airo.create-attribute' }
    );
  }

  /**
   * Update attribute by ID
   *
   * @param attributeId - ID of the attribute
   * @param payload - Attribute update payload with value
   * @returns Promise resolving to updated attribute
   */
  async updateAttribute(
    attributeId: string,
    payload: AiroUpdateAttributePayload
  ): Promise<AiroAttribute> {
    return this.request<AiroAttribute>(
      'PUT',
      `/api/airo/v1/attributes/${attributeId}`,
      payload,
      { logEvent: 'mgmt-airo.update-attribute' }
    );
  }

  /**
   * Get secrets for an app
   *
   * Retrieves the list of secrets configured for a specific application and variant.
   * By default returns metadata only; pass `includeValues: true` when the caller is
   * allowed to receive secret material (e.g. authenticated app owner in Settings).
   *
   * @param subscriptionId - Subscription ID
   * @param systemId - System ID
   * @param appId - Application ID
   * @param variant - Variant to filter by (preview or publish)
   * @param includeValues - When true, requests values from mgmt-airo (subject to API policy)
   * @returns Promise resolving to secrets response (raw nested structure)
   *
   * @example
   * ```typescript
   * const secrets = await client.getSecrets(subId, sysId, appId, 'preview');
   * console.log(secrets.secrets); // Array of secret metadata
   * ```
   */
  async getSecrets(
    subscriptionId: string,
    systemId: string,
    appId: string,
    variant?: 'preview' | 'publish',
    includeValues?: boolean
  ): Promise<AiroRawSecretsResponse> {
    const params = new URLSearchParams({
      ...(variant ? { filter: 'variant', variant } : {}),
      ...(includeValues ? { includeValues: 'true' } : {})
    });
    return this.request<AiroRawSecretsResponse>(
      'GET',
      `/api/airo/v1/subscriptions/${subscriptionId}/systems/${systemId}/apps/${appId}/secrets?${params.toString()}`,
      undefined,
      {
        logEvent: 'mgmt-airo.get-secrets',
        noCache: true
      }
    );
  }

  /**
   * Update secrets for an app
   *
   * Performs bulk secret operations (upsert and delete) for a specific application.
   * Operations are processed atomically via a workflow execution.
   *
   * Operation types:
   * - upsert: Create new secret or update existing (requires name, value, variants, systemManaged)
   * - delete: Delete existing secret (requires name, variants, systemManaged)
   *
   * @param subscriptionId - Subscription ID
   * @param systemId - System ID
   * @param appId - Application ID
   * @param payload - Update payload with operations and workflow name
   * @returns Promise resolving to update response with workflow execution details
   *
   * @example
   * ```typescript
   * const result = await client.updateSecrets(subId, sysId, appId, {
   *   operations: [
   *     {
   *       type: 'upsert',
   *       secret: {
   *         name: 'API_KEY',
   *         value: 'secret123',
   *         variants: ['preview'],
   *         systemManaged: false
   *       }
   *     },
   *     {
   *       type: 'delete',
   *       secret: {
   *         name: 'OLD_KEY',
   *         variants: ['preview'],
   *         systemManaged: false
   *       }
   *     }
   *   ],
   *   workflowName: 'airo-app-secrets'
   * });
   * console.log(result.statusJobId);
   * ```
   */
  async updateSecrets(
    subscriptionId: string,
    systemId: string,
    appId: string,
    payload: AiroUpdateSecretsPayload
  ): Promise<AiroUpdateSecretsResponse> {
    return this.request<AiroUpdateSecretsResponse>(
      'POST',
      `/api/airo/v1/subscriptions/${subscriptionId}/systems/${systemId}/apps/${appId}/secrets`,
      payload,
      { logEvent: 'mgmt-airo.update-secrets' }
    );
  }

  /**
   * Get token budget for a subscription
   *
   * Returns the current spend and budget limits for a subscription.
   *
   * @param subscriptionId - The subscription ID
   * @returns Promise resolving to token budget response
   */
  async getTokenBudget(subscriptionId: string): Promise<AiroTokenBudgetResponse> {
    return this.request<AiroTokenBudgetResponse>(
      'GET',
      `/api/airo/v1/subscriptions/${subscriptionId}/token-budget`,
      undefined,
      { logEvent: 'mgmt-airo.get-token-budget', noCache: true }
    );
  }

  /**
   * Record an app export event for refund eligibility tracking
   *
   * @param subscriptionId - Subscription ID
   * @param systemId - System ID
   * @param appId - Application ID
   * @param exportData - Export details
   * @param exportData.initiatedBy - Customer ID of the logged-in user (for refund eligibility)
   * @param exportData.exportedAt - ISO timestamp of export
   * @param exportData.appName - Name of the app
   * @param exportData.metadata - Optional metadata (includes shopperId and auth details for audit trail)
   * @returns Promise resolving to export record response
   */
  async recordExport(
    subscriptionId: string,
    systemId: string,
    appId: string,
    exportData: {
      initiatedBy: string;
      exportedAt: string;
      appName: string;
      metadata?: Record<string, any>;
    }
  ): Promise<{ id: string; subscriptionId: string; appId: string; exportedAt: string } | null> {
    try {
      return await this.request<{ id: string; subscriptionId: string; appId: string; exportedAt: string }>(
        'POST',
        `/api/airo/v1/subscriptions/${subscriptionId}/systems/${systemId}/apps/${appId}/exports`,
        exportData,
        { logEvent: 'mgmt-airo.record-export' }
      );
    } catch (error) {
      // Re-throw 401s so callers can surface SSO re-auth (authReason: 2).
      // Every other error is swallowed — export tracking is non-critical.
      if (error instanceof AiroHttpError && error.status === 401) {
        throw error;
      }
      logger.warn('mgmt-airo.record-export.failed', {
        subscriptionId,
        systemId,
        appId,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  async recordEvent(
    subscriptionId: string,
    systemId: string,
    appId: string,
    payload: AiroEventPayload,
  ): Promise<AiroEventResponse> {
    return this.request<AiroEventResponse>(
      'POST',
      `/api/airo/v1/subscriptions/${subscriptionId}/systems/${systemId}/apps/${appId}/events`,
      payload,
      { logEvent: 'mgmt-airo.record-event' },
    );
  }

  /**
   * Get exports for an app
   *
   * Lists export records for a specific app.
   *
   * @param subscriptionId - Subscription ID
   * @param systemId - System ID
   * @param appId - App ID
   * @returns Promise resolving to exports list
   */
  async getAppExports(
    subscriptionId: string,
    systemId: string,
    appId: string
  ): Promise<{
    exports: Array<{
      id: string;
      initiatedBy: string;
      exportedAt: string;
    }>;
    total: number;
  }> {
    return await this.request<{
      exports: Array<{
        id: string;
        initiatedBy: string;
        exportedAt: string;
      }>;
      total: number;
    }>(
      'GET',
      `/api/airo/v1/subscriptions/${subscriptionId}/systems/${systemId}/apps/${appId}/exports`,
      undefined,
      { logEvent: 'mgmt-airo.get-app-exports' }
    );
  }

  /**
   * Get export status for a subscription
   *
   * Checks refund eligibility status based on export history.
   *
   * @param subscriptionId - Subscription ID
   * @returns Promise resolving to export status
   */
  async getExportsStatus(subscriptionId: string): Promise<{
    eligibleForRefund: boolean;
    lastExportedAt: string | null;
    totalExports: number;
  }> {
    return await this.request<{
      eligibleForRefund: boolean;
      lastExportedAt: string | null;
      totalExports: number;
    }>(
      'GET',
      `/api/airo/v1/subscriptions/${subscriptionId}/exports/status`,
      undefined,
      { logEvent: 'mgmt-airo.get-exports-status' }
    );
  }

  /**
   * Get image status for an app
   *
   * GET /api/airo/v1/subscriptions/:subscriptionId/systems/:systemId/apps/:appId/image-status
   *
   * @param subscriptionId - Subscription ID
   * @param systemId - System ID
   * @param appId - App ID
   * @returns Promise resolving to image status response
   */
  async getImageStatus(
    subscriptionId: string,
    systemId: string,
    appId: string,
    katanaVersion?: string
  ): Promise<AiroImageStatusResponse> {
    return this.request<AiroImageStatusResponse>(
      'GET',
      `/api/airo/v1/subscriptions/${subscriptionId}/systems/${systemId}/apps/${appId}/image-status`,
      undefined,
      { logEvent: 'mgmt-airo.get-image-status', noCache: true, extraHeaders: this.katanaVersionHeaders(katanaVersion) }
    );
  }

  /**
   * Reload images for an app
   *
   * POST /api/airo/v1/subscriptions/:subscriptionId/systems/:systemId/apps/:appId/reload
   *
   * @param subscriptionId - Subscription ID
   * @param systemId - System ID
   * @param appId - App ID
   * @returns Promise resolving to reload response
   */
  async reloadImages(
    subscriptionId: string,
    systemId: string,
    appId: string
  ): Promise<AiroReloadImagesResponse> {
    return this.request<AiroReloadImagesResponse>(
      'POST',
      `/api/airo/v1/subscriptions/${subscriptionId}/systems/${systemId}/apps/${appId}/reload`,
      {},
      { logEvent: 'mgmt-airo.reload-images' }
    );
  }

  /**
   * Initiate a transfer for an app
   *
   * POST /api/airo/v1/apps/:appId/transfer/initiate
   */
  async initiateTransfer(
    appId: string,
    targetEmail: string
  ): Promise<AiroTransferInitiateResponse> {
    return this.request<AiroTransferInitiateResponse>(
      'POST',
      `/api/airo/v1/apps/${appId}/transfer/initiate`,
      { targetEmail },
      { logEvent: 'mgmt-airo.initiate-transfer' }
    );
  }

  /**
   * Get transfer metadata for an app (initiator view)
   *
   * GET /api/airo/v1/apps/:appId/transfer/metadata
   */
  async getTransferMetadata(
    appId: string,
    transferToken?: string
  ): Promise<AiroTransferMetadata> {
    const params = transferToken
      ? `?transferToken=${encodeURIComponent(transferToken)}`
      : '';
    return this.request<AiroTransferMetadata>(
      'GET',
      `/api/airo/v1/apps/${appId}/transfer/metadata${params}`,
      undefined,
      { logEvent: 'mgmt-airo.get-transfer-metadata' }
    );
  }

  /**
   * Cancel a pending transfer for an app
   *
   * DELETE /api/airo/v1/apps/:appId/transfer
   */
  async cancelTransfer(appId: string): Promise<AiroTransferCancelResponse> {
    return this.request<AiroTransferCancelResponse>(
      'DELETE',
      `/api/airo/v1/apps/${appId}/transfer`,
      undefined,
      { logEvent: 'mgmt-airo.cancel-transfer' }
    );
  }

  /**
   * Accept a transfer using a token
   *
   * POST /api/airo/v1/transfer/accept
   */
  async acceptTransfer(transferToken: string): Promise<AiroTransferAcceptResponse> {
    return this.request<AiroTransferAcceptResponse>(
      'POST',
      '/api/airo/v1/transfer/accept',
      { transferToken },
      { logEvent: 'mgmt-airo.accept-transfer' }
    );
  }

  /**
   * Get transfer metadata by token (recipient view)
   *
   * GET /api/airo/v1/transfer/metadata?transferToken=xxx
   */
  async getTransferMetadataByToken(transferToken: string): Promise<AiroTransferMetadata> {
    return this.request<AiroTransferMetadata>(
      'GET',
      `/api/airo/v1/transfer/metadata?transferToken=${encodeURIComponent(transferToken)}`,
      undefined,
      { logEvent: 'mgmt-airo.get-transfer-metadata-by-token' }
    );
  }

  /**
   * Grant a collaborator access to an app (AAB multi-user, consumer track).
   *
   * Idempotent: a repeat call updates the role/scope in place. The endpoint is
   * OWNER-authorized (mgmt-airo EntityOwnerAuthorization) — construct this client
   * with the inviting owner's sso-jwt; a collaborator cannot grant (no
   * self-escalation). It is NOT service-principal/IAM authorized.
   *
   * POST /api/airo/v1/subscriptions/:subscriptionId/apps/:appId/collaborators
   */
  async grantCollaborator(
    subscriptionId: string,
    appId: string,
    payload: AiroGrantCollaboratorPayload
  ): Promise<AiroGrantCollaboratorResponse> {
    return this.request<AiroGrantCollaboratorResponse>(
      'POST',
      `/api/airo/v1/subscriptions/${subscriptionId}/apps/${appId}/collaborators`,
      payload,
      { logEvent: 'mgmt-airo.grant-collaborator' }
    );
  }

  /**
   * Record the OpenFGA venture an app's multi-user team is provisioned on, so a
   * later self-scoped reconcile can resolve venture -> (app, subscription).
   * Owner-authorized + idempotent; called by the BFF at venture provisioning.
   * POST (not PUT) to match the collaborator routes' gateway-forwarded verb.
   *
   * POST /api/airo/v1/subscriptions/:subscriptionId/apps/:appId/venture
   */
  async setAppVenture(subscriptionId: string, appId: string, ventureId: string): Promise<void> {
    await this.request<unknown>(
      'POST',
      `/api/airo/v1/subscriptions/${subscriptionId}/apps/${appId}/venture`,
      { ventureId },
      { logEvent: 'mgmt-airo.set-app-venture' }
    );
  }

  /**
   * Self-scoped collaborator reconcile (invitee-pull). The authenticated caller's
   * own collaborator rows are ensured for every supplied venture they map to a
   * known app. The customer is taken server-side from the forwarded sso-jwt (this
   * client is constructed with the caller's jwt); we only pass the venture ids the
   * BFF resolved from FGA. Grant-only, never downgrades — safe to call on every
   * apps-list load.
   *
   * POST /api/airo/v1/customers/me/reconcile-shared
   */
  async reconcileSharedFromVentures(ventureIds: string[]): Promise<ReconcileSharedResult> {
    return this.request<ReconcileSharedResult>(
      'POST',
      `/api/airo/v1/customers/me/reconcile-shared`,
      { ventureIds },
      { logEvent: 'mgmt-airo.reconcile-shared' }
    );
  }

  /**
   * Revoke a collaborator's access to an app. No-op upstream when the row is
   * already absent (safe to retry).
   *
   * DELETE /api/airo/v1/subscriptions/:subscriptionId/apps/:appId/collaborators/:collaboratorCustomerId
   */
  async revokeCollaborator(
    subscriptionId: string,
    appId: string,
    collaboratorCustomerId: string
  ): Promise<{ success: boolean }> {
    // POST (not DELETE): the mgmt edge gateway forwards GET/POST to airo-go but
    // rejects DELETE for the collaborators route at the gateway (bodyless 401,
    // x-error-info:1) before it reaches the app — so a DELETE revoke silently
    // never deletes the row and the invitee keeps access. airo-go exposes a POST
    // `/collaborators/:cid/revoke` alias (same handler) that the gateway forwards.
    return this.request<{ success: boolean }>(
      'POST',
      `/api/airo/v1/subscriptions/${subscriptionId}/apps/${appId}/collaborators/${encodeURIComponent(collaboratorCustomerId)}/revoke`,
      undefined,
      { logEvent: 'mgmt-airo.revoke-collaborator' }
    );
  }

  /**
   * List collaborators recorded for an app.
   *
   * GET /api/airo/v1/subscriptions/:subscriptionId/apps/:appId/collaborators
   */
  async listCollaborators(
    subscriptionId: string,
    appId: string
  ): Promise<AiroListCollaboratorsResponse> {
    return this.request<AiroListCollaboratorsResponse>(
      'GET',
      `/api/airo/v1/subscriptions/${subscriptionId}/apps/${appId}/collaborators`,
      undefined,
      { logEvent: 'mgmt-airo.list-collaborators', noCache: true }
    );
  }

}
