/**
 * Customer Authentication Middleware
 * Uses Gasket shopper tokens for customer access control
 */

import { NextRequest, NextResponse } from 'next/server';
import { gdAuthService } from '@/lib/gd-auth-service';
import { AccountService } from '@/lib/database/account-service';
import { isAuthDisabled } from '@/lib/gasket-config';
import { isFeatureEnabled } from '@/lib/features';
import { MOCK_USER } from '@/lib/mock-auth';

const accountService = new AccountService();

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
      let mockAccount = await accountService.findByShopperId(mockShopperId);
      
      // The account should already exist (created by ensureTestUserExists)
      if (!mockAccount) {
        console.log('🔧 Creating mock account for customer auth...');
        try {
          mockAccount = await accountService.createAccount(mockShopperId, mockCustomerId);
          console.log(`✅ Mock account created: ${mockAccount.id}`);
        } catch (error: any) {
          if (error.message.includes('UNIQUE constraint failed')) {
            mockAccount = await accountService.findByCustomerId(mockCustomerId);
            console.log(`✅ Mock account found: ${mockAccount?.id}`);
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
        }
      };
    }

    // Skip JWT validation if auth is disabled in development
    if (await isAuthDisabled()) {
      console.log('🔧 Customer Auth bypassed - development mode');
      
      // Ensure dev account exists in database
      const devShopperId = 'dev-user';
      const devCustomerId = 'dev-customer-123';
      let devAccount = await accountService.findByShopperId(devShopperId);
      
      // Create dev account if it doesn't exist
      if (!devAccount) {
        console.log('🔧 Creating dev account for testing...');
        try {
          devAccount = await accountService.createAccount(devShopperId, devCustomerId);
          console.log(`✅ Dev account created: ${devAccount.id}`);
        } catch (error: any) {
          // Account might already exist, try to find it
          if (error.message.includes('UNIQUE constraint failed')) {
            devAccount = await accountService.findByCustomerId(devCustomerId);
            console.log(`✅ Dev account found: ${devAccount?.id}`);
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
        }
      };
    }

    // Extract shopper token using gd-auth service
    const token = gdAuthService.extractTokenFromRequest(request);
    if (!token) {
      return {
        isAuthenticated: false,
        user: null,
        error: 'No authentication token provided. Please log in.'
      };
    }

    // Use gd-auth for authentication (includes automatic heartbeat)
    console.log('🔐 Customer auth: Using gd-auth for validation...');
    const result = await gdAuthService.authenticate(token);
    if (!result.valid || !result.payload) {
      console.log('❌ Customer auth: gd-auth validation failed:', result.reason);
      return {
        isAuthenticated: false,
        user: null,
        error: result.reason || 'Invalid or expired token'
      };
    }

    console.log('✅ Customer auth: gd-auth validation successful');

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

    // Get or create account for the authenticated shopper
    let account = await accountService.findByShopperId(shopperId);
    
    // If not found by shopperId, try by customerId
    if (!account || !account.id) {
      account = await accountService.findByCustomerId(customerId);
    }
    
    if (!account || !account.id) {
      try {
        account = await accountService.createAccount(shopperId, customerId);
      } catch (error: any) {
        // If creation fails due to duplicate customer_id, find the existing account
        if (error.message.includes('UNIQUE constraint failed: accounts.customer_id')) {
          account = await accountService.findByCustomerId(customerId);
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

    return {
      isAuthenticated: true,
      user
    };

  } catch (error) {
    console.error('Customer authentication error:', error);
    return {
      isAuthenticated: false,
      user: null,
      error: `Authentication failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
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
      return NextResponse.json(
        { 
          error: 'Unauthorized', 
          message: authContext.error,
          requiresAuth: true
        },
        { status: 401 }
      );
    }

    return handler(request, authContext, ...args);
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
