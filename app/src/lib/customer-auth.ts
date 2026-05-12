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
import { extractTokenFromRequest } from '@/lib/gd-auth-service';
import { mgmtAiro401Response } from '@/lib/mgmt-airo/auth-error';
import { MOCK_USER } from '@/lib/mock-auth';
import { createRequestContext, logger, RequestContextService } from '@/lib/request-context';
import { extractCustomerId, extractShopperId } from '@/lib/utils/jwt-utils';

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
  hbi?: number;
  isPersistent?: boolean; // true = persistent session (30-day IAT window), false = non-persistent (12h)
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
  authReason?: number;
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

      const now = Math.floor(Date.now() / 1000);
      const mockHeader = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
      const mockPayload = Buffer.from(JSON.stringify({
        cid: mockCustomerId,
        shopperId: mockShopperId,
        iat: now,
        exp: now + 3600,
      })).toString('base64url');

      return {
        isAuthenticated: true,
        user: {
          shopperId: mockShopperId,
          customerId: mockCustomerId,
          accountId: mockAccount?.id,
          exp: now + 3600,
          iat: now,
          isE2S: false
        },
        jwt: `${mockHeader}.${mockPayload}.`
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
    // Default level 1: IAT <= 30 days (persistent) or <= 12 hours (non-persistent)
    // Level 3 (sensitive ops): HBI <= 12 hours (requires recent heartbeat)
    const result = await gdAuthService.authenticate(token, level);
    if (!result.valid || !result.payload) {
      logger.warn('auth.gdauth.validate.failed', { reason: result.reason, authReason: result.authReason }, { tags: ['security'] });
      return {
        isAuthenticated: false,
        user: null,
        error: result.reason || 'Invalid or expired token',
        ...(result.authReason !== undefined ? { authReason: result.authReason } : {})
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
      hbi: result.payload.hbi,
      isPersistent: result.payload.per as boolean | undefined,
      authType,
      isE2S: authType === 'e2s' // Only true for e2s (care), NOT s2s (delegation) - s2s uses customer grants
    };

    logger.info('auth.validated', {
      message: 'Customer authenticated',
      authType,
      level: level ?? 2,
      tokenAge: result.payload.iat ? now - result.payload.iat : undefined,
      isPersistent: result.payload.per ?? undefined,
      customerId,
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
    const txName = `${request.method} ${request.nextUrl.pathname}`;
    const transaction = startApmTransaction(txName, 'request');
    let cidSetEarly = false;

    // Initialize context early so all logs during auth automatically carry request metadata.
    // customerId/shopperId start undefined; pre-decode may fill them from the unvalidated token,
    // and auth overwrites them with verified values (or leaves them as the pre-decoded best-effort
    // on failure, so auth-failure logs still carry identifiers).
    const requestContext = createRequestContext(request);

    try {
      return await RequestContextService.run(requestContext, async () => {
        try {
          // Pre-decode token inside the inner try so unexpected throws reach auth.handler.unhandled.
          // extractCustomerId/extractShopperId return null on parse errors; they don't throw.
          const token = extractTokenFromRequest(request);
          if (token) {
            const customerId = extractCustomerId(token);
            if (customerId) {
              requestContext.customerId = customerId;
              if (transaction) {
                transaction.setLabel('cid', customerId);
                cidSetEarly = true;
              }
            }
            const shopperId = extractShopperId(token);
            if (shopperId) {
              requestContext.shopperId = shopperId;
            }
          }

          const authContext = await authenticateCustomer(request, options?.level);

          if (!authContext.isAuthenticated) {
            const unauthContext = authContext as UnauthenticatedCustomerContext;
            transaction?.end('HTTP 401');
            return NextResponse.json(
              {
                error: 'Unauthorized',
                message: unauthContext.error,
                requiresAuth: true,
                ...(unauthContext.authReason !== undefined ? { authReason: unauthContext.authReason } : {})
              },
              { status: 401 }
            );
          }

          // Overwrite pre-decoded context values with validated auth results
          const appIdFromPath = extractAppIdFromPath(request.url);
          requestContext.customerId = authContext.user.customerId;
          requestContext.shopperId = authContext.user.shopperId;
          if (appIdFromPath) requestContext.appId = appIdFromPath;
          if (authContext.user.iat !== undefined) requestContext.tokenIat = authContext.user.iat;
          if (authContext.user.hbi !== undefined) requestContext.tokenHbi = authContext.user.hbi;
          if (authContext.user.exp !== undefined) requestContext.tokenExp = authContext.user.exp;
          if (authContext.user.isPersistent !== undefined) requestContext.isPersistent = authContext.user.isPersistent;
          if (authContext.user.authType) requestContext.authType = authContext.user.authType;

          // Set APM labels directly on the transaction object we captured
          // This avoids async context issues that can occur with agent-level APIs
          if (transaction && !cidSetEarly) {
            transaction.setLabel('cid', authContext.user.customerId);
          }
          if (transaction) {
            if (appIdFromPath) {
              transaction.setLabel('appId', appIdFromPath);
            }
            if (authContext.user.authType === 'e2s') {
              transaction.setLabel('delegated', true);
            }
          }

          addApmContext(request, authContext);
          setApmUserContext(authContext.user.customerId);

          if (options?.level === 3) {
            // path, method, customerId are injected centrally from request context
            logger.info('auth.level3.access', {
              message: 'Level 3 auth for sensitive operation',
              authType: authContext.user.authType
            }, { tags: ['security'] });
          }

          const response = await handler(request, authContext, ...args);

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
          // Safety net: any uncaught mgmt-airo 401 bubbling out of a route
          // handler should surface as the standard SSO re-auth response,
          // not a generic 500. Routes with their own catch blocks should
          // still call mgmtAiro401Response explicitly so they can log a
          // route-specific event; this only catches the "forgot to handle"
          // case.
          const authResponse = mgmtAiro401Response(error, 'auth.handler.mgmt-airo.hbi-expired');
          if (authResponse) {
            transaction?.end('HTTP 401');
            return authResponse;
          }

          // Log here (inside run()) so the ALS store is still active and context fields are present
          logger.error('auth.handler.unhandled', {
            errorMessage: error instanceof Error ? error.message : String(error)
          }, { tags: ['security'], error: error instanceof Error ? error : undefined });
          throw error;
        }
      });
    } catch (error) {
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
