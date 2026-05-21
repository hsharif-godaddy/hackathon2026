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
  'EB_LANGFUSE_PUBLIC_KEY_SECRET',
  'EB_LANGFUSE_SECRET_KEY_SECRET',
  'AIRO_BUILDER_ES_API_KEY_SECRET',
  'CONTROL_PLANE_ES_API_KEY_SECRET',
  'FULLSTORY_API_KEY_SECRET',
];

function setAllEnv() {
  process.env.LOKI_API_KEY_SECRET = 'arn:loki';
  process.env.EB_LANGFUSE_PUBLIC_KEY_SECRET = 'arn:lf-pub';
  process.env.EB_LANGFUSE_SECRET_KEY_SECRET = 'arn:lf-sec';
  process.env.AIRO_BUILDER_ES_API_KEY_SECRET = 'arn:airo-es';
  process.env.CONTROL_PLANE_ES_API_KEY_SECRET = 'arn:cp-es';
  process.env.FULLSTORY_API_KEY_SECRET = 'arn:fs';
  secretValues['arn:loki'] = 'LOKI_VALUE';
  secretValues['arn:lf-pub'] = 'LF_PUB_VALUE';
  secretValues['arn:lf-sec'] = 'LF_SEC_VALUE';
  secretValues['arn:airo-es'] = 'AIRO_ES_VALUE';
  secretValues['arn:cp-es'] = 'CP_ES_VALUE';
  secretValues['arn:fs'] = 'FS_VALUE';
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

  it('returns all evidence credentials when env vars + secrets are present', async () => {
    setAllEnv();
    const creds = await loadEvidenceCredentials();
    assert.equal(creds.lokiApiKey, 'LOKI_VALUE');
    assert.equal(creds.ebLangfusePublicKey, 'LF_PUB_VALUE');
    assert.equal(creds.ebLangfuseSecretKey, 'LF_SEC_VALUE');
    assert.equal(creds.airoBuilderEsApiKey, 'AIRO_ES_VALUE');
    assert.equal(creds.controlPlaneEsApiKey, 'CP_ES_VALUE');
    assert.equal(creds.fullstoryApiKey, 'FS_VALUE');
    assert.equal(sendCallCount, 6);
  });

  it('throws when ANY required env var is unset (lists all missing)', async () => {
    setAllEnv();
    delete process.env.LOKI_API_KEY_SECRET;
    delete process.env.FULLSTORY_API_KEY_SECRET;
    await assert.rejects(loadEvidenceCredentials(), (err) => {
      assert.match(err.message, /Evidence secret env vars not set/);
      assert.match(err.message, /LOKI_API_KEY_SECRET/);
      assert.match(err.message, /FULLSTORY_API_KEY_SECRET/);
      return true;
    });
  });

  it('throws when a secret has no SecretString (empty/binary-only)', async () => {
    setAllEnv();
    secretValues['arn:fs'] = '';
    await assert.rejects(loadEvidenceCredentials(), /Evidence secret 'arn:fs' has no SecretString/);
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
    // Six secrets, fetched once. Without inflight coalescing concurrent
    // callers would each fire their own batch (6 × 3 = 18 calls).
    assert.equal(sendCallCount, 6);
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
