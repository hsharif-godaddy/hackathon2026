import { NextRequest, NextResponse } from 'next/server';
import { AccountService } from '@/lib/database/account-service';

const accountService = new AccountService();

// GET /api/accounts - Get all accounts or specific account by shopper_id
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const shopperId = searchParams.get('shopper_id');

    if (shopperId) {
      // Get specific account with plan details
      const account = accountService.getAccountWithPlan(shopperId);
      
      if (!account) {
        return NextResponse.json(
          { error: 'Account not found' },
          { status: 404 }
        );
      }

      return NextResponse.json({
        success: true,
        account
      });
    } else {
      // Get all accounts
      const accounts = accountService.getAllAccounts();
      
      return NextResponse.json({
        success: true,
        accounts,
        count: accounts.length
      });
    }
  } catch (error) {
    console.error('Error fetching accounts:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

// POST /api/accounts - Create new account manually (for testing/admin)
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { shopper_id, customer_id } = body;

    if (!shopper_id) {
      return NextResponse.json(
        { error: 'shopper_id is required' },
        { status: 400 }
      );
    }

    // Check if account already exists
    const existingAccount = accountService.findByShopperId(shopper_id);
    if (existingAccount) {
      return NextResponse.json(
        { error: 'Account already exists for this shopper_id' },
        { status: 409 }
      );
    }

    // Create new account
    const newAccount = accountService.createAccount(shopper_id, customer_id);

    return NextResponse.json({
      success: true,
      account: newAccount,
      message: 'Account created successfully'
    }, { status: 201 });

  } catch (error) {
    console.error('Error creating account:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

// PATCH /api/accounts?shopper_id=xxx - Update account status
export async function PATCH(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const shopperId = searchParams.get('shopper_id');
    
    if (!shopperId) {
      return NextResponse.json(
        { error: 'shopper_id parameter is required' },
        { status: 400 }
      );
    }

    const body = await request.json();
    const { status } = body;

    if (!status || !['active', 'suspended', 'closed'].includes(status)) {
      return NextResponse.json(
        { error: 'Valid status is required (active, suspended, closed)' },
        { status: 400 }
      );
    }

    const updated = accountService.updateAccountStatus(shopperId, status);
    
    if (!updated) {
      return NextResponse.json(
        { error: 'Account not found or not updated' },
        { status: 404 }
      );
    }

    // Get updated account
    const updatedAccount = accountService.findByShopperId(shopperId);

    return NextResponse.json({
      success: true,
      account: updatedAccount,
      message: 'Account status updated successfully'
    });

  } catch (error) {
    console.error('Error updating account:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
