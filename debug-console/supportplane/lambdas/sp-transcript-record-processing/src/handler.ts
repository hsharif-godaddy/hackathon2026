import type { SQSBatchItemFailure, SQSBatchResponse, SQSEvent, SQSRecord } from 'aws-lambda';

import {
  getTranscriptById,
  writeBackEnrichment,
  type EnrichmentWriteback,
  type TranscriptRow,
} from './dynamo.js';
import { BeaconAskProvider } from './beacon-provider.js';
import type { EnrichmentProvider, EnrichmentResult } from './enrichment-types.js';
import { GoCodeProvider } from './gocode-provider.js';
import { logger } from './log.js';

/**
 * One record-processing job = one transcript row, referenced by `interaction_id`
 * (a pointer, NOT the row payload — keeps messages tiny and DynamoDB the single
 * source of truth). The ingest Lambda enqueues these after it upserts the rows.
 */
interface RecordProcessingJob {
  interaction_id?: string;
  upload_id?: string;
}

const ENV_NAME: string = process.env.ENV_NAME ?? 'dev';
const TRANSCRIPTS_TABLE: string = process.env.SP_L1_TRANSCRIPTS_TABLE ?? '';
const S2S_IAM_JWT_ROLE_ARN: string = process.env.S2S_IAM_JWT_ROLE_ARN ?? '';
const SSO_HOST: string = process.env.SSO_HOST ?? '';

/**
 * Idempotency gate: bump this when providers or prompts change so previously
 * enriched rows re-enrich deterministically. A row whose `enrich_source_version`
 * already equals this is skipped (safe on SQS redelivery).
 */
const ENRICH_SOURCE_VERSION: string = 'v2-resolution-ready';

// Ladder: GoCode is PRIMARY; Beacon is FALLBACK (Beacon 403 until S2S role allow-listed).
const PROVIDERS: EnrichmentProvider[] = [new GoCodeProvider(), new BeaconAskProvider()];

/**
 * NPS proxy from sentiment when there is no survey score (plan ledger 0.4:
 * NPS is null unless a survey exists, so we surface a labelled proxy). Bands
 * mirror the standard promoter/passive/detractor split.
 */
function npsProxyFromSentiment(sentiment?: string): number | undefined {
  switch (sentiment) {
    case 'positive':
      return 9;
    case 'neutral':
      return 7;
    case 'negative':
      return 3;
    default:
      return undefined;
  }
}

/**
 * Run the provider ladder for one row. Returns the first non-null result mapped
 * to a writeback. A configured provider that throws is skipped and the next
 * provider is tried; if every configured provider throws, the last error is
 * rethrown so the message redrives (partial-batch → DLQ after 3). A permanent
 * `error` mark is written only when the ladder is exhausted without a throw
 * (no provider configured, or every provider abstained). (Plan E4.)
 */
async function enrichRow(row: TranscriptRow): Promise<EnrichmentWriteback> {
  const base = {
    enriched_at: new Date().toISOString(),
    enrich_source_version: ENRICH_SOURCE_VERSION,
  };

  let lastError: string | undefined;
  let attempted = false;
  for (const provider of PROVIDERS) {
    if (!provider.isConfigured()) {
      continue;
    }
    attempted = true;
    try {
      const result: EnrichmentResult | null = await provider.enrich({
        interaction_id: row.interaction_id,
        full_transcript: row.full_transcript ?? '',
        conversation_summary: row.conversation_summary,
      });
      if (result) {
        // Field ladder: never overwrite a CSV-native summary the row already has.
        const conversation_summary: string | undefined =
          row.conversation_summary || result.conversation_summary;
        const nps: number | undefined = npsProxyFromSentiment(result.customer_sentiment);
        logger.info('sp-transcript-record-processing.enrichment_success', {
          interactionId: row.interaction_id,
          provider: result.provider,
        });
        return {
          ...result,
          conversation_summary,
          enrichment_provider: result.provider,
          enrich_status: 'ok',
          ...(nps !== undefined ? { nps, nps_source: 'proxy' } : {}),
          ...base,
        };
      }
    } catch (error: unknown) {
      lastError = error instanceof Error ? error.message : String(error);
      logger.warn('sp-transcript-record-processing.provider_failed', {
        provider: provider.name,
        interactionId: row.interaction_id,
        error: lastError,
      });
    }
  }

  if (lastError) {
    throw new Error(`enrichment failed for ${row.interaction_id}: ${lastError}`);
  }

  return {
    enrichment_provider: 'none',
    enrich_status: 'error',
    enrich_error: attempted ? 'all providers returned no result' : 'no configured provider',
    ...base,
  };
}

async function processJob(job: RecordProcessingJob): Promise<void> {
  const interactionId: string = job.interaction_id as string;

  const row: TranscriptRow | null = await getTranscriptById(interactionId);
  if (!row) {
    // Row absent — likely a read-after-write race (ingest enqueues immediately
    // after upsert; even with ConsistentRead, a delete or replication lag can
    // cause this). Throw so SQS redrives; if genuinely gone it DLQs after 3.
    throw new Error(`row not found for ${interactionId} — redrive`);
  }

  // Idempotency gate — re-delivery / already-current version is a no-op.
  if (row.enriched_at && row.enrich_source_version === ENRICH_SOURCE_VERSION) {
    logger.info('sp-transcript-record-processing.skip_current', { interactionId });
    return;
  }

  const writeback: EnrichmentWriteback = await enrichRow(row);
  await writeBackEnrichment(row.interaction_id, row.created_at, writeback);

  logger.info('sp-transcript-record-processing.enriched', {
    interactionId,
    provider: writeback.enrichment_provider,
    status: writeback.enrich_status,
    airoFailure: Boolean(writeback.airo_failure),
  });
}

/**
 * `sp-transcript-record-processing` worker.
 *
 * SQS-triggered (record-processing-jobs queue, batchSize 5 / maxConcurrency 5).
 * Processes ONE row per message: read by `interaction_id`, enrich via the
 * provider ladder (GoCode primary → Beacon fallback), then write
 * back to DynamoDB. Idempotent via `enrich_source_version`; malformed jobs are
 * dropped, transient failures redrive via partial-batch response.
 */
export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  const batchItemFailures: SQSBatchItemFailure[] = [];

  for (const record of event.Records) {
    try {
      const job: RecordProcessingJob = JSON.parse(record.body) as RecordProcessingJob;

      logger.info('sp-transcript-record-processing.received', {
        env: ENV_NAME,
        messageId: record.messageId,
        interactionId: job.interaction_id,
        uploadId: job.upload_id,
        transcriptsTable: TRANSCRIPTS_TABLE,
        gocodeConfigured: PROVIDERS[0]?.isConfigured() ?? false,
        beaconConfigured: PROVIDERS[1]?.isConfigured() ?? false,
        beaconAuthConfigured: Boolean(S2S_IAM_JWT_ROLE_ARN && SSO_HOST),
      });

      if (!job.interaction_id) {
        // Malformed job — retrying will never succeed. Log and drop (do NOT add
        // to failures) so it does not churn the queue toward the DLQ.
        logger.warn('sp-transcript-record-processing.skip', {
          reason: 'missing interaction_id',
          messageId: record.messageId,
        });
        continue;
      }

      await processJob(job);
    } catch (error: unknown) {
      // Transient / unexpected — redrive this message (partial-batch response).
      logger.error('sp-transcript-record-processing.error', {
        messageId: (record as SQSRecord).messageId,
        error: error instanceof Error ? error.message : String(error),
      });
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures };
}
