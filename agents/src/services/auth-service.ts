import { generateCodeVerifier, generateCodeChallenge, generateState } from '../utils/pkce-utils.js';
import { TokenStore } from './token-store.js';
import { Logger } from '../logging/index.js';
import { OAuthTokenRepository } from '../database/repositories/OAuthTokenRepository.js';
import { getSocketIO } from '../server/ai-lib-websocket-server.js';
import { getNomadAllocConfig } from '../utils/nomad-config.js';

const logger = Logger.create({ component: 'auth-service' });

export const OAuthScopes = [
  'commerce.store:read',
  'commerce.product:read',
  'commerce.product:write',
  'commerce.order:read',
  'commerce.onboarding-application:write',
  'commerce.onboarding-application:read',
  'apps.app-registry:read',
  'apps.app-registry:write',
];

/**
 * Check if stored scopes are a superset of requested scopes
 *
 * @param storedScopes - Space-separated scopes from stored token
 * @param requestedScopes - Array of scopes being requested
 * @returns true if stored scopes contain all requested scopes
 *
 * @example
 * isScopesSuperset('read write', ['read']) // true
 * isScopesSuperset('read', ['read', 'write']) // false
 */
function isScopesSuperset(storedScopes: string, requestedScopes: string[]): boolean {
  const storedSet = new Set(storedScopes.split(' ').filter(Boolean));
  return requestedScopes.every((scope) => storedSet.has(scope));
}

/**
 * Custom error thrown when OAuth configuration is missing from environment
 *
 * Contains the names of missing environment variables for diagnostic purposes.
 * This is an unrecoverable configuration error - the values cannot be obtained at runtime.
 */
export class MissingOAuthConfigError extends Error {
  code = 'MISSING_OAUTH_CONFIG';
  missing: string[];

  constructor(missing: string[]) {
    super(
      `Missing required OAuth configuration: ${missing.join(', ')}. ` +
        'Cannot perform authentication without these values.'
    );
    this.name = 'MissingOAuthConfigError';
    this.missing = missing;
  }
}

/**
 * Get OAuth configuration from environment variables and Nomad alloc config
 * Called at runtime to support test environment variable changes
 *
 * Configuration sources:
 * - GODADDY_API_BASE_URL: Always from process.env
 * - AGENT_URL: Always from process.env
 * - GODADDY_OAUTH_CLIENT_ID: From process.env (sandbox) or /alloc/config.json (deployed)
 * - GODADDY_OAUTH_CLIENT_SECRET: From process.env (sandbox) or /alloc/config.json (deployed)
 *
 * @throws {Error} If required configuration values are missing
 */
function getConfig(): {
  apiUrl: string;
  authEndpoint: string;
  tokenEndpoint: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
} {
  // Get values from environment variables (always for apiUrl/agentUrl, fallback for credentials)
  const apiUrl = process.env.GODADDY_API_BASE_URL;
  const agentUrl = process.env.AGENT_URL;

  // Override OAuth credentials from nomad config if present, otherwise use env vars
  const nomadConfig = getNomadAllocConfig();
  const clientId = nomadConfig?.GODADDY_OAUTH_CLIENT_ID?.VALUE || process.env.GODADDY_OAUTH_CLIENT_ID;
  const clientSecret = nomadConfig?.GODADDY_OAUTH_CLIENT_SECRET?.VALUE || process.env.GODADDY_OAUTH_CLIENT_SECRET;

  // Validate all required values are present
  const missing = [];
  if (!apiUrl) missing.push('GODADDY_API_BASE_URL');
  if (!agentUrl) missing.push('AGENT_URL');
  if (!clientId) missing.push('GODADDY_OAUTH_CLIENT_ID');
  if (!clientSecret) missing.push('GODADDY_OAUTH_CLIENT_SECRET');

  if (missing.length > 0) {
    logger.error('auth-service.config.missing-required-values', {
      missing,
      hasNomadConfig: !!nomadConfig,
    });
    throw new MissingOAuthConfigError(missing);
  }

  // TypeScript now knows these values are defined
  let normalizedAgentUrl = agentUrl!.replace(/\/+$/, '');
  if (!normalizedAgentUrl.startsWith('http://') && !normalizedAgentUrl.startsWith('https://')) {
    // Default to https for non-localhost, http for localhost
    const protocol = (normalizedAgentUrl.includes('localhost') || normalizedAgentUrl.includes('127.0.0.1')) 
      ? 'http://' 
      : 'https://';
    normalizedAgentUrl = `${protocol}${normalizedAgentUrl}`;
  }
  const redirectUri = `${normalizedAgentUrl}/oauth/godaddy/callback`;

  return {
    apiUrl: apiUrl!,
    authEndpoint: process.env.GODADDY_OAUTH_AUTH_ENDPOINT || '/v2/oauth2/authorize',
    tokenEndpoint: process.env.GODADDY_OAUTH_TOKEN_ENDPOINT || '/v2/oauth2/token',
    clientId: clientId!,
    clientSecret: clientSecret!,
    redirectUri,
  };
}

