import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockExtract = vi.fn();
const mockProcessEvent = vi.fn();
const mockLoggerWarn = vi.fn();
const mockLoggerInfo = vi.fn();
const mockLoggerError = vi.fn();

vi.mock('../../extractor/index.js', () => ({ extract: mockExtract }));
vi.mock('../../processor/event.js', () => ({ processEvent: mockProcessEvent }));
vi.mock('../../logger.js', () => ({
  logger: { debug: vi.fn(), error: mockLoggerError, info: mockLoggerInfo, warn: mockLoggerWarn },
}));
vi.mock('../../clients/deferred-kinesis.js', () => ({
  EXPIRY_EID: 'appbuilder.apps.transfer.expiry.72hr',
  REMINDER_EID: 'appbuilder.apps.transfer.reminder.48hr',
}));

const { startTimerConsumer } = await import('../deferred.js');
const REMINDER_EID = 'appbuilder.apps.transfer.reminder.48hr';
const EXPIRY_EID = 'appbuilder.apps.transfer.expiry.72hr';

// Mirror internal constants from deferred.ts
const REMINDER_SEEK_MS = 48 * 60 * 60 * 1_000;
const EXPIRY_SEEK_MS = 72 * 60 * 60 * 1_000;
const STALE_GRACE_MS = 30 * 60 * 1_000;
const TIMER_INTERVAL_MS = 5 * 60 * 1_000;

// Max ages beyond which records must be dropped
const REMINDER_MAX_AGE_MS = REMINDER_SEEK_MS + STALE_GRACE_MS;
const EXPIRY_MAX_AGE_MS = EXPIRY_SEEK_MS + STALE_GRACE_MS;

const NOW = new Date('2026-01-01T12:00:00.000Z');
// Records are aged relative to tick time so the stale-guard comparison is exact
const TICK_TIME_MS = NOW.getTime() + TIMER_INTERVAL_MS;

/** Build a minimal Kinesis record whose ApproximateArrivalTimestamp is `ageAtTickMs` in the past
 * relative to when the first tick fires. */
function makeRecord(eid: string, ageAtTickMs: number, seqSuffix = ''): object {
  return {
    ApproximateArrivalTimestamp: new Date(TICK_TIME_MS - ageAtTickMs),
    Data: Buffer.from(JSON.stringify({ eid, appId: 'app-1', customerId: 'cust-1' })),
    SequenceNumber: `seq-${seqSuffix || ageAtTickMs}`,
  };
}

/** Build a mock KinesisClient.send that returns one shard, one iterator, then the given records. */
function makeMockClient(records: object[]): { send: ReturnType<typeof vi.fn> } {
  return {
    send: vi.fn()
      .mockResolvedValueOnce({ Shards: [{ SequenceNumberRange: {}, ShardId: 'shard-0' }] })
      .mockResolvedValueOnce({ ShardIterator: 'iter-1' })
      .mockResolvedValueOnce({ NextShardIterator: undefined, Records: records }),
  };
}

