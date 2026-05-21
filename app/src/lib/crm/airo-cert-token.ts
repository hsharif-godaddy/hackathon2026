/**
 * Airo client-cert SSO token singleton.
 *
 * Mints SSO JWTs by presenting the airo-builder client cert (mTLS) to GoDaddy
 * SSO. Used by the Profile API and CRM clients to authenticate calls into
 * GoDaddy internal services. Env-only: when `AIRO_CLIENT_CERT` and
 * `AIRO_CLIENT_KEY` are not set, callers should treat the feature as disabled
 * (use `isConfigured()` to fail fast).
 *
 * Token cache reads the JWT's actual `exp` claim (with a 5-min safety margin)
 * so we don't pay the SSO mint cost on every CRM call. Per-request mint
 * added measurable latency to the user-facing fanout, contributing to the
 * 15s timeout failures we saw against the test-godaddy CMAPI tail.
 *
 * NOTE: this duplicates a small amount of SSO-mint logic from
 * `lib/product-graph/cert-token-service.ts`. Consolidation into a shared
 * `CertTokenService` is intentionally deferred to a follow-up PR.
 */

import https from 'node:https';

import { logger } from '@/lib/request-context';

const ENV_CERT = 'AIRO_CLIENT_CERT';
const ENV_KEY = 'AIRO_CLIENT_KEY';
const ENV_SSO = 'AIRO_SSO_ENDPOINT';
const DEFAULT_SSO_ENDPOINT = 'https://sso.test-godaddy.com/v1/secure/api/token';
const REALM = 'cert';
const LOG_DOMAIN = 'cert-token.airo';

// Cache safety margin: never hand out a token within this window of expiry.
// Ensures a CRM call that sees a "valid" token won't have it expire mid-RTT.
const MIN_LIFETIME_MS = 5 * 60 * 1000;
// Fallback TTL when the JWT lacks an `exp` claim (defensive — current SSO
// always sets it). 50 min matches the documented ~1h SSO token lifetime
// minus the safety margin.
const FALLBACK_TTL_MS = 50 * 60 * 1000;

interface SSOResponse {
  data?: string;
  access_token?: string;
  token?: string;
}

interface CachedToken {
  token: string;
  expiresAt: number;
}

/**
 * Read the JWT's `exp` claim (Unix epoch seconds) and convert to ms. Returns
 * null if the JWT is malformed or `exp` is absent. Base64url decode handles
 * `-` and `_` characters that plain base64 silently mis-decodes.
 *
 * NOTE: this codebase has THREE near-identical decoders. They diverge by
 * design — but the divergence is subtle and worth documenting:
 *   - This file (`app/src/lib/crm/airo-cert-token.ts`) — cert-realm SSO,
 *     null-on-missing-exp + FALLBACK_TTL_MS (50min). Cert tokens always
 *     ship `exp` today; the fallback is defensive only.
 *   - `investigator/crm-token.mjs` — same cert-realm SSO from the Lambda
 *     side. Identical semantics (null + 50min fallback).
 *   - `investigator/auth.mjs` — GoCode S2S JWTs (different issuer). These
 *     provably lack `exp` (only `iat`), so it derives expiry from
 *     `iat + GOCODE_JWT_LIFETIME_MS` and THROWS when both are missing.
 *
 * If the cert-realm issuer ever changes its claim shape, expect that
 * divergence to surface differently in BFF (silent stale cache) vs
 * Lambda S2S (loud throw). Consolidation deferred — see follow-up note in
 * the file-level docblock above.
 */
