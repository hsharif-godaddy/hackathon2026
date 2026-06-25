/**
 * GET /api/apps/[id]/sso-config/status — has the customer saved their Okta
 * Client ID + Client Secret for this app?
 *
 * Reads via airo-go's customer-proxy `GET /apps/:appId/secrets` and checks
 * for both credential pointer rows in the `auth` group. The customer-proxy
 * GET surfaces all four classification groups (`shared`/`protected`/
 * `auth`/`variants`) with `name` + `systemManaged` only — values are
 * stripped by hosting regardless of caller context — exactly the presence
 * signal the publish gate needs.
 *
 * Pointer-name resolution is dynamic from `SiteInfo.clientIdSecretName` /
 * `clientSecretSecretName` (mhp-core PR #738) with Phase-1 GD defaults as
 * a backstop (see `app/src/lib/sso/pointer-names.ts`).
 *
 * Auth: gd-auth level 1 (read-only, no state change). The companion POST
 * route is level-3.
 */

import { NextRequest, NextResponse } from 'next/server';

import { getControlPlaneAdapter } from '@/lib/control-plane';
import { type CustomerAuthContext, withCustomerAuth } from '@/lib/customer-auth';
import { AiroMgmtClient } from '@/lib/mgmt-airo';
import { logger } from '@/lib/request-context';
import { resolveSsoPointerNames } from '@/lib/sso/pointer-names';

const MGMT_AIRO_BASE_URL: string = process.env.MGMT_AIRO_BASE_URL || 'https://mgmt.nstk.net';

// Next.js route segment config — must be the literal string so typegen can
// narrow it against `"auto" | "force-dynamic" | "error" | "force-static"`.
// An explicit `: string` annotation widens the type and `next build` rejects
// it ("Invalid configuration 'dynamic': Expected ... got 'string'").
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export const GET = withCustomerAuth(async (
  _request: NextRequest,
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

  // IDOR guard: verify the caller owns (or has shared-access to) this app
  // before reaching upstream. The boolean response is small but it's also
  // the source of truth the agents JWT bakes into the `ssoConfigured`
  // claim — it must be ownership-gated.
  const adapter = getControlPlaneAdapter();
  const site = await adapter.getSite(appId, authContext.jwt);
  if (!site) {
    return NextResponse.json({ error: 'App not found' }, { status: 404 });
  }

  // Owner-only enforcement. getSite() also returns SiteInfo for shared
  // apps (FGA); SSO presence feeds the agents-JWT ssoConfigured claim
  // used by the publish gate. Collaborators get the same 404 mask.
  //
  // Use `sharedWithMe` rather than comparing `owner_customer_id` to the
  // caller — the customer-ID compare doesn't work in LCP (stamps every
  // app with `local-customer-001`). IDOR (`!site`) catches cross-tenant;
  // the only non-owner state that reaches here is FGA-shared.
  if (site.sharedWithMe === true) {
    logger.warn('sso-config.status.rejected.not-owner', {
      appId,
      customerId: authContext.user.customerId,
    });
    return NextResponse.json({ error: 'App not found' }, { status: 404 });
  }

  // The presence check only makes sense when SSO is bound. For unbound
  // apps the answer is unambiguously "not configured" — short-circuit
  // without touching airo-go.
  if (!site.ssoConfigId || !site.subscription_id || !site.system_id) {
    return NextResponse.json({ configured: false });
  }

  let clientIdSecretName: string;
  let clientSecretSecretName: string;
  try {
    const names = resolveSsoPointerNames(site);
    clientIdSecretName = names.clientIdSecretName;
    clientSecretSecretName = names.clientSecretSecretName;
  } catch (err) {
    // Misconfigured upstream pointer names — fail safe (treat as not
    // configured) and log so the operator can investigate.
    logger.warn('sso-config.status.invalid-pointer-names', {
      appId,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ configured: false });
  }

  try {
    const client = new AiroMgmtClient({ baseUrl: MGMT_AIRO_BASE_URL, jwt: authContext.jwt });
    const raw = await client.getSecrets(site.subscription_id, site.system_id, appId);
    const authSecrets = raw.auth?.secrets ?? [];
    const names = new Set<string>(
      authSecrets
        .map((s) => (typeof s.name === 'string' ? s.name.toLowerCase() : undefined))
        .filter((n): n is string => typeof n === 'string'),
    );
    const configured: boolean = names.has(clientIdSecretName.toLowerCase()) && names.has(clientSecretSecretName.toLowerCase());
    return NextResponse.json({ configured });
  } catch (err) {
    logger.warn('sso-config.status.fetch-failed', {
      appId,
      error: err instanceof Error ? err.message : String(err),
    });
    // Fail safe — UI treats this as "not configured" and keeps the
    // Save-required gate active. Better than falsely unlocking publish.
    return NextResponse.json({ configured: false });
  }
});
