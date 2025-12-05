import { NextRequest, NextResponse } from 'next/server';
import { agentFetch } from '@/lib/agent-fetch';
import { logger } from '@/lib/request-context';
import { withCustomerAuth, type CustomerAuthContext } from '@/lib/customer-auth';

/**
 * Force dynamic rendering - prevent static generation
 */
export const dynamic = 'force-dynamic';

/**
 * Disable caching - always fetch fresh data
 */
export const revalidate = 0;

/**
 * Configuration for the agents service
 */
const AGENTS_CONFIG = {
  url: process.env.NEXT_PUBLIC_AGENTS_URL || 'http://localhost:4000'
};

/**
 * Check if TLA restriction should be enforced
 * Only enforced when ENVIRONMENT_NAME is 'production'
 */
function isTLARestrictionEnabled(): boolean {
  return process.env.ENVIRONMENT_NAME === 'production';
}

/**
 * Check if user is a TLA (Three Letter Acronym - internal GoDaddy employee)
 * TLA users have a shopperId with 3 or fewer characters
 *
 * @param shopperId - User's shopper ID
 * @returns True if user is a TLA
 */
function isTLAUser(shopperId: string): boolean {
  return shopperId.length <= 3;
}

/**
 * GET handler for fetching conversations from the agents service
 *
 * Retrieves all conversations for a specific app ID from the agents
 * database via the agents service API.
 *
 * Restricted to TLA users only in production environment.
 *
 * @param request - The incoming Next.js request with appId query param
 * @returns NextResponse with conversations data or error
 *
 * @example
 * ```typescript
 * const response = await fetch('/api/conversations?appId=abc123');
 * const data = await response.json();
 * ```
 */
export const GET = withCustomerAuth(async (request: NextRequest, authContext: CustomerAuthContext) => {
  try {
    // Check if user is a TLA (only enforced in production)
    if (isTLARestrictionEnabled() && !isTLAUser(authContext.user.shopperId)) {
      logger.debug('conversations.api.tla_required', {
        reason: 'User is not a TLA',
        shopperId: authContext.user.shopperId
      });
      return NextResponse.json(
        { error: 'This feature is only available for internal users' },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(request.url);
    const appId = searchParams.get('appId');

    if (!appId) {
      return NextResponse.json(
        { error: 'appId is required' },
        { status: 400 }
      );
    }

    // Fetch conversations from agents service with authentication
    const response = await agentFetch(
      `${AGENTS_CONFIG.url}/api/conversations?appId=${encodeURIComponent(appId)}`,
      {
        method: 'GET',
        siteId: appId
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('agents_service_error', { appId, errorText });
      return NextResponse.json(
        { error: 'Failed to fetch conversations from agents service', details: errorText },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0'
      }
    });
  } catch (error) {
    logger.error('fetch_conversations_error', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json(
      { error: 'Internal server error while fetching conversations' },
      { status: 500 }
    );
  }
});

