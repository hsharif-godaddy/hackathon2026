// Server-side mint of the `actpro` cookie. FOS sets it on its own root
// (`https://www.{env}-godaddy.com/?isc=<CODE>`); this route fetches that
// page server-to-server, lifts the `Set-Cookie: actpro=...` header off
// the response, and forwards it to our browser scoped to the same root
// domain so subsequent requests to `salesproducts.api.{env}-godaddy.com`
// carry it. `redirect: manual` is required because actpro is set on the
// initial response, before any FOS redirect chain.

import { NextRequest, NextResponse } from 'next/server';

import { type CustomerAuthContext, withCustomerAuth } from '@/lib/customer-auth';
import { normalizeIsc } from '@/lib/domain-offers/isc-config';
import { logger } from '@/lib/request-context';
import { checkSwitchboardFlag } from '@/lib/switchboard/server';
import { getRootDomainFromHeaders } from '@/utils/getRootDomain';

export const dynamic = 'force-dynamic';

const SWITCHBOARD_FLAG = 'appbuilder-domain-offers-isc';
const UPSTREAM_TIMEOUT_MS = 5_000;

function extractActpro(response: Response): string | null {
  // `getSetCookie()` is the spec-correct way to read multiple Set-Cookie
  // headers; fall back to splitting on the comma-joined string for runtimes
  // that don't expose it.
  const headers = response.headers as Headers & {
    getSetCookie?: () => string[];
  };
  const setCookies =
    typeof headers.getSetCookie === 'function'
      ? headers.getSetCookie()
      : (headers.get('set-cookie') || '').split(/,(?=\s*[A-Za-z0-9_-]+=)/);

  for (const raw of setCookies) {
    const match = /^\s*actpro=([^;]+)/.exec(raw);
    if (match) return match[1];
  }
  return null;
}

export const POST = withCustomerAuth(
  async (
    request: NextRequest,
    _authContext: CustomerAuthContext
  ): Promise<NextResponse> => {
    const enabled = await checkSwitchboardFlag(SWITCHBOARD_FLAG, request);
    if (!enabled) {
      return NextResponse.json(
        { error: 'Feature not enabled' },
        { status: 403 }
      );
    }

    let body: { isc?: unknown } = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }

    const rawIsc = typeof body.isc === 'string' ? body.isc : null;
    const normalized = normalizeIsc(rawIsc);
    if (!normalized) {
      return NextResponse.json(
        { error: 'Invalid or unknown isc code' },
        { status: 400 }
      );
    }

    const rootDomain = getRootDomainFromHeaders(request.headers);
    if (!rootDomain) {
      return NextResponse.json(
        { error: 'Unsupported environment' },
        { status: 400 }
      );
    }

    const upstreamUrl = `https://www.${rootDomain}/?isc=${encodeURIComponent(normalized)}`;

    let upstream: Response;
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      UPSTREAM_TIMEOUT_MS
    );
    try {
      upstream = await fetch(upstreamUrl, {
        method: 'GET',
        signal: controller.signal,
        redirect: 'manual',
      });
    } catch (err) {
      logger.error('domains.isc-session.upstream-error', {
        upstreamUrl,
        error: err instanceof Error ? err.message : String(err),
      });
      return NextResponse.json(
        { error: 'Upstream unreachable' },
        { status: 502 }
      );
    } finally {
      clearTimeout(timeout);
    }

    const actpro = extractActpro(upstream);
    if (!actpro) {
      logger.error('domains.isc-session.no-actpro', {
        upstreamUrl,
        status: upstream.status,
      });
      return NextResponse.json(
        { error: 'Upstream did not return actpro' },
        { status: 502 }
      );
    }

    logger.info('domains.isc-session.mint-success', {
      isc: normalized,
      rootDomain,
    });

    const response = NextResponse.json({ ok: true, isc: normalized });
    // HttpOnly: only SAPI reads `actpro`, server-to-server via cookie header.
    // No browser JS needs it. Closes off XSS exfiltration on any *.{rootDomain}.
    response.headers.append(
      'set-cookie',
      `actpro=${actpro}; Domain=${rootDomain}; Path=/; Secure; HttpOnly; SameSite=Lax`
    );
    response.headers.set('Cache-Control', 'no-store');

    return response;
  }
);
