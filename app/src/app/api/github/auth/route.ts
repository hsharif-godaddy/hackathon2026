import { NextRequest, NextResponse } from 'next/server';

import { type CustomerAuthContext,withCustomerAuth } from '@/lib/customer-auth';
import {
  buildOAuthCookie,
  callbackUrl,
  encodeState,
  enforce,
  generateCodeChallenge,
  generateCodeVerifier,
  generateNonce,
  getConfig,
  validateReturnTo,
} from '@/lib/github';

export const dynamic = 'force-dynamic';

export const GET = withCustomerAuth(async (
  request: NextRequest,
  _authContext: CustomerAuthContext,
): Promise<NextResponse> => {
  const gateResponse = await enforce(request);
  if (gateResponse) return gateResponse;

  const { searchParams } = new URL(request.url);
  const appId = searchParams.get('appId');
  const returnTo = searchParams.get('returnTo') ?? '/';
  const action = searchParams.get('action');

  if (!appId) {
    return NextResponse.json({ error: 'appId is required' }, { status: 400 });
  }

  if (!validateReturnTo(returnTo)) {
    return NextResponse.json({ error: 'Invalid returnTo path' }, { status: 400 });
  }

  const config = getConfig();
  const nonce = generateNonce();

  const state = encodeState({ appId, returnTo, nonce });

  const redirectUri = callbackUrl(request);

  if (action === 'install') {
    // GitHub App installations redirect to the "Setup URL" configured in the
    // App settings, not to a redirect_uri param. Only state is forwarded.
    const installUrl = new URL(config.installUrl);
    installUrl.searchParams.set('state', state);

    const response = NextResponse.redirect(installUrl.toString());
    response.headers.append('Set-Cookie', buildOAuthCookie('gh_oauth_nonce', nonce));
    return response;
  }

  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);

  const authorizeUrl = new URL(config.authorizeUrl);
  authorizeUrl.searchParams.set('client_id', config.clientId);
  authorizeUrl.searchParams.set('redirect_uri', redirectUri);
  authorizeUrl.searchParams.set('state', state);
  authorizeUrl.searchParams.set('code_challenge', codeChallenge);
  authorizeUrl.searchParams.set('code_challenge_method', 'S256');

  const response = NextResponse.redirect(authorizeUrl.toString());
  response.headers.append('Set-Cookie', buildOAuthCookie('gh_oauth_nonce', nonce));
  response.headers.append('Set-Cookie', buildOAuthCookie('gh_pkce_verifier', codeVerifier));
  return response;
});
