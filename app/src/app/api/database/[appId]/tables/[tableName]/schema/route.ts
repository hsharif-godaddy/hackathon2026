import { NextRequest, NextResponse } from 'next/server';

import { agentFetch } from '@/lib/agent-fetch';
import { getControlPlaneAdapter } from '@/lib/control-plane';
import { createCustomerAuthError, type CustomerAuthContext, customerHasAccount, withCustomerAuth } from '@/lib/customer-auth';
import { logger } from '@/lib/request-context';

export const GET = withCustomerAuth(async (
	request: NextRequest,
	authContext: CustomerAuthContext,
	{ params }: { params: Promise<{ appId: string; tableName: string }> }
) => {
	try {
		const { user } = authContext;
		const { appId, tableName } = await params;

		// Customer must have an account
		if (!customerHasAccount(user)) {
			return createCustomerAuthError('You must have an account to access database operations', 403);
		}

		// Validate parameters
		if (!appId) {
			return NextResponse.json({ error: 'App ID is required' }, { status: 400 });
		}

		if (!tableName) {
			return NextResponse.json({ error: 'Table name is required' }, { status: 400 });
		}

		// JWT required
		if (!authContext.jwt) {
			return NextResponse.json({ error: 'Authentication token required' }, { status: 401 });
		}

		// Get site using control plane adapter
		const adapter = getControlPlaneAdapter();
		const site = await adapter.getSite(appId, authContext.jwt);

		if (!site) {
			return NextResponse.json({ error: 'Site not found' }, { status: 404 });
		}

		// Ensure site has agent URL
		if (!site?.agent_url) {
			throw new Error(`Site ${appId} does not have agent URL for table ${tableName}`)
		}

		// Forward request to agent service
		const agentUrl = `${site.agent_url}/apps/${appId}/database/tables/${encodeURIComponent(tableName)}/schema`;

		const response = await agentFetch(agentUrl, {
			siteId: appId,
			method: 'GET'
		});

		if (!response.ok) {
			logger.error(`Agent database/tables/schema failed: ${response.status} ${response.statusText}`);
			return NextResponse.json(
				{
					error: 'Failed to retrieve table schema',
					status: response.status
				},
				{ status: response.status }
			);
		}

		const data = await response.json();
		return NextResponse.json(data);

	} catch (error) {
		logger.error('Error fetching table schema:', error);
		return NextResponse.json(
			{ error: 'Failed to retrieve table schema' },
			{ status: 500 }
		);
	}
});
