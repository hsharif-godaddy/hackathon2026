import { NextRequest, NextResponse } from 'next/server';

import { type CustomerAuthContext, withCustomerAuth } from '@/lib/customer-auth';
import { DomainsClient } from '@/lib/domains';
import { logger } from '@/lib/request-context';

export const dynamic = 'force-dynamic';

/**
 * GET /api/domains/[customerId]/domains - Get all domains for a customer
 *
 * Returns all domains associated with the authenticated customer
 *
 * Note: The customerId parameter must match the 'cid' field in the JWT token.
 * The Domains API validates that the customerId in the URL matches the JWT's cid.
 *
 * @param request - Next.js request object
 * @param authContext - Customer authentication context
 *   - customerId: Customer ID (from URL path) - must match JWT's 'cid' field
 * @returns Domains response
 */
export const GET = withCustomerAuth(async (
  request: NextRequest,
  authContext: CustomerAuthContext
): Promise<NextResponse> => {
  try {
    if (!authContext.jwt) {
      return NextResponse.json({ error: 'Authentication token required' }, { status: 401 });
    }

    const customerId = authContext.user.customerId;

    if (!customerId) {
      logger.error('domains.api.missing-customer-id', {
        message: 'Customer ID not available in auth context'
      });
      return NextResponse.json(
        { error: 'Customer ID not available' },
        { status: 400 }
      );
    }

    // Determine environment based on current request host
    const getDomainsBaseUrl = () => {
      // Use host header first (the actual domain), fallback to request.url
      const host = request.headers.get('host') || '';

      // Check for test environment first (most specific)
      if (host.includes('test-godaddy.com')) {
        return 'https://domains.dcc.api.test-godaddy.com';
      }
      // Check for dev environment (must include "dev" prefix)
      if (host.includes('dev-godaddy.com') || host.includes('localhost')) {
        return 'https://domains.dcc.api.dev-godaddy.com';
      }
      // Production (default)
      return 'https://domainsapi.godaddy.com';
    };

    const baseUrl = getDomainsBaseUrl();
    const client = new DomainsClient({ baseUrl, jwt: authContext.jwt });

    logger.info('domains.api.start', {
      message: 'Fetching domains via API route',
      customerId,
      shopperId: authContext.user.shopperId
    });

    const response = await client.getAllDomainsForCustomer(customerId) as {
      filter: string;
      startIndex: number;
      total: number;
      pageSize: number;
      domains: Array<{ domain: string }>;
    };

    logger.info('domains.api.success', {
      message: 'Domains fetched successfully',
      count: response.domains?.length || 0,
      total: response.total
    });

    return NextResponse.json(response);

  } catch (error) {
    logger.error('domains.api.error', {
      message: 'Failed to fetch domains',
      error: error instanceof Error ? error.message : 'Unknown error'
    });

    return NextResponse.json(
      { error: 'Failed to fetch domains' },
      { status: error?.status ?? 500 }
    );
  }
});
