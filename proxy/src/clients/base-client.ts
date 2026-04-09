/**
 * Base Client Class
 *
 * Provides common functionality for all API clients (Getty, KnowB, WebScraper)
 * - SSO token management
 * - HTTP request handling with retries
 * - Error handling
 * - Header sanitization
 * - Request timing
 */
import ssoClient from '../auth/sso-client.js';
import logger from '../utils/logger.js';

/**
 * Base API response structure
 */
export interface BaseAPIResponse {
  statusCode: number;
  headers: Record<string, string | string[]>;
  data: string;
  duration?: number;
}

/**
 * Binary API response structure (for image/file endpoints)
 */
export interface BinaryAPIResponse {
  statusCode: number;
  headers: Record<string, string | string[]>;
  buffer: Buffer;
  duration?: number;
}

/**
 * Configuration for base client
 */
export interface BaseClientConfig {
  serviceName: string;
  ssoHost: string;
  defaultRetries?: number;
}

/**
 * Base Client Class
 * Handles common request infrastructure for all API clients
 */
export abstract class BaseClient {
  protected serviceName: string;
  protected ssoHost: string;
  protected defaultRetries: number;

  constructor(config: BaseClientConfig) {
    this.serviceName = config.serviceName;
    this.ssoHost = config.ssoHost;
    this.defaultRetries = config.defaultRetries ?? 2;
  }

  /**
   * Get SSO token for this client's host
   */
  protected async getToken(): Promise<string> {
    return ssoClient.getToken(this.ssoHost);
  }

  // Method overloads for type safety
  protected makeRequest(url: string, requestId?: string, method?: 'GET' | 'POST' | 'PUT', body?: string, additionalHeaders?: Record<string, string>, retries?: number, responseType?: 'text'): Promise<BaseAPIResponse>;
  protected makeRequest(url: string, requestId?: string, method?: 'GET' | 'POST' | 'PUT', body?: string, additionalHeaders?: Record<string, string>, retries?: number, responseType?: 'binary'): Promise<BinaryAPIResponse>;
  protected makeRequest(url: string, requestId?: string, method?: 'GET' | 'POST' | 'PUT', body?: string, additionalHeaders?: Record<string, string>, retries?: number, responseType?: 'text' | 'binary'): Promise<BaseAPIResponse | BinaryAPIResponse>;

  /**
   * Make HTTP request with automatic retries and token refresh.
   * Pass responseType='binary' to receive raw buffer instead of text
   * (avoids UTF-8 decoding corruption of binary responses like PNG).
   */
  protected async makeRequest(
    url: string,
    requestId: string = 'unknown',
    method: 'GET' | 'POST' | 'PUT' = 'GET',
    body?: string,
    additionalHeaders?: Record<string, string>,
    retries: number = this.defaultRetries,
    responseType: 'text' | 'binary' = 'text'
  ): Promise<BaseAPIResponse | BinaryAPIResponse> {
    const startTime = Date.now();
    const jwtToken = await this.getToken();
    const urlObj = new URL(url);

    const headers: Record<string, string> = {
      'Authorization': `sso-jwt ${jwtToken}`,
      ...(responseType === 'text' && { 'Accept': 'application/json' }),
      ...additionalHeaders
    };

    if (body && (method === 'POST' || method === 'PUT')) {
      headers['Content-Type'] = 'application/json';
    }

    logger.debug(`[${this.serviceName}] Making API request`, {
      requestId,
      method,
      responseType,
      url: urlObj.pathname + urlObj.search,
      headers: this.sanitizeHeaders(headers)
    });

    try {
      const response = await fetch(url, {
        method,
        headers,
        ...(body && (method === 'POST' || method === 'PUT') && { body })
      });

      if (response.status === 401 && retries > 0) {
        logger.warn(`[${this.serviceName}] API returned 401, clearing SSO cache and retrying`, {
          requestId,
          retriesLeft: retries
        });
        ssoClient.clearCache(this.ssoHost);
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, this.defaultRetries - retries + 1) * 1000));
        return this.makeRequest(url, requestId, method, body, additionalHeaders, retries - 1, responseType);
      }

      if (responseType === 'binary') {
        const buffer = Buffer.from(await response.arrayBuffer());

        logger.debug(`[${this.serviceName}] Binary request completed`, {
          requestId,
          url: urlObj.pathname,
          statusCode: response.status,
          sizeBytes: buffer.length
        });

        return {
          statusCode: response.status,
          headers: Object.fromEntries(response.headers.entries()) as Record<string, string | string[]>,
          buffer,
          duration: Date.now() - startTime
        };
      }

      const data = await response.text();

      if (response.ok) {
        return {
          statusCode: response.status,
          headers: Object.fromEntries(response.headers.entries()) as Record<string, string | string[]>,
          data
        };
      }

      logger.error(`[${this.serviceName}] API request failed`, {
        requestId,
        statusCode: response.status,
        responseBody: data,
        url: urlObj.pathname
      });

      const error = new Error(`${this.serviceName} API request failed with status ${response.status}`) as Error & {
        statusCode?: number;
        response?: string;
      };
      error.statusCode = response.status;
      error.response = data;
      throw error;
    } catch (error) {
      logger.error(`[${this.serviceName}] API request error`, {
        requestId,
        error: error instanceof Error ? error.message : String(error)
      });

      if (retries > 0) {
        logger.info(`[${this.serviceName}] Retrying API request`, { requestId, retriesLeft: retries });
        await new Promise(resolve => setTimeout(resolve, 1000));
        return this.makeRequest(url, requestId, method, body, additionalHeaders, retries - 1, responseType);
      } else {
        throw error;
      }
    }
  }

  /**
   * Sanitize headers for logging (redact sensitive data)
   */
  protected sanitizeHeaders(headers: Record<string, string | number>): Record<string, string> {
    const sanitized: Record<string, string> = {};

    for (const [key, value] of Object.entries(headers)) {
      if (key === 'Authorization') {
        sanitized[key] = String(value).substring(0, 20) + '...';
      } else {
        sanitized[key] = String(value);
      }
    }

    return sanitized;
  }

  /**
   * Execute request with timing
   */
  protected async executeWithTiming<T extends BaseAPIResponse>(
    operation: () => Promise<T>
  ): Promise<T> {
    const startTime = Date.now();

    try {
      const response = await operation();
      response.duration = Date.now() - startTime;
      return response;
    } catch (error) {
      const duration = Date.now() - startTime;

      if (error instanceof Error) {
        (error as Error & { duration?: number }).duration = duration;
      }
      throw error;
    }
  }
}

