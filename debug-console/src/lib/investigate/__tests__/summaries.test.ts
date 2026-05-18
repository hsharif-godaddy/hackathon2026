import { describe, expect, it } from 'vitest';

import {
  buildSummary,
  ensureSummary,
  ensureSummaryAfterTerminal,
  getSummaryById,
  partitionDateFor,
  readAnalysis,
  writeSummaryIdempotent,
  FEEDBACK_EXCERPT_MAX,
  type S3Like,
} from '../summaries';
import type { InvestigationState } from '../types';

const baseState: InvestigationState = {
  investigationId: 'inv-2026-05-14-deadbeef',
  appId: 'app1',
  customerId: 'cust1',
  status: 'completed',
  startedAt: '2026-05-14T23:30:00.000Z',
  startedBy: 'me@godaddy.com',
  updatedAt: '2026-05-14T23:31:30.000Z',
  heartbeatAt: '2026-05-14T23:31:30.000Z',
  phase: 'done',
  lastEvent: 'finished',
  input: { feedback: 'hello world', fullstoryUrl: null, timeWindow: null },
  resultKey: 'active/cust1/app1/result.md',
  reportFilename: 'report.md',
  completedAt: '2026-05-15T00:00:30.000Z',
  durationMs: 90000,
  lambdaRequestId: 'req-1',
  error: null,
};

describe('partitionDateFor', () => {
  it('uses completedAt for terminal status', () => {
    expect(partitionDateFor(baseState)).toBe('2026-05-15');
  });

  it('falls back to startedAt when completedAt missing', () => {
    expect(partitionDateFor({ ...baseState, completedAt: null })).toBe('2026-05-14');
  });

  it('falls back to heartbeatAt when both missing', () => {
    expect(partitionDateFor({ ...baseState, completedAt: null, startedAt: '' })).toBe('2026-05-14');
  });
});

describe('buildSummary', () => {
  it('produces v=1 record with required fields', () => {
    const s = buildSummary(baseState, { reportSize: 1234, reportEtag: '"abc"' });
    expect(s.v).toBe(1);
    expect(s.investigationId).toBe('inv-2026-05-14-deadbeef');
    expect(s.status).toBe('completed');
    expect(s.reportAvailable).toBe(true);
    expect(s.reportSize).toBe(1234);
    expect(s.feedbackExcerpt).toBe('hello world');
    expect(s.sentiment).toBeNull();
    expect(s.schemaCompleted).toBe(false);
  });

  it('truncates long feedback to excerpt', () => {
    const long = 'x'.repeat(FEEDBACK_EXCERPT_MAX + 50);
    const s = buildSummary({ ...baseState, input: { ...baseState.input, feedback: long } }, {});
    expect(s.feedbackExcerpt.length).toBe(FEEDBACK_EXCERPT_MAX);
  });

  it('marks reportAvailable false for failed/killed', () => {
    const s = buildSummary({ ...baseState, status: 'failed', resultKey: null, error: 'boom' }, {});
    expect(s.reportAvailable).toBe(false);
    expect(s.error).toBe('boom');
  });

  it('overlays analysis fields when provided', () => {
    const s = buildSummary(baseState, {
      analysis: { sentiment: 'negative', confidence: 0.9, rootCause: 'bad publish', category: 'publish-failure' },
    });
    expect(s.sentiment).toBe('negative');
    expect(s.confidence).toBe(0.9);
    expect(s.rootCause).toBe('bad publish');
    expect(s.category).toBe('publish-failure');
    expect(s.schemaCompleted).toBe(true);
  });
});