function decodeJwtExpMs(jwt: string): number | null {
  try {
    const parts = jwt.split('.');
    if (parts.length !== 3 || !parts[1]) return null;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString()) as { exp?: number };
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

class AiroCertTokenService {
  private cached: CachedToken | null = null;
  // In-flight mint, shared across concurrent callers so a burst of feedback
  // submissions in the same Node process doesn't stampede SSO. The first
  // miss starts the mint; every subsequent caller awaits the same Promise.
  private inflight: Promise<string> | null = null;

  isConfigured(): boolean {
    return Boolean(process.env[ENV_CERT] && process.env[ENV_KEY]);
  }

  async getToken(): Promise<string> {
    if (this.cached && this.cached.expiresAt - Date.now() > MIN_LIFETIME_MS) {
      return this.cached.token;
    }
    if (this.inflight) return this.inflight;

    this.inflight = this.mintFresh().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async mintFresh(): Promise<string> {
    const cert = process.env[ENV_CERT];
    const key = process.env[ENV_KEY];
    if (!cert || !key) {
      const message = `${ENV_CERT}/${ENV_KEY} env vars not set`;
      logger.error(`${LOG_DOMAIN}.not-configured`, { message });
      throw new Error(message);
    }

    const ssoEndpoint = process.env[ENV_SSO] || DEFAULT_SSO_ENDPOINT;
    logger.info(`${LOG_DOMAIN}.mint.start`, { endpoint: ssoEndpoint });
    const token = await this.makeSSORequest(new URL(ssoEndpoint), cert, key, JSON.stringify({ realm: REALM }));
    const expMs = decodeJwtExpMs(token);
    const expiresAt = expMs ?? (Date.now() + FALLBACK_TTL_MS);
    this.cached = { token, expiresAt };
    logger.info(`${LOG_DOMAIN}.mint.success`, { ttlMs: expiresAt - Date.now() });
    return token;
  }

  /** Test seam — clears the cached token so unit tests start clean. */
  _resetCacheForTests(): void {
    this.cached = null;
    this.inflight = null;
  }

  private makeSSORequest(url: URL, cert: string, key: string, body: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
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
          timeout: 15000,
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => { data += chunk; });
          res.on('end', () => {
            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
              // Require valid JSON. Falling back to `data.trim()` would let an
              // HTML captive-portal / proxy-interception body become a
              // "token" string and break every downstream call confusingly.
              let parsed: SSOResponse;
              try {
                parsed = JSON.parse(data);
              } catch {
                logger.error(`${LOG_DOMAIN}.sso.response.not-json`, {
                  statusCode: res.statusCode,
                  responseSnippet: data.slice(0, 200),
                });
                reject(new Error('SSO 2xx response was not JSON'));
                return;
              }
              // `JSON.parse('null')` and `JSON.parse('"x"')` both succeed but
              // produce non-objects. Reading `.data` off them would throw a
              // sync TypeError inside this event-handler, escaping the
              // Promise and leaving it unsettled until the request timeout.
              if (parsed === null || typeof parsed !== 'object') {
                logger.error(`${LOG_DOMAIN}.sso.response.not-object`, {
                  statusCode: res.statusCode,
                  responseSnippet: data.slice(0, 200),
                });
                reject(new Error('SSO 2xx response was not a JSON object'));
                return;
              }
              const token = parsed.data ?? parsed.access_token ?? parsed.token;
              if (!token) {
                // Keys only, not values — SSO error envelopes can carry
                // sensitive context. Knowing the shape is enough to debug.
                logger.error(`${LOG_DOMAIN}.sso.response.no-token`, {
                  statusCode: res.statusCode,
                  responseKeys: Object.keys(parsed),
                });
                reject(new Error('SSO response missing token field'));
                return;
              }
              resolve(token);
            } else {
              logger.error(`${LOG_DOMAIN}.sso.request.failed`, {
                statusCode: res.statusCode,
                responseSnippet: data.slice(0, 500),
              });
              reject(new Error(`SSO authentication failed with status ${res.statusCode}`));
            }
          });
        },
      );

      req.on('error', (err) => {
        logger.error(`${LOG_DOMAIN}.sso.request.error`, { error: err.message });
        reject(err);
      });
      req.on('timeout', () => {
        logger.error(`${LOG_DOMAIN}.sso.timeout`, { message: 'SSO request timed out' });
        req.destroy();
        reject(new Error('SSO request timed out'));
      });

      req.write(body);
      req.end();
    });
  }
}

export const airoCertTokenService = new AiroCertTokenService();
