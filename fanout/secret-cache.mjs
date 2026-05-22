import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

const REGION = process.env.AWS_REGION ?? 'us-west-2';
const TTL_MS = 5 * 60 * 1000;
const client = new SecretsManagerClient({ region: REGION });
const cache = new Map();

export function _resetCache() {
  cache.clear();
}

/**
 * Fetch a secret's `SecretString` value with a 5-minute in-process cache.
 * Lambda containers reuse this module across invocations, so the cache
 * amortises Secrets Manager calls within a warm container's lifetime.
 *
 * @param {string} secretArn - The Secrets Manager ARN or name.
 * @returns {Promise<string>} The plaintext SecretString.
 */
export async function getSecretString(secretArn) {
  const cached = cache.get(secretArn);
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }
  const result = await client.send(new GetSecretValueCommand({ SecretId: secretArn }));
  if (!result.SecretString) {
    throw new Error(`SecretString missing for secret ${secretArn}`);
  }
  cache.set(secretArn, { value: result.SecretString, expiresAt: now + TTL_MS });
  return result.SecretString;
}
