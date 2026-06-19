import { NextRequest, NextResponse } from 'next/server';

import { getControlPlaneAdapter } from '@/lib/control-plane';
import {
  createCustomerAuthError,
  type CustomerAuthContext,
  customerHasAccount,
  withCustomerAuth,
} from '@/lib/customer-auth';
import { logger } from '@/lib/request-context';
import { checkSwitchboardFlag } from '@/lib/switchboard/server';

export const dynamic = 'force-dynamic';

/**
 * 307-redirect to a SAME-ORIGIN, MARKET-LESS path (e.g. `/develop/<id>`).
 *
 * Two pitfalls this avoids:
 * 1. Host — we must NOT build an absolute URL from `request.url`: behind the
 *    Gasket HTTPS proxy that origin is the internal Next.js address
 *    (localhost:3000), so the `Location` would point at localhost. A relative
 *    `Location` (leading-slash path) is resolved by the browser against the
 *    public URL it actually requested.
 * 2. Market — `middleware.ts` unconditionally prepends the visitor's locale to
 *    every incoming path (`/develop/<id>` -> `/en-US/develop/<id>`), with no
 *    "already prefixed" guard. So we must emit the BARE path and let middleware
 *    inject the locale; emitting `/en-US/develop/<id>` ourselves would rewrite to
 *    `/en-US/en-US/develop/<id>` and 404. `path` is always internally built.
 */
function redirectToPath(path: string): NextResponse {
  return new NextResponse(null, { status: 307, headers: { Location: path } });
}

/**
 * GET /api/ventures/[ventureId]/app
 *
 * Resolve a venture id to the AAB app it backs and 307-redirect to that app's
 * develop page. The multi-user invite-accept flow lands the invitee with only
 * the venture id (the venture is product-agnostic); this is the reverse lookup
 * to the app. Resolves against the caller's own sites (owned + shared), so it
 * only ever redirects to an app the caller can actually access.
 *
 * On no match (e.g. the collaborator row isn't populated yet) it falls back to
 * the app list rather than erroring, so the invitee still lands somewhere sane.
 *
 * Redirect targets are market-less; `middleware.ts` injects the visitor locale.
 */
export const GET = withCustomerAuth(
  async (
    request: NextRequest,
    authContext: CustomerAuthContext,
    { params }: { params: Promise<{ ventureId: string }> }
  ): Promise<NextResponse> => {
    const { user } = authContext;
    const { ventureId } = await params;

    if (!customerHasAccount(user)) {
      return createCustomerAuthError('You must have an account to resolve a venture', 403);
    }
    if (!ventureId) {
      return NextResponse.json({ error: 'ventureId is required' }, { status: 400 });
    }
    if (!authContext.jwt) {
      return NextResponse.json({ error: 'Authentication token required' }, { status: 401 });
    }

    const multiUser = await checkSwitchboardFlag('aab-multi-user', request);
    const target = ventureId.trim();

    let appId: string | undefined;
    try {
      const adapter = getControlPlaneAdapter();
      const sites = await adapter.listSites(authContext.jwt, multiUser);
      appId = sites.find((site) => site.team_venture_id && site.team_venture_id === target)?.id;
    } catch (error) {
      logger.warn('ventures.resolve-app.list-sites-failed', {
        ventureId: target,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    if (appId) {
      logger.info('ventures.resolve-app.matched', { ventureId: target, appId });
      return redirectToPath(`/develop/${appId}`);
    }

    logger.info('ventures.resolve-app.no-match', { ventureId: target });
    return redirectToPath('/apps');
  }
);
