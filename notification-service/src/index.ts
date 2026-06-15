import { readFileSync } from 'node:fs';
import { type ServerResponse } from 'node:http';
import { createServer } from 'node:https';
import { join } from 'node:path';
import { KinesisClient, ListShardsCommand, type Shard } from '@aws-sdk/client-kinesis';

import { startSwitchboardClient, stopSwitchboardClient } from './clients/switchboard.js';
import { EXPIRY_EID, REMINDER_EID } from './clients/deferred-kinesis.js';
import { getPermanentFailureCount } from './consumer/deferred.js';
import { config } from './config.js';
import { startTimerConsumer } from './consumer/deferred.js';
import { createKinesisClient, startShardConsumer } from './consumer/kinesis.js';
import { logger } from './logger.js';

const HEALTH_PORT = 8080;
// Re-list shards every minute to pick up child shards created by a reshard
const SHARD_POLL_INTERVAL_MS = 60_000;

// Reminder records are replayed 48h after being written (24h before the 72h expiry).
const REMINDER_SEEK_MS = 48 * 60 * 60 * 1_000;

// Expiry records are replayed 72h after being written.
const EXPIRY_SEEK_MS = 72 * 60 * 60 * 1_000;

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body, null, 2));
}

function startHealthServer(): ReturnType<typeof createServer> {
  const certsDir = join(process.cwd(), 'certs');

  const server = createServer(
    { cert: readFileSync(join(certsDir, 'server.crt')), key: readFileSync(join(certsDir, 'server.key')) },
    (req, res) => {
      if (req.method === 'GET' && req.url === '/health') {
        const failureCount = getPermanentFailureCount();
        const status = failureCount > 0 ? 'degraded' : 'ok';
        json(res, 200, { status, permanentFailureCount: failureCount });
        return;
      }

      logger.info('notification-service.health.unknown_request', { method: req.method, url: req.url });
      res.writeHead(404);
      res.end();
    },
  );

  server.listen(HEALTH_PORT);

  return server;
}

async function listOpenShards(kinesisClient: KinesisClient): Promise<Shard[]> {
  const res = await kinesisClient.send(
    new ListShardsCommand({ StreamName: config.KINESIS_STREAM_NAME }),
  );
  return (res.Shards ?? []).filter(s => !s.SequenceNumberRange?.EndingSequenceNumber);
}

async function start(): Promise<void> {
  logger.info('notification-service.startup.begin', {
    stream: config.KINESIS_STREAM_NAME,
    reminderStream: config.REMINDER_KINESIS_STREAM_NAME,
    expiryStream: config.EXPIRY_KINESIS_STREAM_NAME,
    awsRegion: config.AWS_REGION,
    mgmtBaseUrl: config.MGMT_AIRO_BASE_URL,
    messagingBaseUrl: config.MESSAGING_BASE_URL,
    switchboardEnv: config.SWITCHBOARD_ENV,
    switchboardApp: config.SWITCHBOARD_APP,
  });

  const healthServer = startHealthServer();

  await startSwitchboardClient();

  const kinesisClient = createKinesisClient();

  // Verify the main stream is reachable and has open shards before entering the supervisor loop
  const initialShards = await listOpenShards(kinesisClient);
  if (initialShards.length === 0) {
    logger.error('notification-service.kinesis.no_shards', { stream: config.KINESIS_STREAM_NAME });
    await stopSwitchboardClient();
    healthServer.close();
    process.exit(1);
  }
  logger.info('notification-service.kinesis.shards_listed', {
    stream: config.KINESIS_STREAM_NAME,
    shardCount: initialShards.length,
    shardIds: initialShards.map(s => s.ShardId).filter(Boolean),
  });

  // Tracks shard IDs with a running consumer — used to avoid duplicate consumers after reshards
  const activeShardIds = new Set<string>();
  const consumersController = new AbortController();
  let processShutdown = false;
  const supervisorController = new AbortController();

  const shutdown = (signal: string): void => {
    logger.info('notification-service.shutdown.received', { signal });
    processShutdown = true;
    supervisorController.abort();
    logger.info('notification-service.shutdown.aborting_consumers');
    consumersController.abort();
  };

  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));

  // Reminder consumer: replays records from the 72h reminder stream at AT_TIMESTAMP(now − 48h).
  startTimerConsumer(
    kinesisClient,
    config.REMINDER_KINESIS_STREAM_NAME,
    REMINDER_SEEK_MS,
    REMINDER_EID,
    consumersController.signal,
  );

  // Expiry consumer: replays records from the 96h expiry stream at AT_TIMESTAMP(now − 72h).
  startTimerConsumer(
    kinesisClient,
    config.EXPIRY_KINESIS_STREAM_NAME,
    EXPIRY_SEEK_MS,
    EXPIRY_EID,
    consumersController.signal,
  );

  // Supervisor loop: re-list open shards each tick so reshards are discovered without a redeploy.
  // Events are filtered inside processEvent based on the Switchboard flag.
  while (!processShutdown) {
    try {
      const openShards = await listOpenShards(kinesisClient);
      for (const shard of openShards) {
        if (!shard.ShardId || activeShardIds.has(shard.ShardId)) continue;
        const shardId = shard.ShardId;
        activeShardIds.add(shardId);
        startShardConsumer(kinesisClient, shardId, consumersController.signal).finally(() => {
          activeShardIds.delete(shardId);
        });
      }
    } catch (err) {
      logger.error('notification-service.supervisor.list_shards_failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    await new Promise<void>(resolve => {
      const timer = setTimeout(resolve, SHARD_POLL_INTERVAL_MS);
      supervisorController.signal.addEventListener('abort', () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
    });
  }

  await stopSwitchboardClient();
  healthServer.close();
  logger.info('notification-service.shutdown.complete');
}

start().catch(err => {
  logger.error('notification-service.startup.fatal', {
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  });
  process.exit(1);
});
