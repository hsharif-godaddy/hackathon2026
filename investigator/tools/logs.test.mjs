import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLogTools } from './logs.mjs';

test('logDigest returns Drain3 templates + rare from mineLogs', async () => {
  const rawLogLines = [
    'request from 10.0.0.1 took 12 ms',
    'request from 10.0.0.2 took 34 ms',
    'request from 10.0.0.3 took 9 ms',
    'FATAL disk error on node-9',
  ];
  const tools = createLogTools({ rawLogLines });
  const r = await tools.logDigest.execute({ rareMaxCount: 1 });
  assert.equal(r.ok, true);
  assert.equal(r.clusterCount, 2);
  assert.equal(r.templates[0].count, 3);
  assert.equal(r.rare.length, 1);
});

test('logDigest handles empty logs', async () => {
  const tools = createLogTools({ rawLogLines: [] });
  const r = await tools.logDigest.execute({});
  assert.equal(r.ok, true);
  assert.equal(r.totalLines, 0);
});

test('fetchLogLines invokes the fetchImpl with correct args and returns parsed result', async () => {
  const calls = [];
  const fakeExec = async (cmd, args, opts) => {
    calls.push({ cmd, args });
    return { stdout: JSON.stringify({ ok: true, lines: [{ ts: '2026-01-01', text: 'error: boom' }] }), stderr: '' };
  };
  const tools = createLogTools({ appId: 'myapp', rawLogLines: [], skillDir: '/opt/skills', fetchImpl: fakeExec });
  const r = await tools.fetchLogLines.execute({ service: 'airo-agents', contains: 'boom', window: '1h', limit: 50 });
  assert.equal(r.ok, true);
  assert.equal(r.lines.length, 1);
  assert.ok(calls[0].args.includes('--appId'));
  assert.ok(calls[0].args.includes('myapp'));
});

test('fetchLogLines soft-fails when fetchImpl throws', async () => {
  const fakeExec = async () => { throw new Error('loki unavailable'); };
  const tools = createLogTools({ appId: 'app1', rawLogLines: [], fetchImpl: fakeExec });
  const r = await tools.fetchLogLines.execute({ service: 'airo-preview', window: '1h' });
  assert.equal(r.ok, false);
  assert.ok(r.error);
});
