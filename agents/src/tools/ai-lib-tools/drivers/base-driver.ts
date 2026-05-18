/**
 * Base Driver Class
 *
 * Provides common authentication, URL handling, and HTTP request functionality
 * for all API drivers (Getty, KnowB, WebScraper, etc.)
 */
import { Logger } from '../../../logging/index.js';

/**
 * Configuration options for base driver
 */
export interface BaseDriverConfig {
  serviceName: string;
  defaultBaseUrl?: string;
  appKeyEnvVar?: string;
  defaultAppKey?: string;
}

/**
 * Base Driver Class
 * Handles common authentication and request infrastructure
 */
export abstract class BaseDriver {
  protected logger: Logger;
  protected apiBaseUrl: string;
  protected appKey: string;
  protected ssoJwt: string;
  protected proxyToken: string;
  protected useProxy: boolean;

  constructor(config: BaseDriverConfig) {
    this.logger = Logger.create({ component: config.serviceName });

    // Get base URL from GETTY_API_URL (shared proxy) or use default
    const baseUrl = process.env.GETTY_API_URL || config.defaultBaseUrl || '';

    // Parse and clean the base URL
    this.apiBaseUrl = this.parseBaseUrl(baseUrl);

    // Set app key from environment or default
    const appKeyEnv = config.appKeyEnvVar || 'GETTY_APP_KEY';
    this.appKey = process.env[appKeyEnv] || config.defaultAppKey || 'airo-app-builder';

    // Setup authentication tokens
    this.proxyToken = process.env.GETTY_TOKEN || '';
    this.ssoJwt = this.setupSsoJwt();

    // Determine if using proxy mode
    this.useProxy = !!(this.apiBaseUrl && this.proxyToken);

    this.logInitialization(config.serviceName, baseUrl);

    if (!this.ssoJwt && !this.proxyToken) {
      this.logger.warn(`${config.serviceName}.auth.missing`, {
        message: 'Neither GETTY_TOKEN nor SSO_JWT is set',
      });
    }
  }

  /**
   * Parse and clean base URL by stripping path components
   */
  private parseBaseUrl(baseUrl: string): string {
    if (!baseUrl) return '';

    try {
      const urlObj = new URL(baseUrl);
      return `${urlObj.protocol}//${urlObj.host}`;
    } catch {
      // If URL parsing fails, strip common path patterns
      return baseUrl.replace(/\/(img\/search|v1\/search|v1\/videos|v1\/knowb|v1\/).*$/, '');
    }
  }

  /**
   * Setup SSO JWT with proper prefix
   */
  private setupSsoJwt(): string {
    if (process.env.GETTY_TOKEN) {
      return 'Bearer ' + process.env.GETTY_TOKEN;
    } else if (process.env.SSO_JWT) {
      return 'sso-jwt ' + process.env.SSO_JWT;
    }
    return '';
  }

  /**
   * Log initialization details
   */
  private logInitialization(serviceName: string, configuredUrl: string): void {
    this.logger.info(`${serviceName}.config.initialized`, {
      configuredUrl,
      cleanedBaseUrl: this.apiBaseUrl,
      hasToken: !!this.ssoJwt,
      hasProxyToken: !!this.proxyToken,
      useProxy: this.useProxy,
      usingProxyUrl: configuredUrl.includes('onkatana.net') || configuredUrl.includes('test-godaddy.com'),
    });
  }

  /**
   * Get common request headers
   */
  protected getHeaders(additionalHeaders: Record<string, string> = {}): Record<string, string> {
    return {
      'Authorization': this.ssoJwt,
      'x-app-key': this.appKey,
      'Accept': 'application/json',
      ...additionalHeaders,
    };
  }

  /**
   * Wrap `fetch` so that network-level failures (DNS, TCP, TLS) are logged
   * with structured context before the error propagates. Without this,
   * undici surfaces only `TypeError: fetch failed` and the underlying
   * cause is buried in `error.cause`, which the outer tool layer drops.
   *
   * Logs `request.network_failed` with the URL, method, and the underlying
   * errno/code (e.g. `ENOTFOUND`, `ECONNREFUSED`, `UND_ERR_CONNECT_TIMEOUT`).
   * Re-throws unchanged so existing error handling stays intact.
   */
  private async fetchWithNetworkLogging(
    url: string,
    init: RequestInit,
  ): Promise<Response> {
    try {
      return await fetch(url, init);
    } catch (error) {
      const cause =
        error instanceof Error && (error as Error & { cause?: unknown }).cause
          ? ((error as Error & { cause?: unknown }).cause as
              | Error
              | { code?: string; errno?: string; message?: string })
          : undefined;
      const causeRecord =
        cause && typeof cause === 'object' ? (cause as Record<string, unknown>) : {};
      const errorName = error instanceof Error ? error.name : 'Error';
      const errorMessage = error instanceof Error ? error.message : String(error);
      const causeName =
        cause instanceof Error ? cause.name : (causeRecord.name as string | undefined);
      const causeMessage =
        cause instanceof Error
          ? cause.message
          : (causeRecord.message as string | undefined);
      const causeCode = causeRecord.code as string | undefined;
      const causeErrno = causeRecord.errno as string | undefined;

      this.logger.error('request.network_failed', {
        method: init.method,
        url,
        baseUrl: this.apiBaseUrl,
        errorName,
        errorMessage,
        causeName,
        causeMessage,
        causeCode,
        causeErrno,
      });
      throw error;
    }
  }

  /**
   * Make authenticated GET request
   */
  protected async get(
    endpoint: string,
    queryParams?: URLSearchParams,
    additionalHeaders?: Record<string, string>
  ): Promise<Response> {
    const url = queryParams
      ? `${this.apiBaseUrl}${endpoint}?${queryParams.toString()}`
      : `${this.apiBaseUrl}${endpoint}`;

    return this.fetchWithNetworkLogging(url, {
      method: 'GET',
      headers: this.getHeaders(additionalHeaders),
    });
  }

  /**
   * Make authenticated POST request
   */
  protected async post(
    endpoint: string,
    body: unknown,
    additionalHeaders?: Record<string, string>
  ): Promise<Response> {
    const url = `${this.apiBaseUrl}${endpoint}`;

    return this.fetchWithNetworkLogging(url, {
      method: 'POST',
      headers: this.getHeaders({
        'Content-Type': 'application/json',
        ...additionalHeaders,
      }),
      body: JSON.stringify(body),
    });
  }

  /**
   * Make authenticated PUT request
   */
  protected async put(
    endpoint: string,
    body: unknown,
    additionalHeaders?: Record<string, string>
  ): Promise<Response> {
    const url = `${this.apiBaseUrl}${endpoint}`;

    return this.fetchWithNetworkLogging(url, {
      method: 'PUT',
      headers: this.getHeaders({
        'Content-Type': 'application/json',
        ...additionalHeaders,
      }),
      body: JSON.stringify(body),
    });
  }

  /**
   * Check if authentication is configured
   */
  protected hasAuth(): boolean {
    return !!(this.ssoJwt || this.proxyToken);
  }

  /**
   * Get authentication error message
   */
  protected getAuthErrorMessage(): string {
    return 'Authentication not configured. Set GETTY_TOKEN for proxy or SSO_JWT for direct access.';
  }
}
