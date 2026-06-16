import {
  GetRecordsCommand,
  GetShardIteratorCommand,
  KinesisClient,
  ListShardsCommand,
} from '@aws-sdk/client-kinesis';

import { EXPIRY_EID, REMINDER_EID } from '../clients/deferred-kinesis.js';
import { type GuardName } from '../clients/switchboard.js';
import { extract } from '../extractor/index.js';
import { logger } from '../logger.js';
import { processEvent } from '../processor/event.js';

const TIMER_INTERVAL_MS = 5 * 60 * 1_000;
// Wider than TIMER_INTERVAL_MS so windows overlap by 2 min; gaps from tick jitter are handled by
// streamHighWaterMarks, not this overlap. Duplicates are suppressed by processedSequences.
const WINDOW_MS = TIMER_INTERVAL_MS + 2 * 60 * 1_000;

const STALE_GUARD_GRACE_MS = 60 * 60 * 1_000;

// TTL for the processed-sequence cache. Must cover at least WINDOW_MS so overlap re-reads are always caught.
const SEQUENCE_CACHE_TTL_MS = WINDOW_MS + 60 * 1_000;
// Hard cap per stream. Map preserves insertion order, so the oldest entries are trimmed first.
const MAX_SEQUENCE_CACHE_SIZE = 10_000;

/** Per-stream cache: sequenceNumber → timestamp (ms). Prevents the 2-min window overlap from
 * delivering the same record twice. Entries older than SEQUENCE_CACHE_TTL_MS are evicted. */
const processedSequences = new Map<string, Map<string, number>>();

/** Per-stream high-water marks: streamName → start of next window. Advanced by TIMER_INTERVAL_MS
 * after each tick so windows are gap-free. Falls back to now − seekMs on first tick/restart. */
const streamHighWaterMarks = new Map<string, Date>();

// Counts records that exhausted all retries and were permanently dropped this process lifetime.
// Exposed via getPermanentFailureCount() so the health endpoint can flip to 'degraded'.
let permanentFailureCount = 0;
export function getPermanentFailureCount(): number { return permanentFailureCount; }

function getStreamCache(streamName: string): Map<string, number> {
  if (!processedSequences.has(streamName)) {
    processedSequences.set(streamName, new Map());
  }
  return processedSequences.get(streamName)!;
}

