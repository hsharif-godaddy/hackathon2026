/**
 * JWS Signing Debug Endpoint
 *
 * POST /api/apps/[id]/email-signing/debug
 *
 * Switchboard-gated wrapper around dev-supervisor's
 * /airo/email/test-send proxy, which itself forwards to the existing
 * /api/email/send gateway on the alloc's loopback. Used to confirm a
 * cell's per-alloc signing material is provisioned, loadable, AND
 * fires on a real send when the normal email flow can't be exercised
 * end-to-end (e.g. DCC outage blocking customer-domain attach on a
 * test cell).
 *
 * Two layers of gating, both must pass:
 *   1. Switchboard flag `appbuilder-jws-signing-debug` enabled for
 *      the request's environment. Operator-facing toggle.
 *   2. The customer alloc's preview task has env var
 *      DEV_SUPERVISOR_SIGN_DEBUG_ENABLED='true' set, which mhp-core's
 *      `enableJwsSignDebug` config flag controls per cell.
 *
 * Either gate disabled → 404 (the wrapper returns 404 for switchboard
 * off, dev-supervisor returns 404 for env var off; both look the
 * same to the caller, by design — debug-feature presence is not
 * advertised).
 *
 * IMPORTANT: this endpoint causes a REAL email send through the
 * existing /api/email/send pipeline (same code path customer apps
 * hit via nodemailer). Pass a recipient inbox you own. There is no
 * dry-run mode by design — the whole point is to exercise the same
 * code path that real customer traffic uses, which is the only way
 * to confirm signing fires for them too.
 *
 * The wrapper returns dev-supervisor's response, which includes
 * `signing_enabled`, `key_id`, `cell_id`, the upstream send result,
 * and the destination the alloc would have forwarded to. Operators
 * confirm signing by reading `signing_enabled: true` here AND
 * inspecting the recipient inbox for `DKIM-Signature: ... d=<your
 * domain>` (which confirms the relay verified our JWS and applied
 * RFC DKIM).
 *
 * See airo-app-builder/docs/jws-email-signing.md §8 for the full
 * debug-API spec.
 */

import { NextRequest, NextResponse } from 'next/server';

import { getControlPlaneAdapter } from '@/lib/control-plane';
import { type CustomerAuthContext, withCustomerAuth } from '@/lib/customer-auth';
import { getJWTService } from '@/lib/jwt-service';
import { logger } from '@/lib/request-context';
import { checkSwitchboardFlag } from '@/lib/switchboard/server';
import { ApiErrorCode } from '@/utils/api-errors';
import gasket from '../../../../../../../gasket';

export const dynamic = 'force-dynamic';

const SWITCHBOARD_FLAG = 'appbuilder-jws-signing-debug';

// Build the preview alloc URL the same way constructUrls does in
// v2-control-plane-adapter.ts — duplicated here rather than imported
// because the adapter exposes only the full Site object via getSite,
// and this endpoint operates pre-feature-flag-aware (not all
// debug-flag environments will have `urls.preview` populated).
function buildPreviewBaseUrl(appId: string, cellId: string | undefined): string {
  let cellPrefix = 'c4';
  if (cellId) {
    const match = cellId.match(/^([^-]+)/);
    if (match && match[1]) {
      cellPrefix = match[1];
    }
  }
  // gasket.config.airoAppDomain mirrors the env-specific override
  // (test-airoapp.ai vs airoapp.ai). Fallback to the test domain
  // because debug usage is test-cell-only.
  const baseDomain = (gasket?.config as { airoAppDomain?: string } | undefined)?.airoAppDomain || 'test-airoapp.ai';
  return `https://${appId}.preview.${cellPrefix}.${baseDomain}`;
}

// Mirrors emailhttp.SendRequest in dev-supervisor. We don't validate
// here — the gateway is the source of truth for email-shape policy
// and returns rich 400s. We just forward whatever the operator
// sends. Optional fields are explicit so a caller posting `{}` gets
// a 400 from the gateway (subject + at least one of text/html
// required) rather than from us — keeps the failure-mode surface
// in one place.
interface DebugRequest {
  to?: string[];
  from?: string;
  cc?: string[];
  bcc?: string[];
  subject?: string;
  text?: string;
  html?: string;
  replyTo?: string;
}

