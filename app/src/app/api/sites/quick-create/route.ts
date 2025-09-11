import { NextRequest, NextResponse } from 'next/server';
import { PrismaSiteService } from '@/lib/database/prisma-site-service';
import { 
  withCustomerAuth, 
  customerHasAccount,
  createCustomerAuthError,
  type CustomerAuthContext 
} from '@/lib/customer-auth';
import { logger } from '@/lib/request-context';

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

    logger.info('sites.quick-create.start', { message: 'Quick creating site record', account_id });

    // Create ONLY the database record - no deployment
    const siteService = new PrismaSiteService();
    const site = await siteService.createSiteSimple({
      account_id,
      initial_prompt: projectPrompt.trim()
    });

    logger.info('sites.quick-create.success', { message: 'Site record created quickly', siteId: site.id });

    return NextResponse.json({
      id: site.id,
      name: site.title,
      status: site.status,
      account_id: site.account_id,
      created_at: site.created_at,
      updated_at: site.updated_at
    }, { status: 201 });

  } catch (error) {
    logger.error('sites.quick-create.error', { message: 'Quick site creation failed', errorMessage: error instanceof Error ? error.message : 'Unknown error' });
    return NextResponse.json(
      {
        error: 'Failed to create site record',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
});