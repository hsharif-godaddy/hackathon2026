import test from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { Readable } from 'node:stream';

import { fetchAppZip, fetchConversations } from './agent-fetch.mjs';

const realFetch = globalThis.fetch;
function restoreFetch() {
  globalThis.fetch = realFetch;
}

/** Build a Web Response whose body is a real readable stream of `buf`. */
function streamResponse(buf, { status = 200 } = {}) {
  return new Response(Readable.toWeb(Readable.from(buf)), { status });
}

// ---------------------------------------------------------------------------
// fetchConversations
// ---------------------------------------------------------------------------

test('fetchConversations returns { ok, conversations } and sends bearer header to the right URL', async (t) => {
  t.after(restoreFetch);

  const calls = [];
  const listBody = [{ id: 'c1', updatedAt: '2026-06-01T00:00:00.000Z' }];
  globalThis.fetch = async (url, opts) => {
    calls.push({ url: String(url), opts });
    return new Response(JSON.stringify(listBody), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  const result = await fetchConversations({
    agentUrl: 'https://agent.example.com',
    appId: 'app123',
    token: 'tok-abc',
    detailLimit: 0,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.conversations, listBody);
  // exactly one call when detailLimit is 0 (list only)
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://agent.example.com/agent/conversations/app123');
  assert.equal(calls[0].opts.headers.Authorization, 'Bearer tok-abc');
});

test('fetchConversations unwraps the { conversations: [...] } wrapper to an array', async (t) => {
  t.after(restoreFetch);
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ conversations: [{ id: 'c1' }, { id: 'c2' }], total: 2 }), { status: 200 });

  const result = await fetchConversations({
    agentUrl: 'https://agent.example.com',
    appId: 'app123',
    token: 'tok-abc',
    detailLimit: 0,
  });

  assert.equal(result.ok, true);
  assert.ok(Array.isArray(result.conversations), 'unwrapped to an array');
  assert.equal(result.conversations.length, 2);
});

test('fetchConversations soft-fails (ok:false) on an unusable body (null / unknown shape)', async (t) => {
  t.after(restoreFetch);
  for (const body of ['null', JSON.stringify({ unexpected: true })]) {
    globalThis.fetch = async () => new Response(body, { status: 200 });
    const result = await fetchConversations({
      agentUrl: 'https://agent.example.com',
      appId: 'app123',
      token: 'tok-abc',
      detailLimit: 0,
    });
    assert.equal(result.ok, false, `body ${body} should be treated as unavailable`);
  }
});

test('fetchConversations fetches details for up to detailLimit most-recent conversations', async (t) => {
  t.after(restoreFetch);

  const calls = [];
  const listBody = [
    { id: 'c1' },
    { id: 'c2' },
    { id: 'c3' },
  ];
  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    calls.push(u);
    if (u.endsWith('/agent/conversations/app123')) {
      return new Response(JSON.stringify(listBody), { status: 200 });
    }
    // detail request
    const id = u.split('/').pop();
    return new Response(JSON.stringify({ id, messages: [`m-${id}`] }), { status: 200 });
  };

  const result = await fetchConversations({
    agentUrl: 'https://agent.example.com/',
    appId: 'app123',
    token: 'tok-abc',
    detailLimit: 2,
  });

  assert.equal(result.ok, true);
  // list call + 2 detail calls
  assert.equal(calls.length, 3);
  assert.ok(calls.includes('https://agent.example.com/agent/conversations/app123/c1'));
  assert.ok(calls.includes('https://agent.example.com/agent/conversations/app123/c2'));
  assert.ok(!calls.includes('https://agent.example.com/agent/conversations/app123/c3'));
  // details attached to the first two conversations
  assert.deepEqual(result.conversations[0].detail, { id: 'c1', messages: ['m-c1'] });
  assert.deepEqual(result.conversations[1].detail, { id: 'c2', messages: ['m-c2'] });
  assert.equal(result.conversations[2].detail, undefined);
});

