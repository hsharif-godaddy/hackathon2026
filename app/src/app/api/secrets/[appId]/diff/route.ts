import { NextRequest, NextResponse } from 'next/server';

import { getControlPlaneAdapter } from '@/lib/control-plane';
import { createCustomerAuthError, type CustomerAuthContext, customerHasAccount, withCustomerAuth } from '@/lib/customer-auth';
import { logger } from '@/lib/request-context';

/**
 * GET /api/secrets/:appId/diff
 *
 * Get the difference between secrets in two variants (preview and publish)
 *
 * Query Parameters:
 * - source: Source variant to compare from ('preview' or 'publish')
 * - destination: Destination variant to compare to ('preview' or 'publish')
 *
 * Returns:
 * {
 *   added: string[],      // Secrets in source but not in destination
 *   updated: string[],    // Secrets in both but with different values
 *   deleted: string[]     // Secrets in destination but not in source
 * }
 *
 * Security: Only compares non-system-managed secrets
 *
 * @example
 * ```typescript
 * // Frontend usage
 * const response = await fetch('/api/secrets/my-app-id/diff?source=preview&destination=publish');
 * const diff = await response.json();
 * // {
 * //   added: ['SECRET_E'],
 * //   updated: ['SECRET_B', 'SECRET_C'],
 * //   deleted: ['SECRET_D']
 * // }
 * ```
 */
export const GET = withCustomerAuth(async (
  request: NextRequest,
  authContext: CustomerAuthContext,
  { params }: { params: Promise<{ appId: string }> }
) => {
  try {
    const { user } = authContext;
    const { appId } = await params;
    const { searchParams } = new URL(request.url);

    // Customer must have an account
    if (!customerHasAccount(user)) {
      return createCustomerAuthError('You must have an account to compare secrets', 403);
    }

    // Validate appId
    if (!appId) {
      return NextResponse.json({ error: 'App ID is required' }, { status: 400 });
    }

    // Get query parameters
    const sourceVariant = searchParams.get('source');
    const destinationVariant = searchParams.get('destination');

    // Validate required parameters
    if (!sourceVariant || !destinationVariant) {
      return NextResponse.json(
        { error: 'Missing required query parameters: source and destination' },
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

    // JWT required
    if (!authContext.jwt) {
      return NextResponse.json({ error: 'Authentication token required' }, { status: 401 });
    }

    // Get control plane adapter and compare secrets
    const adapter = getControlPlaneAdapter();

    logger.info('Comparing secrets between variants', {
      appId,
      sourceVariant,
      destinationVariant
    });

    const diff = await adapter.compareSecrets(
      appId,
      sourceVariant as 'preview' | 'publish',
      destinationVariant as 'preview' | 'publish',
      authContext.jwt
    );

    logger.info('Secret diff completed', {
      appId,
      sourceVariant,
      destinationVariant,
      addedCount: diff.added.length,
      updatedCount: diff.updated.length,
      deletedCount: diff.deleted.length
    });

    return NextResponse.json(diff, { status: 200 });

  } catch (error) {
    logger.error('Failed to get secret diff', {
      appId: (await params).appId,
      error: error instanceof Error ? error.message : String(error)
    });

    // Handle "not implemented" errors gracefully
    if (error instanceof Error && error.message.includes('not implemented')) {
      return NextResponse.json(
        { error: 'Secret diff is not available for this app configuration' },
        { status: 501 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to get secret diff' },
      { status: 500 }
    );
  }
});
