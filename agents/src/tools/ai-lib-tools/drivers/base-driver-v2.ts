import { getS2STokenV2, isS2SAuthV2Enabled, refreshS2STokenV2, type S2SAuthV2Config } from '@airo/ai-lib';

import { log, Logger } from '../../../logging/index.js';
import { decodeJwtExp } from '../../../utils/jwt-expiry.js';
import { getDefaultS2SConfigV2 } from '../../../utils/s2s-config.js';

export interface BaseDriverV2Config {
  serviceName: string;
  baseUrl: string;
  appKeyEnvVar?: string;
  defaultAppKey?: string;
}

const TOKEN_REFRESH_BUFFER_SECONDS = 300;

export abstract class BaseDriverV2 {
  protected logger: Logger;
  protected readonly apiBaseUrl: string;
  private readonly serviceName: string;
  private readonly appKey: string;

  private readonly useS2S: boolean;
  private readonly s2sConfig: S2SAuthV2Config;
  private readonly localSsoJwt: string;
  private cachedS2SToken: string | null = null;
  private cachedTokenExpSeconds: number | null = null;
  private initFailure: Error | null = null;
  private initPromise: Promise<void> | null = null;
  private initPromiseIsForce = false;

  constructor(config: BaseDriverV2Config) {
    this.serviceName = config.serviceName;
    this.logger = Logger.create({ component: config.serviceName });
    this.apiBaseUrl = config.baseUrl;
    const envAppKey = config.appKeyEnvVar ? process.env[config.appKeyEnvVar] : undefined;
    this.appKey = envAppKey || config.defaultAppKey || 'airo-app-builder';

    this.useS2S = isS2SAuthV2Enabled();
    this.s2sConfig = getDefaultS2SConfigV2();
    this.localSsoJwt = process.env.SSO_JWT || '';

    this.logger.info(`base-driver-v2.${config.serviceName}.config.initialized`, {
      baseUrl: this.apiBaseUrl,
      hasAuth: this.hasAuth(),
      useS2S: this.useS2S,
      ...(this.useS2S && {
        awsProfile: this.s2sConfig.awsProfile,
        ssoHost: this.s2sConfig.ssoHost,
      }),
    });

    if (!this.hasAuth()) {
      this.logger.warn(`base-driver-v2.${config.serviceName}.auth.missing`, {
        message: 'Neither USE_S2S_AUTH nor SSO_JWT is set',
      });
    }
  }

  protected getAuthToken(): string {
    if (this.useS2S) {
      if (!this.cachedS2SToken) {
        throw new Error('S2S token not initialized. Call ensureInitialized() first.');
      }
      return `sso-jwt ${this.cachedS2SToken}`;
    }
    if (this.localSsoJwt) {
      return `sso-jwt ${this.localSsoJwt}`;
    }
    throw new Error(
      'No authentication configured. Set USE_S2S_AUTH=true for hosted or SSO_JWT for local.'
    );
  }

  private needsTokenRefresh(): boolean {
    if (!this.useS2S) return false;
    if (!this.cachedS2SToken) return true;
    // null exp means the JWT was undecodable — fall back to cache-until-invalidated.
    // The reactive 401 retry path (invalidateToken → forceRefresh) self-heals.
    // Mirrors knowb-driver.ts KnowBTokenProvider.needsRefresh() design.
    if (this.cachedTokenExpSeconds === null) return false;
    return Math.floor(Date.now() / 1000) >= this.cachedTokenExpSeconds - TOKEN_REFRESH_BUFFER_SECONDS;
  }

  protected async ensureInitialized(forceRefresh = false): Promise<void> {
    if (this.initFailure && !this.cachedS2SToken) {
      throw this.initFailure;
    }
    if (!forceRefresh && !this.needsTokenRefresh()) {
      this.initFailure = null;
      return;
    }
    // Only coalesce if the in-flight request satisfies our needs:
    // a forceRefresh caller must not piggyback on a non-force promise
    // (it would reuse the same upstream-cached token that just 401'd).
    if (this.initPromise && (this.initPromiseIsForce || !forceRefresh)) {
      return this.initPromise;
    }
    this.initPromiseIsForce = forceRefresh;
    this.initPromise = this.fetchAndCacheToken(forceRefresh);
    try {
      await this.initPromise;
    } finally {
      this.initPromise = null;
      this.initPromiseIsForce = false;
    }
  }

