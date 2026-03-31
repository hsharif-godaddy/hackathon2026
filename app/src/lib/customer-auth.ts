/**
 * Customer Authentication Middleware
 * Uses Gasket shopper tokens for customer access control
 */

import { NextRequest, NextResponse } from 'next/server';
import type { AuthType } from '@airo/shared/auth';

import {
  addApmContext,
  extractAppIdFromPath,
  setApmAppId,
  setApmCustomerId,
  setApmJobId,
  setApmUserContext,
  startApmTransaction
} from '@/lib/apm-context';
import { isFeatureEnabled } from '@/lib/features';
import { isAuthDisabled } from '@/lib/gasket-config';
import { MOCK_USER } from '@/lib/mock-auth';
import { logger, type RequestContext, RequestContextService } from '@/lib/request-context';

/**
 * Set appId on the current APM transaction for correlation
 * Call this from API routes that have access to appId
 */
export function setSpanAppId(appId: string): void {
  setApmAppId(appId);
}

/**
 * Set customerId on the current APM transaction for correlation
 */
export function setSpanCustomerId(customerId: string): void {
  setApmCustomerId(customerId);
}

/**
 * Set jobId on the current APM transaction for correlation
 * Used when appId is not yet available (e.g., during async job creation)
 */
export function setSpanJobId(jobId: string): void {
  setApmJobId(jobId);
}

/**
 * Error message for shopper ID authorization failure
 * Used consistently across authentication checks to trigger coming-soon page redirect
 */
export const SHOPPER_AUTH_FAILURE_MESSAGE = 'Your account does not have authorization to access this application.';

/**
 * Simple account service that derives accountId from customer identity.
 * In V2, account management is handled by mgmt-airo; we just need to return
 * an account-like object so customerHasAccount() returns true.
 */
function getOrCreateAccount(_shopperId: string, customerId: string): { id: string } {
  return { id: customerId };
}

export interface CustomerUser {
  shopperId: string;
  customerId: string;
  accountId?: string; // May not exist for new customers
  exp?: number;
  iat?: number;
  authType?: AuthType; // Authentication type: basic (normal), e2s (employee impersonation), s2s (shopper delegation)
  isE2S?: boolean; // DEPRECATED: Use authType === 'e2s' instead. Only true for e2s (care), NOT s2s (delegation)
}

export interface CustomerAuthContext {
  user: CustomerUser;
  isAuthenticated: true;
  jwt?: string; // Raw JWT token for downstream API calls
}

export interface UnauthenticatedCustomerContext {
  user: null;
  isAuthenticated: false;
  error: string;
}

export type CustomerRequestContext = CustomerAuthContext | UnauthenticatedCustomerContext;

/**
 * Customer authentication using Gasket shopper tokens
 */