export const POST = withCustomerAuth(async (
  request: NextRequest,
  authContext: CustomerAuthContext,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> => {
  const { id: appId } = await params;

  // Switchboard gate. Returning 404 (not 403) so callers can't
  // distinguish "feature exists but disabled" from "feature does
  // not exist on this build". Reduces info leakage on the
  // platform's debug surface area.
  let flagOn = false;
  try {
    flagOn = await checkSwitchboardFlag(SWITCHBOARD_FLAG, request);
  } catch (err) {
    logger.warn('email_signing.debug.switchboard_failed', {
      appId,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (!flagOn) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  if (!authContext.jwt) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const adapter = getControlPlaneAdapter();
  const site = await adapter.getSite(appId, authContext.jwt);
  if (!site) {
    return NextResponse.json(
      { code: ApiErrorCode.SITE_NOT_FOUND, error: 'Site not found' },
      { status: 404 },
    );
  }

  // Parse + forward body. We don't validate fields here — defaults
  // are applied by dev-supervisor when keys are missing. Limit body
  // size at the BFF gate so a misconfigured caller can't ship a
  // huge message through to the alloc.
  let debugReq: DebugRequest = {};
  const raw = await request.text();
  if (raw.length > 0) {
    if (raw.length > 1024 * 1024) {
      return NextResponse.json(
        { error: 'Request body too large (max 1 MiB)' },
        { status: 413 },
      );
    }
    try {
      debugReq = JSON.parse(raw) as DebugRequest;
    } catch (err) {
      return NextResponse.json(
        { error: 'Invalid JSON', details: err instanceof Error ? err.message : String(err) },
        { status: 400 },
      );
    }
  }

  // Build the preview-alloc URL. We reach dev-supervisor's HTTP
  // proxy (port 20000 inside the alloc, fronted by the public
  // preview hostname). The /airo/* namespace is reserved for
  // platform endpoints — the customer's app on port 20010 never
  // sees this request. /airo/email/test-send proxies into the
  // alloc-loopback /api/email/send (the same gateway nodemailer
  // hits) and reports back signing state.
  const cellId = (site as { cellId?: string; cell_id?: string }).cellId
    ?? (site as { cell_id?: string }).cell_id;
  const previewBase = buildPreviewBaseUrl(appId, cellId);
  const debugUrl = `${previewBase}/airo/email/test-send`;

  // Mint a short-lived agents-service JWT for the auth'd user +
  // siteId. dev-supervisor's middleware validates against the
  // same JWKS issued from this BFF. 5-minute TTL is plenty for a
  // single debug call; re-mint if the operator iterates.
  const jwtService = getJWTService();
  const tokenResult = await jwtService.createToken({
    siteId: appId,
    customerId: authContext.user.customerId,
    canDownload: false,
    canPublish: false,
    canPurchaseDomain: false,
    isE2S: authContext.user.authType === 'e2s',
    authType: authContext.user.authType,
  }, 300);

  logger.info('email_signing.debug.forwarding', {
    appId,
    cellId,
    debugUrl,
  });

  const upstreamRes = await fetch(debugUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${tokenResult.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(debugReq),
    // Don't follow redirects — dev-supervisor never redirects /airo/*.
    redirect: 'manual',
  }).catch((err: unknown) => {
    logger.error('email_signing.debug.upstream_unreachable', {
      appId,
      debugUrl,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  });

  if (!upstreamRes) {
    return NextResponse.json(
      {
        error: 'dev-supervisor /airo/email/test-send unreachable',
        debug_url: debugUrl,
        hint: 'Confirm the alloc is running and the preview hostname resolves.',
      },
      { status: 502 },
    );
  }

  // Pass through whatever dev-supervisor returned. 404 from upstream
  // = the alloc-side env var is not set; we surface that directly so
  // the operator knows which gate is closed.
  const upstreamBody = await upstreamRes.text();
  if (upstreamRes.status === 404) {
    return NextResponse.json(
      {
        error: 'JWS debug endpoint disabled on the alloc',
        hint: 'Set DEV_SUPERVISOR_SIGN_DEBUG_ENABLED=true on the preview/publish task (mhp-core enableJwsSignDebug=true), then redeploy the alloc.',
        debug_url: debugUrl,
      },
      { status: 404 },
    );
  }

  // Upstream JSON passes through verbatim. We add the BFF's view of
  // the routing decision so the operator sees both layers in one
  // response.
  let parsedBody: unknown = null;
  try {
    parsedBody = JSON.parse(upstreamBody);
  } catch {
    // Non-JSON responses (e.g. a 500 from dev-supervisor) — surface
    // raw text under a known key.
    return NextResponse.json(
      {
        error: 'dev-supervisor returned non-JSON',
        upstream_status: upstreamRes.status,
        upstream_body: upstreamBody,
        debug_url: debugUrl,
      },
      { status: 502 },
    );
  }

  return NextResponse.json({
    debug_url: debugUrl,
    cell_id: cellId,
    upstream_status: upstreamRes.status,
    result: parsedBody,
  }, { status: upstreamRes.status });
}, { level: 3 });
