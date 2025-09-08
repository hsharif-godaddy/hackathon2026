import { NextRequest, NextResponse } from 'next/server';
import { PrismaSiteService } from '@/lib/database/prisma-site-service';
import { 
  withCustomerAuth, 
  customerHasAccount,
  createCustomerAuthError,
  type CustomerAuthContext 
} from '@/lib/customer-auth';

// POST /api/sites/quick-create - Fast site creation (database record only)
export const POST = withCustomerAuth(async (request: NextRequest, authContext: CustomerAuthContext) => {
  try {
    const body = await request.json();
    const { prompt, initialPrompt } = body;
    const { user } = authContext;

    // Customer must have an account to create sites
    if (!customerHasAccount(user)) {
      return createCustomerAuthError('You must have an account to create sites. Please create an account first.', 403);
    }

    // Accept either prompt or initialPrompt
    const projectPrompt = prompt || initialPrompt;
    if (!projectPrompt) {
      return NextResponse.json(
        { error: 'prompt or initialPrompt is required' },
        { status: 400 }
      );
    }

    // Use authenticated user's account ID
    const account_id = user.accountId!;

    console.log('🚀 Quick creating site record for account:', account_id);

    // Create ONLY the database record - no deployment
    const siteService = new PrismaSiteService();
    const site = await siteService.createSiteSimple({
      account_id,
      initial_prompt: projectPrompt.trim()
    });

    console.log('✅ Site record created quickly:', site.id);

    return NextResponse.json({
      id: site.id,
      name: site.title,
      status: site.status,
      account_id: site.account_id,
      created_at: site.created_at,
      updated_at: site.updated_at
    }, { status: 201 });

  } catch (error) {
    console.error('❌ Quick site creation failed:', error);
    return NextResponse.json(
      {
        error: 'Failed to create site record',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
});