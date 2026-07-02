import test from 'node:test';
import assert from 'node:assert';
import { generateKeyPairSync, createVerify } from 'node:crypto';
import { mintAgentToken, _resetAgentJwtForTest } from './agent-jwt.mjs';

test('mintAgentToken signs RS256 with agents-service claims (static key)', async () => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  process.env.AGENT_JWT_PRIVATE_KEY = privateKey.export({ type: 'pkcs1', format: 'pem' });
  process.env.AGENT_JWT_KEY_ID = 'test-kid';
  delete process.env.JWT_SECRETS_NAME;
  _resetAgentJwtForTest();
  const { token, expires } = await mintAgentToken({ appId: 'app123', canDownload: true });
  const [h, p, sig] = token.split('.');
  const header = JSON.parse(Buffer.from(h, 'base64url').toString());
  const claims = JSON.parse(Buffer.from(p, 'base64url').toString());
  assert.equal(header.typ, 'JWT');
  assert.equal(header.alg, 'RS256');
  assert.equal(header.kid, 'test-kid');
  assert.equal(claims.iss, 'airo-app');
  assert.equal(claims.aud, 'agents-service');
  assert.equal(claims.siteId, 'app123');
  assert.equal(claims.canDownload, true);
  assert.equal(claims.canPublish, false);
  assert.equal(claims.canPurchaseDomain, false);
  assert.equal(claims.authType, 'basic');
  assert.equal(claims.isE2S, false);
  assert.equal(claims.useTestBudget, false);
  assert.equal(claims.budgetServiceEnabled, false);
  assert.equal(claims.enableAssessmentAgent, false);
  assert.equal(claims.enableAssessmentOverride, false);
  assert.equal(claims.product, 'AiroAppBuilder');
  assert.equal(claims.modelSelectorEnabled, false);
  assert.equal(claims.costAttributionDryRun, false);
  assert.equal(typeof claims.iat, 'number');
  assert.equal(claims.exp, claims.iat + 300);
  // signature verifies against the public key
  const v = createVerify('RSA-SHA256'); v.update(`${h}.${p}`); v.end();
  assert.ok(v.verify(publicKey, sig, 'base64url'));
  assert.ok(expires instanceof Date);
  assert.equal(expires.getTime(), claims.exp * 1000);
});

test('mintAgentToken throws a clear error when neither secret nor static key configured', async () => {
  delete process.env.JWT_SECRETS_NAME;
  delete process.env.AGENT_JWT_PRIVATE_KEY;
  delete process.env.AGENT_JWT_KEY_ID;
  _resetAgentJwtForTest();
  await assert.rejects(
    () => mintAgentToken({ appId: 'app123' }),
    /Agents JWT signing not configured/,
  );
});
