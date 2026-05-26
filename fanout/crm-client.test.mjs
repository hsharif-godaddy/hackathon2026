import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

// `mock.module` cannot remock the same specifier in a single process, and
// dynamic `await import(...)` is cached after the first call. We therefore
// install the module mock once with a mutable `jwtImpl`, then reassign
// `jwtImpl` per test to control behavior. `globalThis.fetch` is reassigned
// per test directly (no Node API restriction on that).
let jwtImpl = async () => 'JWT';
mock.module('./crm-token.mjs', {
  namedExports: {
    mintCrmSsoJwt: (...args) => jwtImpl(...args),
  },
});

const {
  postCase,
  getCase,
  postNote,
  getCaseByExternalId,
  resolveCaseAsync,
} = await import('./crm-client.mjs');

const config = {
  crmBaseUrl: 'https://crm.example.com',
};

await test('postCase returns extracted caseId, caseNumber, created flag', async () => {
  jwtImpl = async () => 'JWT';

  const mockFetch = mock.fn(async () => ({
    ok: true,
    status: 200,
    text: async () =>
      JSON.stringify({ id: '500U900000TP4kYIAT', caseNumber: '00012345', created: true }),
  }));
  globalThis.fetch = mockFetch;

  const result = await postCase({
    ...config,
    body: { contactName: 'A B', externalSystemId: 'airo-cust-app-uuid' },
  });
  assert.equal(result.caseId, '500U900000TP4kYIAT');
  assert.equal(result.caseNumber, '00012345');
  assert.equal(result.created, true);
});

await test('postCase throws on 5xx', async () => {
  jwtImpl = async () => 'JWT';

  const mockFetch = mock.fn(async () => ({
    ok: false,
    status: 503,
    text: async () => 'unavailable',
  }));
  globalThis.fetch = mockFetch;

  await assert.rejects(
    () =>
      postCase({
        ...config,
        body: { contactName: 'A B', externalSystemId: 'airo-cust-app-uuid' },
      }),
    /CMAPI POST 503/,
  );
});

await test('getCase returns case with status', async () => {
  jwtImpl = async () => 'JWT';

  const mockFetch = mock.fn(async () => ({
    ok: true,
    status: 200,
    text: async () =>
      JSON.stringify({
        data: { cases: [{ caseRecordId: '500U900000TP4kYIAT', status: 'Open' }] },
      }),
  }));
  globalThis.fetch = mockFetch;

  const result = await getCase({ ...config, caseId: '500U900000TP4kYIAT' });
  assert.equal(result.caseRecordId, '500U900000TP4kYIAT');
  assert.equal(result.status, 'Open');
});

await test('getCase returns null when no cases found', async () => {
  jwtImpl = async () => 'JWT';

  const mockFetch = mock.fn(async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ data: { cases: [] } }),
  }));
  globalThis.fetch = mockFetch;

  const result = await getCase({ ...config, caseId: '500U900000TP4kYIAT' });
  assert.equal(result, null);
});

await test('postNote returns void on 200', async () => {
  jwtImpl = async () => 'JWT';

  const mockFetch = mock.fn(async () => ({
    ok: true,
    status: 200,
    text: async () => '{}',
  }));
  globalThis.fetch = mockFetch;

  await postNote({ ...config, caseRecordId: '500U900000TP4kYIAT', note: 'hello' });
  assert.equal(mockFetch.mock.callCount(), 1);
});

// ---- getCaseByExternalId ----

await test('getCaseByExternalId returns first case from data.cases when present', async () => {
  jwtImpl = async () => 'JWT';
  const mockFetch = mock.fn(async () => ({
    ok: true,
    status: 200,
    text: async () =>
      JSON.stringify({
        data: {
          cases: [{ caseRecordId: '500U900000TP4kYIAT', caseNumber: '00012345', status: 'Open' }],
        },
      }),
  }));
  globalThis.fetch = mockFetch;

  const result = await getCaseByExternalId({
    ...config,
    externalId: 'airo-cust-app-1234567890-abcdef12',
  });
  assert.equal(result.caseRecordId, '500U900000TP4kYIAT');
  assert.equal(result.caseNumber, '00012345');
  // URL must encode externalId so dashes/UUIDs don't break the query string
  assert.match(mockFetch.mock.calls[0].arguments[0], /\?externalId=airo-cust-app-/);
});

await test('getCaseByExternalId returns null on 404 (case not yet created)', async () => {
  jwtImpl = async () => 'JWT';
  globalThis.fetch = mock.fn(async () => ({ ok: false, status: 404, text: async () => '' }));

  const result = await getCaseByExternalId({ ...config, externalId: 'EXT-not-yet' });
  assert.equal(result, null);
});

await test('getCaseByExternalId returns null when data.cases empty', async () => {
  jwtImpl = async () => 'JWT';
  globalThis.fetch = mock.fn(async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ data: { cases: [] } }),
  }));

  const result = await getCaseByExternalId({ ...config, externalId: 'EXT-empty' });
  assert.equal(result, null);
});

await test('getCaseByExternalId throws on 5xx', async () => {
  jwtImpl = async () => 'JWT';
  globalThis.fetch = mock.fn(async () => ({
    ok: false,
    status: 503,
    text: async () => 'unavailable',
  }));

  await assert.rejects(
    () => getCaseByExternalId({ ...config, externalId: 'EXT-down' }),
    /CMAPI GET 503/,
  );
});

// ---- resolveCaseAsync ----

