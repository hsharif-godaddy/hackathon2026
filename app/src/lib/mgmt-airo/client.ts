import { context as otelContext, propagation } from '@opentelemetry/api';

import { logger } from '@/lib/request-context';
import { extractCustomerId as extractCustomerIdFromJWT } from '@/lib/utils/jwt-utils';
import {
  type AiroApiError,
  type AiroApp,
  type AiroAppDetails,
  type AiroAttribute,
  type AiroBulkAppsResponse,
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
  type AiroDomainCheckResponse,
  type AiroGetCreditGrantsResponse,
  AiroHttpError,
  type AiroJobStatus,
  type AiroMgmtClientConfig,
  type AiroModifyDomainsPayload,
  type AiroModifyDomainsResponse,
  type AiroPublishAppResponse,
  type AiroRawSecretsResponse,
  type AiroSignupPayload,
  type AiroSignupResponse,
  type AiroSubscription,
  type AiroSystem,
  type AiroTokenBudgetResponse,
  type AiroUpdateAppPayload,
  type AiroUpdateAttributePayload,
  type AiroUpdateProjectDomainPayload,
  type AiroUpdateProjectDomainResponse,
  type AiroUpdateSecretsPayload,
  type AiroUpdateSecretsResponse,
  type CustomerTree,
  DEFAULT_OWNER_PRODUCT,
  DomainMode} from './types';

/**
 * Authorization scheme used by mgmt-airo API
 * mgmt-airo expects 'sso-jwt' instead of standard 'Bearer' scheme
 */
const MGMT_AIRO_AUTH_SCHEME = 'sso-jwt';

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

  /**
   * Make an authenticated HTTP request with retry logic
   */
  private async request<T>(
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    path: string,
    body?: any,
    options: { retryOn404?: boolean; logEvent?: string; noCache?: boolean } = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const { retryOn404 = false, logEvent = 'api.request', noCache = false } = options;

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
          let errorBody: AiroApiError | string = errorText;
          try {
            errorBody = JSON.parse(errorText);
          } catch {
            // Keep as string if not JSON
          }

          // Log errors
          logger.error(`${logEvent}.error`, {
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
  async getSubscriptions(ownerProduct: string = DEFAULT_OWNER_PRODUCT): Promise<AiroSubscription[]> {
    const params = new URLSearchParams({ ownerProduct });
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
    options: { noCache?: boolean } = {}
  ): Promise<AiroSubscription> {
    return this.request<AiroSubscription>(
      'GET',
      `/api/airo/v1/subscriptions/${subscriptionId}`,
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
   * Create a new subscription with app (signup/provision workflow)
   */
  async signup(payload: AiroSignupPayload): Promise<AiroSignupResponse> {
    return this.request<AiroSignupResponse>(
      'POST',
      '/api/airo/v1/signup',
      payload,
      { logEvent: 'mgmt-airo.signup' }
    );
  }

  /**
   * Add app to existing subscription + system (airo-add-app workflow)
   */
  async createApp(
    subscriptionId: string,
    systemId: string,
    payload: AiroCreateAppPayload
  ): Promise<AiroCreateAppResponse> {
    return this.request<AiroCreateAppResponse>(
      'POST',
      `/api/airo/v1/subscriptions/${subscriptionId}/systems/${systemId}/apps`,
      payload,
      { logEvent: 'mgmt-airo.create-app' }
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
    gitHash: string
  ): Promise<AiroPublishAppResponse> {
    return this.request<AiroPublishAppResponse>(
      'PUT',
      `/api/airo/v1/subscriptions/${subscriptionId}/systems/${systemId}/apps/${appId}/publish`,
      { gitHash },
      { logEvent: 'mgmt-airo.publish-app' }
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
   * @returns Promise resolving to deployments response
   */
  async getDeployments(
    subscriptionId: string,
    systemId: string,
    appId: string,
    limit = 20,
    includeJobData = true
  ): Promise<AiroDeploymentsResponse> {
    const params = new URLSearchParams({
      limit: limit.toString(),
      includeJobData: includeJobData.toString()
    });

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
   * The response includes secret metadata (name, systemManaged, variants, timestamps)
   * but does NOT include the actual secret values for security.
   *
   * @param subscriptionId - Subscription ID
   * @param systemId - System ID
   * @param appId - Application ID
   * @param variant - Variant to filter by (preview or publish)
   * @returns Promise resolving to secrets response with metadata
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
      // Log but don't throw - export tracking is non-critical
      logger.warn('mgmt-airo.record-export.failed', {
        subscriptionId,
        systemId,
        appId,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
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
}
