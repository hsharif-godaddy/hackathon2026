import { NextRequest, NextResponse } from 'next/server';

import { getControlPlaneAdapter } from '@/lib/control-plane';
import { handleControlPlaneError } from '@/lib/control-plane/error-handler';
import {
  createCustomerAuthError,
  type CustomerAuthContext,
  customerHasAccount,
  withCustomerAuth} from '@/lib/customer-auth';
import { logger } from '@/lib/request-context';

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
// Body (optional): { variant?: 'preview' | 'publish', resumeFromHibernation?: boolean }
export const POST = withCustomerAuth(async (request: NextRequest, authContext: CustomerAuthContext, { params }: { params: Promise<{ id: string }> }) => {
  try {
    const { user } = authContext;
    const { id: siteId } = await params;

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

    // Parse optional body parameters
    let variant: string | undefined;
    let resumeFromHibernation: boolean | undefined;
    
    try {
      const body = await request.json().catch(() => ({}));
      variant = body?.variant;
      resumeFromHibernation = body?.resumeFromHibernation;
    } catch {
      // Body is optional, ignore parse errors
    }

    logger.info('deploy.start', { 
      message: 'Starting deployment for site', 
      siteId,
      variant,
      resumeFromHibernation,
    });

    // JWT is required for both V2 and legacy auth
    if (!authContext.jwt) {
      releaseDeploymentLock(siteId);
      return NextResponse.json({ error: 'Authentication token required' }, { status: 401 });
    }

    // Use control plane adapter
    const adapter = getControlPlaneAdapter();
    const result = await adapter.deploySite(siteId, authContext.jwt, {
      variant,
      resumeFromHibernation,
    });

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

    return handleControlPlaneError(error, 'deploy');
  }
});