export async function authenticateCustomer(request: NextRequest, level?: 1 | 2 | 3): Promise<CustomerRequestContext> {
  try {
    // Handle mock authentication first
    if (isFeatureEnabled.mockLogin()) {
      // Customer auth logging disabled - too noisy in development

      // Use mock user credentials
      const mockShopperId = MOCK_USER.id;
      const mockCustomerId = MOCK_USER.id;

      const mockAccount = getOrCreateAccount(mockShopperId, mockCustomerId);
      logger.info('auth.mock.account.ready', { message: 'Mock account ready for customer auth', accountId: mockAccount.id }, { tags: ['security'] });

      return {
        isAuthenticated: true,
        user: {
          shopperId: mockShopperId,
          customerId: mockCustomerId,
          accountId: mockAccount?.id,
          exp: Math.floor(Date.now() / 1000) + 3600,
          iat: Math.floor(Date.now() / 1000),
          isE2S: false
        },
        jwt: 'mock-jwt-token' // Mock JWT for development
      };
    }

    // Skip JWT validation if auth is disabled in development
    if (await isAuthDisabled()) {
      logger.info('auth.dev.bypass', 'Customer auth bypassed - development mode', { tags: ['security'] });

      // Derive dev account from hardcoded dev identity
      const devShopperId = 'dev-user';
      const devCustomerId = 'dev-customer-123';

      const devAccount = getOrCreateAccount(devShopperId, devCustomerId);
      logger.info('auth.dev.account.ready', { message: 'Dev account ready for testing', accountId: devAccount.id }, { tags: ['security'] });

      return {
        isAuthenticated: true,
        user: {
          shopperId: devShopperId,
          customerId: devCustomerId,
          accountId: devAccount?.id, // Derived from customerId
          exp: Math.floor(Date.now() / 1000) + 3600,
          iat: Math.floor(Date.now() / 1000),
          isE2S: false
        },
        jwt: 'dev-jwt-token' // Dev JWT for development
      };
    }

    // Extract shopper token using gd-auth service (lazy import)
    const { gdAuthService } = await import('@/lib/gd-auth-service');
    const token = gdAuthService.extractTokenFromRequest(request);
    if (!token) {
      return {
        isAuthenticated: false,
        user: null,
        error: 'No authentication token provided. Please log in.'
      };
    }

    // Use gd-auth for authentication (includes automatic heartbeat and expiration checking)
    // Default level 2: IAT <= 30 days (persistent) or <= 12 hours (non-persistent)
    // Level 3 (sensitive ops): HBI <= 12 hours (requires recent heartbeat)
    const result = await gdAuthService.authenticate(token, level);
    if (!result.valid || !result.payload) {
      logger.warn('auth.gdauth.validate.failed', { reason: result.reason }, { tags: ['security'] });
      return {
        isAuthenticated: false,
        user: null,
        error: result.reason || 'Invalid or expired token'
      };
    }

    // Extract customer information from JWT payload
    const shopperId = result.payload.shopperId as string;
    const customerId = result.payload.cid as string;

    if (!shopperId) {
      return {
        isAuthenticated: false,
        user: null,
        error: 'Invalid token: missing shopper ID'
      };
    }

    if (!customerId) {
      return {
        isAuthenticated: false,
        user: null,
        error: 'Invalid token: missing customer ID'
      };
    }

    // Derive accountId from customerId (pure mapping, no persistence)
    const account = getOrCreateAccount(shopperId, customerId);

    const authType = result.payload.authType || 'basic';
    const now = Math.floor(Date.now() / 1000);
    const user: CustomerUser = {
      shopperId,
      customerId: customerId || shopperId,
      accountId: account.id,
      exp: result.payload.exp,
      iat: result.payload.iat,
      authType,
      isE2S: authType === 'e2s' // Only true for e2s (care), NOT s2s (delegation) - s2s uses customer grants
    };

    logger.info('auth.validated', {
      message: 'Customer authenticated',
      authType,
      level: level ?? 2,
      tokenAge: result.payload.iat ? now - result.payload.iat : undefined,
      isPersistent: result.payload.per ?? undefined,
      customerId
    }, { tags: ['security'] });

    return {
      isAuthenticated: true,
      user,
      jwt: token // Include raw JWT for downstream API calls (e.g., mgmt-airo)
    };

  } catch (error) {
    logger.error('auth.error', { message: 'Customer authentication error', errorMessage: error instanceof Error ? error.message : 'Unknown error' }, { tags: ['security'] });
    return {
      isAuthenticated: false,
      user: null,
      error: `Authentication failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

/**
 * Middleware wrapper for API routes requiring customer authentication
 *
 * APM context behavior:
 * - Starts an APM transaction with the route name
 * - Sets a best-effort UNVERIFIED cid early (before auth) to help debug 401s
 * - Sets verified cid/appId labels after successful authentication
 * - The early unverified cid is for observability only, not a security signal
 */
interface WithCustomerAuthOptions {
  level?: 1 | 2 | 3;
}

export function withCustomerAuth<T extends unknown[]>(
  handler: (request: NextRequest, context: CustomerAuthContext, ...args: T) => Promise<NextResponse>,
  options?: WithCustomerAuthOptions
) {
  return async (request: NextRequest, ...args: T): Promise<NextResponse> => {
    // Start APM transaction for this API request
    const urlPath = new URL(request.url).pathname;
    const txName = `${request.method} ${urlPath}`;
    const transaction = startApmTransaction(txName, 'request');

    // Track if we set cid early (before auth) - used to avoid redundant label setting
    let cidSetEarly = false;

    // EARLY: Extract cid from token BEFORE authentication (best-effort for APM)
    // This ensures cid is set even when auth fails (401), helping debug auth issues
    // Use standalone functions to avoid instantiating auth service when no token exists
    try {
      const { extractTokenFromRequest, decodeTokenPayload } = await import('@/lib/gd-auth-service');
      const token = extractTokenFromRequest(request);
      if (token && transaction) {
        const claims = decodeTokenPayload(token);
        if (claims?.cid) {
          transaction.setLabel('cid', claims.cid);
          cidSetEarly = true;
        }
      }
    } catch {
      // Ignore - best effort only
    }

    try {
      const authContext = await authenticateCustomer(request, options?.level);

      if (!authContext.isAuthenticated) {
        const errorMessage = (authContext as UnauthenticatedCustomerContext).error;

        transaction?.end('HTTP 401');
        return NextResponse.json(
          {
            error: 'Unauthorized',
            message: errorMessage,
            requiresAuth: true
          },
          { status: 401 }
        );
      }

      // Set up request context for the entire request lifecycle
      const requestContext: RequestContext = {
        customerId: authContext.user.customerId
      };

      // Set APM labels directly on the transaction object we captured
      // This avoids async context issues that can occur with agent-level APIs
      // Only set cid if not already set early (validated cid should match early cid)
      if (transaction && !cidSetEarly) {
        transaction.setLabel('cid', authContext.user.customerId);
      }

      // Always set appId when present (not dependent on cidSetEarly)
      if (transaction) {
        const appIdFromPath = extractAppIdFromPath(request.url);
        if (appIdFromPath) {
          transaction.setLabel('appId', appIdFromPath);
        }

        // Set delegated label for employee-to-shopper impersonation
        if (authContext.user.authType === 'e2s') {
          transaction.setLabel('delegated', true);
        }
      }

      // Also try agent-level APIs as backup (may work if context is preserved)
      addApmContext(request, authContext);
      setApmUserContext(authContext.user.customerId);

      // Log level 3 access for high-impact operation tracking
      if (options?.level === 3) {
        logger.info('auth.level3.access', {
          message: 'Level 3 auth for sensitive operation',
          route: urlPath,
          method: request.method,
          customerId: authContext.user.customerId,
          authType: authContext.user.authType
        }, { tags: ['security'] });
      }

      // Run the handler within the request context
      const response = await RequestContextService.run(requestContext, () => {
        return handler(request, authContext, ...args);
      });

      // End transaction with appropriate result based on response status
      const status = response.status;
      if (status >= 200 && status < 300) {
        transaction?.end('HTTP 2xx');
      } else if (status >= 400 && status < 500) {
        transaction?.end('HTTP 4xx');
      } else if (status >= 500) {
        transaction?.end('HTTP 5xx');
      } else {
        transaction?.end(`HTTP ${status}`);
      }

      return response;
    } catch (error) {
      // End transaction with error
      transaction?.end('error');
      throw error;
    }
  };
}

/**
 * Check if customer already has an account
 */
export function customerHasAccount(customer: CustomerUser): boolean {
  return !!customer.accountId;
}

/**
 * Check if customer can access a specific account (their own)
 */
export function canAccessOwnAccount(customer: CustomerUser, shopperId: string): boolean {
  return customer.shopperId === shopperId;
}

/**
 * Response helper for customer authorization errors
 */
export function createCustomerAuthError(message: string, status: number = 403): NextResponse {
  return createCustomerAuthErrorWithData(message, status);
}

export function createCustomerAuthErrorWithData(
  message: string,
  status: number = 403,
  data: Record<string, unknown> = {}
): NextResponse {
  return NextResponse.json(
    {
      error: status === 401 ? 'Unauthorized' : 'Forbidden',
      message,
      requiresAuth: status === 401,
      customerOnly: true,
      ...data
    },
    { status }
  );
}