await test('resolveCaseAsync returns case on first attempt when SF has persisted', async () => {
  jwtImpl = async () => 'JWT';
  const mockFetch = mock.fn(async () => ({
    ok: true,
    status: 200,
    text: async () =>
      JSON.stringify({
        data: { cases: [{ caseRecordId: '500U900000TP4kYIAT', caseNumber: '00012345' }] },
      }),
  }));
  globalThis.fetch = mockFetch;

  const result = await resolveCaseAsync({ ...config, externalId: 'EXT-fast' });
  assert.deepEqual(result, { caseRecordId: '500U900000TP4kYIAT', caseNumber: '00012345' });
  assert.equal(mockFetch.mock.callCount(), 1, 'first attempt fired with no delay');
});

await test('resolveCaseAsync polls when initial attempts return null and resolves on later attempt', async () => {
  jwtImpl = async () => 'JWT';
  let attempt = 0;
  const mockFetch = mock.fn(async () => {
    attempt += 1;
    if (attempt < 3) {
      return { ok: false, status: 404, text: async () => '' };
    }
    return {
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          data: { cases: [{ caseRecordId: '500U900000TP4kYIAT', caseNumber: '00012345' }] },
        }),
    };
  });
  globalThis.fetch = mockFetch;

  const result = await resolveCaseAsync({ ...config, externalId: 'EXT-late' });
  assert.deepEqual(result, { caseRecordId: '500U900000TP4kYIAT', caseNumber: '00012345' });
  assert.equal(mockFetch.mock.callCount(), 3, 'two retries before success');
});

await test('resolveCaseAsync keeps polling when caseRecordId present but caseNumber missing (atomic-AND gate)', async () => {
  // Ensures the gate that waits for BOTH fields actually does so. If a
  // future regression returned the partial as a hit, the customer-facing
  // Slack link would render with no case number.
  jwtImpl = async () => 'JWT';
  let attempt = 0;
  const mockFetch = mock.fn(async () => {
    attempt += 1;
    if (attempt === 1) {
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            data: { cases: [{ caseRecordId: '500U900000TP4kYIAT' /* no caseNumber */ }] },
          }),
      };
    }
    return {
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          data: { cases: [{ caseRecordId: '500U900000TP4kYIAT', caseNumber: '00012345' }] },
        }),
    };
  });
  globalThis.fetch = mockFetch;

  const result = await resolveCaseAsync({ ...config, externalId: 'EXT-partial' });
  assert.deepEqual(result, { caseRecordId: '500U900000TP4kYIAT', caseNumber: '00012345' });
  assert.equal(mockFetch.mock.callCount(), 2, 'partial response triggered another poll');
});

await test('resolveCaseAsync returns null and logs timeout after all attempts exhausted', async () => {
  jwtImpl = async () => 'JWT';
  globalThis.fetch = mock.fn(async () => ({ ok: false, status: 404, text: async () => '' }));
  const logs = [];
  const log = (level, key, fields) => logs.push({ level, key, fields });

  const result = await resolveCaseAsync({
    ...config,
    externalId: 'EXT-never',
    log,
    context: { customerId: 'cust', appId: 'app', submissionId: 'sub' },
  });
  assert.equal(result, null);
  // Final log must be the timeout, with the structured context propagated
  const timeout = logs.find((l) => l.key === 'fanout.crm.resolve.timeout');
  assert.ok(timeout, 'timeout log emitted');
  assert.equal(timeout.fields.attempts, 4);
  assert.equal(timeout.fields.customerId, 'cust');
  assert.equal(timeout.fields.appId, 'app');
  assert.equal(timeout.fields.submissionId, 'sub');
});

await test('resolveCaseAsync logs attempt_failed and keeps polling on transient errors', async () => {
  jwtImpl = async () => 'JWT';
  let attempt = 0;
  globalThis.fetch = mock.fn(async () => {
    attempt += 1;
    if (attempt === 1) {
      return { ok: false, status: 500, text: async () => 'transient' };
    }
    return {
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          data: { cases: [{ caseRecordId: '500U900000TP4kYIAT', caseNumber: '00012345' }] },
        }),
    };
  });
  const logs = [];
  const log = (level, key, fields) => logs.push({ level, key, fields });

  const result = await resolveCaseAsync({ ...config, externalId: 'EXT-flaky', log });
  assert.deepEqual(result, { caseRecordId: '500U900000TP4kYIAT', caseNumber: '00012345' });
  const transient = logs.find((l) => l.key === 'fanout.crm.resolve.attempt_failed');
  assert.ok(transient, 'attempt_failed logged for transient error');
});

await test('resolveCaseAsync aborts on non-retryable auth error and emits unauthorized log', async () => {
  // 401/403 indicates SSO cert / IAM misconfig — retrying 4× wastes time
  // and (worse) hides the real failure under the same timeout log as
  // benign CMAPI lag. Distinct log key surfaces ops issues.
  jwtImpl = async () => 'JWT';
  globalThis.fetch = mock.fn(async () => ({
    ok: false,
    status: 403,
    text: async () => 'Forbidden',
  }));
  const logs = [];
  const log = (level, key, fields) => logs.push({ level, key, fields });

  const result = await resolveCaseAsync({ ...config, externalId: 'EXT-noauth', log });
  assert.equal(result, null);
  const unauthorized = logs.find((l) => l.key === 'fanout.crm.resolve.unauthorized');
  assert.ok(unauthorized, 'non-retryable auth error logs unauthorized');
  // Must NOT have looped through all 4 attempts
  assert.equal(
    logs.filter((l) => l.key === 'fanout.crm.resolve.attempt_failed').length,
    0,
    'unauthorized error does not roll into attempt_failed',
  );
  assert.equal(
    logs.filter((l) => l.key === 'fanout.crm.resolve.timeout').length,
    0,
    'unauthorized error does not roll into timeout',
  );
});