/**
 * PKCE state stored during OAuth authorization flow
 * Kept in memory with 10-minute TTL
 */
export interface PKCEState {
  appId: string;
  codeVerifier: string;
  scopes: string[];
  redirectUri: string;
  createdAt: number;
}

/**
 * In-memory store for PKCE state during OAuth flow
 * Maps state parameter (UUID) to PKCE flow data
 * Exported for testing purposes
 *
 * TODO: Implement proper PKCE state cleanup strategy
 * Current approach: States stay in memory until process restart
 * Considerations for cleanup implementation:
 * - Lazy cleanup: Remove expired states when checking/storing new ones
 * - Scheduled job: External cron/scheduler instead of setInterval
 * - TTL-based cache: Use Redis or similar with automatic expiration
 * - Manual cleanup endpoint: Admin route to clear expired states
 * - Serverless compatibility: setInterval doesn't work in Lambda/edge functions
 * States have 10-minute TTL (see PKCEState.createdAt)
 */
export const pkceStateStore = new Map<string, PKCEState>();

/**
 * Custom error thrown when user authentication is required
 *
 * Contains OAuth authorization URL and state for frontend to initiate flow.
 * Frontend should open redirectUrl in popup/window for user authentication.
 */
export class AuthRequiredError extends Error {
  code = 'AUTH_REQUIRED';
  redirectUrl: string;
  state: string;
  scopes: string[];

  /**
   * Create an AuthRequiredError with OAuth redirect information
   *
   * @param redirectUrl - Full OAuth authorization URL to redirect user to
   * @param state - CSRF protection state parameter (UUID)
   * @param scopes - OAuth scopes being requested
   *
   * @example
   * ```typescript
   * throw new AuthRequiredError(
   *   'https://api.dev-godaddy.com/v2/oauth2/authorize?...',
   *   'uuid-state-value',
   *   ['commerce.product:read']
   * );
   * ```
   */
  constructor(redirectUrl: string, state: string, scopes: string[]) {
    super('Authentication required');
    this.name = 'AuthRequiredError';
    this.redirectUrl = redirectUrl;
    this.state = state;
    this.scopes = scopes;
  }
}

/**
 * OAuth2 PKCE Flow Orchestration Service
 *
 * Manages the complete OAuth2 Authorization Code Flow with PKCE:
 * 1. Check for existing valid token in TokenStore
 * 2. Attempt token refresh if expired
 * 3. Generate PKCE challenge and throw AuthRequiredError if needed
 * 4. Exchange authorization code for access token on callback
 *
 * Uses in-memory PKCE state store with automatic cleanup.
 */
export class AuthService {
  /**
   * Get an access token for the given session and scopes
   *
   * Attempts to retrieve a valid token from storage, refresh if expired,
   * or initiates new OAuth flow by throwing AuthRequiredError.
   *
   * @param params - Token request parameters
   * @param params.appId - Unique session identifier for user/app instance
   * @param params.scopes - Array of OAuth scopes required (e.g., ['commerce.product:read'])
   * @param params.provider - OAuth provider name (default: 'godaddy')
   * @param params.redirectUri - Optional OAuth callback URI (defaults to config)
   * @returns Promise resolving to access token and expiration timestamp
   * @throws {AuthRequiredError} When user needs to authenticate - contains redirectUrl
   *
   * @example
   * ```typescript
   * try {
   *   const { accessToken, expiresAt } = await AuthService.getAccessToken({
   *     appId: 'session-123',
   *     scopes: ['commerce.product:read', 'commerce.checkout:write']
   *   });
   *   // Use accessToken for API calls
   * } catch (err) {
   *   if (err instanceof AuthRequiredError) {
   *     // Open err.redirectUrl in browser for user authentication
   *   }
   * }
   * ```
   */
  /**
   * Parse the `sub` claim from a JWT access token payload without validation.
   * The token has already been obtained from the OAuth flow — this is claim extraction, not validation.
   */
  private static parseSubClaim(accessToken: string): string | undefined {
    try {
      const parts = accessToken.split('.');
      if (parts.length < 2 || !parts[1]) return undefined;
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
      return typeof payload.sub === 'string' ? payload.sub : undefined;
    } catch {
      return undefined;
    }
  }

