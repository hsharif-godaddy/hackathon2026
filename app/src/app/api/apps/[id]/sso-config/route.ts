/**
 * POST /api/apps/[id]/sso-config — store the customer's Okta `client_id` +
 * `client_secret` for this app as TWO `auth`-class pointer rows on hosting.
 *
 * ## Contract overview
 *
 * mhp-core's SSO data model splits credential storage into:
 *
 *   - The CACHE ROW (`SSO_OAUTH_CONFIG`) — auto-seeded by airo-go on app
 *     create. Holds metadata (issuer, jwksUrl, expectedAudience, etc.) and
 *     points at the credential pointer names. AAB does NOT write it.
 *
 *   - Two CREDENTIAL POINTER ROWS — names come from the bound SSO config's
 *     `client_id_secret_name` / `client_secret_secret_name` columns,
 *     surfaced per-app by airo-go on `GET /apps/:appId` as
 *     `clientIdSecretName` / `clientSecretSecretName` (mhp-core PR #738).
 *     Each is an `auth:true, systemManaged:false` secret holding the bare
 *     credential string. This is what this route writes.
 *
 * The customer pastes Client ID + Client Secret into Settings → SSO; the
 * BFF writes both pointer rows via airo-go's customer-proxy secrets
 * endpoint (mhp-core PR #738 added the `auth` flag to the customer-proxy
 * schema). airo-go forwards both rows to hosting in a single atomic
 * operation. dev-supervisor reads the cache row at boot to discover the
 * pointer names, then resolves the credentials at runtime.
 *
 * ## Security invariants
 *
 *   1. IDOR: caller must own the app. `adapter.getSite(appId, jwt)` returns
 *      null for cross-tenant lookups (multi-user-aware) → 404.
 *
 *   2. Owner-only. `getSite()` also returns SiteInfo for apps shared with
 *      the caller via FGA; SSO is owner-scoped → reject collaborators with
 *      the same 404 mask.
 *
 *   3. Server-authoritative pointer names. The pointer-key names are NEVER
 *      taken from the client. They come from the bound SSO config via
 *      `SiteInfo.clientIdSecretName` / `clientSecretSecretName`, with
 *      Phase-1 GD defaults as a backstop (see
 *      `app/src/lib/sso/pointer-names.ts`). A client-controlled pointer
 *      name would route credentials into an attacker-chosen secret slot.
 *
 *   4. Server-authoritative sso_config_id. If the client sends one, it must
 *      match `site.ssoConfigId`. Mismatched value → 400, no write fires.
 *
 *   5. Auth: standard customer auth (default level). HBI step-up was
 *      removed by product decision so the panel save flow doesn't
 *      require re-authentication; airo-go still enforces ShopperJwt
 *      + EntityOwner authorization on the customer-proxy secrets write,
 *      which remains the canonical authority for credential-write
 *      access control.
 *
 *   6. Observable failures: missing-server-config-id (409), upstream
 *      airo-go write failure (502). Customer-facing copy is generic; full
 *      diagnostics live in the structured logs.
 *
 * ## Auth model
 *
 * Goes through airo-go's customer-proxy, which runs:
 *   - `ShopperJwt` middleware (validates the caller's gd-auth JWT)
 *   - `EntityOwnerAuthorization` middleware (server-side owner-only)
 *   - Hosting's `ValidateAuthClassWrite` + `ValidateCustomerAuthRestrictions`
 *     (gates auth-class writes by name — only names matching the bound SSO
 *     config's pointer columns are accepted with `systemManaged:false`)
 *
 * No mTLS, no stripe-service cert dependency — single auth model for all
 * AAB→mhp-core traffic.
 */

import { NextRequest, NextResponse } from 'next/server';

import { getControlPlaneAdapter } from '@/lib/control-plane';
import { type CustomerAuthContext, withCustomerAuth } from '@/lib/customer-auth';
import { AiroHttpError, AiroMgmtClient } from '@/lib/mgmt-airo';
import type { AiroSecretOperation } from '@/lib/mgmt-airo/types';
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

/**
 * Payload accepted by POST. `sso_config_id` is OPTIONAL and only used to
 * spot client/server config-id drift early — the server uses its own
 * authoritative value either way. `client_id` + `client_secret` are
 * required non-empty strings.
 */
interface SsoConfigPayload {
  client_id: string;
  client_secret: string;
  sso_config_id?: string;
}

