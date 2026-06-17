// Integration test for INVESTIGATOR_HARNESS=core handler path.
// Verifies B1 (terminal vars in shared scope — no ReferenceError),
// H1 (heartbeat/finalized declared before harness branch),
// and that the handler returns statusCode:200 with status:completed.
//
// Uses mock.module to stub all external boundaries mirroring handler.test.mjs.

import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

// ── shared state ───────────────────────────────────────────────────────────
const stateStore = new Map();
const emittedEvents = [];
const fsWrites = [];

// ── mocks ───────────────────────────────────────────────────────────────────
mock.module('@aws-sdk/client-s3', {
  namedExports: {
    S3Client: class {
      send(cmd) {
        const op = cmd.constructor.name;
        if (op === 'GetObjectCommand') {
          const key = `${cmd.args.Bucket}/${cmd.args.Key}`;
          if (!stateStore.has(key)) {
            const err = new Error('NoSuchKey'); err.name = 'NoSuchKey'; return Promise.reject(err);
          }
          const body = stateStore.get(key);
          return Promise.resolve({ Body: (async function* () { yield Buffer.from(body); })() });
        }
        if (op === 'PutObjectCommand') {
          stateStore.set(`${cmd.args.Bucket}/${cmd.args.Key}`, String(cmd.args.Body ?? ''));
          return Promise.resolve({});
        }
        return Promise.resolve({});
      }
    },
    GetObjectCommand: class { constructor(args) { this.args = args; } },
    PutObjectCommand: class { constructor(args) { this.args = args; } },
    CopyObjectCommand: class { constructor(args) { this.args = args; } },
    HeadObjectCommand: class { constructor(args) { this.args = args; } },
  },
});

mock.module('gd-auth-client', {
  defaultExport: {
    IamTokenClient: class {
      once() { return this; }
      getToken() {
        const h = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
        const p = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 86400 })).toString('base64url');
        return Promise.resolve(`${h}.${p}.sig`);
      }
    },
  },
});

mock.module('./events.mjs', {
  namedExports: {
    createEventEmitter: () => {
      let seq = 0;
      const emit = async (type, data) => { seq++; emittedEvents.push({ type, data, seq }); };
      emit.getSeq = () => seq;
      return emit;
    },
  },
});

mock.module('./crm-casenote.mjs', { namedExports: { addCrmCaseNote: async () => {} } });

mock.module('./evidence-loader.mjs', {
  namedExports: { loadEvidenceCredentials: async () => ({ lokiApiKey: 'L', airoBuilderEsApiKey: 'A', controlPlaneEsApiKey: 'C' }) },
});

mock.module('./agent-jwt.mjs', {
  namedExports: { mintAgentToken: async () => ({ token: 'tok', expires: new Date(Date.now() + 300_000) }) },
});

mock.module('./agent-fetch.mjs', {
  namedExports: {
    fetchAppZip: async () => ({ ok: false }),
    fetchConversations: async () => ({ ok: false }),
  },
});

mock.module('./graph-setup.mjs', {
  namedExports: {
    buildCustomerGraph: async () => false,
    writeMcpConfig: async (p) => p,
    isGraphAvailable: async () => false,
    createCrgMcpClient: async () => null,
  },
});

mock.module('./platform-graph.mjs', {
  namedExports: { ensurePlatformGraph: async () => null },
});

mock.module('./verifier.mjs', {
  namedExports: { VERIFIER_MODEL: 'claude-sonnet-4-6', runVerifier: async () => ({ ran: false, pass: null }) },
});

// Stub core-run to return a completed result with stub files
mock.module('./core-run.mjs', {
  namedExports: {
    runCore: async ({ workDir, appId }) => {
      const reportPath = `${workDir}/${appId}.md`;
      const analysisPath = `${workDir}/${appId}.analysis.json`;
      fsWrites.push({ path: reportPath, body: '# Report\n\nRoot cause.' });
      fsWrites.push({ path: analysisPath, body: JSON.stringify({ v: 1, appId, verdict: 'agent-bug', verdictConfidence: 'medium', verdictRationale: 'test', sentiment: 'negative', confidence: 0.8, rootCause: 'route missing', category: 'test', relatesTo: 'test', fixKind: 'none', fixPrompt: null, engNote: null }) });
      return {
        reportPath,
        analysisPath,
        coverage: { partial: false, toolsUsed: new Set() },
        usage: { inputTokens: 1000, outputTokens: 200 },
        verdict: { verdict: 'agent-bug' },
      };
    },
  },
});

mock.module('./provider.mjs', {
  namedExports: {
    createInvestigatorModels: () => ({ lead: {}, mechanical: {}, strong: {} }),
  },
});

// Mock node:child_process (used by logStream createWriteStream and spawn on cli path)
mock.module('node:child_process', {
  namedExports: {
    spawn: (...args) => {
      const child = new EventEmitter();
      child.pid = 9999;
      child.stdout = new EventEmitter(); child.stdout.pipe = () => {};
      child.stderr = new EventEmitter(); child.stderr.pipe = () => {};
      return child;
    },
  },
});

