/**
 * PUT /api/apps/[id]/sso-required — Phase-2 customer-facing toggle for the
 * per-app Auth-at-Edge SSO override.
 *
 * Honored only when the bound SSO config's admin tier is `'optional'`. When
 * the admin has hard-locked SSO on or off, the toggle is rejected upstream
 * with 409 OVERRIDE_LOCKED, which this route maps to its own 409 response
 * with a stable error code (`sso_toggle_locked`) the UI can branch on.
 *
 * ## Security invariants
 *
 *   1. IDOR: caller must own the app. `adapter.getSite(appId, jwt)` returns
 *      null for cross-tenant lookups → 404.
 *
 *   2. The customer's JWT is forwarded to airo-go's customer-context
 *      endpoint, which independently enforces ShopperJwt + EntityOwner.
 *      Two layers of authz; either one rejecting closes the gate.
 *
 *   3. The body is tri-state: `true`, `false`, or `null` (clear override —
 *      defer to admin tier). Any other value is rejected as 400.
 *
 *   4. Auth: standard customer auth (default level). HBI step-up was
 *      removed by product decision so the toggle doesn't trigger
 *      re-authentication; airo-go's `EntityOwner` middleware still
 *      enforces owner-only on this write.
 *
 *   5. Server-authoritative response: AAB returns the resolved + raw values
 *      from airo-go (NOT the client-sent value), so a follow-on read
 *      doesn't show stale state.
 */

import { NextRequest, NextResponse } from 'next/server';

import { getControlPlaneAdapter } from '@/lib/control-plane';
import { type CustomerAuthContext, withCustomerAuth } from '@/lib/customer-auth';
import { AiroHttpError, AiroMgmtClient } from '@/lib/mgmt-airo';
import { logger } from '@/lib/request-context';

const MGMT_AIRO_BASE_URL = process.env.MGMT_AIRO_BASE_URL || 'https://mgmt.nstk.net';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface SsoRequiredPayload {
  // tri-state: true, false, or null (clear override)
  ssoRequired: boolean | null;
}

function isPayload(v: unknown): v is SsoRequiredPayload {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  if (!('ssoRequired' in o)) return false;
  const val = o.ssoRequired;
  return val === true || val === false || val === null;
}

export const PUT = withCustomerAuth(
  async (
    request: NextRequest,
    authContext: CustomerAuthContext,
    context: RouteContext,
  ): Promise<NextResponse> => {
    if (!authContext.jwt) {
      return NextResponse.json({ error: 'Authentication token required' }, { status: 401 });
    }
    const { id: appId } = await context.params;
    if (!appId) {
      return NextResponse.json({ error: 'appId path parameter is required' }, { status: 400 });
    }

    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    if (!isPayload(payload)) {
      return NextResponse.json(
        { error: 'ssoRequired must be true, false, or null' },
        { status: 400 },
      );
    }

    // IDOR guard + read site for the subscription id (the airo-go customer
    // endpoint takes :subscriptionId in the URL, NOT just :appId — airo-go
    // can derive it from the app's sso_config_id, but verifying ownership
    // first keeps the cross-tenant 404 contract consistent with our other
    // BFF routes and avoids leaking app existence to foreign customers).
    const adapter = getControlPlaneAdapter();
    const site = await adapter.getSite(appId, authContext.jwt);
    if (!site) {
      return NextResponse.json({ error: 'App not found' }, { status: 404 });
    }
    // Owner-only enforcement. airo-go's customer-context endpoint already
    // enforces EntityOwner server-side (see invariant #2 above), so this is
    // defense in depth — fast-fails collaborator requests before any
    // upstream call and keeps the BFF authz model consistent with the
    // sister sso-config routes.
    //
    // Use `sharedWithMe` (set by `reconcileSharedOwnership` for FGA invitees)
    // rather than comparing `owner_customer_id` to the caller — the customer-
    // ID compare doesn't work locally (LCP stamps every app with a fixed
    // `local-customer-001` while the caller's customerId comes from the
    // gd-auth JWT). For owned apps `sharedWithMe` is unset; for collaborator
    // listings it's explicitly `true`. IDOR (`!site`) already catches cross-
    // tenant requests, so the only non-owner state that reaches here is FGA
    // shared.
    if (site.sharedWithMe === true) {
      logger.warn('sso-required.toggle-rejected.not-owner', {
        appId,
        customerId: authContext.user.customerId,
      });
      return NextResponse.json({ error: 'App not found' }, { status: 404 });
    }
    if (!site.subscription_id) {
      logger.error('sso-required.toggle-rejected.no-subscription-id', {
        appId,
        customerId: authContext.user.customerId,
      });
      return NextResponse.json(
        { error: 'App is not associated with a subscription' },
        { status: 409 },
      );
    }
    if (!site.ssoConfigId) {
      logger.error('sso-required.toggle-rejected.no-server-config-id', {
        appId,
        customerId: authContext.user.customerId,
      });
      return NextResponse.json(
        { error: 'No SSO config bound to this app' },
        { status: 409 },
      );
    }

    try {
      const client = new AiroMgmtClient({ baseUrl: MGMT_AIRO_BASE_URL, jwt: authContext.jwt });
      const result = await client.setAppSsoRequired(
        site.subscription_id,
        appId,
        payload.ssoRequired,
      );
      logger.info('sso-required.toggle.success', {
        appId,
        customerId: authContext.user.customerId,
        ssoConfigId: site.ssoConfigId,
        newOverride: payload.ssoRequired,
        resolved: result.ssoRequired,
      });
      return NextResponse.json({
        appId: result.appId,
        ssoConfigId: result.ssoConfigId,
        ssoRequired: result.ssoRequired,
        ssoRequiredOverride: result.ssoRequiredOverride,
        ssoOverrideAllowed: result.ssoOverrideAllowed,
      });
    } catch (err) {
      // Map airo-go's typed errors. 409 OVERRIDE_LOCKED is the expected
      // path when admin has hard-locked the tier — surface to the UI with
      // a stable code so the form can render a "locked by admin" message.
      if (err instanceof AiroHttpError) {
        if (err.status === 409) {
          logger.warn('sso-required.toggle-rejected.locked', {
            appId,
            customerId: authContext.user.customerId,
            upstream: err.message,
          });
          return NextResponse.json(
            { error: 'sso_toggle_locked' },
            { status: 409 },
          );
        }
        if (err.status === 400) {
          return NextResponse.json(
            { error: 'Invalid request' },
            { status: 400 },
          );
        }
        if (err.status === 404) {
          return NextResponse.json(
            { error: 'App not found' },
            { status: 404 },
          );
        }
      }
      logger.error('sso-required.toggle.failed', {
        appId,
        customerId: authContext.user.customerId,
        error: err instanceof Error ? err.message : String(err),
      });
      return NextResponse.json({ error: 'Failed to update SSO setting' }, { status: 502 });
    }
  },
);
