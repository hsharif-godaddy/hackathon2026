import { NextRequest, NextResponse } from 'next/server';

import { agentFetch } from '@/lib/agent-fetch';
import { type CustomerAuthContext, withCustomerAuth } from '@/lib/customer-auth';
import { logger } from '@/lib/request-context';
import { checkSwitchboardFlag } from '@/lib/switchboard/server';

// Force dynamic rendering
export const dynamic = 'force-dynamic';

/**
 * GET /api/apps/[id]/share - List share tokens for an app
 *
 * Returns all active share tokens for the specified app.
 * Requires authentication and feature flag appbuilder-share-links.
 *
 * Path Parameters:
 * - id: The app ID
 *
 * Response:
 * {
 *   "tokens": [
 *     {
 *       "token": "abc123",
 *       "appId": "app-id",
 *       "expiresAt": 1234567890000,
 *       "createdAt": "2024-01-01T00:00:00.000Z",
 *       "firstUsedAt": "2024-01-01T00:05:00.000Z"
 *     }
 *   ]
 * }
 */
export const GET = withCustomerAuth(async (
  request: NextRequest,
  authContext: CustomerAuthContext,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> => {
  try {
    // JWT required
    if (!authContext.jwt) {
      return NextResponse.json({ error: 'Authentication token required' }, { status: 401 });
    }

    // Check feature flag
    const isFeatureEnabled = await checkSwitchboardFlag(
      'appbuilder-share-links',
      authContext.jwt,
      request.headers
    );

    if (!isFeatureEnabled) {
      logger.warn('share.api.feature_disabled', {
        message: 'Share links feature is not enabled',
      });
      return NextResponse.json(
        { error: 'Feature not available' },
        { status: 403 }
      );
    }

    const { id: appId } = await params;

    if (!appId) {
      return NextResponse.json({ error: 'appId path parameter is required' }, { status: 400 });
    }

    logger.info('share.api.list.start', {
      appId,
    });

    // Call agents API to list share tokens
    const agentsBaseUrl = process.env.AGENTS_SERVICE_URL || 'http://localhost:4000';
    const url = `${agentsBaseUrl}/apps/${appId}/share`;
    const response = await agentFetch(url, {
      siteId: appId,
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('share.api.list.failure', {
        appId,
        status: response.status,
        error: errorText,
      });

      if (response.status === 404) {
        return NextResponse.json({ error: 'App not found' }, { status: 404 });
      }

      return NextResponse.json(
        { error: 'Failed to list share tokens' },
        { status: response.status }
      );
    }

    const data = await response.json();

    logger.info('share.api.list.success', {
      appId,
      tokenCount: data.tokens?.length || 0,
    });

    return NextResponse.json(data);
  } catch (error) {
    logger.error('share.api.list.error', {
      message: 'Failed to list share tokens',
      error: error instanceof Error ? error.message : 'Unknown error',
    });

    return NextResponse.json(
      { error: 'Failed to list share tokens' },
      { status: 500 }
    );
  }
});

/**
 * POST /api/apps/[id]/share - Create a new share token
 *
 * Creates a new share token for the specified app.
 * Requires authentication and feature flag appbuilder-share-links.
 *
 * Path Parameters:
 * - id: The app ID
 *
 * Request Body:
 * {
 *   "expiresInDays": 7 (optional, default: 7)
 * }
 *
 * Response:
 * {
 *   "token": "abc123",
 *   "appId": "app-id",
 *   "expiresAt": 1234567890000,
 *   "createdAt": "2024-01-01T00:00:00.000Z"
 * }
 */
export const POST = withCustomerAuth(async (
  request: NextRequest,
  authContext: CustomerAuthContext,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> => {
  try {
    // JWT required
    if (!authContext.jwt) {
      return NextResponse.json({ error: 'Authentication token required' }, { status: 401 });
    }

    // Check feature flag
    const isFeatureEnabled = await checkSwitchboardFlag(
      'appbuilder-share-links',
      authContext.jwt,
      request.headers
    );

    if (!isFeatureEnabled) {
      logger.warn('share.api.feature_disabled', {
        message: 'Share links feature is not enabled',
      });
      return NextResponse.json(
        { error: 'Feature not available' },
        { status: 403 }
      );
    }

    const { id: appId } = await params;

    if (!appId) {
      return NextResponse.json({ error: 'appId path parameter is required' }, { status: 400 });
    }

    // Parse request body (optional expiresInDays from UI)
    let expiresInDays = 7; // Default: 7 days
    try {
      const body = await request.json();
      if (body.expiresInDays !== undefined) {
        expiresInDays = Number(body.expiresInDays);
        if (isNaN(expiresInDays) || expiresInDays <= 0) {
          return NextResponse.json(
            { error: 'expiresInDays must be a positive number' },
            { status: 400 }
          );
        }
      }
    } catch {
      // Empty body is fine, use default
    }

    // Convert days to seconds for agents API
    const expiresIn = Math.floor(expiresInDays * 86400); // 86400 seconds per day

    logger.info('share.api.create.start', {
      appId,
      expiresInDays,
      expiresIn,
    });

    // Call agents API to create share token (API accepts seconds)
    const agentsBaseUrl = process.env.AGENTS_SERVICE_URL || 'http://localhost:4000';
    const url = `${agentsBaseUrl}/apps/${appId}/share`;
    const response = await agentFetch(url, {
      siteId: appId,
      method: 'POST',
      body: JSON.stringify({ expiresIn }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('share.api.create.failure', {
        appId,
        status: response.status,
        error: errorText,
      });

      if (response.status === 404) {
        return NextResponse.json({ error: 'App not found' }, { status: 404 });
      }

      return NextResponse.json(
        { error: 'Failed to create share token' },
        { status: response.status }
      );
    }

    const data = await response.json();

    logger.info('share.api.create.success', {
      appId,
      token: data.token,
      expiresAt: data.expiresAt,
    });

    return NextResponse.json(data);
  } catch (error) {
    logger.error('share.api.create.error', {
      message: 'Failed to create share token',
      error: error instanceof Error ? error.message : 'Unknown error',
    });

    return NextResponse.json(
      { error: 'Failed to create share token' },
      { status: 500 }
    );
  }
});
