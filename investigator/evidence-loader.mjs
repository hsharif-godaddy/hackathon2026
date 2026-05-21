/**
 * Loads direct evidence query credentials from Secrets Manager.
 *
 * Called only for source=feedback investigations that bypass debug-console.
 * Each credential is a plain-string ASM secret (same pattern as cert-loader).
 * Secret path names come from Lambda env vars (*_SECRET) set by CDK.
 *
 *   LOKI_API_KEY_SECRET             → /Katana/Secrets/.../LOKI_API_KEY
 *   EB_LANGFUSE_PUBLIC_KEY_SECRET   → /Katana/Secrets/.../EB_LANGFUSE_PUBLIC_KEY
 *   EB_LANGFUSE_SECRET_KEY_SECRET   → /Katana/Secrets/.../EB_LANGFUSE_SECRET_KEY
 *   AIRO_BUILDER_ES_API_KEY_SECRET  → /Katana/Secrets/.../AIRO_BUILDER_ES_API_KEY
 *   CONTROL_PLANE_ES_API_KEY_SECRET → /Katana/Secrets/.../CONTROL_PLANE_ES_API_KEY
 */

import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';

const TTL_MS = 15 * 60 * 1000;

/** @type {{ values: Record<string, string>; fetchedAt: number } | null} */
let cache = null;
let inflight = null;

let cachedClient = null;
function getClient() {
  if (!cachedClient) {
    const region = process.env.AWS_REGION ?? 'us-west-2';
    cachedClient = new SecretsManagerClient({ region });
  }
  return cachedClient;
}

async function readSecret(secretName) {
  const out = await getClient().send(new GetSecretValueCommand({ SecretId: secretName }));
  const text = out.SecretString;
  if (!text) throw new Error(`Evidence secret '${secretName}' has no SecretString`);
  return text;
}

/**
 * Returns all evidence credentials.
 * Throws if any required secret env var is unset.
 * @returns {Promise<{
 *   lokiApiKey: string;
 *   ebLangfusePublicKey: string;
 *   ebLangfuseSecretKey: string;
 *   airoBuilderEsApiKey: string;
 *   controlPlaneEsApiKey: string;
 *   fullstoryApiKey: string;
 * }>}
 */
export async function loadEvidenceCredentials() {
  const now = Date.now();
  if (cache && now - cache.fetchedAt < TTL_MS) {
    return cache.values;
  }
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const entries = [
        ['LOKI_API_KEY_SECRET', 'lokiApiKey'],
        ['EB_LANGFUSE_PUBLIC_KEY_SECRET', 'ebLangfusePublicKey'],
        ['EB_LANGFUSE_SECRET_KEY_SECRET', 'ebLangfuseSecretKey'],
        ['AIRO_BUILDER_ES_API_KEY_SECRET', 'airoBuilderEsApiKey'],
        ['CONTROL_PLANE_ES_API_KEY_SECRET', 'controlPlaneEsApiKey'],
        ['FULLSTORY_API_KEY_SECRET', 'fullstoryApiKey'],
      ];

      const missing = entries.filter(([envVar]) => !process.env[envVar]).map(([e]) => e);
      if (missing.length > 0) {
        throw new Error(`Evidence secret env vars not set: ${missing.join(', ')}`);
      }

      const results = await Promise.all(
        entries.map(([envVar]) => readSecret(process.env[envVar])),
      );

      const values = Object.fromEntries(entries.map(([, key], i) => [key, results[i]]));
      cache = { values, fetchedAt: Date.now() };
      return values;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export function _resetEvidenceCacheForTests() {
  cache = null;
  inflight = null;
  cachedClient = null;
}
