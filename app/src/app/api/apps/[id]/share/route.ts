import { NextRequest, NextResponse } from 'next/server';
import { tokenSuffix } from '@airo/shared';

import { agentFetch } from '@/lib/agent-fetch';
import { getControlPlaneAdapter } from '@/lib/control-plane';
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
  // Resolve appId before the try block so it is in scope for the outer
  // catch's log payload — a const inside the try is block-scoped and was
  // dropping appId from share.api.list.error logs.
  const { id: appId } = await params;

  try {
    // JWT required
    if (!authContext.jwt) {
      return NextResponse.json({ error: 'Authentication token required' }, { status: 401 });
    }

    // Check feature flag
    const isFeatureEnabled = await checkSwitchboardFlag('appbuilder-share-links', request);

    if (!isFeatureEnabled) {
      logger.warn('share.api.feature_disabled', {
        appId,
        message: 'Share links feature is not enabled',
      });
      return NextResponse.json(
        { error: 'Feature not available' },
        { status: 403 }
      );
    }

    if (!appId) {
      return NextResponse.json({ error: 'appId path parameter is required' }, { status: 400 });
    }

    // Get site from control plane to resolve agent URL
    const adapter = getControlPlaneAdapter();
    const site = await adapter.getSite(appId, authContext.jwt);

    if (!site) {
      return NextResponse.json({ error: 'App not found' }, { status: 404 });
    }

    if (!site.agent_url) {
      return NextResponse.json({ error: 'App agent not available' }, { status: 503 });
    }

    logger.info('share.api.list.start', {
      appId,
    });

    const url = `${site.agent_url}/apps/${appId}/share`;
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

    // If agents returns 2xx with a non-JSON body (proxy timeout HTML,
    // truncated response, etc.) response.json() throws. Translate to a
    // 502 with the upstream status preserved in the log so the failure
    // mode is distinguishable from a generic 500.
    let data: { tokens?: unknown[] };
    try {
      data = await response.json();
    } catch (parseErr) {
      logger.error('share.api.list.parseError', {
        appId,
        status: response.status,
        error: parseErr instanceof Error ? parseErr.message : 'Unknown parse error',
      });
      return NextResponse.json(
        { error: 'Unexpected response from agents service' },
        { status: 502 }
      );
    }

    logger.info('share.api.list.success', {
      appId,
      tokenCount: data.tokens?.length || 0,
    });

    return NextResponse.json(data);
  } catch (error) {
    logger.error('share.api.list.error', {
      appId,
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
  // Resolve appId before the try block so it is in scope for the outer
  // catch's log payload — see GET handler comment above.
  const { id: appId } = await params;

  try {
    // JWT required
    if (!authContext.jwt) {
      return NextResponse.json({ error: 'Authentication token required' }, { status: 401 });
    }

    // Check feature flag
    const isFeatureEnabled = await checkSwitchboardFlag('appbuilder-share-links', request);

    if (!isFeatureEnabled) {
      logger.warn('share.api.feature_disabled', {
        appId,
        message: 'Share links feature is not enabled',
      });
      return NextResponse.json(
        { error: 'Feature not available' },
        { status: 403 }
      );
    }

    if (!appId) {
      return NextResponse.json({ error: 'appId path parameter is required' }, { status: 400 });
    }

    // Parse request body (optional expiresInDays from UI). Distinguish:
    //   - No body / empty body → use default 7 days
    //   - Valid JSON → use the value (with range check)
    //   - Non-empty malformed JSON → 400 so the caller learns about the bug
    //     instead of silently getting a 201 with default expiry
    let expiresInDays = 7;
    const rawBody = await request.text();
    if (rawBody.length > 0) {
      let body: { expiresInDays?: unknown };
      try {
        body = JSON.parse(rawBody);
      } catch (err) {
        if (err instanceof SyntaxError) {
          return NextResponse.json(
            { error: 'Request body contains invalid JSON' },
            { status: 400 }
          );
        }
        throw err;
      }
      if (body.expiresInDays !== undefined) {
        expiresInDays = Number(body.expiresInDays);
        // Range-check at the BFF instead of relying on the agents 400.
        // Agents accepts expiresIn in [3600, 604800] seconds (1h–7d).
        // Without this guard:
        //   - expiresInDays=365 → expiresIn=31_536_000 → agents 400 with
        //     a generic "Failed to create share token" surfaced to the UI.
        //   - expiresInDays=0.04 (fractional) → expiresIn=3456 < 3600 →
        //     same confusing passthrough.
        // Rejecting non-integer / out-of-range up front gives a precise
        // error and avoids a wasted round-trip to agents.
        if (
          !Number.isInteger(expiresInDays) ||
          expiresInDays < 1 ||
          expiresInDays > 7
        ) {
          return NextResponse.json(
            { error: 'expiresInDays must be an integer between 1 and 7' },
            { status: 400 }
          );
        }
      }
    }

    // Convert days to seconds for agents API. Safe Math.floor — expiresInDays
    // is now guaranteed integer by the validation above.
    const expiresIn = expiresInDays * 86400; // 86400 seconds per day

    // Get site from control plane to resolve agent URL
    const adapter = getControlPlaneAdapter();
    const site = await adapter.getSite(appId, authContext.jwt);

    if (!site) {
      return NextResponse.json({ error: 'App not found' }, { status: 404 });
    }

    if (!site.agent_url) {
      return NextResponse.json({ error: 'App agent not available' }, { status: 503 });
    }

    logger.info('share.api.create.start', {
      appId,
      expiresInDays,
      expiresIn,
    });

    const url = `${site.agent_url}/apps/${appId}/share`;
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

    // If agents returns 2xx with a non-JSON body (proxy timeout HTML,
    // truncated response, etc.) response.json() throws. Translate to a
    // 502 with the upstream status preserved in the log. Note: at this
    // point agents has likely already persisted a token; the customer
    // may need to refresh and copy from the GET listing.
    let data: { token?: string; expiresAt?: number };
    try {
      data = await response.json();
    } catch (parseErr) {
      logger.error('share.api.create.parseError', {
        appId,
        status: response.status,
        error: parseErr instanceof Error ? parseErr.message : 'Unknown parse error',
      });
      return NextResponse.json(
        { error: 'Unexpected response from agents service' },
        { status: 502 }
      );
    }

    // Agents returned 2xx with parseable JSON, but the body lacks the token
    // field — proxy misconfig or future schema drift. Without this guard the
    // BFF would forward `{ token: undefined, ... }` as a 201, the UI would
    // show "success" with no copyable URL, and the only signal would be a
    // shareTokenSuffix='****' line in logs (tokenSuffix's non-string
    // fallback). Surface the failure mode explicitly.
    if (!data.token) {
      logger.error('share.api.create.missingToken', {
        appId,
        status: response.status,
      });
      return NextResponse.json(
        { error: 'Unexpected response from agents service' },
        { status: 502 }
      );
    }

    logger.info('share.api.create.success', {
      appId,
      shareTokenSuffix: tokenSuffix(data.token),
      expiresAt: data.expiresAt,
    });

    return NextResponse.json(data);
  } catch (error) {
    logger.error('share.api.create.error', {
      appId,
      message: 'Failed to create share token',
      error: error instanceof Error ? error.message : 'Unknown error',
    });

    return NextResponse.json(
      { error: 'Failed to create share token' },
      { status: 500 }
    );
  }
}, { level: 3 });
