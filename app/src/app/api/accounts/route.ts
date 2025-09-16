import { NextRequest, NextResponse } from 'next/server';
import { AccountAdapterFactory } from '@/lib/account-adapters/AccountAdapterFactory';
import { 
  withCustomerAuth, 
  customerHasAccount,
  canAccessOwnAccount,
  createCustomerAuthError,
  type CustomerAuthContext 
} from '@/lib/customer-auth';
import { logger } from '@/lib/request-context';

// GET /api/accounts?shopper_id=xxx - Get authenticated customer's own account only
export const GET = withCustomerAuth(async (request: NextRequest, authContext: CustomerAuthContext) => {
  try {
    const { searchParams } = new URL(request.url);
    const shopperId = searchParams.get('shopper_id');
    const { user } = authContext;

    // shopper_id parameter is required
    if (!shopperId) {
      return NextResponse.json(
        { error: 'shopper_id parameter is required' },
        { status: 400 }
      );
    }

    // Get account adapter and check access permissions
    const accountAdapter = AccountAdapterFactory.getInstance();
    
    // Customer can only access their own account (if auth is required)
    if (accountAdapter.requiresAuth() && !canAccessOwnAccount(user, shopperId)) {
      return createCustomerAuthError('You can only access your own account', 403);
    }

    // Get specific account with plan details (includes plan_name, plan_site_limit, plan_price)
    const account = await accountAdapter.getAccountWithPlan(shopperId);
    
    if (!account) {
      return NextResponse.json(
        { error: 'Account not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      account // Contains: account info + plan_name + plan_site_limit + plan_price
    });
    
  } catch (error) {
    logger.error('Error fetching account:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
});

// POST /api/accounts - Create new account for authenticated customer who doesn't have one
export const POST = withCustomerAuth(async (request: NextRequest, authContext: CustomerAuthContext) => {
  try {
    const { user } = authContext;

    // Get account adapter
    const accountAdapter = AccountAdapterFactory.getInstance();
    
    // Check if customer already has an account (if auth is required)
    if (accountAdapter.requiresAuth() && customerHasAccount(user)) {
      return createCustomerAuthError('You already have an account with us', 409);
    }

    // Double-check by querying adapter (in case account was created since token was issued)
    const existingAccount = await accountAdapter.getAccountByShopperId(user.shopperId);
    if (existingAccount) {
      return createCustomerAuthError('Account already exists for your shopper ID', 409);
    }

    // Create new account using authenticated user's information
    const newAccount = await accountAdapter.createAccount(user.shopperId, user.customerId);

    logger.info('accounts.create.success', { message: 'New account created for authenticated customer', accountId: newAccount.id });

    return NextResponse.json({
      success: true,
      account: newAccount,
      message: 'Account created successfully'
    }, { status: 201 });

  } catch (error) {
    logger.error('Error creating account:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
});

// PATCH /api/accounts?shopper_id=xxx - Update authenticated customer's own account only  
export const PATCH = withCustomerAuth(async (request: NextRequest, authContext: CustomerAuthContext) => {
  try {
    const { searchParams } = new URL(request.url);
    const shopperId = searchParams.get('shopper_id');
    const { user } = authContext;
    
    // shopper_id parameter is required
    if (!shopperId) {
      return NextResponse.json(
        { error: 'shopper_id parameter is required' },
        { status: 400 }
      );
    }

    // Get account adapter and check access permissions
    const accountAdapter = AccountAdapterFactory.getInstance();
    
    // Customer can only update their own account (if auth is required)
    if (accountAdapter.requiresAuth() && !canAccessOwnAccount(user, shopperId)) {
      return createCustomerAuthError('You can only update your own account', 403);
    }

    const body = await request.json();
    const { status } = body;

    // Validate status field (customers can manage basic account status)
    if (!status || !['active', 'suspended', 'closed'].includes(status)) {
      return NextResponse.json(
        { error: 'Valid status is required (active, suspended, closed)' },
        { status: 400 }
      );
    }

    const updated = await accountAdapter.updateAccountStatus(shopperId, status);
    
    if (!updated) {
      return NextResponse.json(
        { error: 'Account not found or not updated' },
        { status: 404 }
      );
    }

    // Get updated account
    const updatedAccount = await accountAdapter.getAccountByShopperId(shopperId);

    logger.info('accounts.update.success', { message: 'Account updated by authenticated customer', newStatus: status });

    return NextResponse.json({
      success: true,
      account: updatedAccount,
      message: 'Account status updated successfully'
    });

  } catch (error) {
    logger.error('Error updating account:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
});
