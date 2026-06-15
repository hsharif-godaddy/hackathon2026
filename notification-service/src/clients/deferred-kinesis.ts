import { KinesisClient, PutRecordCommand } from '@aws-sdk/client-kinesis';

import { config } from '../config.js';
import { logger } from '../logger.js';

const client = new KinesisClient({ region: config.AWS_REGION });

export const REMINDER_EID = 'appbuilder.apps.transfer.reminder.48hr';
export const EXPIRY_EID = 'appbuilder.apps.transfer.expiry.72hr';

/** Shape written by buildRecord and read by extract(). Typed here so TypeScript catches
 * any drift between the writer and the reader at compile time. */
export interface DeferredRecord {
  detail: {
    global: { context: { customerId: string } };
    event: {
      data: {
        traffic: {
          eid: string;
          customProperties: { appId: string };
        };
      };
    };
  };
}

function buildRecord(eid: string, customerId: string, appId: string): Buffer {
  const payload: DeferredRecord = {
    detail: {
      global: { context: { customerId } },
      event: {
        data: {
          traffic: {
            eid,
            customProperties: { appId },
          },
        },
      },
    },
  };
  return Buffer.from(JSON.stringify(payload));
}

/** Puts a reminder record on the 72h reminder stream to be replayed at now − 48h. */
export async function putReminderRecord(appId: string, customerId: string): Promise<void> {
  try {
    await client.send(new PutRecordCommand({
      StreamName: config.REMINDER_KINESIS_STREAM_NAME,
      PartitionKey: appId,
      Data: buildRecord(REMINDER_EID, customerId, appId),
    }));
    logger.info('deferred.kinesis.put_reminder', { appId });
  } catch (err) {
    logger.error('deferred.kinesis.put_reminder_failed', {
      appId,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/** Puts an expiry record on the 96h expiry stream to be replayed at now − 72h. */
export async function putExpiryRecord(appId: string, customerId: string): Promise<void> {
  try {
    await client.send(new PutRecordCommand({
      StreamName: config.EXPIRY_KINESIS_STREAM_NAME,
      PartitionKey: appId,
      Data: buildRecord(EXPIRY_EID, customerId, appId),
    }));
    logger.info('deferred.kinesis.put_expiry', { appId });
  } catch (err) {
    logger.error('deferred.kinesis.put_expiry_failed', {
      appId,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
