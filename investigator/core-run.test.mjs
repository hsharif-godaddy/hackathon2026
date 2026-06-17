import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCore } from './core-run.mjs';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('runCore builds tools, runs loop, synthesizes verdict, writes files', async () => {
  const workDir = await mkdtemp(join(tmpdir(), 'core-run-test-'));

  const phases = [];
  const activity = [];

  const fakeRunInvestigation = async ({ onActivity, onPhase }) => {
    onPhase?.('phase-1-analyze');
    onActivity?.({ tool: 'logDigest', label: 'Searching logs', detail: '' });
    return { report: 'ROOT CAUSE: route missing', steps: [], usage: { inputTokens: 10, outputTokens: 5 }, coverage: { partial: false } };
  };

  const fakeVerdict = { v: 1, sentiment: 'negative', confidence: 0.8, rootCause: 'route missing', category: 'missing-route', verdict: 'agent-bug', relatesTo: 'app-code', verdictConfidence: 'high', verdictRationale: 'log cited', fixKind: 'app-prompt', fixPrompt: 'add route', engNote: null };
  const fakeSynthesize = async () => fakeVerdict;
  const fakePreResolve = async (v) => ({ verdict: v, dangling: [] });

  const result = await runCore({
    appId: 'testapp', feedback: 'broken', workDir,
    models: { lead: {} },
    onActivity: (a) => activity.push(a),
    onPhase: (p) => phases.push(p),
    deps: {
      runInvestigation: fakeRunInvestigation,
      synthesizeVerdict: fakeSynthesize,
      preResolveCitations: fakePreResolve,
    },
  });

  assert.ok(result.reportPath);
  assert.ok(result.analysisPath);
  const report = await readFile(result.reportPath, 'utf-8');
  assert.match(report, /ROOT CAUSE/);
  const analysis = JSON.parse(await readFile(result.analysisPath, 'utf-8'));
  assert.equal(analysis.verdict, 'agent-bug');
  assert.ok(activity.some((a) => a.tool === 'logDigest'));
  assert.ok(phases.includes('phase-1-analyze'));
  // C2: usage must be forwarded from the loop so the handler can record cost.
  assert.deepEqual(result.usage, { inputTokens: 10, outputTokens: 5 });
});

test('runCore wires the readConversation tool when hasConversations is set (CLI parity)', async () => {
  const workDir = await mkdtemp(join(tmpdir(), 'core-run-convo-'));
  let toolsSeen = null;
  let convoOpts = null;
  let systemSeen = null;

  const result = await runCore({
    appId: 'testapp', feedback: 'broken', workDir,
    hasConversations: true,
    conversationsPath: '/tmp/conversations.json',
    skillDir: '/nonexistent-skill-dir', // skill-file reads soft-fail to ''
    models: { lead: {} },
    onActivity: () => {},
    onPhase: () => {},
    deps: {
      createConversationTools: (o) => { convoOpts = o; return { readConversation: { __tool: true } }; },
      runInvestigation: async ({ tools, system }) => {
        toolsSeen = tools;
        systemSeen = system;
        return { report: 'R', steps: [], usage: { inputTokens: 1, outputTokens: 1 }, coverage: { partial: false } };
      },
      synthesizeVerdict: async () => ({ v: 1, sentiment: 'neutral', confidence: 0.5, rootCause: 'x', category: 'c', verdict: 'no-issue', relatesTo: 'r', verdictConfidence: 'low', verdictRationale: 'x', fixKind: 'none', fixPrompt: null, engNote: null }),
      preResolveCitations: async (v) => ({ verdict: v, dangling: [] }),
    },
  });

  assert.ok(result.reportPath);
  assert.ok(toolsSeen.readConversation, 'readConversation tool must be passed to the loop');
  assert.equal(convoOpts.conversationsPath, '/tmp/conversations.json');
  // P1-3: a per-run spotlighting sentinel is generated and injected into the system prompt
  assert.match(systemSeen, /UNTRUSTED-[0-9a-f]{8}/);
});
