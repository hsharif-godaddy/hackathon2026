import { NextRequest, NextResponse } from 'next/server';
import { agentFetch } from '@/lib/agent-fetch';
import { logger } from '@/lib/request-context';
import { authenticateCustomer } from '@/lib/customer-auth';

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
 * Route params for conversation messages
 */
interface RouteParams {
  params: Promise<{ id: string }>;
}

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
 * GET handler for fetching messages for a specific conversation
 *
 * Retrieves all messages for a conversation from the agents
 * database via the agents service API.
 *
 * Restricted to TLA users only in production environment.
 *
 * @param request - The incoming Next.js request
 * @param params - Route parameters containing conversation id
 * @returns NextResponse with messages data or error
 *
 * @example
 * ```typescript
 * const response = await fetch('/api/conversations/conv-123/messages?appId=abc123');
 * const data = await response.json();
 * ```
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id: conversationId } = await params;
  const { searchParams } = new URL(request.url);
  const appId = searchParams.get('appId');

  try {
    // Authenticate user
    const authContext = await authenticateCustomer(request);
    if (!authContext.isAuthenticated) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    // Check if user is a TLA (only enforced in production)
    if (isTLARestrictionEnabled() && !isTLAUser(authContext.user.shopperId)) {
      logger.debug('conversations.messages.api.tla_required', {
        reason: 'User is not a TLA',
        shopperId: authContext.user.shopperId
      });
      return NextResponse.json(
        { error: 'This feature is only available for internal users' },
        { status: 403 }
      );
    }

    if (!conversationId) {
      return NextResponse.json(
        { error: 'conversationId is required' },
        { status: 400 }
      );
    }

    if (!appId) {
      return NextResponse.json(
        { error: 'appId query parameter is required' },
        { status: 400 }
      );
    }

    // Fetch messages from agents service with authentication
    const response = await agentFetch(
      `${AGENTS_CONFIG.url}/api/conversations/${encodeURIComponent(conversationId)}/messages?appId=${encodeURIComponent(appId)}`,
      {
        method: 'GET',
        siteId: appId
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('agents_service_error', { conversationId, appId, errorText });
      return NextResponse.json(
        { error: 'Failed to fetch messages from agents service', details: errorText },
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
    logger.error('fetch_messages_error', {
      conversationId,
      appId,
      error: error instanceof Error ? error.message : String(error)
    });
    return NextResponse.json(
      { error: 'Internal server error while fetching messages' },
      { status: 500 }
    );
  }
}
