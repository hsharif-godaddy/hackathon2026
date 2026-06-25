import { NextRequest, NextResponse } from 'next/server';
import { tokenSuffix } from '@airo/shared';

import { agentFetch } from '@/lib/agent-fetch';
import { getControlPlaneAdapter } from '@/lib/control-plane';
import { type CustomerAuthContext, withCustomerAuth } from '@/lib/customer-auth';
import { logger } from '@/lib/request-context';
import { checkSwitchboardFlag } from '@/lib/switchboard/server';
import {
  type AgentsTokenEntry,
  type RotatedToken,
  rotateShareTokenForList,
  ROTATION_COOLDOWN_MS,
  scanForRotation,
  shouldAttemptRotation,
} from './rotation-helpers';

// Force dynamic rendering
export const dynamic = 'force-dynamic';

/**
 * GET /api/apps/[id]/share - List share tokens for an app
 *
 * Returns all active share tokens for the specified app.
 * Requires authentication and feature flag appbuilder-share-links.
 *
 * **Auth level 1** (default IAT-based: persistent up to 30 days).
 *
 * This handler DOES have a rotation side-effect: when the freshest active
 * token is past its freshness window, it silently POSTs to agents with
 * `replaceActive: true` and prepends a newly-minted 7-day token to the
 * response. The mint is the same operation the sibling POST performs, so
 * the question arises whether GET should match POST's `{ level: 3 }` gate.
 * It deliberately doesn't, because:
 *
 *   1. The popover that consumes this endpoint is opened frequently;
 *      gating it at level 3 would force re-auth every 12 hours for any
 *      shopper on a "remember me" session, even just to read a share
 *      link. Concrete, high-frequency UX cost.
 *   2. Rotation is opportunistic — only fires when a stale token already
 *      exists. A stolen-cookie attacker can't force a mint that wouldn't
 *      otherwise happen.
 *   3. The level-3 gate on POST is for explicit credential creation
 *      (user clicks "Create Share Link"). That's the high-signal,
 *      attacker-targetable action. Rotation is silent housekeeping.
 *   4. A stolen builder-session cookie already grants broad read access
 *      to the customer's data; adding "could trigger a rotation" is a
 *      marginal capability increase, not a step-change.
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
    //
    // Typed loosely (`Record<string, unknown>` with a known `tokens` field)
    // so future agents response fields (pagination cursors, summary
    // counts, etc.) are forwarded to the client transparently. Without
    // that, a contract addition on agents would silently get dropped
    // here until someone notices a client-side regression.
    let data: { tokens?: unknown[] } & Record<string, unknown>;
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

    // Auto-rotate when the freshest active token is past the freshness
    // window. The ShareLink's "Share Link" popover uses the FIRST
    // active token from this response (agents orders by `created_at DESC`,
    // so freshest first), then the user copies that URL. Without this
    // step, a 6-day-old token still gets handed out — the recipient gets
    // a link with ~24h of validity. Mint a fresh one and prepend it so
    // the popover, and any `useShareTokens` caller, picks it up.
    //
    // Fails open: rotation failure leaves the existing list untouched
    // and the GET still succeeds. The old token continues to work for
    // any URL that was already copied — by design, agents leaves the
    // previous token alive when minting via `replaceActive: true`.
    const tokenList: AgentsTokenEntry[] = Array.isArray(data.tokens)
      ? (data.tokens as AgentsTokenEntry[])
      : [];
    const now = Date.now();
    // Auth-at-Edge: skip auto-rotation for ent apps where SSO is required.
    // Existing tokens are still listed (revoke/history UI works), but no
    // new tokens are minted via the silent rotation path. Explicit POST
    // mints are blocked by the gate above.
    const ssoRequired = site.ssoRequired === true;
    const scan = ssoRequired ? { kind: 'sso_required' as const } : scanForRotation(tokenList, now);
    let rotated: RotatedToken | undefined;
    if (scan.kind === 'sso_required') {
      logger.info('share.api.list.rotation.skippedSsoRequired', { appId });
    } else if (scan.kind === 'noParseableCreatedAt') {
      // Active tokens exist but none have a usable createdAt — silent
      // rotation-disable scenario (older agents binary, schema drift,
      // proxy stripped the field). Without this log, rotation could
      // silently stop fleet-wide for a deploy window with zero signal.
      // activeTokenCount is carried through from scanForRotation so we
      // don't re-traverse the list here.
      logger.warn('share.api.list.rotation.noParseableCreatedAt', {
        appId,
        activeTokenCount: scan.activeTokenCount,
      });
    } else if (scan.kind === 'stale') {
      // Collapse same-event bursts (multiple tabs, Strict Mode, etc.)
      // before they each fire their own replaceActive POST. Without the
      // cooldown, N concurrent stale-detections create N new tokens in
      // one burst — proportional growth in share_tokens DB rows for an
      // effectively single rotation event.
      if (!shouldAttemptRotation(appId, now)) {
        logger.info('share.api.list.rotation.cooldown', {
          appId,
          freshestAgeMs: scan.freshestAgeMs,
          cooldownMs: ROTATION_COOLDOWN_MS,
        });
      } else {
        logger.info('share.api.list.rotation.begin', {
          appId,
          freshestAgeMs: scan.freshestAgeMs,
        });
        rotated = await rotateShareTokenForList(appId, url);
        if (rotated) {
          // Carry freshestAgeMs through so a Loki query can correlate the
          // begin/rotated pair on a single trace. expiresAt mirrors the
          // POST handler's success log shape for symmetry.
          logger.info('share.api.list.rotated', {
            appId,
            // `rotated.token` is narrowed to `string` by the
            // rotateShareTokenForList return type (RotatedToken).
            shareTokenSuffix: tokenSuffix(rotated.token),
            expiresAt: typeof rotated.expiresAt === 'number' ? rotated.expiresAt : undefined,
            previousFreshestAgeMs: scan.freshestAgeMs,
          });
        }
      }
    }
    // Prepend the rotated token so the new one is first — preserves the
    // "newest first" ordering callers rely on (matches agents' own
    // `ORDER BY created_at DESC` from findByAppId). Compose the response
    // tokens as a new array rather than mutating `data.tokens` in place,
    // per the const-over-let preference in the engineering guidelines.
    //
    // Normalize `firstUsedAt: null` on the rotated entry. The agents POST
    // response shape lacks `firstUsedAt` (line 247-253 of agents share.ts),
    // while the list shape includes it as ISO string or null (line 287-294).
    // Without this normalization, consumers iterating tokens see
    // `firstUsedAt === undefined` on the rotated entry and `null` on the
    // rest — a `t.firstUsedAt ? ... : ...` check would behave the same
    // way, but `t.firstUsedAt === null` would diverge. Pin the contract.
    const rotatedNormalized: AgentsTokenEntry | undefined = rotated
      ? { ...rotated, firstUsedAt: null }
      : undefined;
    const responseTokens = rotatedNormalized
      ? [rotatedNormalized, ...tokenList]
      : tokenList;

    logger.info('share.api.list.success', {
      appId,
      tokenCount: responseTokens.length,
    });

    // Spread `data` so any future agents response fields (pagination,
    // metadata, summary counts, etc.) flow through unchanged; only
    // `tokens` is overridden to include the rotated entry. Without the
    // spread, a contract addition on agents would silently get dropped
    // here until a consumer noticed a regression.
    return NextResponse.json({ ...data, tokens: responseTokens });
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

    // Auth-at-Edge SSO gate. Share links are public-by-design (anyone with
    // the URL bypasses the IdP), which contradicts apps.sso_required. Block
    // the mint here so we don't waste a round-trip to agents/, and the agent
    // route's parallel gate is the defense-in-depth backstop. The check is
    // on ssoRequired itself, not on configured/not — even fully configured
    // SSO doesn't justify a no-auth share link.
    if (site.ssoRequired === true) {
      logger.info('share.api.create.blocked.sso_required', { appId });
      return NextResponse.json(
        {
          error: 'sso_share_disabled',
          details:
            'Share links are disabled for apps in this organization because SSO is required. ' +
            'Publish the app and use the published URL behind your IdP instead.',
        },
        { status: 403 },
      );
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