describe('@airo/notification-service', function packageTests() {
  describe('deferred consumer stale guard', function staleGuardTests() {
    let controller: AbortController;

    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(NOW);
      vi.clearAllMocks();
      mockProcessEvent.mockResolvedValue('sent');
      mockExtract.mockReturnValue({ appId: 'app-1', customerId: 'cust-1', eid: REMINDER_EID });
      controller = new AbortController();
    });

    afterEach(() => {
      controller.abort();
      vi.useRealTimers();
    });

    it('should drop a reminder record older than 48h 30min', async function staleReminder() {
      // 1ms past the hard limit — must be dropped
      const client = makeMockClient([makeRecord(REMINDER_EID, REMINDER_MAX_AGE_MS + 1)]);

      startTimerConsumer(client as never, 'reminder-stream', REMINDER_SEEK_MS, REMINDER_EID, controller.signal);
      await vi.advanceTimersByTimeAsync(TIMER_INTERVAL_MS);

      expect(mockLoggerWarn).toHaveBeenCalledWith(
        'deferred.window.record_stale_dropped',
        expect.objectContaining({ allowedEid: REMINDER_EID, streamName: 'reminder-stream' }),
      );
      expect(mockProcessEvent).not.toHaveBeenCalled();
    });

    it('should drop an expiry record older than 72h 30min', async function staleExpiry() {
      mockExtract.mockReturnValue({ appId: 'app-1', customerId: 'cust-1', eid: EXPIRY_EID });

      const client = makeMockClient([makeRecord(EXPIRY_EID, EXPIRY_MAX_AGE_MS + 1)]);

      startTimerConsumer(client as never, 'expiry-stream', EXPIRY_SEEK_MS, EXPIRY_EID, controller.signal);
      await vi.advanceTimersByTimeAsync(TIMER_INTERVAL_MS);

      expect(mockLoggerWarn).toHaveBeenCalledWith(
        'deferred.window.record_stale_dropped',
        expect.objectContaining({ allowedEid: EXPIRY_EID, streamName: 'expiry-stream' }),
      );
      expect(mockProcessEvent).not.toHaveBeenCalled();
    });

    it('should process a reminder record that is within the 48h 30min window', async function freshReminder() {
      // 1ms before the hard limit — must be processed
      const client = makeMockClient([makeRecord(REMINDER_EID, REMINDER_MAX_AGE_MS - 1)]);

      startTimerConsumer(client as never, 'reminder-stream-fresh', REMINDER_SEEK_MS, REMINDER_EID, controller.signal);
      await vi.advanceTimersByTimeAsync(TIMER_INTERVAL_MS);

      expect(mockLoggerWarn).not.toHaveBeenCalledWith(
        'deferred.window.record_stale_dropped',
        expect.anything(),
      );
      expect(mockProcessEvent).toHaveBeenCalledOnce();
    });

    it('should process an expiry record that is within the 72h 30min window', async function freshExpiry() {
      mockExtract.mockReturnValue({ appId: 'app-1', customerId: 'cust-1', eid: EXPIRY_EID });

      const client = makeMockClient([makeRecord(EXPIRY_EID, EXPIRY_MAX_AGE_MS - 1)]);

      startTimerConsumer(client as never, 'expiry-stream-fresh', EXPIRY_SEEK_MS, EXPIRY_EID, controller.signal);
      await vi.advanceTimersByTimeAsync(TIMER_INTERVAL_MS);

      expect(mockLoggerWarn).not.toHaveBeenCalledWith(
        'deferred.window.record_stale_dropped',
        expect.anything(),
      );
      expect(mockProcessEvent).toHaveBeenCalledOnce();
    });

    it('should drop only stale records when both stale and fresh are in the same batch', async function mixedBatch() {
      const staleRecord = makeRecord(REMINDER_EID, REMINDER_MAX_AGE_MS + 1, 'stale');
      // Fresh record needs a distinct sequence number for dedup cache
      const freshRecord = makeRecord(REMINDER_EID, REMINDER_MAX_AGE_MS - 1, 'fresh');

      const client = makeMockClient([staleRecord, freshRecord]);

      startTimerConsumer(client as never, 'reminder-stream-mixed', REMINDER_SEEK_MS, REMINDER_EID, controller.signal);
      await vi.advanceTimersByTimeAsync(TIMER_INTERVAL_MS);

      expect(mockLoggerWarn).toHaveBeenCalledWith(
        'deferred.window.record_stale_dropped',
        expect.objectContaining({ sequenceNumber: 'seq-stale' }),
      );
      // Only the fresh record reaches processEvent
      expect(mockProcessEvent).toHaveBeenCalledOnce();
    });

    it('should drop a record exactly at the 48h 30min boundary (strict greater-than)', async function boundaryReminder() {
      // ageMs === maxAgeMs: condition is `> maxAgeMs` so exactly equal passes through
      const client = makeMockClient([makeRecord(REMINDER_EID, REMINDER_MAX_AGE_MS)]);

      startTimerConsumer(client as never, 'reminder-stream-boundary', REMINDER_SEEK_MS, REMINDER_EID, controller.signal);
      await vi.advanceTimersByTimeAsync(TIMER_INTERVAL_MS);

      expect(mockLoggerWarn).not.toHaveBeenCalledWith(
        'deferred.window.record_stale_dropped',
        expect.anything(),
      );
      expect(mockProcessEvent).toHaveBeenCalledOnce();
    });

    it('should drop a record 1ms past the 48h 30min boundary', async function onePastBoundaryReminder() {
      const client = makeMockClient([makeRecord(REMINDER_EID, REMINDER_MAX_AGE_MS + 1)]);

      startTimerConsumer(client as never, 'reminder-stream-over-boundary', REMINDER_SEEK_MS, REMINDER_EID, controller.signal);
      await vi.advanceTimersByTimeAsync(TIMER_INTERVAL_MS);

      expect(mockLoggerWarn).toHaveBeenCalledWith(
        'deferred.window.record_stale_dropped',
        expect.objectContaining({ allowedEid: REMINDER_EID }),
      );
      expect(mockProcessEvent).not.toHaveBeenCalled();
    });
  });
});
