import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

// `mock.module` cannot remock the same specifier in a single process, and
// dynamic `await import(...)` is cached after the first call. We therefore
// install the module mock once with a mutable `sendImpl`, then reassign
// `sendImpl` per test to control behavior. We also capture the most-recent
// command instance in `lastCommand` so tests can assert on input shape.
let sendImpl = async () => ({});
let lastCommand = null;

mock.module('@aws-sdk/client-s3', {
  namedExports: {
    S3Client: class {
      send(command) {
        lastCommand = command;
        return sendImpl(command);
      }
    },
    GetObjectCommand: class {
      constructor(input) {
        this.input = input;
      }
    },
    PutObjectCommand: class {
      constructor(input) {
        this.input = input;
      }
    },
  },
});

const { keyFor, readState, writeStateConditional } = await import('./state.mjs');

await test('readState returns null on 404 (NoSuchKey)', async () => {
  sendImpl = mock.fn(async () => {
    const err = new Error('not found');
    err.name = 'NoSuchKey';
    throw err;
  });
  const result = await readState({ bucket: 'b', customerId: 'c1', appId: 'a1' });
  assert.equal(result, null);
});

await test('readState parses JSON + etag', async () => {
  sendImpl = mock.fn(async () => ({
    Body: { transformToString: async () => JSON.stringify({ crmCaseId: 'C1' }) },
    ETag: '"etag1"',
  }));
  const result = await readState({ bucket: 'b', customerId: 'c1', appId: 'a1' });
  assert.equal(result.state.crmCaseId, 'C1');
  assert.equal(result.etag, '"etag1"');
});

await test('writeStateConditional uses IfNoneMatch on first write', async () => {
  sendImpl = mock.fn(async () => ({}));
  lastCommand = null;
  await writeStateConditional({
    bucket: 'b',
    customerId: 'c1',
    appId: 'a1',
    state: { crmCaseId: 'C1' },
  });
  assert.equal(lastCommand.input.IfNoneMatch, '*');
});

await test('writeStateConditional uses IfMatch on update', async () => {
  sendImpl = mock.fn(async () => ({}));
  lastCommand = null;
  await writeStateConditional({
    bucket: 'b',
    customerId: 'c1',
    appId: 'a1',
    state: { crmCaseId: 'C1' },
    ifMatchEtag: '"etag1"',
  });
  assert.equal(lastCommand.input.IfMatch, '"etag1"');
});

await test('writeStateConditional rethrows 412 PreconditionFailed', async () => {
  sendImpl = mock.fn(async () => {
    const err = new Error('precondition failed');
    err.name = 'PreconditionFailed';
    err.$metadata = { httpStatusCode: 412 };
    throw err;
  });
  await assert.rejects(
    () =>
      writeStateConditional({
        bucket: 'b',
        customerId: 'c1',
        appId: 'a1',
        state: {},
        ifMatchEtag: '"etag1"',
      }),
    (err) => err.name === 'PreconditionFailed',
  );
});

await test('keyFor URL-encodes customerId and appId', () => {
  assert.equal(keyFor('cust/1', 'app#a'), 'dedup/cust%2F1/app%23a/state.json');
});
