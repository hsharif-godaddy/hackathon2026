import { NextRequest } from 'next/server';

import { logger } from '@/lib/request-context';

export interface GitHubAppConfig {
  clientId: string;
  clientSecret: string;
  appSlug: string;
  authorizeUrl: string;
  tokenUrl: string;
  apiBase: string;
  installUrl: string;
  redirectPath: string;
}

export function get(): GitHubAppConfig {
  const clientId = process.env.GITHUB_APP_CLIENT_ID ?? '';
  const clientSecret = process.env.GITHUB_APP_CLIENT_SECRET ?? '';
  const appSlug = process.env.GITHUB_APP_SLUG ?? '';

  if (!clientId || !clientSecret) {
    logger.warn('github.config.missing', {
      hasClientId: Boolean(clientId),
      hasClientSecret: Boolean(clientSecret),
      hasAppSlug: Boolean(appSlug),
    });
  }

  return {
    clientId,
    clientSecret,
    appSlug,
    authorizeUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    apiBase: 'https://api.github.com',
    installUrl: `https://github.com/apps/${appSlug}/installations/new`,
    redirectPath: '/api/github/callback',
  };
}

/**
 * Public-facing origin derived from the request's host header.
 * Next.js `request.url` uses the internal server address (e.g. localhost:3000),
 * which differs from the browser-facing URL behind proxies / dev-certs.
 */
export function publicOrigin(request: NextRequest): string {
  const host = request.headers.get('host') ?? 'localhost:3000';
  const proto = (request.headers.get('x-forwarded-proto') ?? 'https').split(',')[0].trim();
  return `${proto}://${host}`;
}

export function callbackUrl(request: NextRequest): string {
  return `${publicOrigin(request)}${get().redirectPath}`;
}
