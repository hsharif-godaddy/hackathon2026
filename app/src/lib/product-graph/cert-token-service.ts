/**
 * Certificate-based S2S Token Service for GraphQL API
 *
 * Uses client certificate authentication to obtain service tokens from SSO.
 * Implements caching and thread-safe token refresh similar to s2s-auth.ts.
 */

import https from 'node:https';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { logger } from '@/lib/request-context';

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
 * Certificate-based token service configuration
 */
interface CertTokenConfig {
    cert?: string;
    key?: string;
    certPath?: string;
    keyPath?: string;
    ssoEndpoint: string;
    realm: string;
    tokenExpiry: number;
}

/**
 * Get configuration from environment variables
 *
 * Supports both direct cert/key content in env vars and file paths.
 * Priority: GRAPHQL_CLIENT_CERT/KEY > GRAPHQL_CLIENT_CERT_PATH/KEY_PATH
 *
 * @returns Configuration object with certs/paths and settings
 */
function getConfig(): CertTokenConfig {
    return {
        cert: process.env.GRAPHQL_CLIENT_CERT,
        key: process.env.GRAPHQL_CLIENT_KEY,
        certPath: process.env.GRAPHQL_CLIENT_CERT_PATH || '/workspace/app/certs/graphql-client.crt',
        keyPath: process.env.GRAPHQL_CLIENT_KEY_PATH || '/workspace/app/certs/graphql-client.key',
        ssoEndpoint: process.env.GRAPHQL_SSO_ENDPOINT || 'https://sso.test-godaddy.com/v1/secure/api/token',
        realm: process.env.GRAPHQL_SSO_REALM || 'cert',
        tokenExpiry: parseInt(process.env.GRAPHQL_TOKEN_EXPIRY || '3000', 10),
    };
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
 * Certificate-based S2S Token Service
 */
class CertTokenService {
    private tokenCache: TokenCache;
    private config: CertTokenConfig;

    constructor() {
        this.tokenCache = {
            token: null,
            expiresAt: null,
            isRefreshing: false,
            refreshPromise: null,
        };
        this.config = getConfig();
    }

    /**
     * Get S2S token with automatic caching and refresh
     *
     * @returns Promise resolving to JWT token string
     *
     * @throws {Error} If certificates are missing or token refresh fails
     */
    async getToken(): Promise<string> {
        // Check if we have a valid cached token
        if (this.tokenCache.token && this.tokenCache.expiresAt && new Date() < this.tokenCache.expiresAt) {
            logger.debug('cert-token.cache-hit', {
                message: 'Using cached certificate-based S2S token',
                expiresAt: this.tokenCache.expiresAt,
            });
            return this.tokenCache.token;
        }

        // If a refresh is already in progress, wait for it
        if (this.tokenCache.isRefreshing && this.tokenCache.refreshPromise) {
            logger.debug('cert-token.waiting', {
                message: 'Waiting for ongoing token refresh',
            });
            return this.tokenCache.refreshPromise;
        }

        // Start token refresh
        this.tokenCache.isRefreshing = true;
        this.tokenCache.refreshPromise = this.refreshToken();

        try {
            const token = await this.tokenCache.refreshPromise;
            return token;
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
     * @throws {Error} If certificates are missing or SSO request fails
     */
    private async refreshToken(): Promise<string> {
        try {
            let cert: string;
            let key: string;

            // Check if certs are provided directly in env vars
            if (this.config.cert && this.config.key) {
                logger.debug('cert-token.using-env-vars', {
                    message: 'Using certificates from environment variables',
                });
                cert = this.config.cert;
                key = this.config.key;
            } else {
                // Fall back to reading from files
                if (!this.config.certPath || !this.config.keyPath) {
                    throw new Error('Neither certificate env vars nor file paths are configured');
                }

                if (!existsSync(this.config.certPath) || !existsSync(this.config.keyPath)) {
                    const error = `GraphQL client certificates not found at ${this.config.certPath} and ${this.config.keyPath}`;
                    logger.error('cert-token.no-certs', { message: error });
                    throw new Error(error);
                }

                logger.debug('cert-token.reading-files', {
                    message: 'Reading certificates from files',
                    certPath: this.config.certPath,
                    keyPath: this.config.keyPath,
                });

                [cert, key] = await Promise.all([
                    readFile(this.config.certPath, 'utf8'),
                    readFile(this.config.keyPath, 'utf8'),
                ]);
            }

            const url = new URL(this.config.ssoEndpoint);
            const postData = JSON.stringify({ realm: this.config.realm });

            logger.info('cert-token.refresh.start', {
                message: 'Refreshing certificate-based S2S token',
                endpoint: this.config.ssoEndpoint,
                realm: this.config.realm,
            });

            const token = await this.makeSSORequest(url, cert, key, postData);

            // Try to decode JWT to get actual expiration time
            let expiresAt: Date;
            try {
                const payload = decodeJWTPayload(token);
                expiresAt = new Date(payload.exp * 1000);
                logger.info('cert-token.refresh.success', {
                    message: 'Certificate-based S2S token refreshed successfully',
                    expiresAt,
                });
            } catch {
                // If JWT decoding fails, use configured expiry
                expiresAt = new Date(Date.now() + this.config.tokenExpiry * 1000);
                logger.info('cert-token.refresh.success', {
                    message: 'Certificate-based S2S token refreshed (using default expiry)',
                    expiresAt,
                });
            }

            // Cache the token
            this.tokenCache.token = token;
            this.tokenCache.expiresAt = expiresAt;

            return token;
        } catch (error) {
            logger.error('cert-token.refresh.failed', {
                message: 'Failed to refresh certificate-based S2S token',
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
                            // Response might not be JSON
                            const token = data.trim();
                            if (token) {
                                resolve(token);
                            } else {
                                reject(new Error('Empty response from SSO endpoint'));
                            }
                        }
                    } else {
                        logger.error('cert-token.sso.request.failed', {
                            statusCode: response.statusCode,
                            response: data,
                        });
                        reject(new Error(`SSO authentication failed with status ${response.statusCode}`));
                    }
                });
            });

            request.on('error', (error) => {
                logger.error('cert-token.sso.request.error', {
                    message: 'SSO request failed',
                    error: error.message,
                });
                reject(error);
            });

            request.on('timeout', () => {
                logger.error('cert-token.sso.timeout', { message: 'SSO request timed out' });
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
        logger.debug('cert-token.cache-cleared', {
            message: 'Certificate-based S2S token cache cleared',
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

// Export singleton instance
export const certTokenService = new CertTokenService();
