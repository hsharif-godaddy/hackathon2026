/**
 * Generic S2S authentication using a named AWS profile.
 *
 * Unlike s2s-auth.ts this module has zero GoCode coupling.
 * Callers must supply awsProfile and ssoHost explicitly;
 * credentials are loaded via fromIni({ profile }) so the
 * matching [profile …] section must exist in ~/.aws/config.
 *
 * Token cache is keyed by `${awsProfile}::${ssoHost}` so the
 * same profile against different SSO hosts won't cross-contaminate.
 */

// @ts-expect-error - gd-auth-client is a CommonJS module without TypeScript definitions
import { IamTokenClient } from 'gd-auth-client'
import { fromIni } from '@aws-sdk/credential-providers'

import { createLogger } from '@airo/ai-common'

const logger = createLogger('s2s-auth-v2')

export interface S2SAuthV2Config {
  awsProfile: string;
  ssoHost: string;
}

interface TokenCacheEntry {
  jwt: string;
  expiresAt: number;
}

const tokenCache = new Map<string, TokenCacheEntry>();
const inflightRefreshes = new Map<string, Promise<string>>();

function cacheKey({ awsProfile, ssoHost }: S2SAuthV2Config): string {
  return `${awsProfile}::${ssoHost}`;
}

function decodeJwtPayload(jwt: string): Record<string, unknown> {
  const parts = jwt.split('.');
  if (parts.length !== 3 || !parts[1]) {
    throw new Error('Invalid JWT format');
  }
  return JSON.parse(Buffer.from(parts[1], 'base64').toString());
}

function isCachedTokenValid(key: string): boolean {
  const entry = tokenCache.get(key);
  if (!entry) return false;
  // 60-second safety buffer before expiry
  return Date.now() < entry.expiresAt - 60_000;
}

export function isS2SAuthV2Enabled(): boolean {
  return process.env.USE_S2S_AUTH === 'true';
}

/**
 * Clear cached token(s). Omit config to flush everything.
 */
export function clearTokenCacheV2(config?: S2SAuthV2Config): void {
  if (config) {
    const key = cacheKey(config);
    tokenCache.delete(key);
    inflightRefreshes.delete(key);
  } else {
    tokenCache.clear();
    inflightRefreshes.clear();
  }
}

async function fetchToken(config: S2SAuthV2Config): Promise<string> {
  const { awsProfile, ssoHost } = config;
  logger.info('s2s-auth-v2.token.fetch', { awsProfile, ssoHost });
  const credentialProvider = fromIni({ profile: awsProfile });
  const creds = await credentialProvider();

  if (!creds.accessKeyId || !creds.secretAccessKey) {
    throw new Error(
      `AWS credentials for profile "${awsProfile}" are empty or expired. ` +
      `Run: aws sso login --profile ${awsProfile}`,
    );
  }

  const client = new IamTokenClient(ssoHost, {
    credentialProviderChain: () => Promise.resolve({
      accessKeyId: creds.accessKeyId,
      secretAccessKey: creds.secretAccessKey,
      sessionToken: creds.sessionToken,
    }),
  });

  client.once('background_error', (err: { message?: string; code?: string; name?: string }) => {
    logger.error('s2s-auth-v2.token.primary_region_failure', {
      message: err.message,
      code: err.code,
      ssoHost,
      awsProfile,
      errorName: err.name,
    });
  });

  const jwt: string = await client.getToken();

  let payload: Record<string, unknown>;
  try {
    payload = decodeJwtPayload(jwt);
  } catch (err) {
    logger.warn('s2s-auth-v2.token.decode_failed', {
      awsProfile,
      ssoHost,
      jwtLength: jwt.length,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }

  const expSeconds = typeof payload.exp === 'number'
    ? payload.exp
    : typeof payload.iat === 'number'
      ? payload.iat + 30 * 60
      : null;

  if (expSeconds === null) {
    logger.warn('s2s-auth-v2.token.exp_missing', {
      awsProfile,
      ssoHost,
      message: 'JWT has neither exp nor iat — using 30min from now',
    });
  }

  const expiresAt = expSeconds !== null
    ? expSeconds * 1000
    : Date.now() + 30 * 60 * 1000;

  const key = cacheKey(config);
  tokenCache.set(key, { jwt, expiresAt });
  const iamRoleArn = typeof payload.sub === 'string' ? payload.sub : undefined;
  logger.info('s2s-auth-v2.token.acquired', {
    awsProfile,
    ssoHost,
    expiresInSeconds: Math.round((expiresAt - Date.now()) / 1000),
    iamRoleArn,
  });
  return jwt;
}

export async function getS2STokenV2(config: S2SAuthV2Config): Promise<string> {
  const key = cacheKey(config);
  if (isCachedTokenValid(key)) {
    logger.info('s2s-auth-v2.token.cache_hit', { awsProfile: config.awsProfile });
    return tokenCache.get(key)!.jwt;
  }

  const inflight = inflightRefreshes.get(key);
  if (inflight) return inflight;

  const promise = fetchToken(config).finally(() => {
    inflightRefreshes.delete(key);
  });
  inflightRefreshes.set(key, promise);
  return promise;
}

export async function refreshS2STokenV2(config: S2SAuthV2Config): Promise<string> {
  clearTokenCacheV2(config);
  return getS2STokenV2(config);
}
