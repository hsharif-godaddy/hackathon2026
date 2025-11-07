import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/request-context';
import { withCustomerAuth, customerHasAccount, createCustomerAuthError, type CustomerAuthContext } from '@/lib/customer-auth';
import { agentFetch } from '@/lib/agent-fetch';
import { SiteAdapterFactory } from '@/lib/site-adapters/SiteAdapterFactory';

export const GET = withCustomerAuth(async (
	request: NextRequest,
	authContext: CustomerAuthContext,
	{ params }: { params: Promise<{ appId: string }> }
) => {
	try {
		const { user } = authContext;
		const { appId } = await params;

		// Customer must have an account
		if (!customerHasAccount(user)) {
			return createCustomerAuthError('You must have an account to access database operations', 403);
		}

		// Validate appId
		if (!appId) {
			return NextResponse.json({ error: 'App ID is required' }, { status: 400 });
		}

		// Get site
		const siteAdapter = SiteAdapterFactory.getInstance();
		const site = await siteAdapter.getSiteById(appId);

		if (!site) {
			return NextResponse.json({ error: 'Site not found' }, { status: 404 });
		}

		// Ownership check
		if (siteAdapter.requiresAuth() && site.account_id !== user.accountId) {
			return createCustomerAuthError('You can only access your own sites', 403);
		}

		// Ensure site has agent URL
		if (!site?.agent_url) {
			throw new Error(`Site ${appId} does not have agent URL`)
		}

		// Forward request to agent service
		const agentUrl = `${site.agent_url}/apps/${appId}/database/tables`;

		const response = await agentFetch(agentUrl, {
			siteId: appId,
			method: 'GET'
		});

		if (!response.ok) {
			logger.error(`Agent database/tables failed: ${response.status} ${response.statusText}`);
			return NextResponse.json(
				{
					error: 'Failed to retrieve database tables',
					status: response.status
				},
				{ status: response.status }
			);
		}

		const data = await response.json();
		return NextResponse.json(data);

	} catch (error) {
		logger.error('Error fetching database tables:', error);
		return NextResponse.json(
			{ error: 'Failed to retrieve database tables' },
			{ status: 500 }
		);
	}
});