function isPayload(v: unknown): v is SsoConfigPayload {
  if (!v || typeof v !== 'object') return false;
  const o: Record<string, unknown> = v as Record<string, unknown>;
  if (typeof o.client_id !== 'string' || o.client_id.length === 0) return false;
  if (typeof o.client_secret !== 'string' || o.client_secret.length === 0) return false;
  if (o.sso_config_id !== undefined && typeof o.sso_config_id !== 'string') return false;
  return true;
}

export const POST = withCustomerAuth(
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
        { error: 'client_id and client_secret are required non-empty strings' },
        { status: 400 },
      );
    }

    // IDOR guard. adapter.getSite scopes by the JWT's shopper; null → 404.
    // Returning 404 rather than 403 to avoid leaking app existence to
    // foreign customers (same response a missing app would produce).
    const adapter = getControlPlaneAdapter();
    const site = await adapter.getSite(appId, authContext.jwt);
    if (!site) {
      return NextResponse.json({ error: 'App not found' }, { status: 404 });
    }

    // Owner-only enforcement (defense in depth — airo-go's EntityOwner
    // middleware also enforces this server-side). Same 404 mask as IDOR.
    //
    // Use `sharedWithMe` (set by the adapter's `reconcileSharedOwnership`
    // for FGA invitees) rather than comparing `owner_customer_id` to the
    // caller — the customer-ID compare doesn't work in local-control-plane
    // (LCP stamps every app with `local-customer-001` while the caller's
    // customerId comes from the gd-auth JWT). For owned apps `sharedWithMe`
    // is unset; for collaborator listings it's `true`. IDOR (`!site`) above
    // catches cross-tenant; the only non-owner state that reaches here is
    // FGA-shared.
    if (site.sharedWithMe === true) {
      logger.warn('sso-config.upsert-rejected.not-owner', {
        appId,
        customerId: authContext.user.customerId,
      });
      return NextResponse.json({ error: 'App not found' }, { status: 404 });
    }

    // Server-authoritative ssoConfigId — bound by mhp-core admin tooling
    // (mgmt-client) before the customer can save credentials.
    if (!site.ssoConfigId) {
      logger.error('sso-config.upsert-rejected.no-server-config-id', {
        appId,
        customerId: authContext.user.customerId,
      });
      return NextResponse.json(
        { error: 'No SSO config bound to this app' },
        { status: 409 },
      );
    }
    if (payload.sso_config_id !== undefined && payload.sso_config_id !== site.ssoConfigId) {
      logger.warn('sso-config.upsert-rejected.config-id-mismatch', {
        appId,
        customerId: authContext.user.customerId,
      });
      return NextResponse.json(
        { error: 'sso_config_id does not match the server-authoritative value' },
        { status: 400 },
      );
    }
    // Subscription/system IDs are needed for the customer-proxy URL. The
    // bound-app contract guarantees both are present when ssoConfigId is
    // set; if either is missing, something is off — fail closed.
    if (!site.subscription_id || !site.system_id) {
      logger.error('sso-config.upsert-rejected.missing-ids', {
        appId,
        customerId: authContext.user.customerId,
        hasSubscriptionId: Boolean(site.subscription_id),
        hasSystemId: Boolean(site.system_id),
      });
      return NextResponse.json(
        { error: 'App is not associated with a subscription/system' },
        { status: 409 },
      );
    }

    let clientIdSecretName: string;
    let clientSecretSecretName: string;
    try {
      const names = resolveSsoPointerNames(site);
      clientIdSecretName = names.clientIdSecretName;
      clientSecretSecretName = names.clientSecretSecretName;
    } catch (err) {
      logger.error('sso-config.upsert-rejected.invalid-pointer-names', {
        appId,
        customerId: authContext.user.customerId,
        error: err instanceof Error ? err.message : String(err),
      });
      return NextResponse.json(
        { error: 'SSO config is misconfigured upstream' },
        { status: 502 },
      );
    }

    const operations: AiroSecretOperation[] = [
      {
        type: 'upsert',
        secret: {
          name: clientIdSecretName,
          value: payload.client_id,
          variants: [],
          systemManaged: false,
          auth: true,
        },
      },
      {
        type: 'upsert',
        secret: {
          name: clientSecretSecretName,
          value: payload.client_secret,
          variants: [],
          systemManaged: false,
          auth: true,
        },
      },
    ];

    try {
      const client = new AiroMgmtClient({ baseUrl: MGMT_AIRO_BASE_URL, jwt: authContext.jwt });
      await client.updateSecrets(site.subscription_id, site.system_id, appId, {
        operations,
        workflowName: 'airo-app-secrets',
      });
      logger.info('sso-config.upserted', {
        appId,
        customerId: authContext.user.customerId,
        ssoConfigId: site.ssoConfigId,
        clientIdSecretName,
        clientSecretSecretName,
      });
      return NextResponse.json({ configured: true });
    } catch (err) {
      // Map airo-go's typed errors. EntityOwner / not-found map to 404;
      // validator rejections (hosting's `secrets_validator.go`) come back
      // as 400 — differentiate them so the customer-facing copy points at
      // the right cause instead of a generic "invalid credentials".
      if (err instanceof AiroHttpError) {
        if (err.status === 404) {
          logger.warn('sso-config.upsert-rejected.upstream-404', {
            appId,
            customerId: authContext.user.customerId,
          });
          return NextResponse.json({ error: 'App not found' }, { status: 404 });
        }
        if (err.status === 400) {
          const upstreamMessage: string = extractUpstreamMessage(err);
          const rejection: SsoConfigUpsertRejection = classifyUpstream400(upstreamMessage);
          logger.warn('sso-config.upsert-rejected.upstream-400', {
            appId,
            customerId: authContext.user.customerId,
            rejection: rejection.code,
            upstream: upstreamMessage,
          });
          return NextResponse.json(
            { error: rejection.code, message: rejection.userMessage },
            { status: rejection.status },
          );
        }
      }
      logger.error('sso-config.upsert-failed', {
        appId,
        customerId: authContext.user.customerId,
        error: err instanceof Error ? err.message : String(err),
      });
      return NextResponse.json({ error: 'Failed to save SSO config' }, { status: 502 });
    }
  },
);

