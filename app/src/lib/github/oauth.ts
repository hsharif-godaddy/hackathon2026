import { createHash, randomBytes } from 'node:crypto';

import { logger } from '@/lib/request-context';
import { get as getConfig } from './config';

/**
 * PKCE + CSRF helpers for GitHub App OAuth flow.
 *
 * Tokens are exchanged server-side and stored in app secrets —
 * they never reach the browser. Cookies are short-lived (5 min)
 * and scoped to /api/github.
 */

const OAUTH_COOKIE_MAX_AGE = 300;
const OAUTH_COOKIE_PATH = '/api/github';

function base64url(buffer: Buffer): string {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

export function generateNonce(): string {
  return randomBytes(32).toString('hex');
}

export function generateCodeVerifier(): string {
  return base64url(randomBytes(64));
}

export function generateCodeChallenge(verifier: string): string {
  return base64url(createHash('sha256').update(verifier).digest());
}

export interface OAuthState {
  appId: string;
  returnTo: string;
  nonce: string;
}

export function encodeState(state: OAuthState): string {
  return Buffer.from(JSON.stringify(state)).toString('base64url');
}

export function decodeState(encoded: string): OAuthState | null {
  try {
    return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

export function buildOAuthCookie(name: string, value: string): string {
  const parts = [
    `${name}=${value}`,
    'HttpOnly',
    `Path=${OAUTH_COOKIE_PATH}`,
    `Max-Age=${OAUTH_COOKIE_MAX_AGE}`,
    'SameSite=Lax',
  ];
  if (process.env.NODE_ENV === 'production') {
    parts.push('Secure');
  }
  return parts.join('; ');
}

export function clearOAuthCookie(name: string): string {
  return `${name}=; HttpOnly; Path=${OAUTH_COOKIE_PATH}; Max-Age=0; SameSite=Lax`;
}

export function parseCookies(cookieHeader: string | null): Record<string, string> {
  if (!cookieHeader) return {};
  const result: Record<string, string> = {};
  for (const pair of cookieHeader.split(';')) {
    const [key, ...rest] = pair.trim().split('=');
    if (key) {
      result[key.trim()] = rest.join('=').trim();
    }
  }
  return result;
}

export interface GitHubTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
}

export async function exchangeCodeForTokens(
  code: string,
  codeVerifier: string,
  redirectUri: string,
): Promise<GitHubTokenResponse> {
  const config = getConfig();

  const res = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    logger.error('github.oauth.token-exchange.http-error', { status: res.status, body: text });
    throw new Error(`GitHub token exchange HTTP ${res.status}`);
  }

  const data = await res.json();

  if (data.error) {
    logger.error('github.oauth.token-exchange.failed', {
      error: data.error,
      description: data.error_description,
    });
    throw new Error(`GitHub token exchange failed: ${data.error_description || data.error}`);
  }

  if (!data.access_token || typeof data.expires_in !== 'number') {
    throw new Error('GitHub token response missing required fields');
  }

  return data as GitHubTokenResponse;
}

export async function refreshAccessToken(refreshToken: string): Promise<GitHubTokenResponse> {
  const config = getConfig();

  const res = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    logger.error('github.oauth.refresh.http-error', { status: res.status, body: text });
    throw new Error(`GitHub token refresh HTTP ${res.status}`);
  }

  const data = await res.json();

  if (data.error) {
    logger.error('github.oauth.refresh.failed', {
      error: data.error,
      description: data.error_description,
    });
    throw new Error(`GitHub token refresh failed: ${data.error_description || data.error}`);
  }

  if (!data.access_token || typeof data.expires_in !== 'number') {
    throw new Error('GitHub token refresh response missing required fields');
  }

  return data as GitHubTokenResponse;
}

/**
 * Validates that returnTo is a relative path (no open redirect).
 */
export function validateReturnTo(returnTo: string): boolean {
  if (!returnTo) return false;
  if (!returnTo.startsWith('/')) return false;
  if (returnTo.startsWith('//')) return false;
  try {
    const url = new URL(returnTo, 'http://localhost');
    return url.pathname === returnTo || url.pathname + url.search === returnTo;
  } catch {
    return false;
  }
}
