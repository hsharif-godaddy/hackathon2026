import { test, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

const TOKEN_URL = 'https://auth.atlassian.com/oauth/token';
const GATEWAY_BASE = 'https://api.atlassian.com/ex/jira/1f012970-03f4-4025-b750-cbaa332d8a3b';

let getSecretStringImpl = async () => '{"clientId":"FAKE-client-id","clientSecret":"FAKE-not-a-real-secret"}';

mock.module('./secret-cache.mjs', {
  namedExports: {
    getSecretString: (...args) => getSecretStringImpl(...args),
    _resetCache: () => {},
  },
});

const { findIssueByFeedbackId, createIssue, _resetAuthCache } = await import('./jira-client.mjs');

// API (non-token) calls only — the OAuth token mint is infrastructure, handled
// separately below so per-test assertions stay focused on the Jira REST call.
const fetchCalls = [];
// Records every token-mint request so tests can assert the client_credentials body.
const tokenCalls = [];
let fetchHandler = null;
let tokenHandler = null;

globalThis.fetch = async (url, init) => {
  const u = url.toString();
  if (u === TOKEN_URL) {
    tokenCalls.push({ url: u, init });
    if (tokenHandler) return tokenHandler(url, init);
    return new Response(JSON.stringify({ access_token: 'FAKE-access-token', expires_in: 3600 }), { status: 200 });
  }
  fetchCalls.push({ url: u, init });
  if (fetchHandler) return fetchHandler(url, init);
  return new Response(JSON.stringify({ issues: [] }), { status: 200 });
};

beforeEach(() => {
  fetchCalls.length = 0;
  tokenCalls.length = 0;
  fetchHandler = null;
  tokenHandler = null;
  _resetAuthCache();
  process.env.JIRA_OAUTH_SECRET_ARN = 'arn:test';
  getSecretStringImpl = async () => '{"clientId":"FAKE-client-id","clientSecret":"FAKE-not-a-real-secret"}';
});

await test('findIssueByFeedbackId: JQL searches Feedback ID custom field cf[36238]', async () => {
  await findIssueByFeedbackId({
    baseUrl: GATEWAY_BASE,
    projectKey: 'AABSP',
    feedbackId: 'fb-uuid-abc-123',
  });

  assert.equal(fetchCalls.length, 1);
  const url = fetchCalls[0].url;
  // URL must hit the v3 search/jql endpoint, not the deprecated /search
  assert.match(url, /\/rest\/api\/3\/search\/jql\?jql=/);
  // JQL is URL-encoded; cf[36238] becomes cf%5B36238%5D
  assert.match(url, /cf%5B36238%5D/);
  // Project + feedback ID interpolated
  assert.match(url, /project%20%3D%20%22AABSP%22/);
  assert.match(url, /fb-uuid-abc-123/);
  // No legacy `labels = "feedback-id-..."` fragment leftover
  assert.ok(!url.includes('labels'), 'legacy label-based dedup must not appear');
});

await test('findIssueByFeedbackId: returns issue.key when result non-empty', async () => {
  fetchHandler = async () => new Response(JSON.stringify({
    issues: [{ key: 'AABSP-42', fields: { summary: 'x' } }],
  }), { status: 200 });

  const result = await findIssueByFeedbackId({
    baseUrl: GATEWAY_BASE,
    projectKey: 'AABSP',
    feedbackId: 'fb-uuid-abc-123',
  });

  assert.equal(result, 'AABSP-42');
});

await test('findIssueByFeedbackId: returns null when no matching issue', async () => {
  fetchHandler = async () => new Response(JSON.stringify({ issues: [] }), { status: 200 });

  const result = await findIssueByFeedbackId({
    baseUrl: GATEWAY_BASE,
    projectKey: 'AABSP',
    feedbackId: 'fb-uuid-abc-123',
  });

  assert.equal(result, null);
});

await test('findIssueByFeedbackId: rejects malformed projectKey before calling Atlassian', async () => {
  await assert.rejects(
    () => findIssueByFeedbackId({
      baseUrl: GATEWAY_BASE,
      projectKey: 'lowercase', // fails PROJECT_KEY_PATTERN
      feedbackId: 'fb-uuid-abc',
    }),
    /jira projectKey rejected/,
  );
  assert.equal(fetchCalls.length, 0, 'no fetch attempted on rejected input');
});

await test('findIssueByFeedbackId: rejects projectKey with quote (JQL injection guard)', async () => {
  await assert.rejects(
    () => findIssueByFeedbackId({
      baseUrl: GATEWAY_BASE,
      projectKey: 'AAB"SP',
      feedbackId: 'fb-uuid-abc',
    }),
    /jira projectKey rejected/,
  );
  assert.equal(fetchCalls.length, 0);
});

await test('findIssueByFeedbackId: rejects feedbackId containing space (JQL injection guard)', async () => {
  await assert.rejects(
    () => findIssueByFeedbackId({
      baseUrl: GATEWAY_BASE,
      projectKey: 'AABSP',
      feedbackId: 'fb uuid space',
    }),
    /jira feedbackId rejected/,
  );
  assert.equal(fetchCalls.length, 0);
});

await test('findIssueByFeedbackId: rejects feedbackId with quote', async () => {
  await assert.rejects(
    () => findIssueByFeedbackId({
      baseUrl: GATEWAY_BASE,
      projectKey: 'AABSP',
      feedbackId: 'fb"uuid',
    }),
    /jira feedbackId rejected/,
  );
  assert.equal(fetchCalls.length, 0);
});

await test('findIssueByFeedbackId: throws on Atlassian non-2xx', async () => {
  fetchHandler = async () => new Response('boom', { status: 500 });
  await assert.rejects(
    () => findIssueByFeedbackId({
      baseUrl: GATEWAY_BASE,
      projectKey: 'AABSP',
      feedbackId: 'fb-uuid-abc',
    }),
    /jira search 500/,
  );
});

await test('findIssueByFeedbackId: mints client_credentials token, sends Bearer on API call', async () => {
  await findIssueByFeedbackId({
    baseUrl: GATEWAY_BASE,
    projectKey: 'AABSP',
    feedbackId: 'fb-uuid-abc',
  });

  // Token mint: form-encoded client_credentials grant with the secret's clientId/clientSecret.
  assert.equal(tokenCalls.length, 1);
  assert.equal(tokenCalls[0].init.headers['Content-Type'], 'application/x-www-form-urlencoded');
  const body = new URLSearchParams(tokenCalls[0].init.body);
  assert.equal(body.get('grant_type'), 'client_credentials');
  assert.equal(body.get('client_id'), 'FAKE-client-id');
  assert.equal(body.get('client_secret'), 'FAKE-not-a-real-secret');
  // No scope param — scopes are bound to the NSA credential at creation time.
  assert.equal(body.get('scope'), null);

  // API call carries the minted access token as a Bearer.
  assert.equal(fetchCalls[0].init.headers.Authorization, 'Bearer FAKE-access-token');
});

await test('findIssueByFeedbackId: caches token across calls — one mint, two API calls', async () => {
  await findIssueByFeedbackId({ baseUrl: GATEWAY_BASE, projectKey: 'AABSP', feedbackId: 'fb-1' });
  await findIssueByFeedbackId({ baseUrl: GATEWAY_BASE, projectKey: 'AABSP', feedbackId: 'fb-2' });

  assert.equal(tokenCalls.length, 1, 'token minted once and reused while unexpired');
  assert.equal(fetchCalls.length, 2);
});

await test('findIssueByFeedbackId: throws on token-mint non-2xx', async () => {
  tokenHandler = async () => new Response('bad creds', { status: 401 });
  await assert.rejects(
    () => findIssueByFeedbackId({
      baseUrl: GATEWAY_BASE,
      projectKey: 'AABSP',
      feedbackId: 'fb-uuid-abc',
    }),
    /jira oauth 401/,
  );
  assert.equal(fetchCalls.length, 0, 'no API call when token mint fails');
});

await test('findIssueByFeedbackId: rejects REPLACE_ME placeholder secrets with clear error', async () => {
  getSecretStringImpl = async () => '{"clientId":"REPLACE_ME","clientSecret":"REPLACE_ME"}';
  await assert.rejects(
    () => findIssueByFeedbackId({
      baseUrl: GATEWAY_BASE,
      projectKey: 'AABSP',
      feedbackId: 'fb-uuid-abc',
    }),
    /REPLACE_ME placeholder/,
  );
  assert.equal(tokenCalls.length, 0, 'no token mint attempted with placeholder secret');
});

await test('mintAccessToken: rejects non-JSON secret with purpose-built error', async () => {
  getSecretStringImpl = async () => 'not-json-just-a-raw-token';
  await assert.rejects(
    () => findIssueByFeedbackId({ baseUrl: GATEWAY_BASE, projectKey: 'AABSP', feedbackId: 'fb-1' }),
    /jira secret is not valid JSON/,
  );
  assert.equal(tokenCalls.length, 0);
});

await test('token cache: expired token (expires_in:0) forces a second mint', async () => {
  tokenHandler = async () => new Response(
    JSON.stringify({ access_token: 'short-lived', expires_in: 0 }), { status: 200 },
  );
  await findIssueByFeedbackId({ baseUrl: GATEWAY_BASE, projectKey: 'AABSP', feedbackId: 'fb-1' });
  await findIssueByFeedbackId({ baseUrl: GATEWAY_BASE, projectKey: 'AABSP', feedbackId: 'fb-2' });
  // expires_in:0 lands inside EXPIRY_MARGIN_MS, so each call re-mints.
  assert.equal(tokenCalls.length, 2);
  assert.equal(fetchCalls.length, 2);
});

await test('token cache: missing expires_in still caches (default TTL)', async () => {
  tokenHandler = async () => new Response(
    JSON.stringify({ access_token: 'no-expiry-field' }), { status: 200 },
  );
  await findIssueByFeedbackId({ baseUrl: GATEWAY_BASE, projectKey: 'AABSP', feedbackId: 'fb-1' });
  await findIssueByFeedbackId({ baseUrl: GATEWAY_BASE, projectKey: 'AABSP', feedbackId: 'fb-2' });
  assert.equal(tokenCalls.length, 1, 'default 60-min TTL keeps the token cached across calls');
  assert.equal(fetchCalls.length, 2);
});

await test('token mint: concurrent callers share a single in-flight mint', async () => {
  // Gate the token response so both callers are in-flight before either resolves.
  let release;
  const gate = new Promise((r) => { release = r; });
  tokenHandler = async () => {
    await gate;
    return new Response(JSON.stringify({ access_token: 'shared', expires_in: 3600 }), { status: 200 });
  };
  const p1 = findIssueByFeedbackId({ baseUrl: GATEWAY_BASE, projectKey: 'AABSP', feedbackId: 'fb-1' });
  const p2 = findIssueByFeedbackId({ baseUrl: GATEWAY_BASE, projectKey: 'AABSP', feedbackId: 'fb-2' });
  release();
  await Promise.all([p1, p2]);
  assert.equal(tokenCalls.length, 1, 'inflight dedup means one mint for two concurrent callers');
  assert.equal(fetchCalls.length, 2);
});

await test('token mint: 200 response without access_token rejects, no API call', async () => {
  tokenHandler = async () => new Response(JSON.stringify({ scope: 'read:jira-work' }), { status: 200 });
  await assert.rejects(
    () => findIssueByFeedbackId({ baseUrl: GATEWAY_BASE, projectKey: 'AABSP', feedbackId: 'fb-1' }),
    /missing access_token/,
  );
  assert.equal(fetchCalls.length, 0);
});

await test('401 from gateway: clears cache, re-mints once, retries and succeeds', async () => {
  let apiHits = 0;
  fetchHandler = async () => {
    apiHits += 1;
    // First call: stale/revoked bearer → 401. Retry after re-mint succeeds.
    if (apiHits === 1) return new Response('unauthorized', { status: 401 });
    return new Response(JSON.stringify({ issues: [{ key: 'AABSP-7' }] }), { status: 200 });
  };
  const result = await findIssueByFeedbackId({ baseUrl: GATEWAY_BASE, projectKey: 'AABSP', feedbackId: 'fb-1' });
  assert.equal(result, 'AABSP-7');
  assert.equal(fetchCalls.length, 2, 'API called twice (original + retry)');
  assert.equal(tokenCalls.length, 2, 'token minted twice (original + re-mint after 401)');
});

await test('403 from gateway: NOT retried (permissions, not stale token)', async () => {
  fetchHandler = async () => new Response('forbidden', { status: 403 });
  await assert.rejects(
    () => findIssueByFeedbackId({ baseUrl: GATEWAY_BASE, projectKey: 'AABSP', feedbackId: 'fb-1' }),
    /jira search 403/,
  );
  assert.equal(fetchCalls.length, 1, 'no retry on 403');
  assert.equal(tokenCalls.length, 1, 'no re-mint on 403');
});

await test('createIssue: POSTs to /rest/api/3/issue with Bearer token', async () => {
  fetchHandler = async () => new Response(JSON.stringify({ id: '10000', key: 'AABSP-99' }), { status: 201 });
  const result = await createIssue({
    baseUrl: GATEWAY_BASE,
    body: { fields: { summary: 'x' } },
  });
  assert.equal(result.key, 'AABSP-99');
  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].init.method, 'POST');
  assert.match(fetchCalls[0].url, /\/rest\/api\/3\/issue$/);
  assert.equal(fetchCalls[0].init.headers.Authorization, 'Bearer FAKE-access-token');
  assert.equal(fetchCalls[0].init.headers['Content-Type'], 'application/json');
});
