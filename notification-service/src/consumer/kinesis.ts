import {
  GetRecordsCommand,
  GetRecordsCommandOutput,
  GetShardIteratorCommand,
  KinesisClient,
  type _Record,
} from '@aws-sdk/client-kinesis';

import { config } from '../config.js';
import { logger } from '../logger.js';
import { processEvent } from '../processor/event.js';

const POLL_INTERVAL_MS = 5_000;
const MAX_RECORDS_PER_POLL = 100;
const MAX_BACKOFF_MS = 60_000;
const BACKOFF_BASE_MS = 500;

/** Permanent infrastructure errors (revoked IAM, KMS issues). Retrying is pointless — exit so
 * ECS restarts the container and surfaces the alarm via health-check metrics. */
const PROCESS_FATAL_ERROR_NAMES = new Set([
  'AccessDeniedException',
  'KMSAccessDeniedException',
  'KMSDisabledException',
  'KMSInvalidStateException',
  'KMSNotFoundException',
  'KMSOptInRequired',
]);

/** Errors fatal to one shard but not the process. The shard loop exits; the supervisor
 * re-lists shards on the next tick and starts consumers for replacement shards. */
const SHARD_FATAL_ERROR_NAMES = new Set([
  'ResourceNotFoundException',
  'InvalidArgumentException',
]);

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>(resolve => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

function backoffMs(attempt: number): number {
  return Math.min(BACKOFF_BASE_MS * 2 ** attempt, MAX_BACKOFF_MS);
}

async function handleRecord(record: _Record): Promise<void> {
  if (!record.Data) {
    logger.warn('kinesis.record.empty_data', { sequenceNumber: record.SequenceNumber });
    return;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(record.Data).toString('utf8'));
  } catch (err) {
    logger.warn('kinesis.record.parse_failed', {
      sequenceNumber: record.SequenceNumber,
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  }

    try {
      const outcome = await processEvent(parsed);
      logger.debug('kinesis.record.processed', { sequenceNumber: record.SequenceNumber, outcome });
  } catch (err) {
    logger.error('kinesis.record.processing_error', {
      sequenceNumber: record.SequenceNumber,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
  }
}

async function pollShard(
  client: KinesisClient,
  shardId: string,
  signal: AbortSignal,
): Promise<void> {
  logger.info('kinesis.shard.poll_start', { shardId, stream: config.KINESIS_STREAM_NAME });

  let iterator: string | undefined;
  let backoffAttempt = 0;
  let totalRecordsProcessed = 0;

  while (!signal.aborted) {
    try {
      if (!iterator) {
        const iteratorRes = await client.send(
          new GetShardIteratorCommand({
            StreamName: config.KINESIS_STREAM_NAME,
            ShardId: shardId,
            ShardIteratorType: 'LATEST',
          }),
        );
        iterator = iteratorRes.ShardIterator;
        if (!iterator) {
          logger.error('kinesis.shard.no_iterator', { shardId });
          break;
        }
        backoffAttempt = 0;
      }

      const res: GetRecordsCommandOutput = await client.send(
        new GetRecordsCommand({
          ShardIterator: iterator,
          Limit: MAX_RECORDS_PER_POLL,
        }),
      );

      iterator = res.NextShardIterator;
      backoffAttempt = 0;

      if (res.Records && res.Records.length > 0) {
        logger.info('kinesis.shard.records_received', {
          shardId,
          count: res.Records.length,
        });
        for (const record of res.Records) {
          await handleRecord(record);
        }
        totalRecordsProcessed += res.Records.length;
      } else {
        await sleep(POLL_INTERVAL_MS, signal);
      }

      if (!iterator) {
        logger.info('kinesis.shard.exhausted', { shardId, totalProcessed: totalRecordsProcessed });
        break;
      }
    } catch (err) {
      const name = err instanceof Error ? err.name : 'UnknownError';
      const message = err instanceof Error ? err.message : String(err);

      // Throughput exceeded — back off before retrying
      if (name === 'ProvisionedThroughputExceededException') {
        backoffAttempt++;
        logger.warn('kinesis.shard.throughput_exceeded', { shardId, attempt: backoffAttempt, waitMs: backoffMs(backoffAttempt) });
        await sleep(backoffMs(backoffAttempt), signal);
        continue;
      }

      // Iterator expired — clear it so the top of the loop re-fetches with full retry coverage
      if (name === 'ExpiredIteratorException') {
        logger.warn('kinesis.shard.iterator_expired', { shardId, action: 'refreshing' });
        iterator = undefined;
        continue;
      }

      // Permanent infrastructure failure — no point retrying; exit so ECS restarts
      // the container and the health check surfaces the outage.
      if (PROCESS_FATAL_ERROR_NAMES.has(name)) {
        logger.error('kinesis.shard.unrecoverable_error', { shardId, name, message });
        process.exit(1);
      }

      // Shard-level permanent failure (e.g. stream/shard no longer exists) — exit
      // this shard's loop; the supervisor will re-list and start valid replacements.
      if (SHARD_FATAL_ERROR_NAMES.has(name)) {
        logger.error('kinesis.shard.shard_unrecoverable', { shardId, name, message });
        break;
      }

      backoffAttempt++;
      logger.error('kinesis.shard.poll_error', { shardId, name, message, attempt: backoffAttempt, waitMs: backoffMs(backoffAttempt) });
      await sleep(backoffMs(backoffAttempt), signal);
    }
  }

  logger.info('kinesis.shard.poll_stopped', {
    shardId,
    aborted: signal.aborted,
    totalProcessed: totalRecordsProcessed,
  });
}

export function startShardConsumer(
  client: KinesisClient,
  shardId: string,
  signal: AbortSignal,
): Promise<void> {
  logger.info('kinesis.shard.consumer_launched', { shardId });
  return pollShard(client, shardId, signal).catch(err => {
    logger.error('kinesis.shard.consumer_fatal', {
      shardId,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
  });
}

export function createKinesisClient(): KinesisClient {
  return new KinesisClient({ region: config.AWS_REGION });
}
