import { NextRequest, NextResponse } from 'next/server';

import { publicOrigin } from '@/lib/github/config';
import { logger } from '@/lib/request-context';
import { buildNonceCookieName } from '../_utils';

export const dynamic = 'force-dynamic';

// Cross-site redirect from Cloudflare — cannot be auth-gated for the same
// reason as the GitHub install callback (no session cookie after redirect).

interface StatePayload {
  appId: string;
  fqdn: string;
  nonce: string;
}

function clearNonceCookie(appId: string): string {
  return `${buildNonceCookieName(appId)}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

function decodeState(raw: string): StatePayload | null {
  try {
    const decoded: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf-8'));
    if (
      decoded !== null &&
      typeof decoded === 'object' &&
      'appId' in decoded &&
      'fqdn' in decoded &&
      'nonce' in decoded &&
      typeof (decoded as StatePayload).appId === 'string' &&
      typeof (decoded as StatePayload).fqdn === 'string' &&
      typeof (decoded as StatePayload).nonce === 'string'
    ) {
      return decoded as StatePayload;
    }
    return null;
  } catch {
    return null;
  }
}

function buildDevelopRedirect(
  request: NextRequest,
  appId: string,
  status: 'success' | 'error',
  domain: string,
): NextResponse {
  const origin: string = publicOrigin(request);
  const redirectUrl: URL = new URL(`/develop/${appId}`, origin);
  redirectUrl.searchParams.set('domainConnect', status);
  if (domain) redirectUrl.searchParams.set('domain', domain);
  const response: NextResponse = NextResponse.redirect(redirectUrl.toString());
  response.headers.append('Set-Cookie', clearNonceCookie(appId));
  return response;
}

/**
 * GET /api/apps/[id]/domain-connect/[provider]/callback
 *
 * Handles the redirect back from the DNS provider after the user approves
 * (or denies) the Domain Connect template. Validates the CSRF nonce stored
 * in the httpOnly cookie set by the /url route, then redirects to the
 * develop page with ?domainConnect=success|error so the UI can show a banner.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; provider: string }> },
): Promise<NextResponse> {
  const { id: appId } = await params;
  const { searchParams } = new URL(request.url);

  const domain: string = searchParams.get('domain') ?? '';
  const stateParam: string | null = searchParams.get('state');
  const errorParam: string | null = searchParams.get('error');

  if (errorParam) {
    logger.warn('domain-connect.callback.provider-error', {
      message: 'Provider returned an error',
      appId,
      domain,
      error: errorParam,
    });
    return buildDevelopRedirect(request, appId, 'error', domain);
  }

  if (!stateParam) {
    logger.warn('domain-connect.callback.missing-state', { appId, domain });
    return buildDevelopRedirect(request, appId, 'error', domain);
  }

  const state: StatePayload | null = decodeState(stateParam);
  if (!state || state.appId !== appId) {
    logger.warn('domain-connect.callback.invalid-state', { appId, domain });
    return buildDevelopRedirect(request, appId, 'error', domain);
  }

  const cookieNonce: string | undefined = request.cookies.get(buildNonceCookieName(appId))?.value;

  if (!cookieNonce || cookieNonce !== state.nonce) {
    logger.warn('domain-connect.callback.csrf-mismatch', { appId, domain });
    return buildDevelopRedirect(request, appId, 'error', domain);
  }

  logger.info('domain-connect.callback.success', { appId, domain: state.fqdn });
  return buildDevelopRedirect(request, appId, 'success', state.fqdn || domain);
}
