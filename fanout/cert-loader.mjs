import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';

const TTL_MS = 15 * 60 * 1000;
let cache = null; // { cert, key, fetchedAt }
let inflight = null;

let cachedClient = null;
function getClient() {
  if (!cachedClient) {
    const region = process.env.AWS_REGION;
    if (!region) throw new Error('AWS_REGION env var not set');
    cachedClient = new SecretsManagerClient({ region });
  }
  return cachedClient;
}

async function readPlainSecret(arn, envVarName) {
  const out = await getClient().send(new GetSecretValueCommand({ SecretId: arn }));
  const text = out.SecretString;
  if (!text) throw new Error(`${envVarName} secret has no SecretString`);
  return text;
}

/**
 * Loads the CRM mTLS cert + key from separate Katana-managed ASM secrets.
 *
 * Dev:  /Katana/Secrets/airobuilde/app/dev-private/AIRO_CLIENT_CERT  (account 694282668781)
 * Prod: /Katana/Secrets/airobuilde/app/prod-ecs/AIRO_CLIENT_CERT     (account 644094189644)
 *
 * Each secret contains the raw PEM string. CDK grants
 * secretsmanager:GetSecretValue on both ARNs for the Lambda execution role.
 */
export async function loadCrmCert() {
  const certArn = process.env.CRM_CERT_SECRET_ARN;
  if (!certArn) throw new Error('CRM_CERT_SECRET_ARN env var not set');
  const keyArn = process.env.CRM_KEY_SECRET_ARN;
  if (!keyArn) throw new Error('CRM_KEY_SECRET_ARN env var not set');

  const now = Date.now();
  if (cache && now - cache.fetchedAt < TTL_MS) {
    return { cert: cache.cert, key: cache.key };
  }
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const [cert, key] = await Promise.all([
        readPlainSecret(certArn, 'CRM_CERT_SECRET_ARN'),
        readPlainSecret(keyArn, 'CRM_KEY_SECRET_ARN'),
      ]);
      cache = { cert, key, fetchedAt: Date.now() };
      return { cert, key };
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export function _resetCacheForTests() {
  cache = null;
  inflight = null;
  cachedClient = null;
}
