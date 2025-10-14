import { NextRequest, NextResponse } from 'next/server';
import { getControlPlaneAdapter } from '@/lib/control-plane';
import { logger } from '@/lib/request-context';
import {
  withCustomerAuth,
  customerHasAccount,
  createCustomerAuthError,
  isShopperAuthorized,
  type CustomerAuthContext
} from '@/lib/customer-auth';

// In-memory deployment lock to prevent concurrent deployments
const deploymentLocks = new Set<string>();

function acquireDeploymentLock(siteId: string): boolean {
  if (deploymentLocks.has(siteId)) {
    return false; // Lock already held
  }
  deploymentLocks.add(siteId);
  return true; // Lock acquired
}

function releaseDeploymentLock(siteId: string): void {
  deploymentLocks.delete(siteId);
}

// POST /api/sites/[id]/deploy - Trigger deployment for an existing site
export const POST = withCustomerAuth(async (request: NextRequest, authContext: CustomerAuthContext, { params }: { params: Promise<{ id: string }> }) => {
  try {
    const { user } = authContext;
    const { id: siteId } = await params;

    // Check shopper authorization (production only)
    if (!isShopperAuthorized(user.shopperId)) {
      logger.warn('sites.deploy.unauthorized', {
        message: 'User not authorized to deploy sites',
        shopperId: user.shopperId,
        siteId
      });
      return NextResponse.json(
        {
          error: 'Access restricted',
          message: 'Your account does not have authorization to deploy sites at this time.',
          redirectTo: '/coming-soon'
        },
        { status: 403 }
      );
    }

    // Customer must have an account to deploy sites
    if (!customerHasAccount(user)) {
      return createCustomerAuthError('You must have an account to deploy sites', 403);
    }

    if (!siteId) {
      return NextResponse.json(
        { error: 'Site ID is required' },
        { status: 400 }
      );
    }

    // Check if deployment is already in progress for this site
    if (!acquireDeploymentLock(siteId)) {
      logger.warn('deploy.concurrent.blocked', { 
        message: 'Deployment already in progress for site, blocking concurrent request', 
        siteId 
      });
      return NextResponse.json(
        { 
          error: 'Deployment already in progress', 
          message: 'Please wait for the current deployment to complete before starting a new one',
          siteId 
        },
        { status: 409 } // 409 Conflict
      );
    }

    logger.info('deploy.start', { message: 'Starting deployment for site', siteId });

    // JWT is required for both V2 and legacy auth
    if (!authContext.jwt) {
      releaseDeploymentLock(siteId);
      return NextResponse.json({ error: 'Authentication token required' }, { status: 401 });
    }

    // Use control plane adapter (automatically handles V2 vs Legacy)
    const adapter = getControlPlaneAdapter();
    const result = await adapter.deploySite(siteId, authContext.jwt);

    releaseDeploymentLock(siteId);

    return NextResponse.json(result);

  } catch (error) {
    // Extract siteId from params in catch block since it's not in scope
    const siteId = (await params).id;
    releaseDeploymentLock(siteId);
    
    logger.error('deploy.start.error', { 
      message: 'Failed to start deployment', 
      siteId, 
      errorMessage: error instanceof Error ? error.message : 'Unknown error' 
    });
    
    return NextResponse.json(
      {
        error: 'Failed to start deployment',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
});