// Mock node:fs so bootstrap() (mkdir + cp from /opt/claude-template) succeeds,
// and readdir/readFile return the stub report that core-run wrote.
mock.module('node:fs', {
  namedExports: {
    promises: {
      mkdir: async () => {},
      cp: async () => {},
      symlink: async () => {},
      lstat: async () => ({}),
      readdir: async () => [],
      readFile: async (p) => {
        const write = fsWrites.find((w) => w.path === String(p));
        if (write) return write.body;
        const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e;
      },
      writeFile: async (p, body) => { fsWrites.push({ path: String(p), body: String(body) }); },
      rm: async () => {},
    },
    createWriteStream: () => ({
      write: () => {},
      end: (cb) => { if (cb) cb(); },
      once: (ev, cb) => { if (ev === 'finish') setImmediate(cb); },
      on: () => {},
      pipe: () => {},
    }),
    mkdirSync: () => {},
  },
});

// ── log-gather subdir walk unit tests ────────────────────────────────────────
// Directly tests the readback logic using the real node:fs against /tmp,
// bypassing the full handler mock. Runs before the module-mock describe block.
import { test as nodeTest } from 'node:test';
import { promises as realFs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

nodeTest('log-gather: reads page files from source subdirs, skips index.json (regression)', async () => {
  // Reproduce the write_batched_evidence layout:
  //   {logIndexDir}/{safe_name(sourceId)}/{bucket}-p{NNNN}.json → { "logs": [...] }
  //   {logIndexDir}/evidence.json  (top-level, should NOT be read)
  const base = await realFs.mkdtemp(join(tmpdir(), 'lg-test-'));
  const agentsDir = join(base, 'airo-agents');
  const previewDir = join(base, 'airo-preview');
  await realFs.mkdir(agentsDir, { recursive: true });
  await realFs.mkdir(previewDir, { recursive: true });

  // Page files — only these should contribute rawLogLines
  await realFs.writeFile(join(agentsDir, 'b000-p0000.json'), JSON.stringify({ logs: ['agent line 1', 'agent line 2'] }));
  await realFs.writeFile(join(previewDir, 'b000-p0000.json'), JSON.stringify({ logs: ['preview line 1'] }));
  // index.json per source (should be skipped — no -p in name)
  await realFs.writeFile(join(agentsDir, 'index.json'), JSON.stringify({ topSignatures: [] }));
  // top-level evidence.json (should be skipped — not in a subdir)
  await realFs.writeFile(join(base, 'evidence.json'), JSON.stringify({ sources: [] }));

  // Replicate the handler readback loop inline
  const rawLogLines = [];
  let skippedPages = 0;
  const sourceDirs = (await realFs.readdir(base, { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => join(base, e.name));
  for (const sourceDir of sourceDirs) {
    const pageFiles = (await realFs.readdir(sourceDir))
      .filter((f) => f.includes('-p') && f.endsWith('.json'));
    for (const pageFile of pageFiles) {
      try {
        const raw = await realFs.readFile(join(sourceDir, pageFile), 'utf-8');
        const parsed = JSON.parse(raw);
        const logs = parsed.logs || parsed.lines || [];
        for (const log of logs) {
          const text = typeof log === 'string' ? log : (log.message || log.msg || log.log || JSON.stringify(log));
          if (text) rawLogLines.push(text);
        }
      } catch { skippedPages++; }
    }
  }

  assert.equal(rawLogLines.length, 3, `expected 3 lines, got ${rawLogLines.length}: ${JSON.stringify(rawLogLines)}`);
  assert.ok(rawLogLines.includes('agent line 1'));
  assert.ok(rawLogLines.includes('preview line 1'));
  assert.equal(skippedPages, 0);
  // evidence.json and index.json did NOT contribute lines
  assert.ok(!rawLogLines.some((l) => l.includes('sources') || l.includes('topSignatures')));

  await realFs.rm(base, { recursive: true });
});

// ── test ─────────────────────────────────────────────────────────────────────
describe('handler core path (B1/H1 regression)', () => {
  it('completes without ReferenceError and emits terminal event', async () => {
    process.env.INVESTIGATOR_HARNESS = 'core';
    process.env.GOCODE_USE_S2S_AUTH = 'true';
    process.env.STATE_BUCKET = 'test-bucket';
    process.env.ANTHROPIC_BASE_URL = 'https://gocode.test/v1';
    process.env.SSO_HOST = 'sso.test-godaddy.com';
    delete process.env.VERIFIER_FUNCTION_NAME; // no lambda client needed

    const { handler } = await import('./handler.mjs');

    const result = await handler({
      investigationId: 'inv-core-b1-test',
      appId: 'app-test',
      customerId: 'cust-test',
      feedback: 'my app is broken',
      timeWindow: '1h',
      stateKey: 'active/cust-test/app-test/state.json',
      historyPrefix: 'history/cust-test/app-test/',
      resultKey: 'active/cust-test/app-test/result.md',
      eventsPrefix: 'events/inv-core-b1-test/',
      source: 'test',
    });

    // B1: no ReferenceError — should return 200, not 500
    assert.equal(result.statusCode, 200, `handler returned ${result.statusCode}: ${result.body}`);

    const body = JSON.parse(result.body);
    // core path: runCore stub returns partial=false → status=completed
    assert.equal(body.status, 'completed', `expected completed, got: ${JSON.stringify(body)}`);

    // terminal event emitted (B1 bug would throw before this line)
    const terminal = emittedEvents.find((e) => e.type === 'investigation.completed');
    assert.ok(terminal, `investigation.completed not in events: ${JSON.stringify(emittedEvents.map(e => e.type))}`);
  });
});