/**
 * Pull a plain-text error message out of an AiroHttpError, regardless of
 * whether the upstream returned the v1 (`{message, error?}`), v2
 * (`{error:{code,message}}`), or bare-string error shape. Used to match
 * mhp-core's sentinel error strings without crashing on shape drift.
 */
function extractUpstreamMessage(err: AiroHttpError): string {
  const body: unknown = err.body;
  if (typeof body === 'string') return body;
  if (body && typeof body === 'object') {
    const o: Record<string, unknown> = body as Record<string, unknown>;
    const nested: unknown = (o.error && typeof o.error === 'object') ? (o.error as Record<string, unknown>).message : undefined;
    if (typeof nested === 'string') return nested;
    if (typeof o.message === 'string') return o.message;
    if (typeof o.error === 'string') return o.error;
  }
  return err.message;
}

interface SsoConfigUpsertRejection {
  /** Stable code the UI can branch on. */
  code: string;
  /** Customer-facing message; safe to surface verbatim. */
  userMessage: string;
  /** HTTP status. Cache-row-not-seeded surfaces as 503 (transient propagation lag from admin binding). */
  status: number;
}

/**
 * Classify a 400 from airo-go's customer-proxy secrets write into an
 * actionable rejection. mhp-core's hosting validator uses sentinel
 * error strings defined in `backends/hosting/internal/domain/errors/
 * secrets_errors.go`; we match on substrings so a phrasing tweak on
 * mhp-core's side doesn't immediately fall through to the generic path.
 *
 * The cache-row-not-seeded case (`ErrCustomerAuthNameNotPointer`) is
 * surfaced as 503 + a retry-friendly message — when an admin has just
 * bound the SSO config but the `UpsertSSOConfigCacheTask` SFN hasn't
 * finished propagating to hosting yet, the customer should retry, not
 * conclude their credentials are wrong.
 */
function classifyUpstream400(message: string): SsoConfigUpsertRejection {
  const lowered: string = message.toLowerCase();
  if (
    lowered.includes('not registered as a credential pointer') ||
    lowered.includes('not a pointer') ||
    lowered.includes('cache row')
  ) {
    return {
      code: 'sso_cache_not_seeded',
      userMessage: 'SSO config is still being provisioned. Please retry in a few seconds.',
      status: 503,
    };
  }
  if (lowered.includes('systemmanaged') || lowered.includes('system-managed')) {
    return {
      code: 'sso_validator_flag_conflict',
      userMessage: 'SSO configuration is in an inconsistent state. Contact support.',
      status: 400,
    };
  }
  if (lowered.includes('auth=true is required') || lowered.includes('requires auth')) {
    return {
      code: 'sso_validator_auth_required',
      userMessage: 'SSO configuration is in an inconsistent state. Contact support.',
      status: 400,
    };
  }
  return {
    code: 'sso_invalid_request',
    userMessage: 'The SSO credentials could not be saved. Verify the values and try again.',
    status: 400,
  };
}
