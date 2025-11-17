import { OAuthTokenRepository } from '../database/repositories/OAuthTokenRepository.js';
import { encryptToken, decryptToken } from './token-crypto.js';
import { Logger } from '../logging/index.js';

const logger = Logger.create({ service: 'token-store' });

/**
 * Decrypted token record with plain text access and refresh tokens
 */
export interface TokenRecord {
    accessToken: string;
    refreshToken?: string;
    expiresAt: number;
}

/**
 * Key for identifying a token in storage
 * 
 * Tokens are unique per (appId, provider) combination.
 * Each app has ONE token per provider, regardless of scopes.
 * 
 * **Design Note:** Scopes are NOT part of the key. When saving a token
 * with different scopes than currently stored, the system uses a "monotonic
 * union" approach - stored scopes expand via re-authentication if requested
 * scopes exceed stored ones. To reduce scopes, explicitly delete the token
 * and re-authenticate.
 */
export interface TokenKey {
    appId: string;
    provider: string;
}

/**
 * Token storage service that wraps OAuthTokenRepository
 *
 * Handles encryption/decryption of OAuth tokens and provides
 * high-level operations for token lifecycle management.
 * 
 * **Single Token Per Provider Design:**
 * - Each (appId, provider) pair stores exactly ONE token
 * - Scopes are stored with the token but NOT part of the unique key
 * - When requesting different scopes, existing token is replaced
 * - Scope validation happens at usage time (see AuthService)
 * - To reduce scopes: delete token and re-authenticate
 */
export class TokenStore {
    /**
     * Find a valid token (not expired, with 60s buffer)
     *
     * Retrieves a token from storage, decrypts it, and validates expiration.
     * Returns null if token is missing, expired, or decryption fails.
     *
     * @param key - Token identifier (appId, provider)
     * @returns Decrypted token if valid, null otherwise
     *
     * @example
     * ```typescript
     * const token = TokenStore.findValid({
     *   appId: 'session-123',
     *   provider: 'godaddy'
     * });
     *
     * if (token && token.expiresAt > Date.now()) {
     *   // Use token.accessToken
     * }
     * ```
     */
    static findValid(key: TokenKey): TokenRecord | null {
        const repo = new OAuthTokenRepository();
        const record = repo.findOne(key.appId, key.provider);

        if (!record) return null;

        if (record.expiresAt - Date.now() <= 60_000) {
            logger.info('token-store.find-valid.expired', {
                appId: key.appId,
                provider: key.provider,
            });
            return null;
        }

        try {
            const accessToken = decryptToken({
                data: record.accessTokenEncrypted,
                iv: record.accessTokenIv,
                tag: record.accessTokenTag,
            });

            let refreshToken: string | undefined;
            if (
                record.refreshTokenEncrypted &&
                record.refreshTokenIv &&
                record.refreshTokenTag
            ) {
                refreshToken = decryptToken({
                    data: record.refreshTokenEncrypted,
                    iv: record.refreshTokenIv,
                    tag: record.refreshTokenTag,
                });
            }

            return {
                accessToken,
                ...(refreshToken && { refreshToken }),
                expiresAt: record.expiresAt,
            };
        } catch (err) {
            logger.error('token-store.find-valid.decrypt-failed', {
                error: err instanceof Error ? err.message : String(err),
            });
            return null;
        }
    }

    /**
     * Save or update a token
     *
     * Encrypts the access token (and optional refresh token) and stores
     * them in the database. Uses UPSERT pattern to handle duplicates.
     * Replaces any existing token for the same (appId, provider).
     *
     * @param key - Token identifier (appId, provider)
     * @param token - Token data to save (access token, optional refresh token, expiry, scopes)
     *
     * @example
     * ```typescript
     * TokenStore.save(
     *   {
     *     appId: 'session-123',
     *     provider: 'godaddy'
     *   },
     *   {
     *     accessToken: 'EXAMPLE_ACCESS_TOKEN',
     *     refreshToken: 'EXAMPLE_REFRESH_TOKEN',
     *     expiresAt: Date.now() + 3600000,
     *     scopes: 'commerce.product:read commerce.product:write'
     *   }
     * );
     * ```
     */
    static save(
        key: TokenKey,
        token: { accessToken: string; refreshToken?: string; expiresAt: number; scopes: string },
    ): void {
        const accessTokenEnc = encryptToken(token.accessToken);

        let refreshTokenEnc: ReturnType<typeof encryptToken> | undefined;
        if (token.refreshToken) {
            refreshTokenEnc = encryptToken(token.refreshToken);
        }

        const repo = new OAuthTokenRepository();
        repo.upsert({
            appId: key.appId,
            provider: key.provider,
            scopes: token.scopes,
            accessTokenEncrypted: accessTokenEnc.data,
            accessTokenIv: accessTokenEnc.iv,
            accessTokenTag: accessTokenEnc.tag,
            ...(refreshTokenEnc && {
                refreshTokenEncrypted: refreshTokenEnc.data,
                refreshTokenIv: refreshTokenEnc.iv,
                refreshTokenTag: refreshTokenEnc.tag,
            }),
            expiresAt: token.expiresAt,
        });

        logger.info('token-store.save.success', {
            appId: key.appId,
            provider: key.provider,
        });
    }

