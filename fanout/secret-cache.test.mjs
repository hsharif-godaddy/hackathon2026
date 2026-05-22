import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

let callCount = 0;
const secretValues = {};
let returnEmpty = false;

mock.module('@aws-sdk/client-secrets-manager', {
  namedExports: {
    SecretsManagerClient: class {
      send(cmd) {
        callCount++;
        const arn = cmd.args?.SecretId;
        if (returnEmpty) {
          return Promise.resolve({});
        }
        return Promise.resolve({ SecretString: secretValues[arn] ?? 'DEFAULT' });
      }
    },
    GetSecretValueCommand: class { constructor(args) { this.args = args; } },
  },
});

const { getSecretString, _resetCache } = await import('./secret-cache.mjs');

describe('getSecretString', () => {
  beforeEach(() => {
    _resetCache();
    callCount = 0;
    returnEmpty = false;
    secretValues['arn:test'] = '{"webhookUrl":"https://hooks.slack.com/services/X"}';
  });

  it('caches values within TTL window', async () => {
    const v1 = await getSecretString('arn:test');
    const v2 = await getSecretString('arn:test');
    assert.equal(v1, '{"webhookUrl":"https://hooks.slack.com/services/X"}');
    assert.equal(v2, v1);
    assert.equal(callCount, 1);
  });

  it('throws when SecretString is missing', async () => {
    returnEmpty = true;
    await assert.rejects(getSecretString('arn:missing'), /SecretString missing/);
  });
});
