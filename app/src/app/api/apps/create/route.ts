import { NextRequest, NextResponse } from 'next/server';
import { SiteAdapterFactory } from '@/lib/site-adapters/SiteAdapterFactory';
import { v4 as uuidv4 } from 'uuid';
import { 
  withCustomerAuth, 
  customerHasAccount,
  createCustomerAuthError,
  type CustomerAuthContext 
} from '@/lib/customer-auth';
import { logger } from '@/lib/request-context';

interface CreateAppRequest {
  name: string;
  initialPrompt?: string;
}

interface CreateAppResponse {
  success: boolean;
  appId?: string;
  app?: {
    id: string;
    name: string;
    status: string;
  };
  aiGeneratedName?: string;
  nameSuggested?: boolean;
  originalName?: string;
  error?: string;
}

/**
 * POST /api/apps/create - Create app using site adapter system (authenticated)
 * This handles both production and development app creation
 */
export const POST = withCustomerAuth(async (request: NextRequest, authContext: CustomerAuthContext): Promise<NextResponse> => {
  try {
    const body: CreateAppRequest = await request.json();
    const { name, initialPrompt } = body;
    const { user } = authContext;

    // Check auth requirements
    const siteAdapter = SiteAdapterFactory.getInstance();
    if (siteAdapter.requiresAuth() && !customerHasAccount(user)) {
      return createCustomerAuthError('You must have an account to create apps', 403);
    }

    // Validate required fields
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return NextResponse.json(
        { success: false, error: 'Name is required and must be a non-empty string' },
        { status: 400 }
      );
    }

    // Generate a unique site ID
    const siteId = uuidv4();

    logger.info('apps.create.start', { message: 'Creating app via site adapter', siteId, name: name.trim() });

    let finalAppName = name.trim();
    let nameSuggested = false;
    const originalName = name.trim();
    let aiGeneratedName: string | undefined;

    // TODO: Add AI name suggestion service here if needed
    if (initialPrompt && initialPrompt.trim()) {
      logger.debug('apps.create.initial-prompt', { message: 'Initial prompt provided', siteId, promptLength: initialPrompt.length });
    }

    // Create the site using the appropriate adapter with authenticated user's account
    const site = await siteAdapter.createSite({
      siteId,
      name: finalAppName,
      initialPrompt,
      accountId: user.accountId // Use authenticated user's account
    });

    logger.info('apps.create.success', { message: 'Site created via adapter', siteId: site.id, name: site.name, status: site.status, agentUrl: site.agent_url });

    const response: CreateAppResponse = {
      success: true,
      appId: site.id, // Return the site ID as appId for compatibility
      app: {
        id: site.id,
        name: site.name,
        status: site.status
      },
      nameSuggested,
      originalName,
      ...(aiGeneratedName && { aiGeneratedName })
    };

    return NextResponse.json(response, { status: 201 });

  } catch (error) {
    logger.error('❌ Error creating app via site adapter:', error);
    
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create app'
      },
      { status: 500 }
    );
  }
});