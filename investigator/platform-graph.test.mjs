import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { gzipSync } from 'node:zlib';

import {
  ensurePlatformGraph,
  _resetPlatformGraphForTest,
  PLATFORM_GRAPH_KEY,
} from './platform-graph.mjs';

// Lightweight stand-ins for the SDK command classes. The real
// @aws-sdk/client-s3 is only installed in the image (npm install in the
// Dockerfile), so the unit suite injects these instead. Their constructor
// names match the real classes so the fake client can dispatch on them.
class HeadObjectCommand {
  constructor(input) { this.input = input; }
}
class GetObjectCommand {
  constructor(input) { this.input = input; }
}
const injectedCommands = { HeadObjectCommand, GetObjectCommand };

// A minimal fake S3 client whose `send` dispatches on the command's
// constructor name. Lets us assert which calls happened (Head vs Get) and
// inject ETag / Body / error responses without the real SDK.
function makeFakeS3({ head, get } = {}) {
  const calls = [];
  return {
    calls,
    async send(command) {
      const name = command.constructor.name;
      calls.push({ name, input: command.input });
      if (name === 'HeadObjectCommand') {
        if (typeof head === 'function') return head(command);
        return head;
      }
      if (name === 'GetObjectCommand') {
        if (typeof get === 'function') return get(command);
        return get;
      }
      throw new Error(`unexpected command ${name}`);
    },
  };
}

// All ensurePlatformGraph calls in this suite inject the stub commands.
function run(s3, extra = {}) {
  return ensurePlatformGraph({ client: s3, bucket: 'b', ...injectedCommands, ...extra });
}

// Build a GetObject-shaped response whose Body is an async-iterable stream of
// the GZIPPED given buffer (the S3 object is graph.db.gz; the loader
// stream-gunzips it). After gunzip the on-disk file equals the raw `bytes`.
function getResponse(etag, bytes) {
  return { ETag: etag, Body: Readable.from([gzipSync(Buffer.from(bytes))]) };
}

describe('platform-graph', () => {
  let savedTmp;
  let tmpRoot;

  beforeEach(async () => {
    _resetPlatformGraphForTest();
    // Redirect /tmp so the module's hardcoded /tmp/platform-graph target is
    // sandboxed under a per-test dir we can clean up. The module reads
    // PLATFORM_GRAPH_LOCAL_ROOT first (test seam), falling back to /tmp.
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pg-test-'));
    savedTmp = process.env.PLATFORM_GRAPH_LOCAL_ROOT;
    process.env.PLATFORM_GRAPH_LOCAL_ROOT = path.join(tmpRoot, 'platform-graph');
    process.env.STATE_BUCKET = 'airo-investigations-test';
  });

  afterEach(async () => {
    _resetPlatformGraphForTest();
    if (savedTmp === undefined) delete process.env.PLATFORM_GRAPH_LOCAL_ROOT;
    else process.env.PLATFORM_GRAPH_LOCAL_ROOT = savedTmp;
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it('fresh download writes the DB and returns the graph root', async () => {
    const s3 = makeFakeS3({
      head: { ETag: '"abc123"' },
      get: getResponse('"abc123"', 'GRAPHBYTES'),
    });

    const root = await run(s3);

    const expectedRoot = process.env.PLATFORM_GRAPH_LOCAL_ROOT;
    assert.equal(root, expectedRoot);
    // DB landed at <root>/.code-review-graph/graph.db
    const dbPath = path.join(expectedRoot, '.code-review-graph', 'graph.db');
    const contents = await fs.readFile(dbPath, 'utf-8');
    assert.equal(contents, 'GRAPHBYTES');
    // One Head + one Get on the first call.
    assert.deepEqual(s3.calls.map((c) => c.name), ['HeadObjectCommand', 'GetObjectCommand']);
    // Keyed at the documented platform-graph prefix.
    assert.equal(s3.calls[0].input.Key, PLATFORM_GRAPH_KEY);
  });

  it('matching-ETag warm path skips GetObject', async () => {
    const s3 = makeFakeS3({
      head: { ETag: '"same"' },
      get: getResponse('"same"', 'FIRST'),
    });

    // First call downloads.
    const root1 = await run(s3);
    assert.ok(root1);
    s3.calls.length = 0;

    // Second call: Head returns the same ETag and the DB still exists on disk,
    // so GetObject must NOT be issued.
    const root2 = await run(s3);
    assert.equal(root2, root1);
    assert.deepEqual(s3.calls.map((c) => c.name), ['HeadObjectCommand']);
  });

  it('re-downloads when the ETag changed', async () => {
    const s3 = makeFakeS3({
      head: () => ({ ETag: '"v2"' }),
      get: () => getResponse('"v2"', 'SECOND'),
    });
    // Seed cache with a different etag via a first download.
    const first = makeFakeS3({ head: { ETag: '"v1"' }, get: getResponse('"v1"', 'FIRST') });
    await run(first);

    const root = await run(s3);
    assert.ok(root);
    const dbPath = path.join(root, '.code-review-graph', 'graph.db');
    assert.equal(await fs.readFile(dbPath, 'utf-8'), 'SECOND');
    assert.deepEqual(s3.calls.map((c) => c.name), ['HeadObjectCommand', 'GetObjectCommand']);
  });

  it('returns null when the object is missing (NoSuchKey)', async () => {
    const err = new Error('not found');
    err.name = 'NoSuchKey';
    const s3 = makeFakeS3({ head: () => { throw err; } });

    const root = await run(s3);
    assert.equal(root, null);
  });

  it('returns null on a 404 head', async () => {
    const err = new Error('not found');
    err.$metadata = { httpStatusCode: 404 };
    const s3 = makeFakeS3({ head: () => { throw err; } });

    const root = await run(s3);
    assert.equal(root, null);
  });

  it('returns null (soft-fail) on any other S3 error', async () => {
    const err = new Error('AccessDenied');
    err.name = 'AccessDenied';
    const s3 = makeFakeS3({ head: () => { throw err; } });

    const root = await run(s3);
    assert.equal(root, null);
  });

  it('returns null when no bucket is configured', async () => {
    delete process.env.STATE_BUCKET;
    const s3 = makeFakeS3({ head: { ETag: '"x"' } });
    const root = await ensurePlatformGraph({ client: s3 });
    assert.equal(root, null);
    // Must not even attempt an S3 call without a bucket.
    assert.equal(s3.calls.length, 0);
  });
});
