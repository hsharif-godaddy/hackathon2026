import { beforeEach, describe, expect, it, vi } from 'vitest';

// External modules are mocked so the suite is hermetic — the isolated Lambda's
// runtime deps (xlsx, aws-sdk, uuid) are not resolvable from the cdk workspace.
// The real parse logic is a verbatim copy of debug-console and is validated by
// the Docker `tsc` build; here we assert the handler's orchestration.
vi.mock('uuid', () => ({ v4: () => 'gen-upload-id' }));
vi.mock('./s3.js', () => ({ getObjectBuffer: vi.fn() }));
vi.mock('./parse.js', () => ({ parseXlsxFile: vi.fn(), mapCsvRowToTranscript: vi.fn() }));
vi.mock('./dynamo.js', () => ({
  upsertTranscript: vi.fn(),
  createUploadRecord: vi.fn(),
  updateUploadRecord: vi.fn(),
  checkDuplicateUpload: vi.fn(),
}));
vi.mock('./sqs.js', () => ({ enqueueRecordJobs: vi.fn() }));

import { handler } from './handler.js';
import { getObjectBuffer } from './s3.js';
import { mapCsvRowToTranscript, parseXlsxFile } from './parse.js';
import {
  checkDuplicateUpload,
  createUploadRecord,
  updateUploadRecord,
  upsertTranscript,
} from './dynamo.js';
import { enqueueRecordJobs } from './sqs.js';

type IngestEventArg = Parameters<typeof handler>[0];

function sqsEvent(bodies: Array<{ body: string; messageId: string }>): IngestEventArg {
  return {
    Records: bodies.map(({ body, messageId }) => ({ body, messageId })),
  } as IngestEventArg;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getObjectBuffer).mockResolvedValue(Buffer.from('interaction_id\na\n'));
  vi.mocked(parseXlsxFile).mockResolvedValue([
    { interaction_id: 'a' },
    { interaction_id: 'b' },
  ]);
  vi.mocked(mapCsvRowToTranscript).mockImplementation(
    (row) =>
      ({
        interaction_id: String(row.interaction_id),
        shopper_id: 'unknown',
        full_transcript: '',
      }) as ReturnType<typeof mapCsvRowToTranscript>
  );
  vi.mocked(upsertTranscript).mockResolvedValue('inserted');
  vi.mocked(checkDuplicateUpload).mockResolvedValue(null);
  vi.mocked(createUploadRecord).mockResolvedValue(undefined);
  vi.mocked(updateUploadRecord).mockResolvedValue(undefined);
  vi.mocked(enqueueRecordJobs).mockResolvedValue(2);
});

describe('sp-transcript-ingest handler', () => {
  it('processes a direct upload invoke: upserts rows, enqueues jobs, updates the run report', async () => {
    const result = await handler({
      bucket: 'airo-builder-l1-transcripts-dev',
      key: 'uploads/2026-a.csv',
      upload_id: 'up-1',
    } as IngestEventArg);

    expect(result).toEqual({
      status: 'processed',
      bucket: 'airo-builder-l1-transcripts-dev',
      key: 'uploads/2026-a.csv',
      upload_id: 'up-1',
      total: 2,
      upserted: 2,
      updated: 0,
      unprocessable: 0,
    });
    expect(upsertTranscript).toHaveBeenCalledTimes(2);
    expect(enqueueRecordJobs).toHaveBeenCalledWith(['a', 'b'], 'up-1');
    expect(updateUploadRecord).toHaveBeenCalledWith(
      'up-1',
      expect.objectContaining({ status: 'completed', processed_count: 2 })
    );
    // upload_id supplied → reuse the debug-console record, do not open a new one.
    expect(createUploadRecord).not.toHaveBeenCalled();
  });

  it('opens its own run report when invoked without an upload_id (SQS/sync path)', async () => {
    await handler({
      detail: {
        bucket: { name: 'airo-builder-l1-transcripts-dev' },
        object: { key: 'lighthouse_export/2026-06-11.csv' },
      },
    } as IngestEventArg);

    expect(createUploadRecord).toHaveBeenCalledWith(
      expect.objectContaining({ upload_id: 'gen-upload-id', source: 'sync', status: 'processing' })
    );
    expect(enqueueRecordJobs).toHaveBeenCalledWith(['a', 'b'], 'gen-upload-id');
  });

  it('skips (no S3 read) when bucket or key is missing', async () => {
    const result = await handler({ bucket: 'b', key: '' } as IngestEventArg);
    expect(result).toEqual({ status: 'skipped', reason: 'missing bucket or key' });
    expect(getObjectBuffer).not.toHaveBeenCalled();
  });

  it('propagates DynamoDB infra errors (throttle/permission) so the file redrives', async () => {
    vi.mocked(upsertTranscript)
      .mockResolvedValueOnce('inserted')
      .mockRejectedValueOnce(new Error('ddb throttled'));

    await expect(
      handler({
        bucket: 'airo-builder-l1-transcripts-dev',
        key: 'uploads/x.csv',
        upload_id: 'up-2',
      } as IngestEventArg)
    ).rejects.toThrow('ddb throttled');
  });

  describe('SQS ingest-jobs branch', () => {
    it('returns no failures for a valid record', async () => {
      await expect(
        handler(
          sqsEvent([
            {
              messageId: 'm1',
              body: JSON.stringify({ bucket: 'airo-builder-l1-transcripts-dev', key: 'a.csv' }),
            },
          ])
        )
      ).resolves.toEqual({ batchItemFailures: [] });
    });

    it('reports a batch failure when the body is unparseable', async () => {
      await expect(
        handler(sqsEvent([{ messageId: 'm2', body: 'not json' }]))
      ).resolves.toEqual({ batchItemFailures: [{ itemIdentifier: 'm2' }] });
    });

    it('drops (does not fail) a record with missing bucket or key', async () => {
      await expect(
        handler(sqsEvent([{ messageId: 'm3', body: JSON.stringify({ bucket: 'b', key: '' }) }]))
      ).resolves.toEqual({ batchItemFailures: [] });
    });

    it('isolates failures per record within a batch', async () => {
      const result = await handler(
        sqsEvent([
          { messageId: 'ok', body: JSON.stringify({ bucket: 'airo-builder-l1-transcripts-dev', key: 'a.csv' }) },
          { messageId: 'bad', body: '{' },
        ])
      );
      expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: 'bad' }] });
    });
  });
});
