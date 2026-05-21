import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

// Mock the AWS SDK + gd-auth-client + node:child_process at module-load
// so importing `./handler.mjs` doesn't try to construct real clients or
// spawn anything. The s2s-disabled feedback-source early-reject path only
// touches S3 (mergeState → GetObject + PutObject; emitEvent → PutObject)
// and the lock release; spawn is never reached.
//
// Behavior we want to lock:
//   1. `source: 'feedback'` invocation with `GOCODE_USE_S2S_AUTH=false`
//      returns 400 (prevents legacy-key path from silently breaking
//      automation-source invocations) — review F-11.
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
  },
});

const { handler } = await import('./handler.mjs');

const BASE_EVENT = {
  investigationId: 'inv-test-123',
  appId: 'app-1',
  customerId: 'cust-1',
  feedback: 'something broken',
  fullstoryUrl: null,
  timeWindow: null,
  stateKey: 'active/cust-1/app-1/state.json',
  resultKey: 'active/cust-1/app-1/result.md',
  historyPrefix: 'history/cust-1/app-1/',
  tracePrefix: 'active/cust-1/app-1/',
  eventsPrefix: 'events/cust-1/app-1/',
};

describe('handler — s2s-disabled feedback-source early reject', () => {
  beforeEach(() => {
    s3Calls.length = 0;
    stateStore.clear();
    process.env.STATE_BUCKET = 'fake-bucket';
    process.env.SSO_HOST = 'sso.example.com';
    process.env.GOCODE_USE_S2S_AUTH = 'false';
    process.env.AWS_REGION = 'us-west-2';
  });

  it('rejects feedback-source invocation with 400 when GOCODE_USE_S2S_AUTH is false', async () => {
    const result = await handler({
      ...BASE_EVENT,
      source: 'feedback',
      // No gocodeApiKey — feedback-source has no user-side key, that's
      // exactly the regression this guard prevents from silently failing.
    });
    assert.equal(result.statusCode, 400);
    assert.match(result.body, /feedback requires s2s auth/);
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
    assert.match(String(failedWrite.args.Body), /GOCODE_USE_S2S_AUTH=true/);
  });

  it('console-source under same env returns 400 jomaxToken required (the s2s-disabled guard does NOT eat legacy errors)', async () => {
    // The s2s-disabled-feedback guard at handler.mjs:523 must short-circuit
    // ONLY the feedback path; console-source should still hit the
    // jomaxToken check at line 471 first. This pins that the two error
    // paths stay independent — a regression that flipped them would
    // surface as customer impact via dashboard misclassification.
    const result = await handler({
      ...BASE_EVENT,
      source: 'console',
      // No jomaxToken → console-source expects 400 with the jomax-flavored
      // message, which is the line-471 guard, not the s2s guard.
    });
    assert.equal(result.statusCode, 400);
    assert.match(result.body, /jomaxToken required/);
  });
});
