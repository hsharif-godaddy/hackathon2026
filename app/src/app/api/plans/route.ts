import { NextRequest, NextResponse } from 'next/server';
import { AccountAdapterFactory } from '@/lib/account-adapters/AccountAdapterFactory';
import { withCustomerAuth, CustomerAuthContext } from '@/lib/customer-auth';
import { logger } from '@/lib/request-context';

// Force dynamic rendering to prevent database calls during build
export const dynamic = 'force-dynamic';

// GET /api/plans - Get all available plans (authenticated customers only)
export const GET = withCustomerAuth(async (request: NextRequest, authContext: CustomerAuthContext) => { // eslint-disable-line @typescript-eslint/no-unused-vars
  try {
    const accountAdapter = AccountAdapterFactory.getInstance();
    const plans = await accountAdapter.getAllPlans();

    return NextResponse.json({
      success: true,
      plans,
      count: plans.length
    });
  } catch (error) {
    logger.error('api_plans', 'Error fetching plans', { error: error as Error });
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