test('fetchConversations soft-fails on a 500 list response (no throw)', async (t) => {
  t.after(restoreFetch);
  globalThis.fetch = async () => new Response('boom', { status: 500 });

  const result = await fetchConversations({
    agentUrl: 'https://agent.example.com',
    appId: 'app123',
    token: 'tok-abc',
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /500/);
});

test('fetchConversations soft-fails on a network error (no throw)', async (t) => {
  t.after(restoreFetch);
  globalThis.fetch = async () => {
    throw new Error('ECONNREFUSED');
  };

  const result = await fetchConversations({
    agentUrl: 'https://agent.example.com',
    appId: 'app123',
    token: 'tok-abc',
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /ECONNREFUSED/);
});

test('fetchConversations still succeeds when an individual detail fetch fails', async (t) => {
  t.after(restoreFetch);
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.endsWith('/agent/conversations/app123')) {
      return new Response(JSON.stringify([{ id: 'c1' }]), { status: 200 });
    }
    return new Response('nope', { status: 500 });
  };

  const result = await fetchConversations({
    agentUrl: 'https://agent.example.com',
    appId: 'app123',
    token: 'tok-abc',
    detailLimit: 5,
  });

  assert.equal(result.ok, true);
  assert.equal(result.conversations[0].detail, undefined);
});

// ---------------------------------------------------------------------------
// fetchAppZip
// ---------------------------------------------------------------------------

test('fetchAppZip downloads, writes app.zip and unzips into {destDir}/app', async (t) => {
  t.after(restoreFetch);

  // Build a real tiny zip with the system `zip` binary so unzip has real input.
  const fixtureDir = mkdtempSync(join(tmpdir(), 'agentfetch-fix-'));
  t.after(() => rmSync(fixtureDir, { recursive: true, force: true }));
  writeFileSync(join(fixtureDir, 'hello.txt'), 'hello world\n');
  const zipPath = join(fixtureDir, 'fixture.zip');
  execFileSync('zip', ['-q', '-j', zipPath, join(fixtureDir, 'hello.txt')]);
  const zipBytes = readFileSync(zipPath);

  globalThis.fetch = async (url, opts) => {
    assert.equal(String(url), 'https://agent.example.com/apps/app123/zip');
    assert.equal(opts.headers.Authorization, 'Bearer tok-abc');
    return streamResponse(zipBytes, { status: 200 });
  };

  const destDir = mkdtempSync(join(tmpdir(), 'agentfetch-dest-'));
  t.after(() => rmSync(destDir, { recursive: true, force: true }));

  const result = await fetchAppZip({
    agentUrl: 'https://agent.example.com',
    appId: 'app123',
    token: 'tok-abc',
    destDir,
  });

  assert.equal(result.ok, true);
  assert.equal(result.dir, join(destDir, 'app'));
  assert.ok(existsSync(join(destDir, 'app.zip')), 'app.zip written to disk');
  assert.ok(existsSync(join(destDir, 'app', 'hello.txt')), 'zip extracted');
  assert.equal(readFileSync(join(destDir, 'app', 'hello.txt'), 'utf8'), 'hello world\n');
});

test('fetchAppZip soft-fails on a 404 response (no throw, no unzip)', async (t) => {
  t.after(restoreFetch);
  globalThis.fetch = async () => new Response('not found', { status: 404 });

  const destDir = mkdtempSync(join(tmpdir(), 'agentfetch-dest-'));
  t.after(() => rmSync(destDir, { recursive: true, force: true }));

  const result = await fetchAppZip({
    agentUrl: 'https://agent.example.com',
    appId: 'app123',
    token: 'tok-abc',
    destDir,
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /404/);
  assert.ok(!existsSync(join(destDir, 'app')), 'no app dir on failure');
});

test('fetchAppZip soft-fails on a network error (no throw)', async (t) => {
  t.after(restoreFetch);
  globalThis.fetch = async () => {
    throw new Error('ETIMEDOUT');
  };

  const destDir = mkdtempSync(join(tmpdir(), 'agentfetch-dest-'));
  t.after(() => rmSync(destDir, { recursive: true, force: true }));

  const result = await fetchAppZip({
    agentUrl: 'https://agent.example.com',
    appId: 'app123',
    token: 'tok-abc',
    destDir,
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /ETIMEDOUT/);
});

test('fetchAppZip soft-fails when unzip itself fails (corrupt zip)', async (t) => {
  t.after(restoreFetch);
  globalThis.fetch = async () => streamResponse(Buffer.from('this is not a zip'), { status: 200 });

  const destDir = mkdtempSync(join(tmpdir(), 'agentfetch-dest-'));
  t.after(() => rmSync(destDir, { recursive: true, force: true }));

  const result = await fetchAppZip({
    agentUrl: 'https://agent.example.com',
    appId: 'app123',
    token: 'tok-abc',
    destDir,
  });

  assert.equal(result.ok, false);
  assert.ok(result.error, 'error present on unzip failure');
});
