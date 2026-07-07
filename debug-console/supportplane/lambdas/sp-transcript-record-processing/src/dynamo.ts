/**
 * dynamo.ts — read a transcript row and write back enrichment.
 *
 * Mirrors the read/update shape of debug-console `dynamo-store.ts`: the
 * transcripts table PK is `interaction_id`, SK is `created_at`. Enrichment is
 * an additive `UpdateItem` that never touches the key attributes.
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';

import type { EnrichmentResult } from './enrichment-types.js';

const REGION: string = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-west-2';
const TRANSCRIPTS_TABLE: string = process.env.SP_L1_TRANSCRIPTS_TABLE ?? '';

const client: DynamoDBDocumentClient = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: REGION }),
  { marshallOptions: { removeUndefinedValues: true } }
);

export interface TranscriptRow {
  interaction_id: string;
  created_at: string;
  full_transcript?: string;
  conversation_summary?: string;
  enriched_at?: string;
  enrich_source_version?: string;
}

export async function getTranscriptById(interaction_id: string): Promise<TranscriptRow | null> {
  const result = await client.send(
    new QueryCommand({
      TableName: TRANSCRIPTS_TABLE,
      KeyConditionExpression: 'interaction_id = :id',
      ExpressionAttributeValues: { ':id': interaction_id },
      ConsistentRead: true,
      Limit: 1,
      ScanIndexForward: false,
    })
  );
  return (result.Items?.[0] as TranscriptRow) || null;
}

export interface EnrichmentWriteback extends Partial<EnrichmentResult> {
  enrichment_provider: string;
  enriched_at: string;
  enrich_source_version: string;
  enrich_status: 'ok' | 'error';
  enrich_error?: string;
  /** NPS proxy (0–10) derived from sentiment when no survey score exists. */
  nps?: number;
  /** 'survey' | 'proxy' — provenance of `nps` (plan ledger 0.4). */
  nps_source?: string;
}

/**
 * Write enrichment attributes onto an existing row. `created_at` (SK) is
 * required to address the item; key attributes are never modified.
 */
export async function writeBackEnrichment(
  interaction_id: string,
  created_at: string,
  patch: EnrichmentWriteback
): Promise<void> {
  const setFields: Record<string, unknown> = {
    // Dynamic vocabulary facets
    goal: patch.goal,
    intent: patch.intent,
    sub_intent: patch.sub_intent,
    platform_area: patch.platform_area,
    error_type: patch.error_type,
    customer_sentiment: patch.customer_sentiment,
    issue_resolution: patch.issue_resolution,
    friction_point: patch.friction_point,
    preventable_contact: patch.preventable_contact,
    fix_category: patch.fix_category,
    // Resolution fuel
    where_airo_went_wrong: patch.where_airo_went_wrong,
    symptoms: patch.symptoms,
    search_keywords: patch.search_keywords,
    root_cause: patch.root_cause,
    recommended_fix: patch.recommended_fix,
    airo_failure: patch.airo_failure,
    conversation_summary: patch.conversation_summary,
    tags: patch.tags,
    // Metadata
    nps: patch.nps,
    nps_source: patch.nps_source,
    enrichment_provider: patch.enrichment_provider,
    enriched_at: patch.enriched_at,
    enrich_source_version: patch.enrich_source_version,
    enrich_status: patch.enrich_status,
    enrich_error: patch.enrich_error,
  };

  const expressions: string[] = [];
  const names: Record<string, string> = {};
  const values: Record<string, unknown> = {};
  let idx = 0;

  for (const [key, value] of Object.entries(setFields)) {
    if (value === undefined) {
      continue;
    }
    const nameToken = `#f${idx}`;
    const valueToken = `:v${idx}`;
    expressions.push(`${nameToken} = ${valueToken}`);
    names[nameToken] = key;
    values[valueToken] = value;
    idx += 1;
  }

  if (!expressions.length) {
    return;
  }

  await client.send(
    new UpdateCommand({
      TableName: TRANSCRIPTS_TABLE,
      Key: { interaction_id, created_at },
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
      UpdateExpression: `SET ${expressions.join(', ')}`,
    })
  );
}
