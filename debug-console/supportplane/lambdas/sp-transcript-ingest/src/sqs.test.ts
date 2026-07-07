import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sendMock = vi.fn();

vi.mock('@aws-sdk/client-sqs', () => ({
  SQSClient: class {
    public send = sendMock;
  },
  SendMessageBatchCommand: class {
    public input: unknown;
    public constructor(input: unknown) {
      this.input = input;
    }
  },
}));

type EnqueueRecordJobs = (
  interactionIds: string[],
  uploadId?: string
) => Promise<number>;

let enqueueRecordJobs: EnqueueRecordJobs;

beforeEach(async () => {
  vi.clearAllMocks();
  vi.resetModules();
  vi.stubEnv('SP_RECORD_PROCESSING_QUEUE_URL', 'https://sqs.us-west-2.amazonaws.com/123/queue');
  vi.stubEnv('AWS_REGION', 'us-west-2');
  ({ enqueueRecordJobs } = await import('./sqs.js'));
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('enqueueRecordJobs', () => {
  it('throws when any batch entry fails so the ingest job can redrive', async function batchFailure() {
    sendMock.mockResolvedValue({
      Successful: [{ Id: '0' }],
      Failed: [{ Id: '1', Code: 'InternalError', Message: 'throttled', SenderFault: false }],
    });

    await expect(enqueueRecordJobs(['a', 'b'], 'up-1')).rejects.toThrow(
      /SQS SendMessageBatch failed for 1\/2 entries/
    );
  });

  it('returns the number of accepted messages on full success', async function batchSuccess() {
    sendMock.mockResolvedValue({
      Successful: [{ Id: '0' }, { Id: '1' }],
      Failed: [],
    });

    await expect(enqueueRecordJobs(['a', 'b'], 'up-1')).resolves.toBe(2);
  });
});
