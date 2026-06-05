import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

let sendCallCount = 0;
const secretValues = {};
let nextSendError = null;

mock.module('@aws-sdk/client-secrets-manager', {
  namedExports: {
    SecretsManagerClient: class {
      send(cmd) {
        sendCallCount += 1;
        if (nextSendError) {
          const err = nextSendError;
          nextSendError = null;
          return Promise.reject(err);
        }
        const arn = cmd.args?.SecretId;
        const val = arn in secretValues ? secretValues[arn] : 'DEFAULT_VALUE';
        return Promise.resolve({ SecretString: val });
      }
    },
    GetSecretValueCommand: class { constructor(args) { this.args = args; } },
  },
});

const { loadEvidenceCredentials, _resetEvidenceCacheForTests } = await import('./evidence-loader.mjs');

const ENV_VARS = [
  'LOKI_API_KEY_SECRET',
  'AIRO_BUILDER_ES_API_KEY_SECRET',
];

function setAllEnv() {
  process.env.LOKI_API_KEY_SECRET = 'arn:loki';
  process.env.AIRO_BUILDER_ES_API_KEY_SECRET = 'arn:airo-es';
  secretValues['arn:loki'] = 'LOKI_VALUE';
  secretValues['arn:airo-es'] = 'AIRO_ES_VALUE';
}

describe('loadEvidenceCredentials', () => {
  beforeEach(() => {
    _resetEvidenceCacheForTests();
    sendCallCount = 0;
    nextSendError = null;
    for (const envVar of ENV_VARS) delete process.env[envVar];
    for (const k of Object.keys(secretValues)) delete secretValues[k];
    process.env.AWS_REGION = 'us-west-2';
  });

  it('returns exactly loki + airo-es credentials (no control-plane-es/langfuse/fullstory)', async () => {
    setAllEnv();
    const creds = await loadEvidenceCredentials();
    assert.equal(creds.lokiApiKey, 'LOKI_VALUE');
    assert.equal(creds.airoBuilderEsApiKey, 'AIRO_ES_VALUE');
    assert.deepEqual(
      Object.keys(creds).sort(),
      ['airoBuilderEsApiKey', 'lokiApiKey'],
    );
    assert.equal(sendCallCount, 2);
  });

  it('throws when ANY required env var is unset (lists all missing)', async () => {
    setAllEnv();
    delete process.env.LOKI_API_KEY_SECRET;
    delete process.env.AIRO_BUILDER_ES_API_KEY_SECRET;
    await assert.rejects(loadEvidenceCredentials(), (err) => {
      assert.match(err.message, /Evidence secret env vars not set/);
      assert.match(err.message, /LOKI_API_KEY_SECRET/);
      assert.match(err.message, /AIRO_BUILDER_ES_API_KEY_SECRET/);
      return true;
    });
  });

  it('throws when a secret has no SecretString (empty/binary-only)', async () => {
    setAllEnv();
    secretValues['arn:airo-es'] = '';
    await assert.rejects(loadEvidenceCredentials(), /Evidence secret 'arn:airo-es' has no SecretString/);
  });

  it('caches across calls within TTL — no second fetch', async () => {
    setAllEnv();
    await loadEvidenceCredentials();
    const before = sendCallCount;
    await loadEvidenceCredentials();
    await loadEvidenceCredentials();
    assert.equal(sendCallCount, before);
  });

  it('coalesces concurrent calls into one batch of secret fetches', async () => {
    setAllEnv();
    const [a, b, c] = await Promise.all([
      loadEvidenceCredentials(),
      loadEvidenceCredentials(),
      loadEvidenceCredentials(),
    ]);
    assert.deepEqual(a, b);
    assert.deepEqual(b, c);
    // Two secrets, fetched once. Without inflight coalescing concurrent
    // callers would each fire their own batch (2 × 3 = 6 calls).
    assert.equal(sendCallCount, 2);
  });

  it('does not poison the cache when a fetch fails — next call retries', async () => {
    setAllEnv();
    nextSendError = new Error('transient secrets-manager error');
    await assert.rejects(loadEvidenceCredentials(), /transient secrets-manager error/);
    // Second call should retry from scratch (cache wasn't populated).
    const creds = await loadEvidenceCredentials();
    assert.equal(creds.lokiApiKey, 'LOKI_VALUE');
  });
});
