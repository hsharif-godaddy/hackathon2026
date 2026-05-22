/**
 * Mints a GoDaddy SSO JWT using the Lambda's client cert from Secrets Manager.
 *
 * Uses Node's built-in `https` module for mTLS — `undici` is not bundled in
 * the Lambda image. Mirrors the BFF pattern in `app/src/lib/crm/airo-cert-token.ts`.
 *
 * Cache TTL is derived from the JWT's actual `exp` claim, with a 5-min safety
 * margin so we never hand a near-expired token to the CRM caller. SSO has
 * historically returned ~1h tokens, but reading `exp` defends against the
 * issuer ever shortening lifetime: a hard-coded 50-min cache would silently
 * hand expired tokens through that change. Falls back to FALLBACK_TTL_MS when
 * `exp` is missing or unreadable.
 */

import https from 'node:https';

import { loadCrmCert } from './cert-loader.mjs';

const MIN_LIFETIME_MS = 5 * 60 * 1000;
const FALLBACK_TTL_MS = 50 * 60 * 1000;
const DEFAULT_SSO_ENDPOINT = 'https://sso.test-godaddy.com/v1/secure/api/token';

/** @type {{ token: string; expiresAt: number } | null} */
let cachedCrmJwt = null;
/**
 * In-flight mint — coalesces concurrent callers within a single warm
 * container. The Lambda generally serializes invocations, but a fast
 * SSE-style burst across container reuses can still race the cache miss;
 * this guarantees one SSO call per cache window even under that race.
 * @type {Promise<string> | null}
 */
let inflightCrmJwt = null;

/**
 * Decodes a JWT and returns its `exp` as Unix epoch ms, or null if the
 * claim is absent / the JWT is malformed. JWT body is base64url; using
 * 'base64url' (Node 16+) avoids silent mis-decoding when `-` or `_` appear.
 *
 * NOTE: cross-reference for the three near-identical decoders in this
 * codebase. Divergence is intentional but subtle:
 *   - `app/src/lib/crm/airo-cert-token.ts` — same cert-realm SSO from the
 *     BFF side. Identical semantics (null + FALLBACK_TTL_MS).
 *   - This file (`investigator/crm-token.mjs`) — cert-realm SSO from
 *     Lambda. null-on-missing-exp + FALLBACK_TTL_MS (50 min).
 *   - `investigator/auth.mjs` — GoCode S2S JWTs (different issuer, no `exp`
 *     by design). Throws on missing both `exp` and `iat`.
 * If cert-realm SSO ever drops `exp`, expect this caller to silently
 * cache for 50 min while `auth.mjs` (S2S) keeps working as before.
 *
 * @param {string} jwt
 * @returns {number | null}
 */
function decodeJwtExpMs(jwt) {
  try {
    const parts = jwt.split('.');
    if (parts.length !== 3 || !parts[1]) return null;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

/**
 * Mints cert-based SSO JWT for CRM API access (realm: cert).
 * @returns {Promise<string>}
 */
export async function mintCrmSsoJwt() {
  if (cachedCrmJwt && cachedCrmJwt.expiresAt - Date.now() > MIN_LIFETIME_MS) {
    return cachedCrmJwt.token;
  }
  if (inflightCrmJwt) return inflightCrmJwt;

  inflightCrmJwt = (async () => {
    try {
      const { cert, key } = await loadCrmCert();
      const ssoEndpoint = process.env.AIRO_SSO_ENDPOINT ?? DEFAULT_SSO_ENDPOINT;
      const url = new URL(ssoEndpoint);

      // Mint body harmonized with the BFF caller (`app/src/lib/crm/airo-cert-token.ts`).
      // Both target the same SSO realm; an earlier revision sent an extra
      // `type: 'cert'` field that SSO ignores today but which would diverge
      // silently if the issuer ever started rejecting unknown fields.
      const body = JSON.stringify({ realm: 'cert' });
      const token = await makeSsoRequest(url, cert, key, body);

      // Prefer the JWT's actual exp; fall back to a fixed TTL so a
      // malformed payload doesn't cause us to never cache.
      const expMs = decodeJwtExpMs(token);
      const expiresAt = expMs ?? (Date.now() + FALLBACK_TTL_MS);
      cachedCrmJwt = { token, expiresAt };
      return token;
    } finally {
      inflightCrmJwt = null;
    }
  })();
  return inflightCrmJwt;
}


/**
 * @param {URL} url
 * @param {string} cert
 * @param {string} key
 * @param {string} body
 * @returns {Promise<string>}
 */
function makeSsoRequest(url, cert, key, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname,
        method: 'POST',
        cert,
        key,
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
        },
        // 15s matches the BFF caller (`app/src/lib/crm/airo-cert-token.ts`)
        // and the GoCode JWT mint timeout in handler.mjs — same SSO mint
        // operation, same upper bound across services.
        timeout: 15_000,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`SSO mint failed (${res.statusCode}): ${data.slice(0, 200)}`));
            return;
          }
          let parsed;
          try {
            parsed = JSON.parse(data);
          } catch (err) {
            reject(new Error(`SSO mint response not JSON: ${err.message}`));
            return;
          }
          if (parsed === null || typeof parsed !== 'object') {
            reject(new Error('SSO mint response was not a JSON object'));
            return;
          }
          const token = parsed.data ?? parsed.access_token ?? parsed.token;
          if (typeof token !== 'string') {
            reject(new Error(`SSO mint returned no token; keys: ${Object.keys(parsed).join(',')}`));
            return;
          }
          resolve(token);
        });
      },
    );

    req.on('error', (err) => reject(err));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('SSO mint request timed out'));
    });

    req.write(body);
    req.end();
  });
}

export function _resetTokenCacheForTests() {
  cachedCrmJwt = null;
  inflightCrmJwt = null;
}
