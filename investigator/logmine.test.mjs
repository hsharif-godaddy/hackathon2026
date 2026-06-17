import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LogMasker, tokenize, LogCluster, createTemplate, Drain } from './logmine.mjs';

test('LogMasker masks an IPv4 address', () => {
  const m = new LogMasker();
  assert.equal(m.mask('connected to 192.168.0.1 ok'), 'connected to <:IP:> ok');
});

test('LogMasker masks a signed integer as NUM', () => {
  const m = new LogMasker();
  assert.equal(m.mask('retry count -42 reached'), 'retry count <:NUM:> reached');
});

test('LogMasker masks a hex literal', () => {
  const m = new LogMasker();
  assert.equal(m.mask('addr 0xdead is wrong'), 'addr <:HEX:> is wrong');
});

test('LogMasker masks a colon-separated id (e.g. MAC-like)', () => {
  const m = new LogMasker();
  assert.equal(m.mask('dev aa:bb:cc:dd up'), 'dev <:ID:> up');
});

test('LogMasker leaves non-variable text untouched', () => {
  const m = new LogMasker();
  assert.equal(m.mask('user logged in successfully'), 'user logged in successfully');
});

test('LogMasker masks multiple occurrences in one line', () => {
  const m = new LogMasker();
  assert.equal(m.mask('from 10.0.0.1 to 10.0.0.2'), 'from <:IP:> to <:IP:>');
});

// --- Airo-tuned rules (from real Loki + ESSP samples, 2026-06-10) ---

test('LogMasker masks a URL (real ESSP shape)', () => {
  const m = new LogMasker();
  assert.equal(
    m.mask('GET https://mgmt.woosaas.godaddy.com/api/airo/v1/subscriptions?ownerProduct=AiroAppBuilder failed'),
    'GET <:URL:> failed',
  );
});

test('LogMasker masks an ISO-8601 timestamp', () => {
  const m = new LogMasker();
  assert.equal(m.mask('emitted at 2026-06-10T12:04:09.800Z done'), 'emitted at <:TS:> done');
});

test('LogMasker masks a UUID (real ESSP customerId shape)', () => {
  const m = new LogMasker();
  assert.equal(m.mask('customer eb4a03c6-e47e-47ca-92a6-c92cb922375b ok'), 'customer <:UUID:> ok');
});

test('LogMasker masks a long hex hash (real Loki container_id shape)', () => {
  const m = new LogMasker();
  assert.equal(
    m.mask('container 1b1c2abef1099467481c6766df0cad8221e30f352a6a2884cc9910f1048edf93 up'),
    'container <:HEX:> up',
  );
});

test('LogMasker leaves version-like tokens (v1) intact — boundary rule', () => {
  const m = new LogMasker();
  // The /v1/ path segment must NOT become /v<:NUM:>/ — the digit is glued to a letter.
  assert.equal(m.mask('hit /api/airo/v1/x with 403'), 'hit /api/airo/v1/x with <:NUM:>');
});

test('LogMasker accepts custom instructions override', () => {
  const m = new LogMasker({
    instructions: [{ maskWith: 'CUSTOM', regex: /\bFOO\b/g }],
  });
  assert.equal(m.mask('this is FOO and FOO again'), 'this is <:CUSTOM:> and <:CUSTOM:> again');
  // default instructions are NOT applied when custom ones are passed
  assert.equal(m.mask('192.168.1.1'), '192.168.1.1');
});

test('tokenize splits on whitespace and drops empties', () => {
  assert.deepEqual(tokenize('  user   logged in '), ['user', 'logged', 'in']);
});

test('tokenize on empty string returns empty array', () => {
  assert.deepEqual(tokenize('   '), []);
});

test('LogCluster.getTemplate joins tokens with single spaces', () => {
  const c = new LogCluster(['user', 'logged', 'in'], 1);
  assert.equal(c.getTemplate(), 'user logged in');
  assert.equal(c.size, 1);
  assert.equal(c.clusterId, 1);
});

test('createTemplate wildcards positions that differ, keeps positions that match', () => {
  const merged = createTemplate(['user', 'bob', 'logged', 'in'], ['user', 'amy', 'logged', 'in'], '<:*:>');
  assert.deepEqual(merged, ['user', '<:*:>', 'logged', 'in']);
});

test('createTemplate keeps an existing wildcard as wildcard', () => {
  const merged = createTemplate(['user', 'carol', 'in'], ['user', '<:*:>', 'in'], '<:*:>');
  assert.deepEqual(merged, ['user', '<:*:>', 'in']);
});

