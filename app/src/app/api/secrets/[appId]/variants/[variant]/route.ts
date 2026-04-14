import { NextRequest, NextResponse } from 'next/server';

import { getControlPlaneAdapter } from '@/lib/control-plane';
import { handleControlPlaneError } from '@/lib/control-plane/error-handler';
import { createCustomerAuthError, type CustomerAuthContext, customerHasAccount, withCustomerAuth } from '@/lib/customer-auth';

/**
 * Bulk operations request body
 */
interface OperationsRequest {
	operations: {
		additions?: Array<{ name: string; value: string }>;
		updates?: Array<{ name: string; value: string }>;
		deletions?: string[];
	};
}

/**
 * GET handler for fetching app secrets
 *
 * Retrieves the list of secrets configured for a specific application and variant
 * using the control plane adapter.
 *
 * @param request - The incoming Next.js request
 * @param authContext - Customer authentication context with user and JWT
 * @param params - Route parameters containing the appId and variant
 * @returns NextResponse with secrets (names, metadata, and values when mgmt-airo returns them) or error
 *
 * @example
 * ```typescript
 * // Frontend usage
 * const response = await fetch('/api/secrets/my-app-id/variants/preview');
 * const data = await response.json();
 * // {
 * //   appId: 'my-app-id',
 * //   secrets: [{ name: 'API_KEY', systemManaged: false, variants: ['preview', 'publish'], value: '…' }],
 * //   count: 1
 * // }
 * ```
 */
export const GET = withCustomerAuth(async (
	request: NextRequest,
	authContext: CustomerAuthContext,
	{ params }: { params: Promise<{ appId: string; variant: string }> }
) => {
	try {
		const { user } = authContext;
		const { appId, variant } = await params;

		// Customer must have an account
		if (!customerHasAccount(user)) {
			return createCustomerAuthError('You must have an account to access secrets', 403);
		}

		// Validate appId
		if (!appId) {
			return NextResponse.json({ error: 'App ID is required' }, { status: 400 });
		}

		// Validate variant
		if (!variant || (variant !== 'preview' && variant !== 'publish')) {
			return NextResponse.json({ error: 'Valid variant (preview or publish) is required' }, { status: 400 });
		}

		// JWT required
		if (!authContext.jwt) {
			return NextResponse.json({ error: 'Authentication token required' }, { status: 401 });
		}

		// Get secrets using control plane adapter
		const adapter = getControlPlaneAdapter();
		const result = await adapter.getSecrets(appId, variant, authContext.jwt);

		return NextResponse.json(result, {
			headers: {
				'Cache-Control': 'no-store, private',
			},
		});

	} catch (error) {
		return handleControlPlaneError(error, 'secrets.fetch');
	}
}, { level: 3 });

/**
 * POST handler for bulk secret operations
 *
 * Handles bulk operations (additions, updates, deletions) for secrets in a specific
 * application variant using the control plane adapter.
 * All operations are performed atomically - if any operation fails, none of the changes are persisted.
 *
 * Security constraints:
 * - All newly added secrets are created with SYSTEM_MANAGED: false
 * - Only secrets with SYSTEM_MANAGED: false can be updated
 * - Only secrets with SYSTEM_MANAGED: false can be deleted
 * - Attempting to modify system-managed secrets returns 403 Forbidden
 * - Additions cannot create duplicates of existing variant-specific or shared secrets
 *
 * @param request - The incoming Next.js request with operations in body
 * @param authContext - Customer authentication context with user and JWT
 * @param params - Route parameters containing the appId and variant
 * @returns NextResponse with operation results or error
 *
 * @example
 * ```typescript
 * // Frontend usage
 * const response = await fetch('/api/secrets/my-app-id/variants/preview', {
 *   method: 'POST',
 *   headers: { 'Content-Type': 'application/json' },
 *   body: JSON.stringify({
 *     operations: {
 *       additions: [
 *         { name: 'API_KEY', value: 'simple_string' },
 *         { name: 'CONFIG', value: '{"host":"localhost","port":3000}' }
 *       ],
 *       updates: [{ name: 'EXISTING_KEY', value: 'updated_value' }],
 *       deletions: ['OLD_KEY']
 *     }
 *   })
 * });
 * ```
 */
export const POST = withCustomerAuth(async (
	request: NextRequest,
	authContext: CustomerAuthContext,
	{ params }: { params: Promise<{ appId: string; variant: string }> }
) => {
	try {
		const { user } = authContext;
		const { appId, variant } = await params;

		// Customer must have an account
		if (!customerHasAccount(user)) {
			return createCustomerAuthError('You must have an account to modify secrets', 403);
		}

		// Validate appId
		if (!appId) {
			return NextResponse.json({ error: 'App ID is required' }, { status: 400 });
		}

		// Validate variant
		if (!variant || (variant !== 'preview' && variant !== 'publish')) {
			return NextResponse.json({ error: 'Valid variant (preview or publish) is required' }, { status: 400 });
		}

		// JWT required
		if (!authContext.jwt) {
			return NextResponse.json({ error: 'Authentication token required' }, { status: 401 });
		}

		// Parse request body
		const body: OperationsRequest = await request.json();
		const { operations } = body;

		if (!operations) {
			return NextResponse.json({ error: 'Operations object is required' }, { status: 400 });
		}

		// Perform operations using control plane adapter
		const adapter = getControlPlaneAdapter();
		const result = await adapter.updateSecrets(appId, variant, operations, authContext.jwt);

		return NextResponse.json(result);

	} catch (error) {
		return handleControlPlaneError(error, 'secrets.update');
	}
}, { level: 3 });