  static async getAccessToken(params: {
    appId: string;
    provider?: string;
    redirectUri?: string;
    forceRefresh?: boolean;
  }): Promise<{ accessToken: string; expiresAt: number; sub?: string }> {
    const config = getConfig();
    const { appId, provider = 'godaddy', redirectUri = config.redirectUri, forceRefresh = false } = params;
    let scopeKey = OAuthScopes.sort().join(' ');

    // Check for valid token in storage
    // Note: Each app has only ONE token per provider, regardless of scopes requested
    const repo = new OAuthTokenRepository();
    const record = repo.findOne(appId, provider);

    if (record) {
      // Validate that stored token has all requested scopes
      if (!forceRefresh && record.expiresAt - Date.now() > 60_000) {
        // Token has required scopes and is not expired
        const stored = TokenStore.findValid({ appId, provider });
        if (stored) {
          logger.info('auth-service.get-token.found', { appId, scopes: record.scopes });
          return { accessToken: stored.accessToken, expiresAt: stored.expiresAt, sub: this.parseSubClaim(stored.accessToken) };
        }
      } else {
        // Token expired, try to refresh
        // Refresh cannot add scopes - validate before attempting
        if (!isScopesSuperset(record.scopes, OAuthScopes)) {
          // Cannot refresh with different scopes - need new OAuth flow
          const storedScopeSet = new Set(record.scopes.split(' ').filter(Boolean));
          const requestedScopeSet = new Set(OAuthScopes);
          const unionScopes = Array.from(new Set([...storedScopeSet, ...requestedScopeSet])).sort();
          scopeKey = unionScopes.sort().join(' ');
          // Fall through to OAuth flow
        } else {
          // Try to refresh the token with same scopes
          const tokenUrl = `${config.apiUrl}${config.tokenEndpoint}`;
          const refreshed = await TokenStore.tryRefresh(
            { appId, provider },
            tokenUrl,
            config.clientId
          );

          if (refreshed) {
            logger.info(forceRefresh ? 'auth-service.get-token.force-refreshed' : 'auth-service.get-token.refreshed', { appId });
            return { accessToken: refreshed.accessToken, expiresAt: refreshed.expiresAt, sub: this.parseSubClaim(refreshed.accessToken) };
          }
          // Refresh failed - fall through to new OAuth flow
        }
      }
    }

    // Need user authentication - generate PKCE and throw
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);
    const state = generateState();

    // Store PKCE state
    pkceStateStore.set(state, {
      appId,
      codeVerifier,
      scopes: OAuthScopes,
      redirectUri,
      createdAt: Date.now(),
    });

    // Build authorization URL
    const authParams = new URLSearchParams({
      response_type: 'code',
      client_id: config.clientId,
      redirect_uri: redirectUri,
      scope: scopeKey,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });

    const authRedirectUrl = `${config.apiUrl}${config.authEndpoint}?${authParams.toString()}`;

    logger.info('auth-service.get-token.auth-required', {
      appId,
      authEndpoint: `${config.apiUrl}${config.authEndpoint}`,
      scopes: OAuthScopes,
      scopeKey,
      redirectUri,
      // Don't log state value for security - it's sensitive PKCE flow state
    });

