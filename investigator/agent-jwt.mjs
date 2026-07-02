/**
 * Agents JWT Signer (Lambda ESM port of debug-console/src/lib/agent-jwt.ts).
 *
 * Mints short-lived RS256 JWTs accepted by the agents service for read-only
 * lookups (e.g. GET /apps/:id/zip, GET /agent/conversations/:appId). Two key
 * sources, matching the debug-console source:
 *   - Primary: AWS Secrets Manager (same JSON shape as app/'s JWTService)
 *   - Fallback: AGENT_JWT_PRIVATE_KEY + AGENT_JWT_KEY_ID env vars
 *
 * Faithful port notes:
 *   - The TS source's `isJwtSecretValue` type guard is reimplemented as a
 *     runtime validator (no TS narrowing) with identical structural checks.
 *   - The TS source emitted logger.{debug,warn,error} lines; siblings in this
 *     Lambda (cert-loader, crm-token) stay silent and private keys must never
 *     be logged, so the fallback/error paths preserve the same control flow
 *     without logging. No claim, algorithm, or key-resolution behavior changed.
 */

import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { createSign } from 'node:crypto';

const ISSUER = 'airo-app';
const AUDIENCE = 'agents-service';
const ALGORITHM = 'RS256';
const TOKEN_TTL_SECONDS = 5 * 60;
const KEY_CACHE_MAX_AGE_MS = 5 * 60 * 1000;

/** @type {SecretsManagerClient | null} */
let secretsClient = null;
/** @type {{ keys: Array<{ keyId: string; privateKey: string; status: string }>; cachedAt: Date } | null} */
let keyCache = null;
/** @type {Promise<Array<{ keyId: string; privateKey: string; status: string }>> | null} */
let fetchKeysPromise = null;

function getSecretsClient() {
  if (!secretsClient) {
    secretsClient = new SecretsManagerClient({
      region: process.env.AWS_REGION || 'us-west-2',
    });
  }
  return secretsClient;
}

/**
 * Runtime equivalent of the TS `isJwtSecretValue` type guard.
 * @param {unknown} value
 * @returns {boolean}
 */
function isJwtSecretValue(value) {
  if (!value || typeof value !== 'object') return false;
  const v = /** @type {{ keys?: unknown }} */ (value);
  if (!Array.isArray(v.keys) || v.keys.length === 0) return false;
  return v.keys.every((k) => {
    if (!k || typeof k !== 'object') return false;
    const m = /** @type {Record<string, unknown>} */ (k);
    return typeof m.keyId === 'string'
      && typeof m.privateKey === 'string'
      && typeof m.status === 'string';
  });
}

async function fetchKeysFromAWS(secretName) {
  const response = await getSecretsClient().send(new GetSecretValueCommand({ SecretId: secretName }));
  if (!response.SecretString) {
    throw new Error(`Secret ${secretName} has no SecretString`);
  }

  let parsed;
  try {
    parsed = JSON.parse(response.SecretString);
  } catch (error) {
    throw new Error(`Secret ${secretName} is not valid JSON: ${error.message}`);
  }
  if (!isJwtSecretValue(parsed)) {
    throw new Error(`Secret ${secretName} is missing a non-empty 'keys' array of {keyId, privateKey, status}`);
  }
  keyCache = { keys: parsed.keys, cachedAt: new Date() };
  return parsed.keys;
}

async function fetchKeys(secretName) {
  if (keyCache && (Date.now() - keyCache.cachedAt.getTime()) < KEY_CACHE_MAX_AGE_MS) {
    return keyCache.keys;
  }
  if (fetchKeysPromise) {
    return fetchKeysPromise;
  }
  fetchKeysPromise = fetchKeysFromAWS(secretName);
  try {
    return await fetchKeysPromise;
  } finally {
    fetchKeysPromise = null;
  }
}

async function getActiveKey(secretName) {
  const keys = await fetchKeys(secretName);
  const active = keys.find((key) => key.status === 'active');
  if (!active) {
    throw new Error(`No active signing key found in secret ${secretName}`);
  }
  return { keyId: active.keyId, privateKey: active.privateKey };
}

function getStaticKey() {
  const privateKey = process.env.AGENT_JWT_PRIVATE_KEY;
  const keyId = process.env.AGENT_JWT_KEY_ID;
  if (!privateKey || !keyId) {
    throw new Error(
      'Agents JWT signing not configured: set JWT_SECRETS_NAME (preferred) '
      + 'or AGENT_JWT_PRIVATE_KEY + AGENT_JWT_KEY_ID',
    );
  }
  return { keyId, privateKey: privateKey.replace(/\\n/g, '\n') };
}

async function getSigningKey() {
  const secretName = process.env.JWT_SECRETS_NAME;
  if (!secretName) {
    return getStaticKey();
  }

  try {
    return await getActiveKey(secretName);
  } catch (error) {
    // Surface the real root cause (bad JSON / no active key / IAM denial)
    // before falling back — never log the key material itself.
    console.error('[investigator] agent-jwt.secrets.load_failed', {
      secretName,
      error: error && error.message ? error.message : String(error),
      fallback: process.env.AGENT_JWT_ALLOW_STATIC_FALLBACK === 'true' ? 'static-key' : 'none',
    });
    if (process.env.AGENT_JWT_ALLOW_STATIC_FALLBACK === 'true') {
      return getStaticKey();
    }
    throw error;
  }
}

/**
 * Mint a short-lived RS256 token for the agents service.
 * @param {{ appId: string; canDownload?: boolean; canPublish?: boolean; canPurchaseDomain?: boolean }} options
 * @returns {Promise<{ token: string; expires: Date }>}
 */
export async function mintAgentToken(options) {
  const { appId, canDownload = false, canPublish = false, canPurchaseDomain = false } = options;
  const { keyId, privateKey } = await getSigningKey();

  const now = Math.floor(Date.now() / 1000);
  const exp = now + TOKEN_TTL_SECONDS;

  const header = {
    typ: 'JWT',
    alg: ALGORITHM,
    kid: keyId,
  };

  const claims = {
    iss: ISSUER,
    aud: AUDIENCE,
    exp,
    iat: now,
    siteId: appId,
    canDownload,
    canPublish,
    canPurchaseDomain,
    authType: 'basic',
    isE2S: false,
    useTestBudget: false,
    budgetServiceEnabled: false,
    enableAssessmentAgent: false,
    enableAssessmentOverride: false,
    product: 'AiroAppBuilder',
    modelSelectorEnabled: false,
    costAttributionDryRun: false,
  };

  const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
  const payloadB64 = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const message = `${headerB64}.${payloadB64}`;

  const sign = createSign('RSA-SHA256');
  sign.update(message);
  sign.end();
  const signature = sign.sign(privateKey, 'base64url');

  return {
    token: `${message}.${signature}`,
    expires: new Date(exp * 1000),
  };
}

/** Clears the key cache and cached SM client. Test-only. */
export function _resetAgentJwtForTest() {
  keyCache = null;
  fetchKeysPromise = null;
  secretsClient = null;
}
