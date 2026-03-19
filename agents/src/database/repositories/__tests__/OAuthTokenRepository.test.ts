/**
 * OAuthTokenRepository Test Suite
 *
 * Comprehensive tests for the OAuthTokenRepository class covering:
 * - Database CRUD operations for OAuth tokens
 * - Token encryption metadata storage (IV, tag)
 * - UPSERT behavior with unique constraints
 * - Token expiration queries
 * - Session-based operations
 * - Data consistency and integrity
 * - Error handling and edge cases
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OAuthTokenRepository } from '../OAuthTokenRepository.js';
import type { OAuthToken } from '../../schema.js';

// Mock database connection
vi.mock('../../connection.js');
vi.mock('nanoid');

describe('OAuthTokenRepository', () => {
    let repository: OAuthTokenRepository;
    let mockDb: any;
    let mockStatement: any;

    // Test data
    const testAppId = 'app-abc123';
    const testProvider = 'godaddy';
    const testScopes = 'commerce.product:read commerce.checkout:write';
    const futureExpiry = Date.now() + 3600000; // 1 hour from now
    const pastExpiry = Date.now() - 1000; // 1 second ago

    const testTokenData: Omit<OAuthToken, 'id' | 'createdAt' | 'updatedAt'> = {
        appId: testAppId,
        provider: testProvider,
        scopes: testScopes,
        accessTokenEncrypted: 'encrypted_access_token_base64',
        accessTokenIv: 'iv_base64_12bytes',
        accessTokenTag: 'tag_base64_16bytes',
        refreshTokenEncrypted: 'encrypted_refresh_token_base64',
        refreshTokenIv: 'refresh_iv_base64',
        refreshTokenTag: 'refresh_tag_base64',
        expiresAt: futureExpiry,
    };

    const mockDbRow = {
        id: 'oauth-token-123',
        app_id: testAppId,
        provider: testProvider,
        scopes: testScopes,
        access_token_encrypted: testTokenData.accessTokenEncrypted,
        access_token_iv: testTokenData.accessTokenIv,
        access_token_tag: testTokenData.accessTokenTag,
        refresh_token_encrypted: testTokenData.refreshTokenEncrypted,
        refresh_token_iv: testTokenData.refreshTokenIv,
        refresh_token_tag: testTokenData.refreshTokenTag,
        expires_at: futureExpiry,
        created_at: new Date('2024-01-01T10:00:00Z').toISOString(),
        updated_at: new Date('2024-01-01T10:30:00Z').toISOString(),
    };

    const expectedToken: OAuthToken = {
        id: 'oauth-token-123',
        appId: testAppId,
        provider: testProvider,
        scopes: testScopes,
        accessTokenEncrypted: testTokenData.accessTokenEncrypted,
        accessTokenIv: testTokenData.accessTokenIv,
        accessTokenTag: testTokenData.accessTokenTag,
        refreshTokenEncrypted: testTokenData.refreshTokenEncrypted,
        refreshTokenIv: testTokenData.refreshTokenIv,
        refreshTokenTag: testTokenData.refreshTokenTag,
        expiresAt: futureExpiry,
        createdAt: new Date('2024-01-01T10:00:00Z'),
        updatedAt: new Date('2024-01-01T10:30:00Z'),
    };

    beforeEach(async () => {
        // Reset all mocks
        vi.clearAllMocks();

        // Mock database statement
        mockStatement = {
            get: vi.fn(),
            all: vi.fn(),
            run: vi.fn(),
        };

        // Mock database connection
        mockDb = {
            prepare: vi.fn().mockReturnValue(mockStatement),
        };

        // Mock getDatabase
        const { getDatabase } = await import('../../connection.js');
        vi.mocked(getDatabase).mockReturnValue(mockDb);

        // Mock nanoid for ID generation
        const { nanoid } = await import('nanoid');
        vi.mocked(nanoid).mockReturnValue('oauth-token-123');

        // Create repository instance
        repository = new OAuthTokenRepository();
    });

    afterEach(() => {
        vi.resetAllMocks();
    });

    describe('Initialization', () => {
        it('should initialize with database connection', () => {
            expect(repository).toBeInstanceOf(OAuthTokenRepository);
            expect(mockDb).toBeDefined();
        });
    });

    describe('findOne', () => {
        it('should return token when found by session and provider', () => {
            mockStatement.get.mockReturnValue(mockDbRow);

            const result = repository.findOne(testAppId, testProvider);

            expect(result).toEqual(expectedToken);
            expect(mockDb.prepare).toHaveBeenCalledWith(
                expect.stringContaining('SELECT * FROM oauth_tokens'),
            );
            expect(mockStatement.get).toHaveBeenCalledWith(
                testAppId,
                testProvider,
            );
        });

        it('should return null when token not found', () => {
            mockStatement.get.mockReturnValue(undefined);

            const result = repository.findOne(testAppId, testProvider);

            expect(result).toBeNull();
            expect(mockStatement.get).toHaveBeenCalledWith(
                testAppId,
                testProvider,
            );
        });

        it('should handle token without refresh token', () => {
            const rowWithoutRefresh = {
                ...mockDbRow,
                refresh_token_encrypted: null,
                refresh_token_iv: null,
                refresh_token_tag: null,
            };
            mockStatement.get.mockReturnValue(rowWithoutRefresh);

            const result = repository.findOne(testAppId, testProvider);

            expect(result?.refreshTokenEncrypted).toBeUndefined();
            expect(result?.refreshTokenIv).toBeUndefined();
            expect(result?.refreshTokenTag).toBeUndefined();
        });
    });

    describe('upsert', () => {
        it('should insert new token with generated ID and timestamps', () => {
            mockStatement.get.mockReturnValue(mockDbRow);

            const result = repository.upsert(testTokenData);

            expect(mockDb.prepare).toHaveBeenCalledWith(
                expect.stringContaining('INSERT INTO oauth_tokens'),
            );
            expect(mockDb.prepare).toHaveBeenCalledWith(
                expect.stringContaining('ON CONFLICT'),
            );
            expect(mockStatement.run).toHaveBeenCalledWith(
                'oauth-token-123', // id from nanoid
                testAppId,
                testProvider,
                testScopes,
                testTokenData.accessTokenEncrypted,
                testTokenData.accessTokenIv,
                testTokenData.accessTokenTag,
                testTokenData.refreshTokenEncrypted,
                testTokenData.refreshTokenIv,
                testTokenData.refreshTokenTag,
                futureExpiry,
                expect.any(String), // created_at timestamp
                expect.any(String), // updated_at timestamp
            );
            expect(result).toEqual(expectedToken);
        });

        it('should update existing token on conflict (same session, provider, scopes)', () => {
            mockStatement.get.mockReturnValue(mockDbRow);

            const updatedData = {
                ...testTokenData,
                accessTokenEncrypted: 'new_encrypted_token',
                expiresAt: Date.now() + 7200000, // 2 hours
            };

            const result = repository.upsert(updatedData);

            expect(mockStatement.run).toHaveBeenCalledWith(
                expect.any(String),
                testAppId,
                testProvider,
                testScopes,
                'new_encrypted_token',
                expect.any(String),
                expect.any(String),
                expect.any(String),
                expect.any(String),
                expect.any(String),
                expect.any(Number),
                expect.any(String),
                expect.any(String),
            );
            expect(result).toBeDefined();
        });

        it('should handle token without refresh token fields', () => {
            const dataWithoutRefresh: Omit<OAuthToken, 'id' | 'createdAt' | 'updatedAt'> = {
                appId: testAppId,
                provider: testProvider,
                scopes: testScopes,
                accessTokenEncrypted: testTokenData.accessTokenEncrypted,
                accessTokenIv: testTokenData.accessTokenIv,
                accessTokenTag: testTokenData.accessTokenTag,
                expiresAt: futureExpiry,
            };

            mockStatement.get.mockReturnValue({
                ...mockDbRow,
                refresh_token_encrypted: null,
                refresh_token_iv: null,
                refresh_token_tag: null,
            });

            const result = repository.upsert(dataWithoutRefresh);

            expect(mockStatement.run).toHaveBeenCalledWith(
                expect.any(String),
                testAppId,
                testProvider,
                testScopes,
                expect.any(String),
                expect.any(String),
                expect.any(String),
                null, // refresh token encrypted
                null, // refresh token iv
                null, // refresh token tag
                futureExpiry,
                expect.any(String),
                expect.any(String),
            );
            expect(result).toBeDefined();
        });
    });

    describe('delete', () => {
        it('should delete token by session and provider', () => {
            repository.delete(testAppId, testProvider);

            expect(mockDb.prepare).toHaveBeenCalledWith(
                expect.stringContaining('DELETE FROM oauth_tokens'),
            );
            expect(mockStatement.run).toHaveBeenCalledWith(
                testAppId,
                testProvider,
            );
        });

        it('should not throw error when deleting non-existent token', () => {
            expect(() => {
                repository.delete('nonexistent', 'provider');
            }).not.toThrow();
        });
    });

    describe('findExpired', () => {
        it('should return all expired tokens', () => {
            const expiredRow1 = {
                ...mockDbRow,
                id: 'expired-1',
                expires_at: pastExpiry - 10000,
            };
            const expiredRow2 = {
                ...mockDbRow,
                id: 'expired-2',
                expires_at: pastExpiry - 5000,
            };

            mockStatement.all.mockReturnValue([expiredRow1, expiredRow2]);

            const result = repository.findExpired();

            expect(result).toHaveLength(2);
            expect(result[0].id).toBe('expired-1');
            expect(result[1].id).toBe('expired-2');
            expect(mockDb.prepare).toHaveBeenCalledWith(
                expect.stringContaining('WHERE expires_at < ?'),
            );
            expect(mockStatement.all).toHaveBeenCalledWith(expect.any(Number));
        });

        it('should return empty array when no expired tokens', () => {
            mockStatement.all.mockReturnValue([]);

            const result = repository.findExpired();

            expect(result).toEqual([]);
        });

        it('should use current timestamp for expiry check', () => {
            const beforeCall = Date.now();
            mockStatement.all.mockReturnValue([]);

            repository.findExpired();

            const callArg = mockStatement.all.mock.calls[0][0];
            const afterCall = Date.now();

            expect(callArg).toBeGreaterThanOrEqual(beforeCall);
            expect(callArg).toBeLessThanOrEqual(afterCall);
        });
    });

    describe('deleteBySession', () => {
        it('should delete all tokens for a session across all providers and scopes', () => {
            repository.deleteBySession(testAppId);

            expect(mockDb.prepare).toHaveBeenCalledWith(
                expect.stringContaining('DELETE FROM oauth_tokens'),
            );
            expect(mockDb.prepare).toHaveBeenCalledWith(
                expect.stringContaining('WHERE app_id = ?'),
            );
            expect(mockStatement.run).toHaveBeenCalledWith(testAppId);
        });

        it('should not throw error when deleting tokens for non-existent session', () => {
            expect(() => {
                repository.deleteBySession('nonexistent-session');
            }).not.toThrow();
        });
    });

    describe('findBySession', () => {
        it('should return all tokens for a session', () => {
            const row1 = { ...mockDbRow, id: 'token-1', scopes: 'commerce.product:read' };
            const row2 = {
                ...mockDbRow,
                id: 'token-2',
                scopes: 'commerce.checkout:write',
            };

            mockStatement.all.mockReturnValue([row1, row2]);

            const result = repository.findBySession(testAppId);

            expect(result).toHaveLength(2);
            expect(result[0].id).toBe('token-1');
            expect(result[0].scopes).toBe('commerce.product:read');
            expect(result[1].id).toBe('token-2');
            expect(result[1].scopes).toBe('commerce.checkout:write');
            expect(mockDb.prepare).toHaveBeenCalledWith(
                expect.stringContaining('WHERE app_id = ?'),
            );
            expect(mockStatement.all).toHaveBeenCalledWith(testAppId);
        });

        it('should return empty array when session has no tokens', () => {
            mockStatement.all.mockReturnValue([]);

            const result = repository.findBySession('new-session');

            expect(result).toEqual([]);
        });

        it('should handle mixed providers in same session', () => {
            const row1 = { ...mockDbRow, id: 'token-1', provider: 'godaddy' };
            const row2 = { ...mockDbRow, id: 'token-2', provider: 'auth0' };

            mockStatement.all.mockReturnValue([row1, row2]);

            const result = repository.findBySession(testAppId);

            expect(result).toHaveLength(2);
            expect(result[0].provider).toBe('godaddy');
            expect(result[1].provider).toBe('auth0');
        });
    });

    describe('Data Mapping', () => {
        it('should correctly map snake_case columns to camelCase properties', () => {
            mockStatement.get.mockReturnValue(mockDbRow);

            const result = repository.findOne(testAppId, testProvider, testScopes);

            expect(result).toMatchObject({
                appId: mockDbRow.app_id,
                accessTokenEncrypted: mockDbRow.access_token_encrypted,
                accessTokenIv: mockDbRow.access_token_iv,
                accessTokenTag: mockDbRow.access_token_tag,
                refreshTokenEncrypted: mockDbRow.refresh_token_encrypted,
                refreshTokenIv: mockDbRow.refresh_token_iv,
                refreshTokenTag: mockDbRow.refresh_token_tag,
                expiresAt: mockDbRow.expires_at,
            });
        });

        it('should convert timestamp strings to Date objects', () => {
            mockStatement.get.mockReturnValue(mockDbRow);

            const result = repository.findOne(testAppId, testProvider, testScopes);

            expect(result?.createdAt).toBeInstanceOf(Date);
            expect(result?.updatedAt).toBeInstanceOf(Date);
            expect(result?.createdAt.toISOString()).toBe('2024-01-01T10:00:00.000Z');
            expect(result?.updatedAt.toISOString()).toBe('2024-01-01T10:30:00.000Z');
        });
    });

    describe('Edge Cases', () => {
        it('should handle very long scope strings', () => {
            const longScopes =
                'commerce.product:read commerce.product:write commerce.checkout:read commerce.checkout:write orders:read orders:write customers:read customers:write';
            const tokenWithLongScopes = {
                ...testTokenData,
                scopes: longScopes,
            };

            mockStatement.get.mockReturnValue({
                ...mockDbRow,
                scopes: longScopes,
            });

            const result = repository.upsert(tokenWithLongScopes);

            expect(mockStatement.run).toHaveBeenCalledWith(
                expect.any(String),
                testAppId,
                testProvider,
                longScopes,
                expect.any(String),
                expect.any(String),
                expect.any(String),
                expect.any(String),
                expect.any(String),
                expect.any(String),
                expect.any(Number),
                expect.any(String),
                expect.any(String),
            );
        });

        it('should handle tokens expiring at exact current time', () => {
            const now = Date.now();
            const tokenExpiringNow = {
                ...mockDbRow,
                expires_at: now,
            };

            mockStatement.all.mockReturnValue([tokenExpiringNow]);

            const result = repository.findExpired();

            // Token expiring at exactly now should not be included (< not <=)
            expect(mockStatement.all).toHaveBeenCalledWith(expect.any(Number));
        });

        it('should handle empty session ID', () => {
            mockStatement.get.mockReturnValue(undefined);

            const result = repository.findOne('', testProvider);

            expect(result).toBeNull();
            expect(mockStatement.get).toHaveBeenCalledWith('', testProvider);
        });
    });
});
