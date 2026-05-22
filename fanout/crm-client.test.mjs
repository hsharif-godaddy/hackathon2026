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

const { postCase, getCase, postNote } = await import('./crm-client.mjs');

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
