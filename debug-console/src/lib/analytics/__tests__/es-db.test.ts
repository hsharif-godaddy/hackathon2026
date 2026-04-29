import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock es-client before importing es-db so bulkIndex can be controlled.
vi.mock('../es-client', () => ({
  INDICES: {
    AGENT_RUNS: 'agent_runs',
    COMPRESSIONS: 'compressions',
    ERRORS: 'errors',
    CONVERSATIONS: 'conversations',
    SUMMARIZATIONS: 'summarizations',
    TOOL_FAILURES: 'tool_failures',
    PUBLISH_EVENTS: 'publish_events',
    CLIENT_ERRORS: 'client_errors',
  },
  writeClient: {},
  bulkIndex: vi.fn(),
  initIndices: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  },
}));

import { bulkIndex } from '../es-client';
import { flushPendingDocs, insertRun } from '../es-db';

const mockedBulkIndex = bulkIndex as unknown as ReturnType<typeof vi.fn>;

function seedRun(esId: string) {
  insertRun({
    es_id: esId,
    timestamp: '2026-04-22T00:00:00Z',
    app_id: 'app-1',
    agent_id: 'agent-1',
    steps: 1,
    input_tokens: 0,
    output_tokens: 0,
  });
}

describe('es-db', () => {
  beforeEach(async () => {
    mockedBulkIndex.mockReset();
    mockedBulkIndex.mockResolvedValue(undefined);
    // Drain any leftover pendingDocs from a previous test (succeeds because
    // bulkIndex resolves above).
    await flushPendingDocs();
    mockedBulkIndex.mockReset();
    mockedBulkIndex.mockResolvedValue(undefined);
  });

  describe('flushPendingDocs', () => {
    it('returns 0 when there are no pending docs', async () => {
      const count = await flushPendingDocs();
      expect(count).toBe(0);
      expect(mockedBulkIndex).not.toHaveBeenCalled();
    });

    it('flushes all pending docs in a single sub-batch when below BATCH_SIZE', async () => {
      seedRun('a');
      seedRun('b');

      const count = await flushPendingDocs();

      expect(count).toBe(2);
      expect(mockedBulkIndex).toHaveBeenCalledTimes(1);
    });

    it('drops the failing sub-batch and re-queues only un-attempted sub-batches when bulkIndex throws mid-flush', async () => {
      // Round-2 fix re-queued the failing batch as well, which caused
      // unbounded growth on permanent failures (mapping conflict / auth).
      // The corrected behavior drops the failing batch (next scheduler run
      // re-pulls from Loki and regenerates it via content-addressed _ids)
      // and preserves un-attempted sub-batches so they get retried on the
      // next flush.
      //
      // BATCH_SIZE is 5000. Seeding 12000 docs creates three sub-batches
      // (0..4999, 5000..9999, 10000..11999). Force the second sub-batch
      // (index 5000) to throw.
      const TOTAL = 12000;
      const BATCH = 5000;
      for (let i = 0; i < TOTAL; i++) seedRun(`a${i}`);

      let callCount = 0;
      mockedBulkIndex.mockImplementation(async () => {
        callCount++;
        if (callCount === 2) throw new Error('mapping conflict');
      });

      await expect(flushPendingDocs()).rejects.toThrow('mapping conflict');

      // Two attempts before the throw (the third sub-batch is never tried).
      expect(callCount).toBe(2);

      // Re-queue must contain ONLY the un-attempted third sub-batch
      // (TOTAL - 2*BATCH = 2000 docs), not the failing batch + remainder
      // (which would be 7000 docs and grow unboundedly across runs).
      mockedBulkIndex.mockReset();
      mockedBulkIndex.mockResolvedValue(undefined);
      const recoveredCount = await flushPendingDocs();
      expect(recoveredCount).toBe(TOTAL - 2 * BATCH);
      expect(mockedBulkIndex).toHaveBeenCalledTimes(1);
    });

    it('produces an empty re-queue when the failure is on the final sub-batch', async () => {
      // When the failing window is the last one, slice(i + BATCH_SIZE) is
      // []. Pin this so a future "off-by-one" change to the slice math
      // doesn't accidentally re-queue earlier batches.
      const BATCH = 5000;
      const TOTAL = BATCH * 2 + 100;
      for (let i = 0; i < TOTAL; i++) seedRun(`c${i}`);

      let callCount = 0;
      mockedBulkIndex.mockImplementation(async () => {
        callCount++;
        if (callCount === 3) throw new Error('final sub-batch failed');
      });

      await expect(flushPendingDocs()).rejects.toThrow('final sub-batch failed');
      expect(callCount).toBe(3);

      // Nothing un-attempted -> next flush has no docs (the failing window's
      // 100 docs are dropped and rely on next-run Loki re-pull).
      mockedBulkIndex.mockReset();
      mockedBulkIndex.mockResolvedValue(undefined);
      const recoveredCount = await flushPendingDocs();
      expect(recoveredCount).toBe(0);
      expect(mockedBulkIndex).not.toHaveBeenCalled();
    });

    it('preserves the snapshot+clear invariant so a throw does not leave the failing batch in pendingDocs', async () => {
      // If a future refactor moved the pendingDocs reset back to AFTER the
      // for-loop, a bulkIndex throw would re-fire the same docs on the
      // next flush. Pin the contract: after a throw, pendingDocs contains
      // only the un-attempted remainder (not the failing batch, not the
      // already-flushed batches).
      const BATCH = 5000;
      for (let i = 0; i < BATCH * 2 + 1; i++) seedRun(`b${i}`);

      let callCount = 0;
      mockedBulkIndex.mockImplementation(async () => {
        callCount++;
        if (callCount === 1) throw new Error('first batch failed');
      });

      await expect(flushPendingDocs()).rejects.toThrow('first batch failed');
      expect(callCount).toBe(1);

      // After the failing first batch is dropped, only the second batch
      // (5000 docs) and the third partial batch (1 doc) remain.
      mockedBulkIndex.mockReset();
      mockedBulkIndex.mockResolvedValue(undefined);
      const recoveredCount = await flushPendingDocs();
      expect(recoveredCount).toBe(BATCH + 1);
    });
  });
});
