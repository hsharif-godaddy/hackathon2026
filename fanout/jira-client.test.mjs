import { test, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

let getSecretStringImpl = async () => '{"email":"sa@example.com","apiToken":"tok"}';

mock.module('./secret-cache.mjs', {
  namedExports: {
    getSecretString: (...args) => getSecretStringImpl(...args),
    _resetCache: () => {},
  },
});

const { findIssueByFeedbackId, _resetAuthCache } = await import('./jira-client.mjs');

const fetchCalls = [];
let fetchHandler = null;
globalThis.fetch = async (url, init) => {
  fetchCalls.push({ url: url.toString(), init });
  if (fetchHandler) return fetchHandler(url, init);
  return new Response(JSON.stringify({ issues: [] }), { status: 200 });
};

beforeEach(() => {
  fetchCalls.length = 0;
  fetchHandler = null;
  _resetAuthCache();
  process.env.JIRA_API_TOKEN_SECRET_ARN = 'arn:test';
  getSecretStringImpl = async () => '{"email":"sa@example.com","apiToken":"tok"}';
});

await test('findIssueByFeedbackId: JQL searches Feedback ID custom field cf[36238]', async () => {
  await findIssueByFeedbackId({
    baseUrl: 'https://godaddy-corp.atlassian.net',
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
    baseUrl: 'https://godaddy-corp.atlassian.net',
    projectKey: 'AABSP',
    feedbackId: 'fb-uuid-abc-123',
  });

  assert.equal(result, 'AABSP-42');
});

await test('findIssueByFeedbackId: returns null when no matching issue', async () => {
  fetchHandler = async () => new Response(JSON.stringify({ issues: [] }), { status: 200 });

  const result = await findIssueByFeedbackId({
    baseUrl: 'https://godaddy-corp.atlassian.net',
    projectKey: 'AABSP',
    feedbackId: 'fb-uuid-abc-123',
  });

  assert.equal(result, null);
});

await test('findIssueByFeedbackId: rejects malformed projectKey before calling Atlassian', async () => {
  await assert.rejects(
    () => findIssueByFeedbackId({
      baseUrl: 'https://godaddy-corp.atlassian.net',
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
      baseUrl: 'https://godaddy-corp.atlassian.net',
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
      baseUrl: 'https://godaddy-corp.atlassian.net',
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
      baseUrl: 'https://godaddy-corp.atlassian.net',
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
      baseUrl: 'https://godaddy-corp.atlassian.net',
      projectKey: 'AABSP',
      feedbackId: 'fb-uuid-abc',
    }),
    /jira search 500/,
  );
});

await test('findIssueByFeedbackId: sends Basic auth header from secret', async () => {
  await findIssueByFeedbackId({
    baseUrl: 'https://godaddy-corp.atlassian.net',
    projectKey: 'AABSP',
    feedbackId: 'fb-uuid-abc',
  });

  const auth = fetchCalls[0].init.headers.Authorization;
  assert.ok(auth.startsWith('Basic '));
  const decoded = Buffer.from(auth.slice(6), 'base64').toString('utf-8');
  assert.equal(decoded, 'sa@example.com:tok');
});

await test('findIssueByFeedbackId: rejects REPLACE_ME placeholder secrets with clear error', async () => {
  getSecretStringImpl = async () => '{"email":"REPLACE_ME","apiToken":"REPLACE_ME"}';
  await assert.rejects(
    () => findIssueByFeedbackId({
      baseUrl: 'https://godaddy-corp.atlassian.net',
      projectKey: 'AABSP',
      feedbackId: 'fb-uuid-abc',
    }),
    /REPLACE_ME placeholder/,
  );
});
