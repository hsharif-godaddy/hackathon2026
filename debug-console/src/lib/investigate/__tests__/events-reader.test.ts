/**
 * Tests for the contiguous-read behavior of readEventsSince. Covers the two
 * real-world correctness bugs the reader has to defend against:
 *   1. S3 serving PUT N+1 before PUT N while both are in flight
 *      (fire-and-forget emits from the Lambda).
 *   2. Transient GetObject failure on one key.
 *
 * Both must stop the batch at the problem and let the next poll retry, not
 * advance past the gap silently.
 */
import { GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { describe, expect, it } from 'vitest';

import { listEventSeqs, readEventsSince, type S3Like } from '../events';
import type { InvestigationEvent } from '../types';

function mkEvent(seq: number): InvestigationEvent {
  return {
    v: 1,
    seq,
    investigationId: 'inv-test',
    ts: '2026-05-12T00:00:00.000Z',
    type: 'heartbeat',
    data: {},
  };
}

interface FakeOpts {
  // Map of seq -> either an event (serves on GetObject) or 'missing' (404)
  // or 'error' (throws transient error).
  objects: Map<number, InvestigationEvent | 'missing' | 'error'>;
  // Seqs returned by ListObjectsV2. Usually matches objects.keys() but can be
  // set independently to simulate list/get skew.
  listed?: number[];
  prefix: string;
}

function mkFakeS3(opts: FakeOpts): S3Like {
  const listed = opts.listed ?? Array.from(opts.objects.keys());
  return {
    send: async (cmd: unknown) => {
      if (cmd instanceof ListObjectsV2Command) {
        return {
          Contents: listed.map((seq) => ({ Key: `${opts.prefix}${String(seq).padStart(6, '0')}.json` })),
          IsTruncated: false,
        };
      }
      if (cmd instanceof GetObjectCommand) {
        const key = (cmd as GetObjectCommand).input.Key!;
        const m = key.match(/\/(\d{6})\.json$/);
        if (!m) throw new Error('bad key');
        const seq = Number.parseInt(m[1]!, 10);
        const obj = opts.objects.get(seq);
        if (obj === undefined || obj === 'missing') {
          const err = new Error('NoSuchKey');
          (err as unknown as { name: string }).name = 'NoSuchKey';
          throw err;
        }
        if (obj === 'error') {
          throw new Error('S3 500');
        }
        const body = JSON.stringify(obj);
        async function* bodyGen(): AsyncIterable<Uint8Array> {
          yield new TextEncoder().encode(body);
        }
        return { Body: bodyGen() };
      }
      throw new Error('unknown command');
    },
  };
}

describe('listEventSeqs', () => {
  it('filters out seqs <= sinceSeq and sorts ascending', async () => {
    const s3 = mkFakeS3({
      prefix: 'events/c/a/inv-1/',
      listed: [3, 1, 2, 5, 4],
      objects: new Map(),
    });
    const { seqs } = await listEventSeqs('events/c/a/inv-1/', 2, s3);
    expect(seqs).toEqual([3, 4, 5]);
  });

  it('skips non-seq keys', async () => {
    const s3: S3Like = {
      send: async () => ({
        Contents: [
          { Key: 'events/c/a/inv-1/000001.json' },
          { Key: 'events/c/a/inv-1/000002.json' },
          { Key: 'events/c/a/inv-1/not-an-event.txt' },
        ],
        IsTruncated: false,
      }),
    };
    const { seqs } = await listEventSeqs('events/c/a/inv-1/', 0, s3);
    expect(seqs).toEqual([1, 2]);
  });
});

describe('readEventsSince — contiguous read', () => {
  const prefix = 'events/c/a/inv-1/';

  it('returns all events when no gap', async () => {
    const s3 = mkFakeS3({
      prefix,
      objects: new Map([
        [1, mkEvent(1)],
        [2, mkEvent(2)],
        [3, mkEvent(3)],
      ]),
    });
    const events = await readEventsSince(prefix, 0, s3);
    expect(events.map((e) => e.seq)).toEqual([1, 2, 3]);
  });

  it('stops at first gap — does NOT return seqs past the hole', async () => {
    // S3 listed 1, 2, 4, 5 but 3 is still in flight. Reader must return
    // only [1, 2] and let next poll pick up when 3 lands.
    const s3 = mkFakeS3({
      prefix,
      listed: [1, 2, 4, 5],
      objects: new Map([
        [1, mkEvent(1)],
        [2, mkEvent(2)],
        [4, mkEvent(4)],
        [5, mkEvent(5)],
      ]),
    });
    const events = await readEventsSince(prefix, 0, s3);
    expect(events.map((e) => e.seq)).toEqual([1, 2]);
  });

  it('returns contiguous block after gap closes on next poll', async () => {
    // After seq 3 lands, subsequent call with lastSeq=2 should drain 3..5.
    const s3 = mkFakeS3({
      prefix,
      objects: new Map([
        [1, mkEvent(1)],
        [2, mkEvent(2)],
        [3, mkEvent(3)],
        [4, mkEvent(4)],
        [5, mkEvent(5)],
      ]),
    });
    const events = await readEventsSince(prefix, 2, s3);
    expect(events.map((e) => e.seq)).toEqual([3, 4, 5]);
  });

  it('returns [] when sinceSeq is already caught up', async () => {
    const s3 = mkFakeS3({
      prefix,
      objects: new Map([[1, mkEvent(1)]]),
    });
    const events = await readEventsSince(prefix, 1, s3);
    expect(events).toEqual([]);
  });

  it('stops contiguous run on transient per-object GetObject error', async () => {
    // Listed 1, 2, 3. GetObject on seq 2 throws transient 500. Reader must
    // return only [1] (not [1, 3] — that would silently drop seq 2).
    const s3 = mkFakeS3({
      prefix,
      objects: new Map<number, InvestigationEvent | 'error'>([
        [1, mkEvent(1)],
        [2, 'error'],
        [3, mkEvent(3)],
      ]),
    });
    const events = await readEventsSince(prefix, 0, s3);
    expect(events.map((e) => e.seq)).toEqual([1]);
  });

  it('stops on list/get skew (listed but 404 on get)', async () => {
    // Rare but possible: prune deletes an object between list and get.
    const s3 = mkFakeS3({
      prefix,
      listed: [1, 2, 3],
      objects: new Map<number, InvestigationEvent | 'missing'>([
        [1, mkEvent(1)],
        [2, 'missing'],
        [3, mkEvent(3)],
      ]),
    });
    const events = await readEventsSince(prefix, 0, s3);
    expect(events.map((e) => e.seq)).toEqual([1]);
  });

  it('stops at the first gap even when list contains many seqs above', async () => {
    // Stress: big batch of listed seqs with one hole near the start.
    const objs = new Map<number, InvestigationEvent>();
    const listed: number[] = [];
    for (let i = 1; i <= 20; i += 1) {
      if (i === 4) continue; // simulate missing seq 4
      objs.set(i, mkEvent(i));
      listed.push(i);
    }
    const s3 = mkFakeS3({ prefix, listed, objects: objs });
    const events = await readEventsSince(prefix, 0, s3);
    expect(events.map((e) => e.seq)).toEqual([1, 2, 3]);
  });
});
