// @ts-expect-error - gd-auth-client is a CommonJS module without TypeScript definitions
import { getTokenFromCertificate } from 'gd-auth-client';

import { config, getSsoHost } from '../config.js';
import { logger } from '../logger.js';

interface TokenCache {
  token: string;
  expiresAt: number;
  refreshPromise: Promise<string> | null;
}

const cache: TokenCache = {
  token: '',
  expiresAt: 0,
  refreshPromise: null,
};

async function refresh(): Promise<string> {
  const ssoHost = getSsoHost();
  logger.debug('cert-sso.token.refresh_start', { ssoHost });

  const token: string = await getTokenFromCertificate(ssoHost, config.MGMT_CERT, config.MGMT_KEY);
  if (!token) throw new Error('getTokenFromCertificate returned empty token');

  let expiresAt = Date.now() + 3600 * 1000;
  try {
    const parts = token.split('.');
    if (parts.length === 3 && parts[1]) {
      const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8')) as { exp?: number };
      if (typeof payload.exp === 'number') expiresAt = payload.exp * 1000;
    }
  } catch {
    // use default 1-hour TTL
  }

  cache.token = token;
  // Refresh 60s before actual expiry
  cache.expiresAt = expiresAt - 60_000;

  logger.debug('cert-sso.token.refresh_done', {
    ssoHost,
    expiresAt: new Date(cache.expiresAt).toISOString(),
    ttlMs: cache.expiresAt - Date.now(),
  });

  return token;
}

export async function getCertSsoToken(): Promise<string> {
  if (cache.token && Date.now() < cache.expiresAt) {
    return cache.token;
  }

  if (cache.refreshPromise) {
    logger.debug('cert-sso.token.refresh_in_flight', { action: 'awaiting_existing_promise' });
    return cache.refreshPromise;
  }

  logger.debug('cert-sso.token.refresh_required', { reason: cache.token ? 'expired' : 'no_token' });
  cache.refreshPromise = refresh().finally(() => {
    cache.refreshPromise = null;
  });

  return cache.refreshPromise;
}

export function clearCertSsoCache(): void {
  logger.debug('cert-sso.token.cache_cleared');
  cache.token = '';
  cache.expiresAt = 0;
  // Intentionally leave refreshPromise intact: if a refresh is already in-flight,
  // nulling it here breaks the single-flight invariant — concurrent callers would
  // each start their own refresh instead of coalescing onto the existing one.
}
