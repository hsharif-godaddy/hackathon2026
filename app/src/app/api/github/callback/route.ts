import { NextRequest, NextResponse } from 'next/server';

import { type CustomerAuthContext,withCustomerAuth } from '@/lib/customer-auth';
import {
  callbackUrl,
  clearOAuthCookie,
  decodeState,
  enforce,
  exchangeCodeForTokens,
  parseCookies,
  publicOrigin,
  saveTokens,
  validateReturnTo,
} from '@/lib/github';
import { logger } from '@/lib/request-context';

function safeReturnTo(raw: string | undefined): string {
  if (raw && validateReturnTo(raw)) return raw;
  return '/';
}

export const dynamic = 'force-dynamic';

/**
 * GitHub App install callbacks are cross-site redirects from github.com
 * and may not carry session cookies, so the install branch is NOT auth-gated.
 * OAuth code exchange IS auth-gated (needs JWT to store secrets).
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);

  // GitHub App installation callback (no code exchange needed)
  if (searchParams.get('setup_action') === 'install') {
    return handleInstallCallback(request);
  }

  // OAuth code exchange — needs auth for secret storage
  return handleOAuthCallback(request);
}

function handleInstallCallback(request: NextRequest): NextResponse {
  const { searchParams } = new URL(request.url);
  const stateParam = searchParams.get('state');
  const state = stateParam ? decodeState(stateParam) : null;

  const response = NextResponse.redirect(new URL(safeReturnTo(state?.returnTo), publicOrigin(request)));
  response.headers.append('Set-Cookie', clearOAuthCookie('gh_oauth_nonce'));
  return response;
}

const handleOAuthCallback = withCustomerAuth(async (
  request: NextRequest,
  authContext: CustomerAuthContext,
): Promise<NextResponse> => {
  const blocked = await enforce(request);
  if (blocked) return blocked;

  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const stateParam = searchParams.get('state');
  const error = searchParams.get('error');

  if (error) {
    logger.warn('github.callback.oauth-error', {
      error,
      description: searchParams.get('error_description'),
    });
    const state = stateParam ? decodeState(stateParam) : null;
    const returnUrl = new URL(safeReturnTo(state?.returnTo), publicOrigin(request));
    returnUrl.searchParams.set('github_error', error);
    return NextResponse.redirect(returnUrl.toString());
  }

  if (!code || !stateParam) {
    return NextResponse.json({ error: 'Missing code or state' }, { status: 400 });
  }

  const state = decodeState(stateParam);
  if (!state) {
    return NextResponse.json({ error: 'Invalid state parameter' }, { status: 400 });
  }

  const cookies = parseCookies(request.headers.get('cookie'));
  const cookieNonce = cookies['gh_oauth_nonce'];
  const codeVerifier = cookies['gh_pkce_verifier'];

  if (!cookieNonce || cookieNonce !== state.nonce) {
    logger.warn('github.callback.csrf-mismatch', { appId: state.appId });
    return NextResponse.json({ error: 'CSRF validation failed' }, { status: 403 });
  }

  if (!codeVerifier) {
    return NextResponse.json({ error: 'Missing PKCE verifier' }, { status: 400 });
  }

  const redirectUri = callbackUrl(request);

  try {
    const tokens = await exchangeCodeForTokens(code, codeVerifier, redirectUri);

    await saveTokens(state.appId, authContext.jwt!, {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: Math.floor(Date.now() / 1000) + tokens.expires_in,
    });

    logger.info('github.callback.success', { appId: state.appId });
  } catch (err) {
    logger.error('github.callback.token-exchange.failed', {
      appId: state.appId,
      error: err instanceof Error ? err.message : String(err),
    });
    const returnUrl = new URL(safeReturnTo(state.returnTo), publicOrigin(request));
    returnUrl.searchParams.set('github_error', 'token_exchange_failed');
    const response = NextResponse.redirect(returnUrl.toString());
    response.headers.append('Set-Cookie', clearOAuthCookie('gh_oauth_nonce'));
    response.headers.append('Set-Cookie', clearOAuthCookie('gh_pkce_verifier'));
    return response;
  }

  const response = NextResponse.redirect(new URL(safeReturnTo(state.returnTo), publicOrigin(request)));
  response.headers.append('Set-Cookie', clearOAuthCookie('gh_oauth_nonce'));
  response.headers.append('Set-Cookie', clearOAuthCookie('gh_pkce_verifier'));
  return response;
}, { level: 3 });
