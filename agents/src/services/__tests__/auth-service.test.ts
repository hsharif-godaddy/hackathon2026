/**
 * AuthService Test Suite
 *
 * Comprehensive tests for OAuth2 PKCE flow orchestration covering:
 * - Token retrieval with storage lookup
 * - Token refresh when expired
 * - PKCE flow initiation with AuthRequiredError
 * - Authorization code exchange
 * - PKCE state management and cleanup
 * - Error handling for invalid states and failed exchanges
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AuthService, AuthRequiredError, OAuthScopes, pkceStateStore, type PKCEState } from '../auth-service.js';
import { TokenStore } from '../token-store.js';
import * as pkceUtils from '../../utils/pkce-utils.js';

// Hoist mock functions
const { mockFindValid, mockTryRefresh, mockSave, mockFindOne } = vi.hoisted(() => ({
    mockFindValid: vi.fn(),
    mockTryRefresh: vi.fn(),
    mockSave: vi.fn(),
    mockFindOne: vi.fn(),
}));

// Mock TokenStore
vi.mock('../token-store.js', () => ({
    TokenStore: {
        findValid: mockFindValid,
        tryRefresh: mockTryRefresh,
        save: mockSave,
    },
}));

// Mock OAuthTokenRepository
vi.mock('../../database/repositories/OAuthTokenRepository.js', () => ({
    OAuthTokenRepository: vi.fn(() => ({
        findOne: mockFindOne,
    })),
}));

// Mock PKCE utilities
vi.mock('../../utils/pkce-utils.js', () => ({
    generateCodeVerifier: vi.fn(),
    generateCodeChallenge: vi.fn(),
    generateState: vi.fn(),
}));

// Mock Nomad config
vi.mock('../../utils/nomad-config.js', () => ({
    getNomadAllocConfig: vi.fn(() => null),
}));

// Mock websocket server. getSocketIO returns a truthy stub so emitOAuthResult's
// WS path fires; emitToApp is spied so tests can assert the scoped-emit call.
const emitToAppMock = vi.fn(() => 1);
vi.mock('../../server/ai-lib-websocket-server.js', () => ({
    getSocketIO: vi.fn(() => ({})),
    emitToApp: (appId: string, event: string, payload: unknown) => emitToAppMock(appId, event, payload),
}));

// Mock logger
vi.mock('../../logging/index.js', () => ({
    logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        child: vi.fn(() => ({
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
            child: vi.fn(),
        })),
        withContext: vi.fn(() => ({
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
        })),
    },
    Logger: {
        create: vi.fn(() => ({
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
        })),
    },
    log: {
        forApp: vi.fn(() => ({
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
        })),
        error: vi.fn(),
    },
}));

describe('AuthService', () => {
    const testSessionId = 'app-123';
    const testScopes = ['commerce.product:read', 'commerce.checkout:write'];
    const testProvider = 'godaddy';

    beforeEach(() => {
        vi.clearAllMocks();
        pkceStateStore.clear();

        // Set test environment variables
        process.env.GODADDY_API_BASE_URL = 'https://api.test-godaddy.com';
        process.env.GODADDY_OAUTH_AUTH_ENDPOINT = '/v2/oauth2/authorize';
        process.env.GODADDY_OAUTH_TOKEN_ENDPOINT = '/v2/oauth2/token';
        process.env.GODADDY_OAUTH_CLIENT_ID = 'test-client-id-12345';
        process.env.GODADDY_OAUTH_CLIENT_SECRET = 'test-client-secret';
        process.env.AGENT_URL = 'http://localhost:4000';
        process.env.OAUTH_REDIRECT_URI = 'http://localhost:4000/oauth/godaddy/callback';
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('getAccessToken', () => {
        describe('with valid token in storage', () => {
            it('should return token from storage without refresh', async () => {
                const mockToken = {
                    accessToken: 'stored-access-token-xyz',
                    expiresAt: Date.now() + 3600_000,
                };

                // OAuthTokenRepository.findOne must return a record first
                mockFindOne.mockReturnValue({
                    accessToken: 'stored-access-token-xyz',
                    expiresAt: Date.now() + 3600_000,
                    scopes: OAuthScopes.sort().join(' '),
                });
                mockFindValid.mockReturnValue(mockToken);

                const result = await AuthService.getAccessToken({
                    appId: testSessionId,
                });

                expect(result.accessToken).toBe('stored-access-token-xyz');
                expect(result.expiresAt).toBe(mockToken.expiresAt);

                expect(mockFindValid).toHaveBeenCalledWith({
                    appId: testSessionId,
                    provider: 'godaddy',
                });

                expect(mockTryRefresh).not.toHaveBeenCalled();
            });

            it('should use provided provider instead of default', async () => {
                const mockToken = {
                    accessToken: 'custom-provider-token',
                    expiresAt: Date.now() + 3600_000,
                };

                mockFindOne.mockReturnValue({
                    accessToken: 'custom-provider-token',
                    expiresAt: Date.now() + 3600_000,
                    scopes: OAuthScopes.sort().join(' '),
                });
                mockFindValid.mockReturnValue(mockToken);

                await AuthService.getAccessToken({
                    appId: testSessionId,
                    provider: 'custom-provider',
                });

                expect(mockFindValid).toHaveBeenCalledWith({
                    appId: testSessionId,
                    provider: 'custom-provider',
                });
            });

            it('should use OAuthScopes for scope key', async () => {
                const mockToken = {
                    accessToken: 'token',
                    expiresAt: Date.now() + 3600_000,
                };

                mockFindOne.mockReturnValue({
                    accessToken: 'token',
                    expiresAt: Date.now() + 3600_000,
                    scopes: OAuthScopes.sort().join(' '),
                });
                mockFindValid.mockReturnValue(mockToken);

                await AuthService.getAccessToken({
                    appId: testSessionId,
                });

                expect(mockFindValid).toHaveBeenCalledWith({
                    appId: testSessionId,
                    provider: 'godaddy',
                });
            });
        });

        describe('with expired token requiring refresh', () => {
            it('should refresh token when token is expired but has valid scopes', async () => {
                // Token expired (expiresAt in the past, less than 60s buffer)
                mockFindOne.mockReturnValue({
                    accessToken: 'expired-token',
                    expiresAt: Date.now() - 1000, // expired
                    scopes: OAuthScopes.sort().join(' '),
                });

                const refreshedToken = {
                    accessToken: 'refreshed-access-token-abc',
                    expiresAt: Date.now() + 3600_000,
                };

                mockTryRefresh.mockResolvedValue(refreshedToken);

                const result = await AuthService.getAccessToken({
                    appId: testSessionId,
                });

                expect(result.accessToken).toBe('refreshed-access-token-abc');
                expect(result.expiresAt).toBe(refreshedToken.expiresAt);

                expect(mockTryRefresh).toHaveBeenCalledWith(
                    {
                        appId: testSessionId,
                        provider: 'godaddy',
                    },
                    'https://api.test-godaddy.com/v2/oauth2/token',
                    'test-client-id-12345',
                );
            });

            it('should use custom redirect URI if provided', async () => {
                mockFindOne.mockReturnValue(null);

                vi.mocked(pkceUtils.generateCodeVerifier).mockReturnValue('test-verifier-xyz');
                vi.mocked(pkceUtils.generateCodeChallenge).mockReturnValue('test-challenge-abc');
                vi.mocked(pkceUtils.generateState).mockReturnValue('test-state-uuid');

                try {
                    await AuthService.getAccessToken({
                        appId: testSessionId,
                        redirectUri: 'https://custom.app/oauth/callback',
                    });
                } catch (err) {
                    expect(err).toBeInstanceOf(AuthRequiredError);
                    const authErr = err as AuthRequiredError;

                    // Check that custom redirect URI is in the authorization URL
                    expect(authErr.redirectUrl).toContain(
                        'redirect_uri=https%3A%2F%2Fcustom.app%2Foauth%2Fcallback',
                    );

                    // Check that PKCE state stores the custom redirect URI
                    const state = pkceStateStore.get('test-state-uuid');
                    expect(state?.redirectUri).toBe('https://custom.app/oauth/callback');
                }
            });
        });

        describe('when authentication required', () => {
            beforeEach(() => {
                mockFindOne.mockReturnValue(null);
            });

            it('should throw AuthRequiredError with OAuth redirect URL', async () => {
                vi.mocked(pkceUtils.generateCodeVerifier).mockReturnValue('test-verifier-abc123');
                vi.mocked(pkceUtils.generateCodeChallenge).mockReturnValue('test-challenge-xyz789');
                vi.mocked(pkceUtils.generateState).mockReturnValue('test-state-uuid-456');

                await expect(
                    AuthService.getAccessToken({
                        appId: testSessionId,
                    }),
                ).rejects.toThrow(AuthRequiredError);

                try {
                    await AuthService.getAccessToken({
                        appId: testSessionId,
                    });
                } catch (err) {
                    expect(err).toBeInstanceOf(AuthRequiredError);
                    const authErr = err as AuthRequiredError;

                    expect(authErr.code).toBe('AUTH_REQUIRED');
                    expect(authErr.state).toBe('test-state-uuid-456');
                    expect(authErr.scopes).toEqual(OAuthScopes);
                    expect(authErr.redirectUrl).toContain('https://api.test-godaddy.com/v2/oauth2/authorize');
                    expect(authErr.redirectUrl).toContain('response_type=code');
                    expect(authErr.redirectUrl).toContain('client_id=test-client-id-12345');
                    expect(authErr.redirectUrl).toContain('redirect_uri=http%3A%2F%2Flocalhost%3A4000%2Foauth%2Fgodaddy%2Fcallback');
                    expect(authErr.redirectUrl).toContain('state=test-state-uuid-456');
                    expect(authErr.redirectUrl).toContain('code_challenge=test-challenge-xyz789');
                    expect(authErr.redirectUrl).toContain('code_challenge_method=S256');
                }
            });

            it('should store PKCE state in memory', async () => {
                vi.mocked(pkceUtils.generateCodeVerifier).mockReturnValue('verifier-12345');
                vi.mocked(pkceUtils.generateCodeChallenge).mockReturnValue('challenge-67890');
                vi.mocked(pkceUtils.generateState).mockReturnValue('state-uuid-abcde');

                try {
                    await AuthService.getAccessToken({
                        appId: testSessionId,
                    });
                } catch (err) {
                    const storedState = pkceStateStore.get('state-uuid-abcde');

                    expect(storedState).toBeDefined();
                    expect(storedState?.appId).toBe(testSessionId);
                    expect(storedState?.codeVerifier).toBe('verifier-12345');
                    expect(storedState?.scopes).toEqual(OAuthScopes);
                    expect(storedState?.redirectUri).toBe('http://localhost:4000/oauth/godaddy/callback');
                    expect(storedState?.createdAt).toBeGreaterThan(Date.now() - 1000);
                }
            });

            it('should generate PKCE code verifier and challenge', async () => {
                vi.mocked(pkceUtils.generateCodeVerifier).mockReturnValue('generated-verifier');
                vi.mocked(pkceUtils.generateCodeChallenge).mockReturnValue('generated-challenge');
                vi.mocked(pkceUtils.generateState).mockReturnValue('generated-state');

                try {
                    await AuthService.getAccessToken({
                        appId: testSessionId,
                    });
                } catch (err) {
                    expect(pkceUtils.generateCodeVerifier).toHaveBeenCalled();
                    expect(pkceUtils.generateCodeChallenge).toHaveBeenCalledWith('generated-verifier');
                    expect(pkceUtils.generateState).toHaveBeenCalled();
                }
            });
        });
    });

    describe('exchangeCode', () => {
        const testCode = 'auth-code-xyz123';
        const testState = 'state-uuid-abc456';

        beforeEach(() => {
            // Mock fetch for token exchange
            global.fetch = vi.fn();
        });

        describe('with valid PKCE state', () => {
            beforeEach(() => {
                // Store valid PKCE state
                pkceStateStore.set(testState, {
                    appId: testSessionId,
                    codeVerifier: 'stored-verifier-12345',
                    scopes: OAuthScopes,
                    redirectUri: 'http://localhost:4000/oauth/godaddy/callback',
                    createdAt: Date.now(),
                });
            });

            it('should exchange code for access token successfully', async () => {
                const mockResponse = {
                    ok: true,
                    json: vi.fn().mockResolvedValue({
                        access_token: 'new-access-token-xyz',
                        refresh_token: 'new-refresh-token-abc',
                        expires_in: 3600,
                        scope: OAuthScopes.join(' '),
                        token_type: 'Bearer',
                    }),
                };

                vi.mocked(global.fetch).mockResolvedValue(mockResponse as any);

                const result = await AuthService.exchangeCode({
                    code: testCode,
                    state: testState,
                });

                expect(result.accessToken).toBe('new-access-token-xyz');
                expect(result.expiresAt).toBeGreaterThan(Date.now());
                expect(result.expiresAt).toBeLessThanOrEqual(Date.now() + 3600_000 + 100);

                // Verify fetch was called with correct parameters
                expect(global.fetch).toHaveBeenCalledWith(
                    'https://api.test-godaddy.com/v2/oauth2/token',
                    expect.objectContaining({
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/x-www-form-urlencoded',
                            Accept: 'application/json',
                            'User-Agent': 'GoDaddy-Airo-AppBuilder Agent OAuth-Tool v1',
                        },
                    }),
                );

                const fetchCall = vi.mocked(global.fetch).mock.calls[0];
                const body = fetchCall?.[1]?.body?.toString();
                expect(body).toContain('grant_type=authorization_code');
                expect(body).toContain('client_id=test-client-id-12345');
                expect(body).toContain('client_secret=test-client-secret');
                expect(body).toContain(`code=${testCode}`);
                expect(body).toContain('redirect_uri=http%3A%2F%2Flocalhost%3A4000%2Foauth%2Fgodaddy%2Fcallback');
                expect(body).toContain('code_verifier=stored-verifier-12345');
            });

            it('should save tokens to storage', async () => {
                const mockResponse = {
                    ok: true,
                    json: vi.fn().mockResolvedValue({
                        access_token: 'saved-access-token',
                        refresh_token: 'saved-refresh-token',
                        expires_in: 7200,
                        token_type: 'Bearer',
                    }),
                };

                vi.mocked(global.fetch).mockResolvedValue(mockResponse as any);

                await AuthService.exchangeCode({
                    code: testCode,
                    state: testState,
                });

                expect(mockSave).toHaveBeenCalledWith(
                    {
                        appId: testSessionId,
                        provider: 'godaddy',
                    },
                    {
                        accessToken: 'saved-access-token',
                        refreshToken: 'saved-refresh-token',
                        expiresAt: expect.any(Number),
                        scopes: OAuthScopes.sort().join(' '),
                    },
                );
            });

            it('should clean up PKCE state after successful exchange', async () => {
                const mockResponse = {
                    ok: true,
                    json: vi.fn().mockResolvedValue({
                        access_token: 'token',
                        expires_in: 3600,
                        token_type: 'Bearer',
                    }),
                };

                vi.mocked(global.fetch).mockResolvedValue(mockResponse as any);

                expect(pkceStateStore.has(testState)).toBe(true);

                await AuthService.exchangeCode({
                    code: testCode,
                    state: testState,
                });

                expect(pkceStateStore.has(testState)).toBe(false);
            });

            it('should emit oauth:result scoped to the initiating appId', async () => {
                emitToAppMock.mockClear();
                const mockResponse = {
                    ok: true,
                    json: vi.fn().mockResolvedValue({
                        access_token: 'token',
                        refresh_token: 'refresh',
                        expires_in: 3600,
                        token_type: 'Bearer',
                    }),
                };
                vi.mocked(global.fetch).mockResolvedValue(mockResponse as any);

                await AuthService.exchangeCode({
                    code: testCode,
                    state: testState,
                });

                expect(emitToAppMock).toHaveBeenCalledTimes(1);
                const [appIdArg, eventArg, payload] = emitToAppMock.mock.calls[0] as unknown as [string, string, Record<string, unknown>];
                expect(appIdArg).toBe(testSessionId);
                expect(eventArg).toBe('oauth:result');
                expect(payload).toMatchObject({
                    success: true,
                    appId: testSessionId,
                    state: testState,
                    provider: 'godaddy',
                    expiresAt: expect.any(Number),
                    scopes: expect.any(Array),
                });
            });

            it('should handle tokens without refresh token', async () => {
                const mockResponse = {
                    ok: true,
                    json: vi.fn().mockResolvedValue({
                        access_token: 'access-only-token',
                        expires_in: 1800,
                        token_type: 'Bearer',
                        // No refresh_token
                    }),
                };

                vi.mocked(global.fetch).mockResolvedValue(mockResponse as any);

                const result = await AuthService.exchangeCode({
                    code: testCode,
                    state: testState,
                });

                expect(result.accessToken).toBe('access-only-token');

                // Verify save was called with token data (no refreshToken due to conditional spread)
                const saveCall = mockSave.mock.calls[0];
                expect(saveCall?.[0]).toMatchObject({
                    appId: testSessionId,
                    provider: 'godaddy',
                });
                expect(saveCall?.[1]).toMatchObject({
                    accessToken: 'access-only-token',
                    expiresAt: expect.any(Number),
                });
                // refreshToken should not be present at all due to conditional spread
                expect(saveCall?.[1]).not.toHaveProperty('refreshToken');
            });
        });

        describe('with invalid state', () => {
            it('should throw error if state not found in store', async () => {
                await expect(
                    AuthService.exchangeCode({
                        code: testCode,
                        state: 'invalid-state-not-in-store',
                    }),
                ).rejects.toThrow('Invalid state parameter');

                expect(global.fetch).not.toHaveBeenCalled();
            });

            it('should not save token if state is invalid', async () => {
                await expect(
                    AuthService.exchangeCode({
                        code: testCode,
                        state: 'bad-state',
                    }),
                ).rejects.toThrow();

                expect(mockSave).not.toHaveBeenCalled();
            });

            it('should throw error if state has expired (>10 minutes old)', async () => {
                const expiredState = 'expired-state-123';
                pkceStateStore.set(expiredState, {
                    appId: testSessionId,
                    codeVerifier: 'verifier',
                    scopes: OAuthScopes,
                    redirectUri: 'http://localhost:4000/oauth/godaddy/callback',
                    createdAt: Date.now() - 11 * 60 * 1000, // 11 minutes ago
                });

                await expect(
                    AuthService.exchangeCode({
                        code: testCode,
                        state: expiredState,
                    }),
                ).rejects.toThrow('OAuth state has expired');

                // Should perform lazy cleanup
                expect(pkceStateStore.has(expiredState)).toBe(false);
                expect(global.fetch).not.toHaveBeenCalled();
            });
        });

        describe('with failed token exchange', () => {
            beforeEach(() => {
                pkceStateStore.set(testState, {
                    appId: testSessionId,
                    codeVerifier: 'verifier',
                    scopes: OAuthScopes,
                    redirectUri: 'http://localhost:4000/oauth/godaddy/callback',
                    createdAt: Date.now(),
                });
            });

            it('should throw error if token endpoint returns non-ok status', async () => {
                const mockResponse = {
                    ok: false,
                    status: 401,
                    text: vi.fn().mockResolvedValue('invalid_grant'),
                };

                vi.mocked(global.fetch).mockResolvedValue(mockResponse as any);

                await expect(
                    AuthService.exchangeCode({
                        code: testCode,
                        state: testState,
                    }),
                ).rejects.toThrow('Token exchange failed: 401');

                expect(mockSave).not.toHaveBeenCalled();
            });

            it('should throw error if fetch throws network error', async () => {
                vi.mocked(global.fetch).mockRejectedValue(new Error('Network failure'));

                await expect(
                    AuthService.exchangeCode({
                        code: testCode,
                        state: testState,
                    }),
                ).rejects.toThrow('Network failure');

                expect(mockSave).not.toHaveBeenCalled();
            });

            it('should throw error if response JSON is malformed', async () => {
                const mockResponse = {
                    ok: true,
                    json: vi.fn().mockRejectedValue(new Error('Invalid JSON')),
                };

                vi.mocked(global.fetch).mockResolvedValue(mockResponse as any);

                await expect(
                    AuthService.exchangeCode({
                        code: testCode,
                        state: testState,
                    }),
                ).rejects.toThrow('Invalid JSON');
            });
        });
    });

    describe('AuthRequiredError', () => {
        it('should create error with correct properties', () => {
            const error = new AuthRequiredError(
                'https://oauth.provider.com/authorize?...',
                'state-123',
                ['scope1', 'scope2'],
            );

            expect(error).toBeInstanceOf(Error);
            expect(error).toBeInstanceOf(AuthRequiredError);
            expect(error.name).toBe('AuthRequiredError');
            expect(error.code).toBe('AUTH_REQUIRED');
            expect(error.message).toBe('Authentication required');
            expect(error.redirectUrl).toBe('https://oauth.provider.com/authorize?...');
            expect(error.state).toBe('state-123');
            expect(error.scopes).toEqual(['scope1', 'scope2']);
        });
    });

    describe('pkceStateStore cleanup', () => {
        it('should be accessible for testing', () => {
            expect(pkceStateStore).toBeInstanceOf(Map);
        });

        it('should allow manual state management', () => {
            const testState: PKCEState = {
                appId: 'test',
                codeVerifier: 'verifier',
                scopes: ['scope1'],
                redirectUri: 'http://localhost',
                createdAt: Date.now(),
            };

            pkceStateStore.set('test-key', testState);
            expect(pkceStateStore.get('test-key')).toEqual(testState);

            pkceStateStore.delete('test-key');
            expect(pkceStateStore.has('test-key')).toBe(false);
        });
    });
});
