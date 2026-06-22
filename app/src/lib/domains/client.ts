import { logger } from '@/lib/request-context';

/**
 * Authorization scheme used by Domains API
 */
const MGMT_AIRO_AUTH_SCHEME = 'sso-jwt';

export type DomainState =
  | 'ACTIVE'
  | 'DCC_ACTIVE_EXCEPT_STATUS_ZERO'
  | 'DNS_HOSTING'
  | 'DNS_OFFSITE'
  | 'INACTIVE'
  | 'RAA_ACTION_NEEDED'
  | 'REDEMPTION'
  | 'ADULT_BLOCK'
  | 'DCC_ACTIVE_REGISTERED_DOMAINS'
  | 'DCC_REGISTERED_DOMAINS_EXCEPT_STATUS_ZERO';

export interface DomainFilter {
  domainStates?: DomainState[];
  hasInternalDNS?: boolean;
}

/**
 * Application identifier for X-App-Key header
 * This identifies the requesting application to the Domains API
 */
const APP_KEY = 'airo-app-builder';

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
export interface DomainsApiResponse {
  domains: Array<{ domain: string; nameservers?: string[]; hasInternalNameservers?: boolean }>;
  total: number;
  startIndex?: number;
  pageSize?: number;
  filter?: string;
}

export class DomainsClient {
  private baseUrl: string;
  private jwt: string;
  private maxRetries: number;
  private retryDelayMs: number;

  /**
   * Create a new Domains API client
   *
   * @param config - Client configuration
   */
  constructor(config: {
    baseUrl: string;
    jwt: string;
    maxRetries?: number;
    retryDelayMs?: number;
  }) {
    this.baseUrl = config.baseUrl;
    this.jwt = config.jwt;
    this.maxRetries = config.maxRetries ?? 3;
    this.retryDelayMs = config.retryDelayMs ?? 1000;
  }

  /**
   * Make an authenticated HTTP request with retry logic
   */
  private async request<T>(
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    path: string,
    body?: any,
    options: { retryOn404?: boolean; logEvent?: string } = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const { retryOn404 = false, logEvent = 'api.request' } = options;

    // Start timing for this specific API call
    const apiCallStart = Date.now();
    const apiCallId = `${method} ${path}`;

    logger.info('domains.api.start', {
      message: `Starting API call: ${apiCallId}`,
      url,
      method,
      ...(body ? { requestBody: body } : {})
    });

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      const attemptStart = Date.now();

      try {
        const response = await fetch(url, {
          method,
          headers: {
            'Authorization': `${MGMT_AIRO_AUTH_SCHEME} ${this.jwt}`,
            'X-App-Key': APP_KEY,
            ...(body ? { 'Content-Type': 'application/json' } : {})
          },
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
          let errorBody: any = errorText;
          try {
            errorBody = JSON.parse(errorText);
          } catch {
            // Keep as string if not JSON
          }

          // Log errors with properly formatted error body
          logger.error(`${logEvent}.error`, {
            url,
            method,
            status: response.status,
            statusText: response.statusText,
            errorBody,
            errorBodyString: typeof errorBody === 'object' ? JSON.stringify(errorBody) : errorBody
          });

          const errorMessage = typeof errorBody === 'object' ? JSON.stringify(errorBody) : errorBody;
          throw new Error(`API request failed: ${response.status} ${response.statusText} - ${errorMessage}`);
        }

        // Success - parse and return
        const result = await response.json() as T;

        const attemptDuration = Date.now() - attemptStart;
        const totalDuration = Date.now() - apiCallStart;

        // Log successful API call with timing
        logger.info('mgmt-airo.api.success', {
          message: `${apiCallId} completed successfully`,
          url,
          status: response.status,
          attempt,
          attemptDuration,
          totalDuration,
          ...(method === 'PATCH' ? { responseBody: result } : {})
        });

        return result;
      } catch (error) {
        const attemptDuration = Date.now() - attemptStart;
        const totalDuration = Date.now() - apiCallStart;

        logger.error('mgmt-airo.api.attempt-error', {
          message: `${apiCallId} attempt ${attempt} failed`,
          url,
          attempt,
          attemptDuration,
          totalDuration,
          error: error instanceof Error ? error.message : String(error),
          errorName: error instanceof Error ? error.name : 'Unknown',
          errorStack: error instanceof Error ? error.stack : undefined,
          errorCause: error instanceof Error ? (error as any).cause : undefined
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
   * Get all domains for a customer
   *
   * API: POST /v2/customers/{customerId}/domains/get
   * Docs: https://domains.dcc.api.test-godaddy.com/docs#/default/post_v2_customers__customerId__domains_get
   *
   * Filtering with domainStates: ['ACTIVE'] and hasInternalDNS: true validated
   * against test, dev, and prod environments.
   *
   * @param customerId - Customer identifier (must match JWT's 'cid' field)
   * @param options - Optional pagination and filtering options
   * @returns Domains response with pagination info
   */
  async getAllDomainsForCustomer(
    customerId: string,
    options?: {
      pageSize?: number;
      sortColumn?: string;
      sortDirection?: 'ascending' | 'descending';
      filter?: DomainFilter;
    }
  ): Promise<DomainsApiResponse> {
    const requestBody = {
      pagination: {
        pageSize: options?.pageSize || 50,
        sortColumn: options?.sortColumn || 'domainName',
        sortDirection: options?.sortDirection || 'ascending',
        pagingDirection: 'forward',
        ...(options?.filter !== undefined ? { filter: options.filter } : {}),
      }
    };

    const response = await this.request<DomainsApiResponse>(
      'POST',
      `/v2/customers/${customerId}/domains/get`,
      requestBody,
      { logEvent: 'domains.get-all-domains-for-customer' }
    );

    return response;
  }
}

