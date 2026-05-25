import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import https from 'node:https';

import { z } from 'zod';

import { logger } from '@/lib/request-context';

// Single discriminated state — either we have both fields populated, or the
// cache is empty. The previous shape ({ token: string|null, expiresAt: number|null })
// admitted half-populated states that the runtime check at lines 32-34 had to
// guard against; using a nullable record removes the impossible-by-construction.
let tokenCache: { token: string; expiresAt: number } | null = null;
let refreshPromise: Promise<string> | null = null;

// SSO returns one of three field shapes depending on the realm; trimmed-string
// fallback keeps us compatible with opaque token responses.
const SsoResponseSchema = z.object({
  data: z.string().optional(),
  access_token: z.string().optional(),
  token: z.string().optional(),
});

const DEFAULT_SSO_ENDPOINT = 'https://sso.test-godaddy.com/v1/secure/api/token';
const DEFAULT_CERT_PATH = '/workspace/app/certs/dkim-client.crt';
const DEFAULT_KEY_PATH = '/workspace/app/certs/dkim-client.key';

function getSsoEndpoint(): string {
  const endpoint = process.env.DKIM_SSO_ENDPOINT;
  if (!endpoint) {
    // No silent test-routing: surface in logs that we're using the dev
    // default. A misconfigured prod deploy that lacks DKIM_SSO_ENDPOINT
    // will route to test-godaddy.com — visible here, fixable from logs.
    logger.warn('dkim.cert-token.sso-endpoint.default', { default: DEFAULT_SSO_ENDPOINT });
    return DEFAULT_SSO_ENDPOINT;
  }
  return endpoint;
}

async function loadCert(): Promise<{ cert: string; key: string }> {
  const certEnv = process.env.DKIM_CLIENT_CERT;
  const keyEnv = process.env.DKIM_CLIENT_KEY;

  if (certEnv && keyEnv) {
    return { cert: certEnv, key: keyEnv };
  }

  const certPath = process.env.DKIM_CLIENT_CERT_PATH ?? DEFAULT_CERT_PATH;
  const keyPath = process.env.DKIM_CLIENT_KEY_PATH ?? DEFAULT_KEY_PATH;

  // Same rationale as getSsoEndpoint — surface default-path use so prod
  // deploys missing the env vars are visible at the first token mint.
  if (!process.env.DKIM_CLIENT_CERT_PATH) {
    logger.warn('dkim.cert-token.cert-path.default', { default: DEFAULT_CERT_PATH });
  }
  if (!process.env.DKIM_CLIENT_KEY_PATH) {
    logger.warn('dkim.cert-token.key-path.default', { default: DEFAULT_KEY_PATH });
  }

  if (!existsSync(certPath) || !existsSync(keyPath)) {
    throw new Error(`DKIM client certificates not found at ${certPath} / ${keyPath}`);
  }

  const [cert, key] = await Promise.all([readFile(certPath, 'utf8'), readFile(keyPath, 'utf8')]);
  return { cert, key };
}

function makeTokenRequest(ssoEndpoint: string, cert: string, key: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = new URL(ssoEndpoint);
    const body = JSON.stringify({ realm: 'cert' });

    const req = https.request(
      {
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname,
        method: 'POST',
        cert,
        key,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: 10_000,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk: string) => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            const trimmed = data.trim();
            try {
              const parsed = SsoResponseSchema.parse(JSON.parse(data));
              const token = parsed.data ?? parsed.access_token ?? parsed.token ?? trimmed;
              if (token) { resolve(token); } else { reject(new Error('Empty token from SSO')); }
            } catch {
              // Body wasn't JSON or didn't match the schema — fall back to
              // treating the response as the raw token string. Some SSO
              // realms emit opaque tokens with no JSON wrapping.
              if (trimmed) { resolve(trimmed); } else { reject(new Error('Empty SSO response')); }
            }
          } else {
            reject(new Error(`SSO cert auth failed: ${res.statusCode}`));
          }
        });
      },
    );

    req.on('error', (err: Error) => reject(err));
    req.on('timeout', () => { req.destroy(); reject(new Error('SSO request timed out')); });
    req.write(body);
    req.end();
  });
}

export async function getDkimServiceToken(): Promise<string> {
  const now = Date.now();

  if (tokenCache && now < tokenCache.expiresAt) {
    return tokenCache.token;
  }

  if (refreshPromise) return refreshPromise;

  refreshPromise = (async (): Promise<string> => {
    try {
      const { cert, key } = await loadCert();
      const token = await makeTokenRequest(getSsoEndpoint(), cert, key);

      // Derive expiry from the JWT exp claim when we have one. Fall back
      // to 55 minutes (1-min buffer under SSO's 1h default) if the token
      // is opaque or the exp claim is missing.
      let expiresAt = now + 55 * 60 * 1000;
      const segments = token.split('.');
      if (segments.length === 3 && segments[1]) {
        try {
          // 'base64url' is the correct contract for JWT segments per RFC 7515 §2.
          // Node's 'base64' decoder is forgiving and would usually work too, but
          // tokens with characters that differ between the two alphabets (`-`/`+`,
          // `_`/`/`) decode incorrectly with 'base64' — and that failure would
          // be silently swallowed by the catch below + 55-min fallback.
          const payload = JSON.parse(Buffer.from(segments[1], 'base64url').toString()) as { exp?: number };
          if (typeof payload.exp === 'number') {
            expiresAt = payload.exp * 1000 - 60_000; // 1-min buffer
          }
        } catch (err) {
          // Don't silently use the fallback — surface the parse failure
          // so an SSO change that breaks our exp-derivation is visible.
          logger.warn('dkim.cert-token.exp-parse.fallback', {
            error: err instanceof Error ? err.message : String(err),
            fallback_ms: 55 * 60 * 1000,
          });
        }
      } else {
        logger.info('dkim.cert-token.opaque', { fallback_ms: 55 * 60 * 1000 });
      }

      tokenCache = { token, expiresAt };
      logger.info('dkim.cert-token.refreshed', {});
      return token;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

// Test-only: clear the in-process cache so unit tests can exercise
// fresh-fetch and stale-refresh paths without leaking state.
export function _clearTokenCacheForTesting(): void {
  tokenCache = null;
  refreshPromise = null;
}
