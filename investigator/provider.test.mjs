import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBaseUrl, filterBlockedBetas, DEFAULT_BLOCKED_ANTHROPIC_BETA_HEADERS } from './provider.mjs';

test('normalizeBaseUrl appends /v1 when missing', () => {
  assert.equal(normalizeBaseUrl('https://gocode.example.com'), 'https://gocode.example.com/v1');
});

test('normalizeBaseUrl is idempotent when /v1 already present', () => {
  assert.equal(normalizeBaseUrl('https://gocode.example.com/v1'), 'https://gocode.example.com/v1');
});

test('DEFAULT_BLOCKED_ANTHROPIC_BETA_HEADERS matches agents', () => {
  assert.deepEqual(DEFAULT_BLOCKED_ANTHROPIC_BETA_HEADERS, ['structured-outputs-2025-11-13']);
});

test('filterBlockedBetas removes blocked values, keeps allowed', () => {
  const h = new Headers({ 'anthropic-beta': 'structured-outputs-2025-11-13,prompt-caching-2024-07-31' });
  filterBlockedBetas(h, DEFAULT_BLOCKED_ANTHROPIC_BETA_HEADERS);
  assert.equal(h.get('anthropic-beta'), 'prompt-caching-2024-07-31');
});

test('filterBlockedBetas deletes the header when all values blocked', () => {
  const h = new Headers({ 'anthropic-beta': 'structured-outputs-2025-11-13' });
  filterBlockedBetas(h, DEFAULT_BLOCKED_ANTHROPIC_BETA_HEADERS);
  assert.equal(h.has('anthropic-beta'), false);
});

test('filterBlockedBetas no-ops when header absent', () => {
  const h = new Headers();
  filterBlockedBetas(h, DEFAULT_BLOCKED_ANTHROPIC_BETA_HEADERS);
  assert.equal(h.has('anthropic-beta'), false);
});

// --- Task 2: makeGoCodeFetch ---
import { makeGoCodeFetch } from './provider.mjs';

test('makeGoCodeFetch sets sso-jwt Authorization in S2S mode', async () => {
  let captured;
  const baseFetch = async (url, init) => { captured = new Headers(init.headers); return new Response('ok'); };
  const f = makeGoCodeFetch({ useS2S: true, authToken: 'JWT123', baseFetch });
  await f('https://x/v1/messages', { headers: { 'x-api-key': 'placeholder' } });
  assert.equal(captured.get('authorization'), 'sso-jwt JWT123');
});

test('makeGoCodeFetch does NOT set Authorization in direct mode', async () => {
  let captured;
  const baseFetch = async (url, init) => { captured = new Headers(init.headers); return new Response('ok'); };
  const f = makeGoCodeFetch({ useS2S: false, authToken: undefined, baseFetch });
  await f('https://x/v1/messages', { headers: { 'x-api-key': 'real-key' } });
  assert.equal(captured.get('authorization'), null);
  assert.equal(captured.get('x-api-key'), 'real-key');
});

test('makeGoCodeFetch strips blocked betas in both modes', async () => {
  let captured;
  const baseFetch = async (url, init) => { captured = new Headers(init.headers); return new Response('ok'); };
  const f = makeGoCodeFetch({ useS2S: true, authToken: 'J', baseFetch });
  await f('https://x', { headers: { 'anthropic-beta': 'structured-outputs-2025-11-13,keep-me' } });
  assert.equal(captured.get('anthropic-beta'), 'keep-me');
});

// --- Task 3: createInvestigatorProvider + createInvestigatorModels ---
import { createInvestigatorProvider, createInvestigatorModels } from './provider.mjs';

test('createInvestigatorProvider throws without baseURL', () => {
  assert.throws(
    () => createInvestigatorProvider({ baseURL: '', authToken: 'x', useS2S: true, createImpl: () => () => {} }),
    /baseURL/i,
  );
});

test('createInvestigatorProvider (S2S) calls createImpl with normalized baseURL + custom fetch + placeholder key', () => {
  let args;
  const fakeProvider = (id) => ({ id });
  const createImpl = (cfg) => { args = cfg; return fakeProvider; };
  createInvestigatorProvider({ useS2S: true, authToken: 'JWT', baseURL: 'https://g', createImpl });
  assert.equal(args.baseURL, 'https://g/v1');
  assert.equal(typeof args.fetch, 'function');
  assert.ok(args.apiKey);
});

test('createInvestigatorProvider (S2S) never forwards a real apiKey, even if one is set (I2)', () => {
  let args;
  const createImpl = (cfg) => { args = cfg; return () => {}; };
  createInvestigatorProvider({ useS2S: true, authToken: 'JWT', apiKey: 'REAL-SECRET-KEY', baseURL: 'https://g', createImpl });
  assert.notEqual(args.apiKey, 'REAL-SECRET-KEY');
  assert.equal(args.apiKey, 's2s-placeholder');
});

test('createInvestigatorProvider (direct) passes apiKey directly', () => {
  let args;
  const createImpl = (cfg) => { args = cfg; return () => {}; };
  createInvestigatorProvider({ useS2S: false, apiKey: 'real-key', baseURL: 'https://g/v1', createImpl });
  assert.equal(args.apiKey, 'real-key');
  assert.equal(args.baseURL, 'https://g/v1');
});

test('createInvestigatorModels returns lead/mechanical/strong from MODELS', () => {
  const created = [];
  const fakeProvider = (id) => { created.push(id); return { id }; };
  const createImpl = () => fakeProvider;
  const models = createInvestigatorModels({ useS2S: true, authToken: 'J', baseURL: 'https://g', createImpl });
  assert.equal(models.lead.id, 'claude-sonnet-4-6');
  assert.equal(models.mechanical.id, 'claude-haiku-4-5');
  assert.equal(models.strong.id, 'claude-opus-4-8');
});
