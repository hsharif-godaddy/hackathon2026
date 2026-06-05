import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

// Mock the AWS SDK + gd-auth-client + node:child_process at module-load
// so importing `./handler.mjs` doesn't try to construct real clients or
// spawn anything. The s2s-disabled legacy early-reject path only touches
// S3 (mergeState → GetObject + PutObject; emitEvent → PutObject) and the
// lock release; spawn is never reached.
//
// Post Task 4.2, both triggers (console + feedback) run the SAME direct
// path with no JOMAX token and no per-source gocode gating. The only
// remaining legacy guard is the generic gocodeApiKey check: when an
// operator flips GOCODE_USE_S2S_AUTH='false' for rollback and no
// gocodeApiKey is forwarded (neither trigger sends one anymore), the
// handler 400s generically for BOTH sources.
//
// Behavior we want to lock:
//   1. Any source with `GOCODE_USE_S2S_AUTH=false` and no gocodeApiKey
//      returns 400 'gocodeApiKey required'.
//   2. mergeState writes `status: 'failed'` with the descriptive error
//      so a debug-console SSE consumer sees the cause.

const s3Calls = [];
const stateStore = new Map();

mock.module('@aws-sdk/client-s3', {
  namedExports: {
    S3Client: class {
      send(cmd) {
        const op = cmd.constructor.name;
        s3Calls.push({ op, args: cmd.args });
        if (op === 'GetObjectCommand') {
          const key = `${cmd.args.Bucket}/${cmd.args.Key}`;
          if (!stateStore.has(key)) {
            const err = new Error('NoSuchKey');
            err.name = 'NoSuchKey';
            return Promise.reject(err);
          }
          return Promise.resolve({
            Body: { transformToString: () => Promise.resolve(stateStore.get(key)) },
          });
        }
        if (op === 'PutObjectCommand') {
          const key = `${cmd.args.Bucket}/${cmd.args.Key}`;
          stateStore.set(key, String(cmd.args.Body ?? ''));
          return Promise.resolve({});
        }
        if (op === 'CopyObjectCommand') return Promise.resolve({});
        return Promise.resolve({});
      }
    },
    GetObjectCommand: class { constructor(args) { this.args = args; } },
    PutObjectCommand: class { constructor(args) { this.args = args; } },
    CopyObjectCommand: class { constructor(args) { this.args = args; } },
  },
});

mock.module('gd-auth-client', {
  defaultExport: {
    IamTokenClient: class {
      once() { return this; }
      getToken() { return Promise.resolve('fake.s2s.jwt'); }
    },
  },
});

mock.module('./events.mjs', {
  namedExports: {
    createEventEmitter: () => async () => {},
  },
});

mock.module('./crm-casenote.mjs', {
  namedExports: {
    addCrmCaseNote: async () => {},
  },
});

mock.module('./evidence-loader.mjs', {
  namedExports: {
    loadEvidenceCredentials: async () => ({
      lokiApiKey: 'L', ebLangfusePublicKey: 'P', ebLangfuseSecretKey: 'S',
      airoBuilderEsApiKey: 'A', controlPlaneEsApiKey: 'C', fullstoryApiKey: 'F',
    }),
  },
});

// Mock filesystem so handler's `bootstrap()` (mkdir + cp + symlink) is a
// no-op; it normally rehydrates the Claude config tree under /tmp from
// /opt/claude-template, which doesn't exist in the test environment.
mock.module('node:fs', {
  namedExports: {
    promises: {
      mkdir: async () => {},
      cp: async () => {},
      symlink: async () => {},
      lstat: async () => null,
      readdir: async () => [],
      readFile: async () => '',
      writeFile: async () => {},
      rm: async () => {},
    },
    createWriteStream: () => ({
      write: () => {},
      end: () => {},
      on: () => {},
    }),
    // agent-fetch.mjs (imported transitively via handler.mjs) imports
    // `mkdirSync` from node:fs at module load; provide a no-op so the mocked
    // module satisfies the named export. This path's early-reject returns
    // before any fetch runs, so the implementation is never invoked.
    mkdirSync: () => {},
  },
});

const { handler } = await import('./handler.mjs');

const BASE_EVENT = {
  investigationId: 'inv-test-123',
  appId: 'app-1',
  customerId: 'cust-1',
  feedback: 'something broken',
  timeWindow: null,
  stateKey: 'active/cust-1/app-1/state.json',
  resultKey: 'active/cust-1/app-1/result.md',
  historyPrefix: 'history/cust-1/app-1/',
  tracePrefix: 'active/cust-1/app-1/',
  eventsPrefix: 'events/cust-1/app-1/',
};

describe('handler — s2s-disabled legacy early reject (no gocodeApiKey)', () => {
  beforeEach(() => {
    s3Calls.length = 0;
    stateStore.clear();
    process.env.STATE_BUCKET = 'fake-bucket';
    process.env.SSO_HOST = 'sso.example.com';
    process.env.GOCODE_USE_S2S_AUTH = 'false';
    process.env.AWS_REGION = 'us-west-2';
  });

  it('rejects feedback-source invocation with 400 gocodeApiKey required when s2s is off and no key forwarded', async () => {
    const result = await handler({
      ...BASE_EVENT,
      source: 'feedback',
      // No gocodeApiKey — neither trigger forwards one anymore; under the
      // legacy rollback env var this is the generic key-missing 400.
    });
    assert.equal(result.statusCode, 400);
    assert.match(result.body, /gocodeApiKey required/);
  });

  it('writes a failure state to S3 on the early reject path', async () => {
    await handler({
      ...BASE_EVENT,
      source: 'feedback',
    });
    // The S3 write trail must contain a state.json PUT — without it the
    // BFF lock check would still see status: 'running' from the bootstrap
    // write and decline new submissions for 15 minutes. Pattern-match
    // the JSON Body across calls rather than asserting a final string,
    // since the handler writes state multiple times during the early
    // path and any of them carrying status: 'failed' is what matters.
    const stateWrites = s3Calls.filter(
      (c) => c.op === 'PutObjectCommand' && /state\.json$/.test(c.args.Key),
    );
    assert.ok(stateWrites.length > 0, 'expected at least one state.json write');
    const failedWrite = stateWrites.find((c) => /"status":\s*"failed"/.test(String(c.args.Body)));
    assert.ok(
      failedWrite,
      `expected a state write with status: 'failed'; got bodies:\n${stateWrites.map((c) => String(c.args.Body)).join('\n---\n')}`,
    );
    assert.match(String(failedWrite.args.Body), /gocodeApiKey missing from invoke payload/);
  });

  it('console-source under same env hits the SAME generic gocodeApiKey 400 (no per-source gating)', async () => {
    // Post Task 4.2 there is no console-only jomaxToken guard and no
    // feedback-only s2s guard. Both triggers run one unified path, so
    // console-source with s2s off and no key gets the identical generic
    // 400 — proving the two former per-source error paths were collapsed.
    const result = await handler({
      ...BASE_EVENT,
      source: 'console',
    });
    assert.equal(result.statusCode, 400);
    assert.match(result.body, /gocodeApiKey required/);
  });
});
