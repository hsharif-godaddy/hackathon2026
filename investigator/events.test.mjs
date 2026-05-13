import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createEventEmitter } from './events.mjs';

function mkFakeS3() {
  const puts = [];
  return {
    puts,
    send: async (cmd) => {
      const input = cmd.input || cmd;
      puts.push({
        Bucket: input.Bucket,
        Key: input.Key,
        Body: input.Body,
        ContentType: input.ContentType,
      });
    },
  };
}

describe('createEventEmitter', () => {
  it('returns a noop when eventsPrefix missing (backward compat)', async () => {
    const s3 = mkFakeS3();
    const emit = createEventEmitter({ s3, bucket: 'b', eventsPrefix: undefined, investigationId: 'inv-1' });
    const result = await emit('investigation.started', { appId: 'a' });
    assert.equal(result, undefined);
    assert.equal(s3.puts.length, 0);
  });

  it('writes zero-padded seq keys monotonically', async () => {
    const s3 = mkFakeS3();
    const emit = createEventEmitter({
      s3,
      bucket: 'my-bucket',
      eventsPrefix: 'events/cust/app/inv-1/',
      investigationId: 'inv-1',
    });
    await emit('investigation.started', { appId: 'a' });
    await emit('phase.started', { phase: 'bootstrap' });
    await emit('heartbeat', { phase: 'bootstrap' });
    assert.equal(s3.puts.length, 3);
    assert.equal(s3.puts[0].Key, 'events/cust/app/inv-1/000001.json');
    assert.equal(s3.puts[1].Key, 'events/cust/app/inv-1/000002.json');
    assert.equal(s3.puts[2].Key, 'events/cust/app/inv-1/000003.json');
    for (const put of s3.puts) assert.equal(put.Bucket, 'my-bucket');
  });

  it('sets v=1, investigationId, monotonic seq, and ISO ts in payload', async () => {
    const s3 = mkFakeS3();
    const emit = createEventEmitter({
      s3,
      bucket: 'b',
      eventsPrefix: 'events/c/a/inv-2/',
      investigationId: 'inv-2',
    });
    await emit('investigation.started', { appId: 'a', customerId: 'c' });
    const body = JSON.parse(s3.puts[0].Body);
    assert.equal(body.v, 1);
    assert.equal(body.seq, 1);
    assert.equal(body.investigationId, 'inv-2');
    assert.equal(body.type, 'investigation.started');
    assert.deepEqual(body.data, { appId: 'a', customerId: 'c' });
    assert.match(body.ts, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('truncates oversized string fields and flags __truncated', async () => {
    const s3 = mkFakeS3();
    const emit = createEventEmitter({
      s3,
      bucket: 'b',
      eventsPrefix: 'events/c/a/inv-3/',
      investigationId: 'inv-3',
    });
    const huge = 'x'.repeat(10_000);
    await emit('log', { message: huge });
    const body = JSON.parse(s3.puts[0].Body);
    assert.equal(body.data.__truncated, true);
    assert.ok(body.data.message.length <= 513, 'string trimmed to ~512 with ellipsis');
    assert.ok(body.data.message.endsWith('…'));
  });

  it('swallows S3 failures and reuses the failed seq on next emit', async () => {
    // Prevents permanent gaps in the event log that would stall the
    // contiguous reader for the rest of the investigation.
    let callCount = 0;
    const s3 = {
      send: async () => {
        callCount += 1;
        if (callCount === 1) throw new Error('S3 boom');
      },
    };
    const emit = createEventEmitter({
      s3,
      bucket: 'b',
      eventsPrefix: 'events/c/a/inv-4/',
      investigationId: 'inv-4',
    });
    const r = await emit('heartbeat', {});
    assert.equal(r.seq, 1);
    assert.equal(emit.getSeq(), 0, 'failed PUT must not commit seq');
    // Second call must REUSE seq 1 since the first never persisted.
    const r2 = await emit('heartbeat', {});
    assert.equal(r2.seq, 1);
    assert.equal(emit.getSeq(), 1);
  });

  it('serializes concurrent emits and assigns distinct contiguous seqs', async () => {
    const puts = [];
    const s3 = {
      send: async (cmd) => {
        // Add a small delay so concurrent emits would actually overlap
        // without the internal queue.
        await new Promise((resolve) => setTimeout(resolve, 5));
        puts.push({ Key: (cmd.input || cmd).Key });
      },
    };
    const emit = createEventEmitter({
      s3,
      bucket: 'b',
      eventsPrefix: 'events/c/a/inv-q/',
      investigationId: 'inv-q',
    });
    const results = await Promise.all([
      emit('heartbeat', {}),
      emit('heartbeat', {}),
      emit('heartbeat', {}),
    ]);
    assert.deepEqual(results.map((r) => r.seq), [1, 2, 3]);
    assert.deepEqual(puts.map((p) => p.Key), [
      'events/c/a/inv-q/000001.json',
      'events/c/a/inv-q/000002.json',
      'events/c/a/inv-q/000003.json',
    ]);
  });

  it('truncates nested string fields (not just top-level)', async () => {
    const s3 = mkFakeS3();
    const emit = createEventEmitter({
      s3,
      bucket: 'b',
      eventsPrefix: 'events/c/a/inv-nest/',
      investigationId: 'inv-nest',
    });
    const huge = 'x'.repeat(10_000);
    await emit('investigation.started', { input: { feedback: huge } });
    const body = JSON.parse(s3.puts[0].Body);
    assert.equal(body.data.__truncated, true);
    assert.ok(body.data.input.feedback.length <= 513);
    assert.ok(body.data.input.feedback.endsWith('…'));
  });

  it('getSeq reports current seq', async () => {
    const s3 = mkFakeS3();
    const emit = createEventEmitter({
      s3,
      bucket: 'b',
      eventsPrefix: 'events/c/a/inv-5/',
      investigationId: 'inv-5',
    });
    assert.equal(emit.getSeq(), 0);
    await emit('heartbeat', {});
    assert.equal(emit.getSeq(), 1);
    await emit('heartbeat', {});
    assert.equal(emit.getSeq(), 2);
  });
});