function fakeS3(initial: Record<string, string> = {}, opts: { failWrite?: 'precondition' | 'throttle' } = {}): {
  store: Record<string, string>;
  s3: S3Like;
  calls: { type: string; key?: string }[];
} {
  const store = { ...initial };
  const calls: { type: string; key?: string }[] = [];
  const s3: S3Like = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    send: async (cmd: any) => {
      const name = cmd?.constructor?.name ?? 'unknown';
      const Key = cmd?.input?.Key;
      calls.push({ type: name, key: Key });
      if (name === 'PutObjectCommand') {
        if (opts.failWrite === 'precondition' && cmd.input.IfNoneMatch === '*' && store[Key] !== undefined) {
          const e: any = new Error('PreconditionFailed');
          e.name = 'PreconditionFailed';
          e.$metadata = { httpStatusCode: 412 };
          throw e;
        }
        if (opts.failWrite === 'throttle') {
          const e: any = new Error('SlowDown');
          e.name = 'SlowDown';
          e.$metadata = { httpStatusCode: 503 };
          throw e;
        }
        store[Key] = cmd.input.Body;
        return {};
      }
      if (name === 'GetObjectCommand') {
        if (store[Key] === undefined) {
          const e: any = new Error('NoSuchKey');
          e.name = 'NoSuchKey';
          throw e;
        }
        return {
          Body: (async function* () {
            yield Buffer.from(store[Key]!);
          })(),
        };
      }
      if (name === 'HeadObjectCommand') {
        if (store[Key] === undefined) {
          const e: any = new Error('NotFound');
          e.name = 'NotFound';
          e.$metadata = { httpStatusCode: 404 };
          throw e;
        }
        return { ContentLength: store[Key]!.length };
      }
      if (name === 'ListObjectsV2Command') {
        const prefix = cmd.input.Prefix as string;
        const matchingKeys = Object.keys(store).filter((k) => k.startsWith(prefix)).sort();
        return { Contents: matchingKeys.map((k) => ({ Key: k })), IsTruncated: false };
      }
      throw new Error(`fakeS3: unhandled command ${name}`);
    },
  };
  return { store, s3, calls };
}

describe('writeSummaryIdempotent', () => {
  it('writes summary + pointer when neither exists', async () => {
    const { store, s3 } = fakeS3();
    const summary = buildSummary(baseState, {});
    const result = await writeSummaryIdempotent(summary, { s3, bucket: 'b' });
    expect(result.wrote).toBe(true);
    expect(store['summaries/2026-05-15/inv-2026-05-14-deadbeef.json']).toBeDefined();
    expect(store['summaries/_meta/inv-2026-05-14-deadbeef.pointer.json']).toBeDefined();
  });

  it('returns wrote=false on precondition failure (existing summary wins)', async () => {
    const initial = { 'summaries/2026-05-15/inv-2026-05-14-deadbeef.json': '{"existing":true}' };
    const { s3 } = fakeS3(initial, { failWrite: 'precondition' });
    const result = await writeSummaryIdempotent(buildSummary(baseState, {}), { s3, bucket: 'b' });
    expect(result.wrote).toBe(false);
  });
});


describe('getSummaryById', () => {
  it('reads summary via the pointer', async () => {
    const summary = buildSummary(baseState, {});
    const pointer = { v: 1, investigationId: summary.investigationId, date: '2026-05-15', appId: summary.appId, customerId: summary.customerId };
    const initial = {
      [`summaries/2026-05-15/${summary.investigationId}.json`]: JSON.stringify(summary),
      [`summaries/_meta/${summary.investigationId}.pointer.json`]: JSON.stringify(pointer),
    };
    const { s3 } = fakeS3(initial);
    const out = await getSummaryById(summary.investigationId, { s3, bucket: 'b' });
    expect(out?.investigationId).toBe(summary.investigationId);
  });

  it('returns null when pointer missing', async () => {
    const { s3 } = fakeS3();
    expect(await getSummaryById('inv-missing-deadbeef', { s3, bucket: 'b' })).toBeNull();
  });
});

