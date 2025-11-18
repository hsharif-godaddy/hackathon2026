/**
 * Certificate-based S2S Token Service for TestPilot AI API
 *
 * Uses client certificate authentication to obtain service tokens from SSO.
 * Implements caching and thread-safe token refresh similar to cert-token-service.ts.
 */

import https from 'node:https';
import { logger } from '@/lib/request-context';
import { getTestPilotConfig } from './config';

/**
 * Token cache interface
 */
interface TokenCache {
  token: string | null;
  expiresAt: Date | null;
  isRefreshing: boolean;
  refreshPromise: Promise<string> | null;
}

/**
 * SSO response interface
 */
interface SSOResponse {
  data?: string;
  access_token?: string;
  token?: string;
  expires_in?: number;
}

/**
 * Decode JWT payload to extract expiration time
 *
 * @param jwt - JWT token string
 * @returns Decoded payload with exp field
 */
function decodeJWTPayload(jwt: string): { exp: number } {
  try {
    const parts = jwt.split('.');
    if (parts.length !== 3) {
      throw new Error('Invalid JWT format: expected 3 parts separated by dots');
    }

    const payload = parts[1];
    if (!payload) {
      throw new Error('Invalid JWT: missing payload section');
    }

    return JSON.parse(Buffer.from(payload, 'base64').toString());
  } catch (error) {
    throw new Error(`Failed to decode JWT payload: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Certificate-based S2S Token Service for TestPilot
 */
class TokenService {
  private tokenCache: TokenCache;

  constructor() {
    this.tokenCache = {
      token: null,
      expiresAt: null,
      isRefreshing: false,
      refreshPromise: null,
    };
  }

  /**
   * Get S2S token with automatic caching and refresh
   *
   * @returns Promise resolving to JWT token string
   *
   * @throws {Error} If certificates are missing or token refresh fails
   */
  async getToken(): Promise<string> {
    if (this.tokenCache.token && this.tokenCache.expiresAt && new Date() < this.tokenCache.expiresAt) {
      logger.debug('testpilot-token.cache-hit', {
        message: 'Using cached TestPilot S2S token',
        expiresAt: this.tokenCache.expiresAt,
      });
      return this.tokenCache.token;
    }

    if (this.tokenCache.isRefreshing && this.tokenCache.refreshPromise) {
      logger.debug('testpilot-token.waiting', {
        message: 'Waiting for ongoing token refresh',
      });
      return this.tokenCache.refreshPromise;
    }

    this.tokenCache.isRefreshing = true;
    this.tokenCache.refreshPromise = this.refreshToken();

    try {
      return await this.tokenCache.refreshPromise;
    } finally {
      this.tokenCache.isRefreshing = false;
      this.tokenCache.refreshPromise = null;
    }
  }

  /**
   * Refresh S2S token using certificate authentication
   *
   * @returns Promise resolving to new JWT token
   *
   * @throws {Error} If SSO request fails
   */
  private async refreshToken(): Promise<string> {
    try {
      const config = getTestPilotConfig();
      const url = new URL(config.ssoEndpoint);
      const postData = JSON.stringify({ realm: config.ssoRealm });

      logger.info('testpilot-token.refresh.start', {
        message: 'Refreshing TestPilot S2S token',
        endpoint: config.ssoEndpoint,
        realm: config.ssoRealm,
      });

      const token = await this.makeSSORequest(url, config.clientCert, config.clientKey, postData);

      let expiresAt: Date;
      try {
        const payload = decodeJWTPayload(token);
        expiresAt = new Date(payload.exp * 1000);
        logger.info('testpilot-token.refresh.success', {
          message: 'TestPilot S2S token refreshed successfully',
          expiresAt,
        });
      } catch {
        expiresAt = new Date(Date.now() + 3000 * 1000);
        logger.info('testpilot-token.refresh.success', {
          message: 'TestPilot S2S token refreshed (using default expiry)',
          expiresAt,
        });
      }

      this.tokenCache.token = token;
      this.tokenCache.expiresAt = expiresAt;

      return token;
    } catch (error) {
      logger.error('testpilot-token.refresh.failed', {
        message: 'Failed to refresh TestPilot S2S token',
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Make HTTPS request to SSO with client certificate
   *
   * @param url - SSO endpoint URL
   * @param cert - Client certificate content
   * @param key - Client key content
   * @param postData - Request body
   * @returns Promise resolving to token string
   */
  private makeSSORequest(url: URL, cert: string, key: string, postData: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const options: https.RequestOptions = {
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname,
        method: 'POST',
        cert,
        key,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
        },
        timeout: 10000,
      };

      const request = https.request(options, (response) => {
        let data = '';

        response.on('data', (chunk) => {
          data += chunk;
        });

        response.on('end', () => {
          if (response.statusCode && response.statusCode >= 200 && response.statusCode < 300) {
            try {
              const responseData: SSOResponse = JSON.parse(data);
              const token = responseData.data ?? responseData.access_token ?? responseData.token ?? data.trim();

              if (!token) {
                reject(new Error('Empty token received from SSO endpoint'));
                return;
              }

              resolve(token);
            } catch {
              const token = data.trim();
              if (token) {
                resolve(token);
              } else {
                reject(new Error('Empty response from SSO endpoint'));
              }
            }
          } else {
            logger.error('testpilot-token.sso.request.failed', {
              statusCode: response.statusCode,
              response: data,
            });
            reject(new Error(`SSO authentication failed with status ${response.statusCode}`));
          }
        });
      });

      request.on('error', (error) => {
        logger.error('testpilot-token.sso.request.error', {
          message: 'SSO request failed',
          error: error.message,
        });
        reject(error);
      });

      request.on('timeout', () => {
        logger.error('testpilot-token.sso.timeout', { message: 'SSO request timed out' });
        request.destroy();
        reject(new Error('SSO request timed out'));
      });

      request.write(postData);
      request.end();
    });
  }

  /**
   * Clear cached token (for testing or forced refresh)
   */
  clearCache(): void {
    this.tokenCache = {
      token: null,
      expiresAt: null,
      isRefreshing: false,
      refreshPromise: null,
    };
    logger.debug('testpilot-token.cache-cleared', {
      message: 'TestPilot S2S token cache cleared',
    });
  }

  /**
   * Get cache info for debugging
   *
   * @returns Cache information
   */
  getCacheInfo(): {
    hasCachedToken: boolean;
    expiresAt?: Date;
    isExpired?: boolean;
    timeUntilExpiration?: number;
  } {
    if (!this.tokenCache.token || !this.tokenCache.expiresAt) {
      return { hasCachedToken: false };
    }

    const now = new Date();
    const isExpired = now >= this.tokenCache.expiresAt;
    const timeUntilExpiration = Math.max(0, this.tokenCache.expiresAt.getTime() - now.getTime());

    return {
      hasCachedToken: true,
      expiresAt: this.tokenCache.expiresAt,
      isExpired,
      timeUntilExpiration,
    };
  }
}

export const testPilotTokenService = new TokenService();

