import { NextRequest, NextResponse } from 'next/server';

import { enforceAabMultiUserVentureRelation } from '@/lib/authz-fga/enforce-venture-relation';
import { resolveMultiUserFlag } from '@/lib/authz-fga/multi-user-flag';
import { AUTHZ_FGA_RELATIONS } from '@/lib/authz-fga/relations';
import { getControlPlaneAdapter } from '@/lib/control-plane';
import { createCustomerAuthError, type CustomerAuthContext, customerHasAccount, withCustomerAuth } from '@/lib/customer-auth';
import { logger } from '@/lib/request-context';

/**
 * Sync secrets from source variant to destination variant
 *
 * Copies all non-system-managed secrets from source to destination:
 * - Adds secrets that exist only in source
 * - Updates secrets that have different values
 * - Deletes secrets that exist only in destination
 *
 * @route POST /api/secrets/:appId/sync
 *
 * @example
 * POST /api/secrets/0uda0atvh5/sync
 * Body: {
 *   "source": "preview",
 *   "destination": "publish"
 * }
 *
 * Response (200 OK):
 * {
 *   "success": true,
 *   "message": "Secrets synced successfully",
 *   "operations": {
 *     "added": 2,
 *     "updated": 1,
 *     "deleted": 0
 *   }
 * }
 *
 * @param request - Next.js request object
 * @param authContext - Customer authentication context
 * @param params - Route parameters containing appId
 * @returns Operation results with counts
 */
export const POST = withCustomerAuth(async (
  request: NextRequest,
  authContext: CustomerAuthContext,
  { params }: { params: Promise<{ appId: string }> }
) => {
  try {
    const { user } = authContext;
    const { appId } = await params;

    // Customer must have an account
    if (!customerHasAccount(user)) {
      return createCustomerAuthError('You must have an account to sync secrets', 403);
    }

    logger.info('api.secrets.sync.start', {
      appId,
      customerId: user.customerId
    });

    // Validate appId
    if (!appId) {
      return NextResponse.json({ error: 'App ID is required' }, { status: 400 });
    }

    // JWT required
    if (!authContext.jwt) {
      return NextResponse.json({ error: 'Authentication token required' }, { status: 401 });
    }

    const adapter = getControlPlaneAdapter();
    const multiUserEnabled = await resolveMultiUserFlag(request);
    const site = await adapter.getSite(appId, authContext.jwt, undefined, { multiUserEnabled });
    if (!site) {
      return NextResponse.json({ error: 'Site not found' }, { status: 404 });
    }
    const secretsSyncDeny = await enforceAabMultiUserVentureRelation({
      request,
      siteId: appId,
      customerId: user.customerId,
      siteInfo: site,
      relation: AUTHZ_FGA_RELATIONS.canManageSecrets,
      forbiddenMessage: 'You do not have permission to sync secrets for this app.',
    });
    if (secretsSyncDeny) {
      return secretsSyncDeny;
    }

    // Parse request body
    let body;
    try {
      body = await request.json();
    } catch (error) {
      return NextResponse.json(
        { error: 'Invalid JSON in request body' },
        { status: 400 }
      );
    }

    const { source: sourceVariant, destination: destinationVariant } = body;

    // Validate required parameters
    if (!sourceVariant || !destinationVariant) {
      return NextResponse.json(
        { error: 'Missing required body parameters: source and destination' },
        { status: 400 }
      );
    }

    // Validate variant values
    if (!['preview', 'publish'].includes(sourceVariant)) {
      return NextResponse.json(
        { error: 'Invalid source variant. Must be "preview" or "publish"' },
        { status: 400 }
      );
    }

    if (!['preview', 'publish'].includes(destinationVariant)) {
      return NextResponse.json(
        { error: 'Invalid destination variant. Must be "preview" or "publish"' },
        { status: 400 }
      );
    }

    // Check if variants are the same
    if (sourceVariant === destinationVariant) {
      return NextResponse.json(
        { error: 'Source and destination variants must be different' },
        { status: 400 }
      );
    }

    // Get control plane adapter and sync secrets
    logger.info('api.secrets.sync.syncing', {
      appId,
      sourceVariant,
      destinationVariant
    });

    const result = await adapter.syncSecrets(
      appId,
      sourceVariant as 'preview' | 'publish',
      destinationVariant as 'preview' | 'publish',
      authContext.jwt
    );

    logger.info('api.secrets.sync.success', {
      appId,
      sourceVariant,
      destinationVariant,
      added: result.operations.added,
      updated: result.operations.updated,
      deleted: result.operations.deleted
    });

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    logger.error('api.secrets.sync.error', {
      error: error instanceof Error ? error.message : String(error)
    });

    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to sync secrets',
        operations: {
          added: 0,
          updated: 0,
          deleted: 0
        }
      },
      { status: 500 }
    );
  }
}, { level: 3 });
