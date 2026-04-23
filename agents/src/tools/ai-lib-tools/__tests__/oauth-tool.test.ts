import { describe, it, expect, beforeEach, vi } from 'vitest';

const createExecutionOptions = (appId?: string) => ({
  experimental_context: {
    metadata: appId ? { appId } : {},
  },
});

// Mock AuthService - use hoisted pattern
vi.mock('../../../services/auth-service.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../services/auth-service.js')>();
  return {
    ...original,
    AuthService: {
      getAccessToken: vi.fn(),
    },
  };
});

// Import after mocks are set up
import { oauthConnect } from '../oauth-tool.js';
import {
  AuthService,
  AuthRequiredError,
  MissingOAuthConfigError,
  OAuthScopes,
} from '../../../services/auth-service.js';

// Get the mocked function
const mockGetAccessToken = vi.mocked(AuthService.getAccessToken);

describe('oauth-tool', function oauthToolTests() {
  beforeEach(function setup() {
    vi.clearAllMocks();
  });

  describe('successful token retrieval', function successTests() {
    it('should return success when token is available', async function tokenAvailable() {
      const appId = 'test-app-1';
      const expiresAt = Date.now() + 3600000;

      mockGetAccessToken.mockResolvedValue({
        accessToken: 'mock-token',
        expiresAt,
      });

      const result = await oauthConnect.execute!({}, createExecutionOptions(appId) as any);

      expect(result).toEqual({
        success: true,
        provider: 'godaddy',
        scopes: OAuthScopes,
        expiresAt,
      });
      expect(mockGetAccessToken).toHaveBeenCalledWith({ appId });
    });
  });

  describe('auth required flow', function authRequiredTests() {
    it('should return authRequest when authentication is required', async function authRequired() {
      const appId = 'test-app-2';
      const redirectUrl = 'https://api.godaddy.com/v2/oauth2/authorize?...';
      const state = 'mock-state-uuid';

      mockGetAccessToken.mockRejectedValue(
        new AuthRequiredError(redirectUrl, state, OAuthScopes)
      );

      const result = await oauthConnect.execute!({}, createExecutionOptions(appId) as any);

      expect(result).toMatchObject({
        success: true,
        authRequired: true,
        message: expect.stringContaining('popup window'),
        authRequest: {
          type: 'auth_request',
          provider: 'godaddy',
          scopes: OAuthScopes,
          redirectUrl,
          state,
        },
      });
    });
  });

  describe('missing OAuth config error', function missingConfigTests() {
    it('should return structured error for missing OAuth config', async function missingConfig() {
      const appId = 'test-app-3';
      const missingVars = ['GODADDY_OAUTH_CLIENT_ID', 'GODADDY_OAUTH_CLIENT_SECRET'];

      mockGetAccessToken.mockRejectedValue(new MissingOAuthConfigError(missingVars));

      const result = (await oauthConnect.execute!({}, createExecutionOptions(appId) as any)) as any;

      expect(result).toEqual({
        success: false,
        error: expect.stringContaining('OAuth is not configured'),
        recoverable: false,
      });
      expect(result.error).toContain('GODADDY_OAUTH_CLIENT_ID');
      expect(result.error).toContain('GODADDY_OAUTH_CLIENT_SECRET');
    });

    it('should include all missing env var names in error message', async function includesMissingNames() {
      const appId = 'test-app-4';
      const missingVars = ['GODADDY_API_BASE_URL', 'AGENT_URL'];

      mockGetAccessToken.mockRejectedValue(new MissingOAuthConfigError(missingVars));

      const result = (await oauthConnect.execute!({}, createExecutionOptions(appId) as any)) as any;

      expect(result.error).toContain('GODADDY_API_BASE_URL');
      expect(result.error).toContain('AGENT_URL');
    });
  });

  describe('error propagation', function errorPropagationTests() {
    it('should throw for unexpected errors', async function unexpectedError() {
      const appId = 'test-app-5';

      mockGetAccessToken.mockRejectedValue(new Error('Network timeout'));

      await expect(
        oauthConnect.execute!({}, createExecutionOptions(appId) as any)
      ).rejects.toThrow('Network timeout');
    });

    it('should throw for token exchange failures', async function tokenExchangeError() {
      const appId = 'test-app-6';

      mockGetAccessToken.mockRejectedValue(new Error('Token exchange failed: 401'));

      await expect(
        oauthConnect.execute!({}, createExecutionOptions(appId) as any)
      ).rejects.toThrow('Token exchange failed: 401');
    });
  });

  describe('input validation', function validationTests() {
    it('should throw when appId is missing', async function noAppId() {
      await expect(oauthConnect.execute!({}, createExecutionOptions() as any)).rejects.toThrow(
        'App ID is required'
      );
    });
  });
});
