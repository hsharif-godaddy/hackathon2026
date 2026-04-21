/**
 * TokenStore Service Test Suite
 *
 * Comprehensive tests for OAuth token storage service covering:
 * - Token encryption and storage via OAuthTokenRepository
 * - Token retrieval with expiration validation (60s buffer)
 * - Refresh token flow with OAuth token endpoint
 * - Token deletion
 * - Error handling for decryption failures
 * - Integration with token-crypto and OAuthTokenRepository
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TokenStore, type TokenKey, type TokenRecord } from '../token-store.js';
import { OAuthTokenRepository } from '../../database/repositories/OAuthTokenRepository.js';
import { encryptToken, decryptToken } from '../token-crypto.js';

// Hoist mock functions to ensure they're available during mock setup
const { mockFindOne, mockUpsert, mockDelete } = vi.hoisted(() => ({
    mockFindOne: vi.fn(),
    mockUpsert: vi.fn(),
    mockDelete: vi.fn(),
}));

// Mock the encryption functions
vi.mock('../token-crypto.js', () => ({
    encryptToken: vi.fn(),
    decryptToken: vi.fn(),
}));

// Mock the repository with hoisted mocks
vi.mock('../../database/repositories/OAuthTokenRepository.js', () => {
    // Create the mock implementation function
    function MockOAuthTokenRepository(this: any) {
        this.findOne = mockFindOne;
        this.upsert = mockUpsert;
        this.delete = mockDelete;
    }

    return {
        OAuthTokenRepository: MockOAuthTokenRepository,
    };
});

// Mock the logger
vi.mock('../../logging/index.js', () => ({
    Logger: {
        create: vi.fn(() => ({
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
        })),
    },
}));

describe('TokenStore Service', () => {
    const testKey: TokenKey = {
        appId: 'app-123',
        provider: 'godaddy',
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('findValid', () => {
        it('should return null if token not found in repository', () => {
            mockFindOne.mockReturnValue(null);

            const result = TokenStore.findValid(testKey);

            expect(result).toBeNull();
            expect(mockFindOne).toHaveBeenCalledWith(
                'app-123',
                'godaddy',
            );
        });

        it('should return null if token is expired (past expiresAt)', () => {
            const expiredTime = Date.now() - 1000;
            mockFindOne.mockReturnValue({
                id: 'token-1',
                appId: 'app-123',
                provider: 'godaddy',
                scopes: 'commerce.product:read',
                accessTokenEncrypted: 'encrypted-data',
                accessTokenIv: 'iv-data',
                accessTokenTag: 'tag-data',
                expiresAt: expiredTime,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            const result = TokenStore.findValid(testKey);

            expect(result).toBeNull();
        });

        it('should return null if token expires within 60 seconds (buffer)', () => {
            const almostExpired = Date.now() + 30_000; // 30 seconds from now
            mockFindOne.mockReturnValue({
                id: 'token-1',
                appId: 'app-123',
                provider: 'godaddy',
                scopes: 'commerce.product:read',
                accessTokenEncrypted: 'encrypted-data',
                accessTokenIv: 'iv-data',
                accessTokenTag: 'tag-data',
                expiresAt: almostExpired,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            const result = TokenStore.findValid(testKey);

            expect(result).toBeNull();
        });

        it('should decrypt and return valid token with only access token', () => {
            const futureExpiry = Date.now() + 3600_000; // 1 hour from now
            mockFindOne.mockReturnValue({
                id: 'token-1',
                appId: 'app-123',
                provider: 'godaddy',
                scopes: 'commerce.product:read',
                accessTokenEncrypted: 'encrypted-access',
                accessTokenIv: 'iv-access',
                accessTokenTag: 'tag-access',
                expiresAt: futureExpiry,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            vi.mocked(decryptToken).mockReturnValue('decrypted-access-token-xyz');

            const result = TokenStore.findValid(testKey);

            expect(result).toEqual({
                accessToken: 'decrypted-access-token-xyz',
                expiresAt: futureExpiry,
            });

            expect(decryptToken).toHaveBeenCalledWith({
                data: 'encrypted-access',
                iv: 'iv-access',
                tag: 'tag-access',
            });
        });

        it('should decrypt and return valid token with access and refresh tokens', () => {
            const futureExpiry = Date.now() + 3600_000;
            mockFindOne.mockReturnValue({
                id: 'token-1',
                appId: 'app-123',
                provider: 'godaddy',
                scopes: 'commerce.product:read',
                accessTokenEncrypted: 'encrypted-access',
                accessTokenIv: 'iv-access',
                accessTokenTag: 'tag-access',
                refreshTokenEncrypted: 'encrypted-refresh',
                refreshTokenIv: 'iv-refresh',
                refreshTokenTag: 'tag-refresh',
                expiresAt: futureExpiry,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            vi.mocked(decryptToken)
                .mockReturnValueOnce('decrypted-access-token')
                .mockReturnValueOnce('decrypted-refresh-token');

            const result = TokenStore.findValid(testKey);

            expect(result).toEqual({
                accessToken: 'decrypted-access-token',
                refreshToken: 'decrypted-refresh-token',
                expiresAt: futureExpiry,
            });

            expect(decryptToken).toHaveBeenCalledTimes(2);
        });

        it('should return null if decryption fails', () => {
            const futureExpiry = Date.now() + 3600_000;
            mockFindOne.mockReturnValue({
                id: 'token-1',
                appId: 'app-123',
                provider: 'godaddy',
                scopes: 'commerce.product:read',
                accessTokenEncrypted: 'encrypted-access',
                accessTokenIv: 'iv-access',
                accessTokenTag: 'tag-access',
                expiresAt: futureExpiry,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            vi.mocked(decryptToken).mockImplementation(() => {
                throw new Error('Invalid auth tag');
            });

            const result = TokenStore.findValid(testKey);

            expect(result).toBeNull();
        });

        it('should not decrypt refresh token if refresh fields are missing', () => {
            const futureExpiry = Date.now() + 3600_000;
            mockFindOne.mockReturnValue({
                id: 'token-1',
                appId: 'app-123',
                provider: 'godaddy',
                scopes: 'commerce.product:read',
                accessTokenEncrypted: 'encrypted-access',
                accessTokenIv: 'iv-access',
                accessTokenTag: 'tag-access',
                refreshTokenEncrypted: undefined,
                refreshTokenIv: undefined,
                refreshTokenTag: undefined,
                expiresAt: futureExpiry,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            vi.mocked(decryptToken).mockReturnValue('decrypted-access-token');

            const result = TokenStore.findValid(testKey);

            expect(result).toEqual({
                accessToken: 'decrypted-access-token',
                expiresAt: futureExpiry,
            });

            expect(decryptToken).toHaveBeenCalledTimes(1);
        });

        it('should accept token that expires just beyond the 60 second buffer', () => {
            vi.useFakeTimers();
            try {
                const now = 1_700_000_000_000;
                vi.setSystemTime(now);
                const exactlyBeyondBuffer = now + 60_001;
                mockFindOne.mockReturnValue({
                    id: 'token-1',
                    appId: 'app-123',
                    provider: 'godaddy',
                    scopes: 'commerce.product:read',
                    accessTokenEncrypted: 'encrypted-access',
                    accessTokenIv: 'iv-access',
                    accessTokenTag: 'tag-access',
                    expiresAt: exactlyBeyondBuffer,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                });

                vi.mocked(decryptToken).mockReturnValue('decrypted-access-token');

                const result = TokenStore.findValid(testKey);

                expect(result).not.toBeNull();
                expect(result?.accessToken).toBe('decrypted-access-token');
            } finally {
                vi.useRealTimers();
            }
        });
    });

    describe('save', () => {
        it('should encrypt and save access token only', () => {
            const token = {
                accessToken: 'plain-access-token',
                expiresAt: Date.now() + 3600_000,
                scopes: 'commerce.product:read',
            };

            vi.mocked(encryptToken).mockReturnValue({
                data: 'encrypted-access-data',
                iv: 'iv-access',
                tag: 'tag-access',
            });

            TokenStore.save(testKey, token);

            expect(encryptToken).toHaveBeenCalledWith('plain-access-token');
            expect(mockUpsert).toHaveBeenCalledWith({
                appId: 'app-123',
                provider: 'godaddy',
                scopes: 'commerce.product:read',
                accessTokenEncrypted: 'encrypted-access-data',
                accessTokenIv: 'iv-access',
                accessTokenTag: 'tag-access',
                expiresAt: token.expiresAt,
            });
        });

        it('should encrypt and save both access and refresh tokens', () => {
            const token = {
                accessToken: 'plain-access-token',
                refreshToken: 'plain-refresh-token',
                expiresAt: Date.now() + 3600_000,
                scopes: 'commerce.product:read',
            };

            vi.mocked(encryptToken)
                .mockReturnValueOnce({
                    data: 'encrypted-access-data',
                    iv: 'iv-access',
                    tag: 'tag-access',
                })
                .mockReturnValueOnce({
                    data: 'encrypted-refresh-data',
                    iv: 'iv-refresh',
                    tag: 'tag-refresh',
                });

            TokenStore.save(testKey, token);

            expect(encryptToken).toHaveBeenCalledTimes(2);
            expect(encryptToken).toHaveBeenCalledWith('plain-access-token');
            expect(encryptToken).toHaveBeenCalledWith('plain-refresh-token');

            expect(mockUpsert).toHaveBeenCalledWith({
                appId: 'app-123',
                provider: 'godaddy',
                scopes: 'commerce.product:read',
                accessTokenEncrypted: 'encrypted-access-data',
                accessTokenIv: 'iv-access',
                accessTokenTag: 'tag-access',
                refreshTokenEncrypted: 'encrypted-refresh-data',
                refreshTokenIv: 'iv-refresh',
                refreshTokenTag: 'tag-refresh',
                expiresAt: token.expiresAt,
            });
        });

        it('should handle very long token values', () => {
            const longToken = 'x'.repeat(10000);
            const token = {
                accessToken: longToken,
                expiresAt: Date.now() + 3600_000,
                scopes: 'commerce.product:read',
            };

            vi.mocked(encryptToken).mockReturnValue({
                data: 'encrypted-long-data',
                iv: 'iv',
                tag: 'tag',
            });

            TokenStore.save(testKey, token);

            expect(encryptToken).toHaveBeenCalledWith(longToken);
        });
    });

    describe('tryRefresh', () => {
        const tokenUrl = 'https://api.dev-godaddy.com/v2/oauth2/token';
        const clientId = 'test-client-id';

        beforeEach(() => {
            global.fetch = vi.fn();
        });

        afterEach(() => {
            vi.restoreAllMocks();
        });

        it('should return null if token not found', async () => {
            mockFindOne.mockReturnValue(null);

            const result = await TokenStore.tryRefresh(testKey, tokenUrl, clientId);

            expect(result).toBeNull();
            expect(global.fetch).not.toHaveBeenCalled();
        });

        it('should return null if refresh token is missing', async () => {
            mockFindOne.mockReturnValue({
                id: 'token-1',
                appId: 'app-123',
                provider: 'godaddy',
                scopes: 'commerce.product:read',
                accessTokenEncrypted: 'encrypted-access',
                accessTokenIv: 'iv-access',
                accessTokenTag: 'tag-access',
                refreshTokenEncrypted: undefined,
                expiresAt: Date.now() + 3600_000,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            const result = await TokenStore.tryRefresh(testKey, tokenUrl, clientId);

            expect(result).toBeNull();
            expect(global.fetch).not.toHaveBeenCalled();
        });

        it('should successfully refresh token and save new tokens', async () => {
            mockFindOne.mockReturnValue({
                id: 'token-1',
                appId: 'app-123',
                provider: 'godaddy',
                scopes: 'commerce.product:read',
                accessTokenEncrypted: 'encrypted-access',
                accessTokenIv: 'iv-access',
                accessTokenTag: 'tag-access',
                refreshTokenEncrypted: 'encrypted-refresh',
                refreshTokenIv: 'iv-refresh',
                refreshTokenTag: 'tag-refresh',
                expiresAt: Date.now() - 1000,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            vi.mocked(decryptToken).mockReturnValue('decrypted-refresh-token');

            const mockResponse = {
                ok: true,
                json: vi.fn().mockResolvedValue({
                    access_token: 'new-access-token',
                    refresh_token: 'new-refresh-token',
                    expires_in: 3600,
                }),
            };
            vi.mocked(global.fetch).mockResolvedValue(mockResponse as any);

            vi.mocked(encryptToken)
                .mockReturnValueOnce({
                    data: 'enc-new-access',
                    iv: 'iv-new-access',
                    tag: 'tag-new-access',
                })
                .mockReturnValueOnce({
                    data: 'enc-new-refresh',
                    iv: 'iv-new-refresh',
                    tag: 'tag-new-refresh',
                });

            const result = await TokenStore.tryRefresh(testKey, tokenUrl, clientId);

            expect(result).not.toBeNull();
            expect(result?.accessToken).toBe('new-access-token');
            expect(result?.refreshToken).toBe('new-refresh-token');
            expect(result?.expiresAt).toBeGreaterThan(Date.now());

            expect(global.fetch).toHaveBeenCalledWith(
                tokenUrl,
                expect.objectContaining({
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                        Accept: 'application/json',
                    },
                }),
            );

            const fetchCall = vi.mocked(global.fetch).mock.calls[0];
            const body = fetchCall?.[1]?.body?.toString();
            expect(body).toContain('grant_type=refresh_token');
            expect(body).toContain('client_id=test-client-id');
            expect(body).toContain('refresh_token=decrypted-refresh-token');
        });

        it('should reuse old refresh token if new one not provided', async () => {
            mockFindOne.mockReturnValue({
                id: 'token-1',
                appId: 'app-123',
                provider: 'godaddy',
                scopes: 'commerce.product:read',
                accessTokenEncrypted: 'encrypted-access',
                accessTokenIv: 'iv-access',
                accessTokenTag: 'tag-access',
                refreshTokenEncrypted: 'encrypted-refresh',
                refreshTokenIv: 'iv-refresh',
                refreshTokenTag: 'tag-refresh',
                expiresAt: Date.now() - 1000,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            vi.mocked(decryptToken).mockReturnValue('old-refresh-token');

            const mockResponse = {
                ok: true,
                json: vi.fn().mockResolvedValue({
                    access_token: 'new-access-token',
                    // No refresh_token in response
                    expires_in: 3600,
                }),
            };
            vi.mocked(global.fetch).mockResolvedValue(mockResponse as any);

            vi.mocked(encryptToken)
                .mockReturnValueOnce({
                    data: 'enc-new-access',
                    iv: 'iv-new-access',
                    tag: 'tag-new-access',
                })
                .mockReturnValueOnce({
                    data: 'enc-old-refresh',
                    iv: 'iv-old-refresh',
                    tag: 'tag-old-refresh',
                });

            const result = await TokenStore.tryRefresh(testKey, tokenUrl, clientId);

            expect(result?.refreshToken).toBe('old-refresh-token');
        });

        it('should return null if fetch fails with non-ok status', async () => {
            mockFindOne.mockReturnValue({
                id: 'token-1',
                appId: 'app-123',
                provider: 'godaddy',
                scopes: 'commerce.product:read',
                accessTokenEncrypted: 'encrypted-access',
                accessTokenIv: 'iv-access',
                accessTokenTag: 'tag-access',
                refreshTokenEncrypted: 'encrypted-refresh',
                refreshTokenIv: 'iv-refresh',
                refreshTokenTag: 'tag-refresh',
                expiresAt: Date.now() - 1000,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            vi.mocked(decryptToken).mockReturnValue('decrypted-refresh-token');

            const mockResponse = {
                ok: false,
                status: 401,
            };
            vi.mocked(global.fetch).mockResolvedValue(mockResponse as any);

            const result = await TokenStore.tryRefresh(testKey, tokenUrl, clientId);

            expect(result).toBeNull();
        });

        it('should return null and log error if fetch throws', async () => {
            mockFindOne.mockReturnValue({
                id: 'token-1',
                appId: 'app-123',
                provider: 'godaddy',
                scopes: 'commerce.product:read',
                accessTokenEncrypted: 'encrypted-access',
                accessTokenIv: 'iv-access',
                accessTokenTag: 'tag-access',
                refreshTokenEncrypted: 'encrypted-refresh',
                refreshTokenIv: 'iv-refresh',
                refreshTokenTag: 'tag-refresh',
                expiresAt: Date.now() - 1000,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            vi.mocked(decryptToken).mockReturnValue('decrypted-refresh-token');

            vi.mocked(global.fetch).mockRejectedValue(new Error('Network error'));

            const result = await TokenStore.tryRefresh(testKey, tokenUrl, clientId);

            expect(result).toBeNull();
        });

        it('should return null if decryption of refresh token fails', async () => {
            mockFindOne.mockReturnValue({
                id: 'token-1',
                appId: 'app-123',
                provider: 'godaddy',
                scopes: 'commerce.product:read',
                accessTokenEncrypted: 'encrypted-access',
                accessTokenIv: 'iv-access',
                accessTokenTag: 'tag-access',
                refreshTokenEncrypted: 'encrypted-refresh',
                refreshTokenIv: 'iv-refresh',
                refreshTokenTag: 'tag-refresh',
                expiresAt: Date.now() - 1000,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            vi.mocked(decryptToken).mockImplementation(() => {
                throw new Error('Decryption failed');
            });

            const result = await TokenStore.tryRefresh(testKey, tokenUrl, clientId);

            expect(result).toBeNull();
            expect(global.fetch).not.toHaveBeenCalled();
        });
    });

    describe('delete', () => {
        it('should delete token from repository', () => {
            TokenStore.delete(testKey);

            expect(mockDelete).toHaveBeenCalledWith(
                'app-123',
                'godaddy',
            );
        });

        it('should handle deletion of non-existent token gracefully', () => {
            mockDelete.mockImplementation(() => {
                // No-op for non-existent token
            });

            expect(() => TokenStore.delete(testKey)).not.toThrow();
        });
    });

    describe('Integration Tests', () => {
        it('should handle full save and retrieve cycle', () => {
            const token = {
                accessToken: 'test-access-token',
                refreshToken: 'test-refresh-token',
                expiresAt: Date.now() + 3600_000,
                scopes: 'commerce.product:read',
            };

            // Mock encryption
            vi.mocked(encryptToken)
                .mockReturnValueOnce({
                    data: 'enc-access',
                    iv: 'iv-access',
                    tag: 'tag-access',
                })
                .mockReturnValueOnce({
                    data: 'enc-refresh',
                    iv: 'iv-refresh',
                    tag: 'tag-refresh',
                });

            // Save token
            TokenStore.save(testKey, token);

            // Mock retrieval
            mockFindOne.mockReturnValue({
                id: 'token-1',
                appId: testKey.appId,
                provider: testKey.provider,
                scopes: testKey.scopes,
                accessTokenEncrypted: 'enc-access',
                accessTokenIv: 'iv-access',
                accessTokenTag: 'tag-access',
                refreshTokenEncrypted: 'enc-refresh',
                refreshTokenIv: 'iv-refresh',
                refreshTokenTag: 'tag-refresh',
                expiresAt: token.expiresAt,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            vi.mocked(decryptToken)
                .mockReturnValueOnce('test-access-token')
                .mockReturnValueOnce('test-refresh-token');

            // Retrieve token
            const retrieved = TokenStore.findValid(testKey);

            expect(retrieved).toEqual({
                accessToken: token.accessToken,
                refreshToken: token.refreshToken,
                expiresAt: token.expiresAt,
            });
        });

        it('should handle expired token lifecycle', () => {
            const expiredToken = {
                accessToken: 'expired-access',
                refreshToken: 'refresh-token',
                expiresAt: Date.now() - 1000, // Expired
            };

            mockFindOne.mockReturnValue({
                id: 'token-1',
                appId: testKey.appId,
                provider: testKey.provider,
                scopes: testKey.scopes,
                accessTokenEncrypted: 'enc-access',
                accessTokenIv: 'iv-access',
                accessTokenTag: 'tag-access',
                refreshTokenEncrypted: 'enc-refresh',
                refreshTokenIv: 'iv-refresh',
                refreshTokenTag: 'tag-refresh',
                expiresAt: expiredToken.expiresAt,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            // Should be null due to expiration
            const retrieved = TokenStore.findValid(testKey);
            expect(retrieved).toBeNull();
        });
    });
});
