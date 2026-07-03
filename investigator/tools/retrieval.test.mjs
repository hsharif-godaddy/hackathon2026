import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRetrievalTools } from './retrieval.mjs';

test('astGrep finds matches with metavariable + range via inline source', async () => {
  const tools = createRetrievalTools({ appCodeDir: '/tmp/test-app' });
  const r = await tools.astGrep.execute({
    lang: 'TypeScript',
    pattern: 'downloadResource($A)',
    source: 'function h(){ return downloadResource(req.id); }',
  });
  assert.equal(r.ok, true);
  assert.ok(r.matches.length >= 1);
  assert.equal(r.matches[0].meta.A, 'req.id');
  assert.equal(typeof r.matches[0].range.startLine, 'number');
});

test('astGrep rejects a bare-metavariable pattern with a corrective hint', async () => {
  const tools = createRetrievalTools({ appCodeDir: '/tmp' });
  for (const pattern of ['$A', '$_', '$$$', '  $A   $B ']) {
    const r = await tools.astGrep.execute({ lang: 'TypeScript', pattern, source: 'const x = foo(1);' });
    assert.equal(r.ok, false, `pattern ${pattern} should be rejected`);
    assert.match(r.error, /too broad|literal code/i);
  }
});

test('astGrep still accepts a real pattern with literal code + metavariable', async () => {
  const tools = createRetrievalTools({ appCodeDir: '/tmp' });
  const r = await tools.astGrep.execute({ lang: 'TypeScript', pattern: 'foo($A)', source: 'const x = foo(1);' });
  assert.equal(r.ok, true);
  assert.ok(r.matches.length >= 1);
});

test('astGrep returns ok:false on invalid pattern, does not throw', async () => {
  const tools = createRetrievalTools({ appCodeDir: '/tmp' });
  const r = await tools.astGrep.execute({ lang: 'TypeScript', pattern: '(((invalid', source: 'a()' });
  assert.equal(r.ok, false);
  assert.ok(r.error);
});

test('ripgrepSeed returns ok:true with empty hits when rg finds nothing (exit 1)', async () => {
  // inject a fake exec that throws with no stderr (rg exit 1 = no matches)
  const fakeExec = async () => { const e = new Error('no match'); e.code = 1; throw e; };
  const tools = createRetrievalTools({ appCodeDir: '/tmp', exec: fakeExec });
  const r = await tools.ripgrepSeed.execute({ query: 'NOTFOUND_UNIQUE_STRING', maxHits: 10 });
  assert.equal(r.ok, true);
  assert.deepEqual(r.hits, []);
  assert.match(r.note, /no matches/i); // P1-5: explicit no-result message
});

test('readSpan returns ok:false when path traversal attempted', async () => {
  const tools = createRetrievalTools({ appCodeDir: '/tmp/app' });
  const r = await tools.readSpan.execute({ file: '../../etc/passwd', fromLine: 1, toLine: 5 });
  assert.equal(r.ok, false);
  assert.match(r.error, /traversal/i);
});

test('readSpan returns ok:false for fromLine <= 0 instead of a silent wrong span (I4)', async () => {
  const tools = createRetrievalTools({ appCodeDir: '/tmp' });
  const r = await tools.readSpan.execute({ file: 'x.ts', fromLine: 0, toLine: 3 });
  assert.equal(r.ok, false);
  assert.match(r.error, /fromLine/);
});

test('readSpan returns ok:false when toLine < fromLine (I4)', async () => {
  const tools = createRetrievalTools({ appCodeDir: '/tmp' });
  const r = await tools.readSpan.execute({ file: 'x.ts', fromLine: 10, toLine: 3 });
  assert.equal(r.ok, false);
  assert.match(r.error, /toLine/);
});

test('crgQuery returns ok:false when crgClient is null', async () => {
  const tools = createRetrievalTools({ appCodeDir: '/tmp', crgClient: null });
  const r = await tools.crgQuery.execute({ op: 'callers_of', target: 'foo' });
  assert.equal(r.ok, false);
  assert.match(r.error, /unavailable/i);
});

test('crgQuery proxies to the fake client and returns its result', async () => {
  const fakeTool = { execute: async ({ target }) => ({ callers: [target + '_caller'] }) };
  const fakeClient = { tools: async () => ({ 'mcp__crg__callers_of': fakeTool }) };
  const tools = createRetrievalTools({ appCodeDir: '/tmp', crgClient: fakeClient });
  const r = await tools.crgQuery.execute({ op: 'callers_of', target: 'myFn' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.result.callers, ['myFn_caller']);
});

test('crgQuery semantic_search passes target as { query }, not { target } (regression)', async () => {
  let receivedParams = null;
  const fakeTool = { execute: async (params) => { receivedParams = params; return { nodes: [] }; } };
  const fakeClient = { tools: async () => ({ 'semantic_search_nodes': fakeTool }) };
  const tools = createRetrievalTools({ appCodeDir: '/tmp', crgClient: fakeClient });
  const r = await tools.crgQuery.execute({ op: 'semantic_search', target: 'cart checkout routes' });
  assert.equal(r.ok, true);
  // Must pass query (not target) — the MCP tool requires { query } and rejects { target }
  assert.equal(receivedParams.query, 'cart checkout routes');
  assert.equal(receivedParams.target, undefined);
});

test('crgQuery forwards explicit repoRoot when provided', async () => {
  let receivedParams = null;
  const fakeTool = { execute: async (params) => { receivedParams = params; return { nodes: [] }; } };
  const fakeClient = { tools: async () => ({ 'semantic_search_nodes': fakeTool }) };
  const tools = createRetrievalTools({ appCodeDir: '/tmp/app', crgClient: fakeClient });
  await tools.crgQuery.execute({ op: 'semantic_search', target: 'publish pipeline', repoRoot: '/tmp/platform-graph' });
  assert.equal(receivedParams.repo_root, '/tmp/platform-graph');
});

test('crgQuery falls back to closure appCodeDir when repoRoot omitted', async () => {
  let receivedParams = null;
  const fakeTool = { execute: async (params) => { receivedParams = params; return { nodes: [] }; } };
  const fakeClient = { tools: async () => ({ 'semantic_search_nodes': fakeTool }) };
  const tools = createRetrievalTools({ appCodeDir: '/tmp/app', crgClient: fakeClient });
  await tools.crgQuery.execute({ op: 'semantic_search', target: 'auth flow' });
  assert.equal(receivedParams.repo_root, '/tmp/app');
});

test('crgQuery returns ok:false when both repoRoot and appCodeDir are unset', async () => {
  const fakeTool = { execute: async () => ({ nodes: [] }) };
  const fakeClient = { tools: async () => ({ 'semantic_search_nodes': fakeTool }) };
  const tools = createRetrievalTools({ appCodeDir: '', crgClient: fakeClient });
  const r = await tools.crgQuery.execute({ op: 'semantic_search', target: 'anything' });
  assert.equal(r.ok, false);
  assert.match(r.error, /no repo root/);
});
