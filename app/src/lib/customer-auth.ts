/**
 * Customer Authentication Middleware
 * Uses Gasket shopper tokens for customer access control
 */

import { NextRequest, NextResponse } from 'next/server';
// Lazy import to avoid initializing gd-auth during module loading
import { AccountAdapterFactory } from '@/lib/account-adapters/AccountAdapterFactory';
import { isAuthDisabled } from '@/lib/gasket-config';
import { isFeatureEnabled } from '@/lib/features';
import { MOCK_USER } from '@/lib/mock-auth';
import { RequestContextService, type RequestContext, logger } from '@/lib/request-context';
import { randomUUID } from 'crypto';
import { isTokenTooOld, getTokenAgeMinutes } from '@/lib/auth/token-refresh';

/**
 * Error message for shopper ID authorization failure
 * Used consistently across authentication checks to trigger coming-soon page redirect
 */
export const SHOPPER_AUTH_FAILURE_MESSAGE = 'Your account does not have authorization to access this application.';

// Use account adapter factory to get the appropriate service for the environment
function getAccountService() {
  return AccountAdapterFactory.getInstance();
}

export interface CustomerUser {
  shopperId: string;
  customerId: string;
  accountId?: string; // May not exist for new customers
  exp?: number;
  iat?: number;
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
export async function authenticateCustomer(request: NextRequest): Promise<CustomerRequestContext> {
  try {
    // Handle mock authentication first
    if (isFeatureEnabled.mockLogin()) {
      // Customer auth logging disabled - too noisy in development

      // Use mock user credentials
      const mockShopperId = MOCK_USER.id;
      const mockCustomerId = MOCK_USER.id;
      let mockAccount = await getAccountService().getAccountByShopperId(mockShopperId);

      // The account should already exist (created by ensureTestUserExists)
      if (!mockAccount) {
        logger.info('auth.mock.account.create', { message: 'Creating mock account for customer auth', mockShopperId, mockCustomerId });
        try {
          mockAccount = await getAccountService().createAccount(mockShopperId, mockCustomerId);
          logger.info('auth.mock.account.success', { message: 'Mock account created', accountId: mockAccount.id });
        } catch (error: any) {
          if (error.message.includes('UNIQUE constraint failed')) {
            mockAccount = await getAccountService().getAccountByShopperId(mockCustomerId);
            logger.info('auth.mock.account.found', { message: 'Mock account found', accountId: mockAccount?.id });
          } else {
            throw error;
          }
        }
      }

      return {
        isAuthenticated: true,
        user: {
          shopperId: mockShopperId,
          customerId: mockCustomerId,
          accountId: mockAccount?.id,
          exp: Math.floor(Date.now() / 1000) + 3600,
          iat: Math.floor(Date.now() / 1000)
        },
        jwt: 'mock-jwt-token' // Mock JWT for development
      };
    }

    // Skip JWT validation if auth is disabled in development
    if (await isAuthDisabled()) {
      logger.info('auth.dev.bypass', 'Customer auth bypassed - development mode');

      // Ensure dev account exists in database
      const devShopperId = 'dev-user';
      const devCustomerId = 'dev-customer-123';
      let devAccount = await getAccountService().getAccountByShopperId(devShopperId);

      // Create dev account if it doesn't exist
      if (!devAccount) {
        logger.info('auth.dev.account.create', { message: 'Creating dev account for testing', devShopperId, devCustomerId });
        try {
          devAccount = await getAccountService().createAccount(devShopperId, devCustomerId);
          logger.info('auth.dev.account.success', { message: 'Dev account created', accountId: devAccount.id });
        } catch (error: any) {
          // Account might already exist, try to find it
          if (error.message.includes('UNIQUE constraint failed')) {
            devAccount = await getAccountService().getAccountByShopperId(devCustomerId);
            logger.info('auth.dev.account.found', { message: 'Dev account found', accountId: devAccount?.id });
          } else {
            throw error;
          }
        }
      }

      return {
        isAuthenticated: true,
        user: {
          shopperId: devShopperId,
          customerId: devCustomerId,
          accountId: devAccount?.id, // Use actual account ID from database
          exp: Math.floor(Date.now() / 1000) + 3600,
          iat: Math.floor(Date.now() / 1000)
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

    // Use gd-auth for authentication (includes automatic heartbeat)
    logger.info('auth.gdauth.validate.start', 'Using gd-auth for validation');
    const result = await gdAuthService.authenticate(token);
    if (!result.valid || !result.payload) {
      logger.error('auth.gdauth.validate.failed', { message: 'gd-auth validation failed', reason: result.reason });
      return {
        isAuthenticated: false,
        user: null,
        error: result.reason || 'Invalid or expired token'
      };
    }

    logger.info('auth.gdauth.validate.success', 'gd-auth validation successful');

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

    // NOTE: Shopper ID authorization check removed from authentication
    // Users are allowed to login regardless of shopper ID criteria
    // Authorization check happens after login (see isShopperAuthorized function)
    logger.info('auth.login.success', {
      message: 'User authenticated successfully',
      shopperId,
      environment: process.env.ENVIRONMENT_NAME
    });

    // Get or create account for the authenticated shopper
    let account = await getAccountService().getAccountByShopperId(shopperId);

    // If not found by shopperId, try by customerId
    if (!account || !account.id) {
      account = await getAccountService().getAccountByShopperId(customerId);
    }

    if (!account || !account.id) {
      try {
        account = await getAccountService().createAccount(shopperId, customerId);
      } catch (error: any) {
        // If creation fails due to duplicate customer_id, find the existing account
        if (error.message.includes('UNIQUE constraint failed: accounts.customer_id')) {
          account = await getAccountService().getAccountByShopperId(customerId);
        }
        if (!account || !account.id) {
          throw error;
        }
      }
    }

    const user: CustomerUser = {
      shopperId,
      customerId: customerId || shopperId,
      accountId: account.id,
      exp: result.payload.exp,
      iat: result.payload.iat
    };

    // Check if token is too old for gateway
    if (isTokenTooOld(token)) {
      const tokenAge = getTokenAgeMinutes(token);
      logger.warn('auth.token.too-old', {
        message: 'JWT token too old for gateway, will likely be rejected',
        tokenAge,
        customerId,
        shopperId,
        recommendation: 'Client should refresh token'
      });
      
      // Still return the token, but log the warning
      // The client-side code should handle refresh
    }
    
    // Debug: Log JWT token info for troubleshooting mgmt-airo auth issues
    logger.info('auth.jwt.debug', {
      message: 'JWT token extracted for mgmt-airo calls',
      tokenLength: token?.length || 0,
      tokenPrefix: token?.substring(0, 20) + '...',
      tokenAge: getTokenAgeMinutes(token),
      customerId,
      shopperId
    });

    return {
      isAuthenticated: true,
      user,
      jwt: token // Include raw JWT for downstream API calls (e.g., mgmt-airo)
    };

  } catch (error) {
    logger.error('auth.error', { message: 'Customer authentication error', errorMessage: error instanceof Error ? error.message : 'Unknown error' });
    return {
      isAuthenticated: false,
      user: null,
      error: `Authentication failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

/**
 * Check if a shopper is authorized to use the application
 * 
 * In production, checks if shopper ID meets authorization criteria.
 * Returns authorization status without blocking authentication.
 * 
 * @param shopperId - The shopper ID to check
 * @returns true if authorized, false otherwise
 */
export function isShopperAuthorized(shopperId: string): boolean {
  // In non-production environments, all shoppers are authorized
  if (process.env.ENVIRONMENT_NAME !== 'production') {
    return true;
  }

  // Production: Check if shopper ID meets criteria (length === 3)
  const isAuthorized = shopperId.length === 3;
  
  logger.info('auth.shopper.authorization-check', {
    message: 'Shopper authorization check',
    shopperId,
    isAuthorized,
    expectedLength: 3,
    actualLength: shopperId.length
  });
  
  return isAuthorized;
}

/**
 * Middleware wrapper for API routes requiring customer authentication
 */
export function withCustomerAuth<T extends unknown[]>(
  handler: (request: NextRequest, context: CustomerAuthContext, ...args: T) => Promise<NextResponse>
) {
  return async (request: NextRequest, ...args: T): Promise<NextResponse> => {
    const authContext = await authenticateCustomer(request);

    if (!authContext.isAuthenticated) {
      const errorMessage = (authContext as UnauthenticatedCustomerContext).error;
      
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
      customerId: authContext.user.customerId,
      requestId: randomUUID()
    };

    // Run the handler within the request context
    return RequestContextService.run(requestContext, () => {
      return handler(request, authContext, ...args);
    });
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
  return NextResponse.json(
    {
      error: status === 401 ? 'Unauthorized' : 'Forbidden',
      message,
      requiresAuth: status === 401,
      customerOnly: true
    },
    { status }
  );
}
