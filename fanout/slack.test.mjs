import { test, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

let getSecretStringImpl = async () => '{"webhookUrl":"REPLACE_ME"}';

mock.module('./secret-cache.mjs', {
  namedExports: {
    getSecretString: (...args) => getSecretStringImpl(...args),
    _resetCache: () => {},
  },
});

const { postSlackMessage } = await import('./slack.mjs');

const fetchCalls = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  fetchCalls.push({ url, init });
  if (fetchHandler) return fetchHandler(url, init);
  return new Response('ok', { status: 200 });
};

let fetchHandler = null;

const FORM = { topics: ['ui'], description: 'broken', followUp: false };
const CTX = {
  currentAppId: 'app-1',
  previewUrl: 'https://preview.example/?airoShareToken=t',
  publishedUrl: undefined,
  fullStoryUrl: null,
  subscriptionInfo: '',
  isImpersonating: false,
  isInternalUser: false,
  shopperId: undefined,
};

beforeEach(() => {
  fetchCalls.length = 0;
  fetchHandler = null;
  process.env.SLACK_WEBHOOK_SECRET_ARN = 'arn:test';
  getSecretStringImpl = async () => '{"webhookUrl":"https://hooks.slack.com/services/T/B/X"}';
});

await test('happy path: posts formatted Block Kit JSON to webhook URL', async () => {
  await postSlackMessage({ category: 'issue', formData: FORM, origin: 'origin-1', ctx: CTX });

  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].url, 'https://hooks.slack.com/services/T/B/X');
  assert.equal(fetchCalls[0].init.method, 'POST');
  assert.equal(fetchCalls[0].init.headers['Content-Type'], 'application/json');
  const body = JSON.parse(fetchCalls[0].init.body);
  assert.equal(body.text, ':bug: Bug Report');
  assert.ok(Array.isArray(body.blocks));
  // First block: title section
  assert.equal(body.blocks[0].text.text, '*:bug: Bug Report*');
  // Last block always divider
  assert.equal(body.blocks[body.blocks.length - 1].type, 'divider');
});

await test('skips when secret webhook URL is REPLACE_ME placeholder', async () => {
  getSecretStringImpl = async () => '{"webhookUrl":"REPLACE_ME"}';
  await postSlackMessage({ category: 'issue', formData: FORM, origin: undefined, ctx: CTX });
  assert.equal(fetchCalls.length, 0);
});

await test('skips when SLACK_WEBHOOK_SECRET_ARN env var is not set', async () => {
  delete process.env.SLACK_WEBHOOK_SECRET_ARN;
  await postSlackMessage({ category: 'issue', formData: FORM, origin: undefined, ctx: CTX });
  assert.equal(fetchCalls.length, 0);
});

await test('throws when Slack returns 5xx', async () => {
  fetchHandler = async () => new Response('upstream broken', { status: 502 });
  await assert.rejects(
    postSlackMessage({ category: 'issue', formData: FORM, origin: undefined, ctx: CTX }),
    /Slack 502/,
  );
});

await test('throws on unknown category', async () => {
  await assert.rejects(
    postSlackMessage({ category: 'mystery', formData: FORM, origin: undefined, ctx: CTX }),
    /Unknown feedback category/,
  );
});

await test('routes feedback category to buildFeedbackBlocks', async () => {
  await postSlackMessage({
    category: 'feedback',
    formData: { rating: 7, topics: [], comment: 'great', customerConsent: true },
    origin: undefined,
    ctx: CTX,
  });
  const body = JSON.parse(fetchCalls[0].init.body);
  // Title carries the rating in the compact shape so Slack push
  // notifications surface the score without expanding the message.
  assert.equal(body.text, ':speech_balloon: Product Feedback - 7/7 :star-struck:');
});

await test('routes support category to buildSupportRequestBlocks', async () => {
  await postSlackMessage({ category: 'support', formData: FORM, origin: undefined, ctx: CTX });
  const body = JSON.parse(fetchCalls[0].init.body);
  assert.equal(body.text, ':sos: Support Request');
});

// Restore fetch when this test file completes
await test('cleanup: restore fetch', () => {
  globalThis.fetch = originalFetch;
});