test('Drain creates a new cluster for the first message', () => {
  const d = new Drain();
  const { cluster, changeType } = d.addLogMessage('user bob logged in');
  assert.equal(changeType, 'cluster_created');
  assert.equal(cluster.getTemplate(), 'user bob logged in');
  assert.equal(d.clusters().length, 1);
});

test('Drain merges a similar message into a wildcard template', () => {
  const d = new Drain();
  d.addLogMessage('user bob logged in');
  const { cluster, changeType } = d.addLogMessage('user amy logged in');
  assert.equal(changeType, 'cluster_template_changed');
  assert.equal(cluster.getTemplate(), 'user <:*:> logged in');
  assert.equal(cluster.size, 2);
  assert.equal(d.clusters().length, 1);
});

test('Drain returns changeType none when the template is unchanged', () => {
  const d = new Drain();
  d.addLogMessage('user bob logged in');
  d.addLogMessage('user amy logged in');
  const { changeType, cluster } = d.addLogMessage('user carol logged in');
  assert.equal(changeType, 'none');
  assert.equal(cluster.getTemplate(), 'user <:*:> logged in');
  assert.equal(cluster.size, 3);
});

test('Drain separates messages with different token counts', () => {
  const d = new Drain();
  d.addLogMessage('connection established');
  d.addLogMessage('connection established now please');
  assert.equal(d.clusters().length, 2);
});

test('Drain.match returns a matching cluster and null when none', () => {
  const d = new Drain();
  d.addLogMessage('user bob logged in');
  d.addLogMessage('user amy logged in');
  const hit = d.match('user zoe logged in');
  assert.ok(hit);
  assert.equal(hit.getTemplate(), 'user <:*:> logged in');
  assert.equal(d.match('totally different line here'), null);
});

// --- Task 4: TemplateMiner ---

import { TemplateMiner } from './logmine.mjs';

test('TemplateMiner masks then clusters, collapsing lines that differ only by values', () => {
  const tm = new TemplateMiner();
  const a = tm.addLogMessage('request from 10.0.0.1 took 200 ms');
  assert.equal(a.changeType, 'cluster_created');
  assert.equal(a.templateMined, 'request from <:IP:> took <:NUM:> ms');

  const b = tm.addLogMessage('request from 10.0.0.2 took 999 ms');
  assert.equal(b.changeType, 'none');
  assert.equal(b.clusterId, a.clusterId);
  assert.equal(b.clusterSize, 2);
});

test('TemplateMiner result has the documented fields', () => {
  const tm = new TemplateMiner();
  const r = tm.addLogMessage('disk full on node-7');
  assert.deepEqual(Object.keys(r).sort(), ['changeType', 'clusterId', 'clusterSize', 'templateMined']);
});

// --- Task 5: mineLogs ---

import { mineLogs } from './logmine.mjs';

test('mineLogs returns templates sorted by count desc and surfaces rare clusters', () => {
  const lines = [
    'request from 10.0.0.1 took 12 ms',
    'request from 10.0.0.2 took 34 ms',
    'request from 10.0.0.3 took 56 ms',
    'FATAL unrecoverable disk error on node-9',
  ];
  const { templates, rare, totalLines, clusterCount } = mineLogs(lines);

  assert.equal(totalLines, 4);
  assert.equal(clusterCount, 2);
  assert.equal(templates[0].count, 3);
  assert.equal(templates[0].template, 'request from <:IP:> took <:NUM:> ms');
  assert.equal(rare.length, 1);
  assert.match(rare[0].template, /FATAL unrecoverable disk error/);
  assert.deepEqual(Object.keys(templates[0]).sort(), ['clusterId', 'count', 'template']);
});

test('mineLogs respects a custom rareMaxCount', () => {
  const lines = ['a b c', 'a b c', 'x y z'];
  const { rare } = mineLogs(lines, { rareMaxCount: 2 });
  assert.equal(rare.length, 2);
});

test('mineLogs handles an empty input', () => {
  const { templates, rare, anomalies, totalLines, clusterCount } = mineLogs([]);
  assert.deepEqual(templates, []);
  assert.deepEqual(rare, []);
  assert.deepEqual(anomalies, []);
  assert.equal(totalLines, 0);
  assert.equal(clusterCount, 0);
});

