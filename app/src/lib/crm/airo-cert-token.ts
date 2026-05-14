/**
 * Airo client-cert SSO token singleton.
 *
 * Mints SSO JWTs by presenting the airo-builder client cert (mTLS) to GoDaddy
 * SSO. Used by the Profile API and CRM clients to authenticate calls into
 * GoDaddy internal services. Env-only: when `AIRO_CLIENT_CERT` and
 * `AIRO_CLIENT_KEY` are not set, callers should treat the feature as disabled
 * (use `isConfigured()` to fail fast).
 *
 * No token cache: feedback submissions are low-volume (~tens per day), and a
 * fresh mint per request keeps the failure mode simple — no stale-token
 * bugs, no cache-invalidation logic. Revisit if volume grows materially.
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

interface SSOResponse {
  data?: string;
  access_token?: string;
  token?: string;
}

class AiroCertTokenService {
  isConfigured(): boolean {
    return Boolean(process.env[ENV_CERT] && process.env[ENV_KEY]);
  }

  async getToken(): Promise<string> {
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
    logger.info(`${LOG_DOMAIN}.mint.success`);
    return token;
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
          timeout: 10000,
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