    /**
     * Try to refresh an expired token
     *
     * Attempts to use a refresh token to obtain a new access token.
     * Makes a token endpoint request with grant_type=refresh_token.
     * Returns null if refresh token is missing or refresh fails.
     *
     * @param key - Token identifier (appId, provider)
     * @param tokenUrl - OAuth token endpoint URL
     * @param clientId - OAuth client ID
     * @returns New token if refresh succeeds, null otherwise
     *
     * @example
     * ```typescript
     * const refreshed = await TokenStore.tryRefresh(
     *   {
     *     appId: 'session-123',
     *     provider: 'godaddy'
     *   },
     *   'https://api.dev-godaddy.com/v2/oauth2/token',
     *   'f4153f9c-4cef-4c08-b59a-5643c22c78c8'
     * );
     *
     * if (refreshed) {
     *   // Use refreshed.accessToken
     * }
     * ```
     */
    static async tryRefresh(
        key: TokenKey,
        tokenUrl: string,
        clientId: string,
    ): Promise<TokenRecord | null> {
        const repo = new OAuthTokenRepository();
        const record = repo.findOne(key.appId, key.provider);

        if (!record || !record.refreshTokenEncrypted) {
            return null;
        }

        try {
            const refreshToken = decryptToken({
                data: record.refreshTokenEncrypted,
                iv: record.refreshTokenIv!,
                tag: record.refreshTokenTag!,
            });

            const body = new URLSearchParams({
                grant_type: 'refresh_token',
                client_id: clientId,
                refresh_token: refreshToken,
            });

            const response = await fetch(tokenUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    Accept: 'application/json',
                },
                body: body.toString(),
            });

            if (!response.ok) {
                // On 400/401 invalid_grant, delete the token to force clean re-auth
                if (response.status === 400 || response.status === 401) {
                    logger.warn('token-store.refresh.invalid-grant', {
                        status: response.status,
                        appId: key.appId,
                    });
                    this.delete(key);
                } else {
                    logger.warn('token-store.refresh.failed', {
                        status: response.status,
                        appId: key.appId,
                    });
                }
                return null;
            }

            const tokenData = (await response.json()) as {
                access_token: string;
                refresh_token?: string;
                expires_in: number;
                scope?: string;
            };

            // Update scopes if provider returns them in refresh response
            // Otherwise preserve existing scopes
            const scopes = tokenData.scope || record.scopes;

            const newToken = {
                accessToken: tokenData.access_token,
                refreshToken: tokenData.refresh_token || refreshToken,
                expiresAt: Date.now() + tokenData.expires_in * 1000,
                scopes,
            };

            this.save(key, newToken);

            logger.info('token-store.refresh.success', { appId: key.appId, scopes });

            return newToken;
        } catch (err) {
            logger.error('token-store.refresh.error', {
                error: err instanceof Error ? err.message : String(err),
            });
            return null;
        }
    }

    /**
     * Delete a token
     *
     * Removes a token from storage. Used when revoking access
     * or cleaning up expired tokens.
     *
     * @param key - Token identifier (appId, provider)
     *
     * @example
     * ```typescript
     * TokenStore.delete({
     *   appId: 'session-123',
     *   provider: 'godaddy'
     * });
     * ```
     */
    static delete(key: TokenKey): void {
        const repo = new OAuthTokenRepository();
        repo.delete(key.appId, key.provider);

        logger.info('token-store.delete.success', { appId: key.appId });
    }
}