test('mineLogs ranks an error-bearing frequent template above a benign one-off', () => {
  // 5x checkout 500 errors + 1 benign startup line.
  const lines = [
    ...Array(5).fill('POST /checkout 500 internal error'),
    'service started on port 3000',
  ];
  const { anomalies } = mineLogs(lines);
  assert.ok(anomalies.length >= 1);
  // The error template must be the top anomaly even though it's NOT the rarest.
  assert.match(anomalies[0].template, /checkout|error/i);
  assert.ok(anomalies[0].anomalyScore >= 10);
});

test('mineLogs surfaces a pure 5xx status line (no error word) as an anomaly (I3)', () => {
  // "GET /img 502" has no error keyword; masking turns 502 into <:NUM:>.
  // The raw-line status tagging must still rank it as an anomaly.
  const lines = [
    ...Array(4).fill('GET /img 502'),
    ...Array(20).fill('GET /img 200'),
  ];
  const { anomalies } = mineLogs(lines);
  assert.ok(anomalies.length >= 1);
  assert.match(anomalies[0].template, /\/img/);
  assert.ok(anomalies[0].anomalyScore >= 10);
});

test('mineLogs does NOT tag a benign 200 line as a 5xx anomaly (I3)', () => {
  const lines = [...Array(10).fill('GET /ok 200')];
  const { anomalies } = mineLogs(lines);
  assert.deepEqual(anomalies, []);
});

test('mineLogs anomaly list is sorted by score desc and respects anomalyTopN', () => {
  const lines = [
    'connection timeout to db',
    'auth failed for token',
    'request ok',
    'request ok',
  ];
  const { anomalies } = mineLogs(lines, { anomalyTopN: 1 });
  assert.equal(anomalies.length, 1); // capped
  assert.ok(anomalies[0].anomalyScore > 0);
});

test('mineLogs surfaces no anomalies when all lines are benign chatter', () => {
  const lines = [...Array(10).fill('heartbeat ok'), ...Array(10).fill('ping pong')];
  const { anomalies } = mineLogs(lines);
  assert.deepEqual(anomalies, []);
});

// --- Task 6: Real-data fixture tests ---

test('mineLogs collapses real ESSP mgmt-airo retry lines (URL + status masked) into one template', () => {
  const lines = [
    'mgmt-airo.api.auth-error.no-retry: GET https://mgmt.woosaas.godaddy.com/api/airo/v1/subscriptions?ownerProduct=AiroAppBuilder failed with 403, skipping retries',
    'mgmt-airo.api.auth-error.no-retry: GET https://mgmt.woosaas.godaddy.com/api/airo/v1/orders?ownerProduct=AiroAppBuilder failed with 502, skipping retries',
    'auth.validated: Customer authenticated',
  ];
  const { templates, clusterCount } = mineLogs(lines);
  assert.equal(clusterCount, 2);
  const top = templates.find((t) => t.template.startsWith('mgmt-airo.api.auth-error.no-retry'));
  assert.equal(top.count, 2);
  assert.equal(
    top.template,
    'mgmt-airo.api.auth-error.no-retry: GET <:URL:> failed with <:NUM:>, skipping retries',
  );
});

test('mineLogs collapses real Loki airo-agents memory snapshots', () => {
  const lines = ['memory: snapshot', 'memory: snapshot', 'memory: snapshot'];
  const { templates, clusterCount } = mineLogs(lines);
  assert.equal(clusterCount, 1);
  assert.equal(templates[0].count, 3);
  assert.equal(templates[0].template, 'memory: snapshot');
});

test('mineLogs keeps a UUID/timestamp-bearing line stable across value changes', () => {
  const lines = [
    'session eb4a03c6-e47e-47ca-92a6-c92cb922375b started at 2026-06-10T12:04:09.800Z',
    'session 9f12bb01-aa31-4cd2-8e77-1234567890ab started at 2026-06-10T13:15:22.001Z',
  ];
  const { templates, clusterCount } = mineLogs(lines);
  assert.equal(clusterCount, 1);
  assert.equal(templates[0].template, 'session <:UUID:> started at <:TS:>');
  assert.equal(templates[0].count, 2);
});

test('TemplateMiner.match returns cluster info for a known line and null for unknown', () => {
  const tm = new TemplateMiner();
  tm.addLogMessage('request from 10.0.0.1 took 200 ms');
  tm.addLogMessage('request from 10.0.0.2 took 999 ms'); // creates wildcard template

  const hit = tm.match('request from 10.0.0.3 took 42 ms');
  assert.ok(hit);
  assert.equal(hit.template, 'request from <:IP:> took <:NUM:> ms');
  assert.equal(hit.size, 2);

  assert.equal(tm.match('something completely different and unrelated'), null);
});