describe('ensureSummary', () => {
  it('writes summary and pointer once for a terminal state', async () => {
    const { store, s3, calls } = fakeS3();
    const result = await ensureSummary(baseState, { reportSize: 1234, reportEtag: '"abc"', s3, bucket: 'b' });
    expect(result.wrote).toBe(true);
    // summary + pointer + latest = 3 objects under summaries/
    expect(Object.keys(store).filter((k) => k.startsWith('summaries/'))).toHaveLength(3);
    const writes = calls.filter((c) => c.type === 'PutObjectCommand');
    expect(writes).toHaveLength(3);
  });

  it('refuses to ensureSummary for non-terminal state', async () => {
    const { s3 } = fakeS3();
    await expect(
      ensureSummary({ ...baseState, status: 'running' }, { s3, bucket: 'b' }),
    ).rejects.toThrow(/non-terminal/);
  });
});

describe('ensureSummaryAfterTerminal', () => {
  it('does not throw on non-terminal state', () => {
    expect(() => ensureSummaryAfterTerminal({ ...baseState, status: 'running' })).not.toThrow();
  });

  it('inner promise resolves and writes summary for terminal state', async () => {
    const { store, s3 } = fakeS3();
    ensureSummaryAfterTerminal(baseState, { s3, bucket: 'b' });
    // Allow microtask queue to flush so the floating promise completes.
    await new Promise((r) => setTimeout(r, 0));
    const wrote = Object.keys(store).some((k) => k.startsWith('summaries/') && k.endsWith('.json'));
    expect(wrote).toBe(true);
  });
});

describe('readAnalysis', () => {
  it('returns parsed overlay when sidecar exists', async () => {
    const sidecar = { v: 1, sentiment: 'negative', confidence: 0.87, rootCause: 'publish blocked', category: 'publish-failure' };
    const key = `analysis/${encodeURIComponent('cust1')}/${encodeURIComponent('app1')}/inv-2026-05-14-deadbeef.json`;
    const { s3 } = fakeS3({ [key]: JSON.stringify(sidecar) });
    const result = await readAnalysis('cust1', 'app1', 'inv-2026-05-14-deadbeef', { s3, bucket: 'b' });
    expect(result?.sentiment).toBe('negative');
    expect(result?.confidence).toBe(0.87);
    expect(result?.rootCause).toBe('publish blocked');
    expect(result?.category).toBe('publish-failure');
  });

  it('returns null when sidecar missing', async () => {
    const { s3 } = fakeS3();
    expect(await readAnalysis('cust1', 'app1', 'inv-missing', { s3, bucket: 'b' })).toBeNull();
  });
});

describe('ensureSummary with readAnalysis', () => {
  it('populates analysis fields from sidecar when status is completed', async () => {
    const sidecar = { v: 1, sentiment: 'negative', confidence: 0.9, rootCause: 'bad publish', category: 'publish-failure' };
    const analysisKey = `analysis/${encodeURIComponent('cust1')}/${encodeURIComponent('app1')}/inv-2026-05-14-deadbeef.json`;
    const { store, s3 } = fakeS3({ [analysisKey]: JSON.stringify(sidecar) });
    await ensureSummary(baseState, { s3, bucket: 'b' });
    const summaryKey = Object.keys(store).find((k) => k.startsWith('summaries/') && k.endsWith('.json') && !k.includes('_meta'));
    expect(summaryKey).toBeDefined();
    const saved = JSON.parse(store[summaryKey!]) as { sentiment: string; schemaCompleted: boolean };
    expect(saved.sentiment).toBe('negative');
    expect(saved.schemaCompleted).toBe(true);
  });

  it('leaves analysis fields null when no sidecar and status is completed', async () => {
    const { store, s3 } = fakeS3();
    await ensureSummary(baseState, { s3, bucket: 'b' });
    const summaryKey = Object.keys(store).find((k) => k.startsWith('summaries/') && k.endsWith('.json') && !k.includes('_meta'));
    const saved = JSON.parse(store[summaryKey!]) as { sentiment: null; schemaCompleted: boolean };
    expect(saved.sentiment).toBeNull();
    expect(saved.schemaCompleted).toBe(false);
  });
});