function evictExpired(cache: Map<string, number>): void {
  const cutoff = Date.now() - SEQUENCE_CACHE_TTL_MS;
  for (const [seq, ts] of cache) {
    if (ts < cutoff) cache.delete(seq);
  }
  // Size cap: if TTL eviction alone wasn't enough, drop oldest entries (Map insertion order).
  if (cache.size > MAX_SEQUENCE_CACHE_SIZE) {
    const overflow = cache.size - MAX_SEQUENCE_CACHE_SIZE;
    let dropped = 0;
    for (const seq of cache.keys()) {
      cache.delete(seq);
      if (++dropped >= overflow) break;
    }
    logger.warn('deferred.seqcache.size_cap_reached', { dropped, size: cache.size });
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>(resolve => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

// Maps each deferred EID to the guard that must pass regardless of Switchboard template config.
// This enforces transfer status checks in code, so a misconfigured or missing Switchboard guard
// can never cause reminder/expiry emails to go out for already-accepted or cancelled transfers.
const DEFERRED_EID_GUARDS: Record<string, GuardName> = {
  [REMINDER_EID]: 'transfer_pending',
  [EXPIRY_EID]: 'transfer_pending',
};

const RETRY_ATTEMPTS = 3;

/** Calls processEvent with up to RETRY_ATTEMPTS attempts, sleeping 2s → 4s between failures.
 * Throws the last error after all attempts are exhausted. */
async function processEventWithRetry(raw: unknown, context: { streamName: string; shardId: string; sequenceNumber?: string; allowedEid: string }): Promise<'sent' | 'skipped'> {
  const requiredGuard = DEFERRED_EID_GUARDS[context.allowedEid];
  let lastErr: unknown;
  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
    try {
      return await processEvent(raw, requiredGuard);
    } catch (err) {
      lastErr = err;
      if (attempt < RETRY_ATTEMPTS) {
        const backoffMs = 2_000 * 2 ** (attempt - 1);
        logger.warn('deferred.window.process_retry', {
          ...context,
          attempt,
          backoffMs,
          error: err instanceof Error ? err.message : String(err),
        });
        await sleep(backoffMs);
      }
    }
  }
  throw lastErr;
}


/** Reads one shard from seekTimestamp up to WINDOW_MS, forwarding records matching allowedEid
 * to processEvent. Deduplicates via processedSequences. Records older than maxAgeMs are dropped. */
async function processWindow(
  client: KinesisClient,
  streamName: string,
  shardId: string,
  seekTimestamp: Date,
  allowedEid: string,
  maxAgeMs: number,
): Promise<void> {
  const cutoff = new Date(seekTimestamp.getTime() + WINDOW_MS);
  const seqCache = getStreamCache(streamName);
  evictExpired(seqCache);

  let iterator: string | undefined;
  try {
    iterator = (await client.send(new GetShardIteratorCommand({
      StreamName: streamName,
      ShardId: shardId,
      ShardIteratorType: 'AT_TIMESTAMP',
      Timestamp: seekTimestamp,
    }))).ShardIterator;
  } catch (err) {
    logger.error('deferred.window.get_iterator_failed', {
      streamName,
      shardId,
      allowedEid,
      seekTimestamp: seekTimestamp.toISOString(),
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  while (iterator) {
    let res;
    try {
      res = await client.send(new GetRecordsCommand({
        ShardIterator: iterator,
        Limit: 100,
      }));
    } catch (err) {
      logger.error('deferred.window.get_records_failed', {
        streamName,
        shardId,
        allowedEid,
        error: err instanceof Error ? err.message : String(err),
      });
      break;
    }

    iterator = res.NextShardIterator;
    const records = res.Records ?? [];

    let pastWindow = false;
    for (const record of records) {
      if (record.ApproximateArrivalTimestamp && record.ApproximateArrivalTimestamp > cutoff) {
        pastWindow = true;
        break;
      }

      // A record this old missed its delivery window — sending it now would fire a confusing late email.
      if (record.ApproximateArrivalTimestamp) {
        const ageMs = Date.now() - record.ApproximateArrivalTimestamp.getTime();
        if (ageMs > maxAgeMs) {
          logger.warn('deferred.window.record_stale_dropped', {
            streamName,
            shardId,
            sequenceNumber: record.SequenceNumber,
            allowedEid,
            ageMs,
            maxAgeMs,
          });
          continue;
        }
      }

      if (!record.Data) continue;

      const sequenceNumber = record.SequenceNumber;
      if (sequenceNumber && seqCache.has(sequenceNumber)) {
        logger.info('deferred.window.duplicate_skipped', { streamName, shardId, sequenceNumber, allowedEid });
        continue;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(Buffer.from(record.Data).toString('utf8'));
      } catch {
        logger.warn('deferred.window.parse_failed', { streamName, shardId, sequenceNumber: record.SequenceNumber });
        continue;
      }

      const extracted = extract(parsed);
      if (!extracted) {
        // extract() returned null — the record is malformed or buildRecord's format has drifted.
        logger.error('deferred.window.record_malformed', { streamName, shardId, sequenceNumber, allowedEid });
        continue;
      }
      if (extracted.eid !== allowedEid) continue;

      try {
        await processEventWithRetry(parsed, { streamName, shardId, sequenceNumber, allowedEid });
        if (sequenceNumber) seqCache.set(sequenceNumber, Date.now());
      } catch (err) {
        permanentFailureCount++;
        logger.error('deferred.window.process_failed_permanent', {
          streamName,
          shardId,
          allowedEid,
          sequenceNumber: record.SequenceNumber,
          attempts: RETRY_ATTEMPTS,
          permanentFailureCount,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (pastWindow) break;
  }
}

async function tick(
  client: KinesisClient,
  streamName: string,
  seekMs: number,
  allowedEid: string,
): Promise<void> {
  let shardIds: string[];
  try {
    shardIds = ((await client.send(new ListShardsCommand({ StreamName: streamName }))).Shards ?? [])
      .filter(s => !s.SequenceNumberRange?.EndingSequenceNumber)
      .map(s => s.ShardId)
      .filter((id): id is string => !!id);
  } catch (err) {
    logger.error('deferred.tick.list_shards_failed', {
      streamName,
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  if (shardIds.length === 0) {
    logger.warn('deferred.tick.no_shards', { streamName });
    return;
  }

  // Use the high-water mark as the window start so consecutive windows are gap-free.
  // Fall back to now − seekMs on the first tick (or after a restart).
  const seekTimestamp = streamHighWaterMarks.get(streamName) ?? new Date(Date.now() - seekMs);

  logger.info('deferred.tick.start', {
    streamName,
    allowedEid,
    shardCount: shardIds.length,
    seekTimestamp: seekTimestamp.toISOString(),
  });

  await Promise.all(
    shardIds.map(shardId => processWindow(client, streamName, shardId, seekTimestamp, allowedEid, seekMs + STALE_GUARD_GRACE_MS)),
  );

  // Advance the high-water mark by TIMER_INTERVAL_MS (not WINDOW_MS) so the next window
  // starts 5 minutes ahead — maintaining the 2-minute overlap without drifting forward.
  streamHighWaterMarks.set(streamName, new Date(seekTimestamp.getTime() + TIMER_INTERVAL_MS));

  logger.info('deferred.tick.done', { streamName, allowedEid });
}

/** Starts a timer-based consumer that seeks AT_TIMESTAMP(now − seekMs) on streamName every
 * TIMER_INTERVAL_MS, forwarding records matching allowedEid to processEvent. */
export function startTimerConsumer(
  client: KinesisClient,
  streamName: string,
  seekMs: number,
  allowedEid: string,
  signal: AbortSignal,
): void {
  async function run(): Promise<void> {
    logger.info('deferred.consumer.started', { streamName, seekMs, allowedEid });
    while (!signal.aborted) {
      await sleep(TIMER_INTERVAL_MS, signal);
      if (signal.aborted) break;
      try {
        await tick(client, streamName, seekMs, allowedEid);
      } catch (err) {
        logger.error('deferred.consumer.tick_error', {
          streamName,
          allowedEid,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    logger.info('deferred.consumer.stopped', { streamName, allowedEid });
  }

  run().catch(err => {
    logger.error('deferred.consumer.fatal', {
      streamName,
      allowedEid,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
  });
}