    throw new AuthRequiredError(authRedirectUrl, state, OAuthScopes);
  }

  /**
   * Exchange authorization code for access token
   *
   * Called by OAuth callback endpoint after user authentication.
   * Validates PKCE state, exchanges code for tokens, saves to storage.
   *
   * @param params - Code exchange parameters
   * @param params.code - Authorization code from OAuth provider
   * @param params.state - State parameter for CSRF protection (must match stored state)
   * @returns Promise resolving to access token and expiration timestamp
   * @throws {Error} If state is invalid or token exchange fails
   *
   * @example
   * ```typescript
   * // In OAuth callback route handler
   * const { code, state } = req.query;
   * const { accessToken, expiresAt } = await AuthService.exchangeCode({
   *   code: code as string,
   *   state: state as string
   * });
   * // Tokens are now saved in storage, user can close window
   * ```
   */
  static async exchangeCode(params: {
    code: string;
    state: string;
  }): Promise<{ accessToken: string; expiresAt: number; sub?: string }> {
    const config = getConfig();
    const { code, state } = params;

    logger.info('auth-service.exchange-code.start', {
      // Don't log state value for security
    });

    // Retrieve and validate PKCE state
    const pkceState = pkceStateStore.get(state);
    if (!pkceState) {
      logger.error('auth-service.exchange-code.invalid-state', {
        // Don't log state value for security
      });
      throw new Error('Invalid state parameter');
    }

    // Validate state hasn't expired (10 minute TTL)
    const stateAge = Date.now() - pkceState.createdAt;
    if (stateAge > 10 * 60 * 1000) {
      logger.error('auth-service.exchange-code.expired-state', {
        ageMinutes: Math.floor(stateAge / 60000),
      });
      pkceStateStore.delete(state); // Lazy cleanup
      throw new Error('OAuth state has expired. Please restart authentication.');
    }

    const { appId, codeVerifier, scopes, redirectUri } = pkceState;

    // Exchange code for tokens
    const tokenUrl = `${config.apiUrl}${config.tokenEndpoint}`;
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    });

    try {
      const response = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
          'User-Agent': 'GoDaddy-Airo-AppBuilder Agent OAuth-Tool v1',
        },
        body: body.toString(),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error('auth-service.exchange-code.failed', {
          status: response.status,
          error: errorText,
        });
        throw new Error(`Token exchange failed: ${response.status}`);
      }

      const tokenData = (await response.json()) as {
        access_token: string;
        refresh_token?: string;
        expires_in: number;
        scope?: string;
        token_type: string;
      };

      // Validate that granted scopes match requested scopes
      if (tokenData.scope) {
        const grantedScopes = new Set(tokenData.scope.split(' ').filter(Boolean));
        const requestedScopes = new Set(scopes);
        const missingScopes = [...requestedScopes].filter((s) => !grantedScopes.has(s));

        if (missingScopes.length > 0) {
          logger.error('auth-service.exchange-code.scope-mismatch', {
            appId,
            requested: scopes,
            granted: Array.from(grantedScopes),
            missing: missingScopes,
          });
          throw new Error(`Token granted missing required scopes: ${missingScopes.join(', ')}`);
        }
      }

      const expiresAt = Date.now() + tokenData.expires_in * 1000;

      // Save tokens to storage
      // Each app has only ONE token per provider - this replaces any existing token
      TokenStore.save(
        { appId, provider: 'godaddy' },
        {
          accessToken: tokenData.access_token,
          ...(tokenData.refresh_token && { refreshToken: tokenData.refresh_token }),
          expiresAt,
          scopes: scopes.sort().join(' '),
        }
      );

      // Clean up PKCE state
      pkceStateStore.delete(state);

      logger.info('auth-service.exchange-code.success', {
        appId,
        hasRefreshToken: !!tokenData.refresh_token,
      });

      // Emit OAuth result via WebSocket
      const io = getSocketIO();
      if (io) {
        io.emit('oauth:result', {
          success: true,
          appId,
          state,
          provider: 'godaddy',
          expiresAt,
          scopes: [...new Set(scopes)].sort(),
        });
        logger.info('auth-service.oauth-result.emitted', {
          appId,
          state,
        });
      } else {
        logger.warn('auth-service.oauth-result.no-socket', {
          message: 'Socket.IO not available to emit oauth:result',
          appId,
        });
      }

      return { accessToken: tokenData.access_token, expiresAt, sub: this.parseSubClaim(tokenData.access_token) };
    } catch (err) {
      logger.error('auth-service.exchange-code.error', {
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }
}
