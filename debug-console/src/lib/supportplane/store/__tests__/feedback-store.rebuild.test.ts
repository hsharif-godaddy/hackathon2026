import { BatchWriteCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Minimal view of the AWS SDK command objects the store dispatches through send().
interface CapturedCommand {
  constructor: { name: string };
  input: { TableName?: string; RequestItems?: Record<string, unknown> };
}

const { mockSend } = vi.hoisted(() => ({ mockSend: vi.fn() }));

vi.mock('@/lib/supportplane/store/config', () => ({
  buildDynamoClient: (): { send: typeof mockSend } => ({ send: mockSend }),
  getSpEnv: (): string => 'dev',
  getConfig: (): Record<string, string> => ({
    feedbackTable: 'legacy',
    feedbackRawS3Table: 'raw-s3',
    feedbackRawAthenaTable: 'raw-athena',
    feedbackEnrichedTable: 'enriched',
    feedbackStatsTable: 'stats',
    feedbackIngestTable: 'ingest',
    feedbackStartDate: '2026-04-01',
  }),
}));

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/supportplane/sp-logger', () => ({
  spLog: vi.fn(),
  SP_MASK: { INFO: 0, WARN: 1, ERROR: 2, DEBUG: 3 },
}));

import { getFeedbackStore } from '@/lib/supportplane/store/feedback-store';

function batchWriteCalls(): CapturedCommand[] {
  return mockSend.mock.calls
    .map(([cmd]): CapturedCommand => cmd as CapturedCommand)
    .filter((cmd: CapturedCommand): boolean => cmd instanceof BatchWriteCommand);
}

describe('FeedbackStore.rebuildEnrichedTable', function rebuild() {
  beforeEach(function reset() {
    mockSend.mockReset();
  });

  it('aborts without deleting or rewriting when a raw-table scan fails', async function abortsOnScanFailure() {
    mockSend.mockImplementation(async (cmd: CapturedCommand): Promise<unknown> => {
      if (cmd instanceof ScanCommand && cmd.input.TableName === 'raw-s3') {
        throw new Error('connection timed out');
      }
      // The enriched table already holds a row for this env. Pre-fix, the failed
      // raw-s3 scan collapsed to [], the rebuild deleted this row, and rewrote
      // nothing — silently emptying the table.
      if (cmd instanceof ScanCommand && cmd.input.TableName === 'enriched') {
        return {
          Items: [{ env: 'dev', enrich_key: 'dev#c1#2026-05-01', created_at: '2026-05-01T10:00:00Z' }],
        };
      }
      if (cmd instanceof ScanCommand) return { Items: [] };
      return {};
    });

    await expect(getFeedbackStore().rebuildEnrichedTable('dev')).rejects.toThrow(/aborted/);

    // The destructive delete + rewrite must never run on a partial scan — that is
    // exactly how the existing enriched row above was silently dropped before the fix.
    expect(batchWriteCalls()).toHaveLength(0);
  });

  it('rebuilds enriched rows when every scan succeeds', async function happyPath() {
    mockSend.mockImplementation(async (cmd: CapturedCommand): Promise<unknown> => {
      if (cmd instanceof ScanCommand && cmd.input.TableName === 'raw-s3') {
        return {
          Items: [
            {
              env: 'dev',
              customer_id: 'c1',
              feedback_id: 'f1',
              feedback_utc_ts: '2026-05-01T10:00:00Z',
              data_source: 's3',
            },
          ],
        };
      }
      if (cmd instanceof ScanCommand) return { Items: [] };
      return {};
    });

    const count: number = await getFeedbackStore().rebuildEnrichedTable('dev');

    expect(count).toBe(1);
    const writes: CapturedCommand[] = batchWriteCalls().filter(
      (cmd: CapturedCommand): boolean => Object.keys(cmd.input.RequestItems ?? {})[0] === 'enriched'
    );
    expect(writes.length).toBeGreaterThan(0);
  });
});
