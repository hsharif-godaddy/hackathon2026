import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

let callCount = 0;
const secretValues = {};

mock.module('@aws-sdk/client-secrets-manager', {
  namedExports: {
    SecretsManagerClient: class {
      send(cmd) {
        callCount++;
        const arn = cmd.args?.SecretId;
        const val = secretValues[arn] ?? 'DEFAULT_PEM';
        return Promise.resolve({ SecretString: val });
      }
    },
    GetSecretValueCommand: class { constructor(args) { this.args = args; } },
  },
});

const { loadCrmCert, _resetCacheForTests } = await import('./cert-loader.mjs');

describe('loadCrmCert', () => {
  beforeEach(() => {
    _resetCacheForTests();
    callCount = 0;
    secretValues['arn:cert'] = 'FAKE_CERT_PEM_FOR_TESTS_ONLY';
    secretValues['arn:key'] = 'FAKE_KEY_PEM_FOR_TESTS_ONLY';
    process.env.CRM_CERT_SECRET_ARN = 'arn:cert';
    process.env.CRM_KEY_SECRET_ARN = 'arn:key';
    process.env.AWS_REGION = 'us-west-2';
  });

  it('returns cert and key as plain PEM strings', async () => {
    const result = await loadCrmCert();
    assert.equal(result.cert, 'FAKE_CERT_PEM_FOR_TESTS_ONLY');
    assert.equal(result.key, 'FAKE_KEY_PEM_FOR_TESTS_ONLY');
  });

  it('fetches both secrets (cert + key) on cold start', async () => {
    await loadCrmCert();
    assert.equal(callCount, 2);
  });

  it('caches across calls within TTL — no second fetch', async () => {
    await loadCrmCert();
    const before = callCount;
    await loadCrmCert();
    assert.equal(callCount, before);
  });

  it('throws when CRM_CERT_SECRET_ARN missing', async () => {
    delete process.env.CRM_CERT_SECRET_ARN;
    await assert.rejects(loadCrmCert(), /CRM_CERT_SECRET_ARN/);
  });

  it('throws when CRM_KEY_SECRET_ARN missing', async () => {
    delete process.env.CRM_KEY_SECRET_ARN;
    await assert.rejects(loadCrmCert(), /CRM_KEY_SECRET_ARN/);
  });
});