  private async fetchAndCacheToken(forceRefresh: boolean): Promise<void> {
    try {
      this.logger.info(`base-driver-v2.${this.serviceName}.token.${forceRefresh ? 'refresh' : 'init'}`, {
        awsProfile: this.s2sConfig.awsProfile,
        ssoHost: this.s2sConfig.ssoHost,
      });
      const token = forceRefresh
        ? await refreshS2STokenV2(this.s2sConfig)
        : await getS2STokenV2(this.s2sConfig);
      this.cachedS2SToken = token;
      this.cachedTokenExpSeconds = decodeJwtExp(token, (err) => {
        this.logger.warn(`base-driver-v2.${this.serviceName}.token.exp_decode_failed`, {
          message: err instanceof Error ? err.message : String(err),
        });
      });
      this.initFailure = null;
    } catch (error) {
      this.initFailure = error as Error;
      log.error(this.logger, `base-driver-v2.${this.serviceName}.init.s2s_token_failed`, error as Error);
      throw error;
    }
  }

  private invalidateToken(): void {
    this.cachedS2SToken = null;
    this.cachedTokenExpSeconds = null;
    this.initFailure = null;
  }

  protected getHeaders(additionalHeaders: Record<string, string> = {}): Record<string, string> {
    return {
      'Authorization': this.getAuthToken(),
      'x-app-key': this.appKey,
      'Accept': 'application/json',
      ...additionalHeaders,
    };
  }

  /**
   * Executes a request with automatic token initialization and one-shot 401 retry.
   * On 401: invalidates cached token, force-refreshes from IAM, retries once.
   */
  private async executeWithRetry(
    method: string,
    endpoint: string,
    makeRequest: () => Promise<Response>,
  ): Promise<Response> {
    const startTime = Date.now();
    this.logger.info(`base-driver-v2.${this.serviceName}.request.begin`, { method, endpoint });

    await this.ensureInitialized();
    let response = await makeRequest();

    if (response.status === 401 && this.useS2S) {
      this.logger.warn(`base-driver-v2.${this.serviceName}.request.reauth_retry`, { method, endpoint });
      this.invalidateToken();
      await this.ensureInitialized(true);
      response = await makeRequest();
    }

    this.logger.info(`base-driver-v2.${this.serviceName}.request.complete`, {
      method,
      endpoint,
      status: response.status,
      durationMs: Date.now() - startTime,
    });

    return response;
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
  protected async fetchWithNetworkLogging(
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

      this.logger.error(`base-driver-v2.${this.serviceName}.request.network_failed`, {
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

  protected async get(
    endpoint: string,
    queryParams?: URLSearchParams,
    additionalHeaders?: Record<string, string>
  ): Promise<Response> {
    return this.executeWithRetry('GET', endpoint, () => {
      const url = queryParams
        ? `${this.apiBaseUrl}${endpoint}?${queryParams.toString()}`
        : `${this.apiBaseUrl}${endpoint}`;
      return this.fetchWithNetworkLogging(url, {
        method: 'GET',
        headers: this.getHeaders(additionalHeaders),
      });
    });
  }

  protected async post(
    endpoint: string,
    body: unknown,
    additionalHeaders?: Record<string, string>
  ): Promise<Response> {
    return this.executeWithRetry('POST', endpoint, () =>
      this.fetchWithNetworkLogging(`${this.apiBaseUrl}${endpoint}`, {
        method: 'POST',
        headers: this.getHeaders({
          'Content-Type': 'application/json',
          ...additionalHeaders,
        }),
        body: JSON.stringify(body),
      })
    );
  }

  protected async put(
    endpoint: string,
    body: unknown,
    additionalHeaders?: Record<string, string>
  ): Promise<Response> {
    return this.executeWithRetry('PUT', endpoint, () =>
      this.fetchWithNetworkLogging(`${this.apiBaseUrl}${endpoint}`, {
        method: 'PUT',
        headers: this.getHeaders({
          'Content-Type': 'application/json',
          ...additionalHeaders,
        }),
        body: JSON.stringify(body),
      })
    );
  }

  protected hasAuth(): boolean {
    return this.useS2S || !!this.localSsoJwt;
  }

  /**
   * For subclasses using external clients that throw on 401 (e.g. SDK wrappers).
   * Wraps an async operation with token init + one-shot 401 retry.
   */
  protected async withRetryOn401<T>(
    operation: string,
    logContext: Record<string, unknown>,
    run: () => Promise<T>,
  ): Promise<T> {
    await this.ensureInitialized();
    try {
      return await run();
    } catch (error) {
      if (!this.isUnauthorizedError(error)) throw error;
      this.logger.warn(`base-driver-v2.${this.serviceName}.${operation}.reauth_retry`, logContext);
      this.invalidateToken();
      await this.ensureInitialized(true);
      try {
        return await run();
      } catch (retryError) {
        if (this.isUnauthorizedError(retryError)) {
          this.invalidateToken();
          this.logger.warn(`base-driver-v2.${this.serviceName}.${operation}.reauth_retry.exhausted`, logContext);
        }
        throw retryError;
      }
    }
  }

  private isUnauthorizedError(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const e = error as { response?: { status?: number }; message?: string };
    if (e.response?.status === 401) return true;
    return typeof e.message === 'string' && /status code 401\b/.test(e.message);
  }
}
