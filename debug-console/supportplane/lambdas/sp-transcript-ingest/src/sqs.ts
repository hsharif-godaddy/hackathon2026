/**
 * sqs.ts — fan out one record-processing job per upserted row.
 *
 * The worker (`sp-transcript-record-processing`) consumes these off
 * SP_RECORD_PROCESSING_QUEUE_URL, batchSize 5. Messages carry only the
 * `interaction_id` pointer (DynamoDB is the source of truth) plus the
 * originating `upload_id` for run-report correlation.
 */
import {
  SendMessageBatchCommand,
  type SendMessageBatchRequestEntry,
  SQSClient,
} from '@aws-sdk/client-sqs';

import { logger } from './log.js';
import { chunkArray } from './utils.js';

const REGION: string = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-west-2';
const QUEUE_URL: string = process.env.SP_RECORD_PROCESSING_QUEUE_URL ?? '';

const client: SQSClient = new SQSClient({ region: REGION });

/**
 * Enqueue one {interaction_id, upload_id} message per id, in SendMessageBatch
 * chunks of 10 (the SQS max). Returns the number of messages accepted.
 */
export async function enqueueRecordJobs(
  interactionIds: string[],
  uploadId?: string
): Promise<number> {
  if (!QUEUE_URL) {
    throw new Error('SP_RECORD_PROCESSING_QUEUE_URL is not set');
  }
  if (interactionIds.length === 0) {
    return 0;
  }

  let sent = 0;
  for (const chunk of chunkArray(interactionIds, 10)) {
    const entries: SendMessageBatchRequestEntry[] = chunk.map((interaction_id, i) => ({
      Id: String(i),
      MessageBody: JSON.stringify({ interaction_id, upload_id: uploadId }),
    }));

    const result = await client.send(
      new SendMessageBatchCommand({ QueueUrl: QUEUE_URL, Entries: entries })
    );

    const failed = result.Failed ?? [];
    if (failed.length > 0) {
      for (const entry of failed) {
        logger.error('sp-transcript-ingest.enqueue.failed', {
          code: entry.Code,
          message: entry.Message,
          senderFault: entry.SenderFault,
          id: entry.Id,
        });
      }
      throw new Error(
        `SQS SendMessageBatch failed for ${failed.length}/${entries.length} entries`
      );
    }

    sent += result.Successful?.length ?? 0;
  }

  return sent;
}
