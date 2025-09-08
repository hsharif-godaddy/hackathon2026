import { NextRequest, NextResponse } from 'next/server';
import { AccountAdapterFactory } from '@/lib/account-adapters/AccountAdapterFactory';
import { withCustomerAuth, CustomerAuthContext } from '@/lib/customer-auth';

// GET /api/plans - Get all available plans (authenticated customers only)
export const GET = withCustomerAuth(async (request: NextRequest, authContext: CustomerAuthContext) => {
  try {
    const accountAdapter = AccountAdapterFactory.getInstance();
    const plans = await accountAdapter.getAllPlans();
    
    return NextResponse.json({
      success: true,
      plans,
      count: plans.length
    });
  } catch (error) {
    console.error('Error fetching plans:', error);
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
