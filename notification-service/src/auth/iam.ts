// @ts-expect-error - gd-auth-client is a CommonJS module without TypeScript definitions
import { IamTokenClient } from 'gd-auth-client';

import { getSsoHost } from '../config.js';
import { logger } from '../logger.js';

interface TokenCache {
  token: string;
  expiresAt: number;
  refreshPromise: Promise<string> | null;
}

// 30-minute TTL — conservative to stay well within IAM token lifetime
const TOKEN_TTL_MS = 30 * 60 * 1000;

const cache: TokenCache = {
  token: '',
  expiresAt: 0,
  refreshPromise: null,
};

async function refresh(): Promise<string> {
  const ssoHost = getSsoHost();
  logger.debug('iam.token.refresh_start', { ssoHost });

  const client = new IamTokenClient(ssoHost) as {
    getToken(): Promise<string>;
    once?(event: string, handler: (err: { message?: string }) => void): void;
  };

  client.once?.('background_error', (err: { message?: string }) => {
    logger.error('iam.token.primary_region_failure', { message: err.message });
  });

  const token = await client.getToken();
  if (!token) throw new Error('IamTokenClient returned empty token');

  cache.token = token;
  cache.expiresAt = Date.now() + TOKEN_TTL_MS;

  logger.info('iam.token.refresh_done', {
    ssoHost,
    expiresAt: new Date(cache.expiresAt).toISOString(),
    ttlMs: TOKEN_TTL_MS,
  });

  return token;
}

export async function getIamToken(): Promise<string> {
  if (cache.token && Date.now() < cache.expiresAt) {
    logger.info('iam.token.cache_hit', { expiresAt: new Date(cache.expiresAt).toISOString() });
    return cache.token;
  }

  if (cache.refreshPromise) {
    logger.debug('iam.token.refresh_in_flight', { action: 'awaiting_existing_promise' });
    return cache.refreshPromise;
  }

  logger.debug('iam.token.refresh_required', { reason: cache.token ? 'expired' : 'no_token' });
  cache.refreshPromise = refresh().finally(() => {
    cache.refreshPromise = null;
  });

  return cache.refreshPromise;
}

export function clearIamTokenCache(): void {
  logger.debug('iam.token.cache_cleared');
  cache.token = '';
  cache.expiresAt = 0;
  // Intentionally leave refreshPromise intact — nulling it would break the single-flight invariant,
  // causing concurrent callers to each start a new refresh instead of coalescing.
}
