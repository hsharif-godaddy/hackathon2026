import { Client } from '@elastic/elasticsearch';

import { logger } from '@/lib/logger';

const WRITE_ES_URL = process.env.AIRO_BUILDER_ES_ENDPOINT || 'http://localhost:9200';

// Write client for local ES storage (analytics data)
export const writeClient = new Client({
  node: WRITE_ES_URL,
  auth: {
    apiKey: process.env.AIRO_BUILDER_ES_API_KEY || ''
  }
});

// Index prefix for all analytics indices
const INDEX_PREFIX = process.env.ES_INDEX_PREFIX || 'airo_analytics_';

// Index names for processed data
export const INDICES = {
  AGENT_RUNS: `${INDEX_PREFIX}agent_runs`,
  COMPRESSIONS: `${INDEX_PREFIX}compressions`,
  ERRORS: `${INDEX_PREFIX}errors`,
  CONVERSATIONS: `${INDEX_PREFIX}conversations`,
  SUMMARIZATIONS: `${INDEX_PREFIX}summarizations`,
  TOOL_FAILURES: `${INDEX_PREFIX}tool_failures`,
  PUBLISH_EVENTS: `${INDEX_PREFIX}publish_events`,
  CLIENT_ERRORS: `${INDEX_PREFIX}client_errors`,
  CREDIT_PACKS: `${INDEX_PREFIX}credit_packs`
} as const;

// Index mappings
const MAPPINGS = {
  [INDICES.AGENT_RUNS]: {
    properties: {
      es_id: { type: 'keyword' },
      timestamp: { type: 'date' },
      app_id: { type: 'keyword' },
      agent_id: { type: 'keyword' },
      agent_name: { type: 'keyword' },
      finish_reason: { type: 'keyword' },
      steps: { type: 'integer' },
      input_tokens: { type: 'long' },
      output_tokens: { type: 'long' },
      cached_input_tokens: { type: 'long' },
      total_tokens: { type: 'long' },
      cost: { type: 'float' }
    }
  },
  [INDICES.COMPRESSIONS]: {
    properties: {
      es_id: { type: 'keyword' },
      timestamp: { type: 'date' },
      app_id: { type: 'keyword' },
      total_messages: { type: 'integer' },
      compressed_messages: { type: 'integer' },
      original_bytes: { type: 'long' },
      compressed_bytes: { type: 'long' },
      compression_ratio: { type: 'float' },
      saved_bytes: { type: 'long' },
      strategies: { type: 'object', enabled: false }
    }
  },
  [INDICES.ERRORS]: {
    properties: {
      es_id: { type: 'keyword' },
      timestamp: { type: 'date' },
      app_id: { type: 'keyword' },
      event_type: { type: 'keyword' },
      error_message: { type: 'text' },
      status_code: { type: 'integer' },
      url: { type: 'keyword' }
    }
  },
  [INDICES.CONVERSATIONS]: {
    properties: {
      es_id: { type: 'keyword' },
      timestamp: { type: 'date' },
      app_id: { type: 'keyword' },
      agent_id: { type: 'keyword' },
      event_type: { type: 'keyword' },
      socket_id: { type: 'keyword' },
      dropped_messages: { type: 'integer' },
      processed_messages: { type: 'integer' }
    }
  },
  [INDICES.SUMMARIZATIONS]: {
    properties: {
      es_id: { type: 'keyword' },
      timestamp: { type: 'date' },
      app_id: { type: 'keyword' },
      original_tokens: { type: 'long' },
      summary_tokens: { type: 'long' },
      compression_ratio: { type: 'float' },
      success: { type: 'boolean' },
      error_message: { type: 'text' }
    }
  },
  [INDICES.TOOL_FAILURES]: {
    properties: {
      es_id: { type: 'keyword' },
      timestamp: { type: 'date' },
      app_id: { type: 'keyword' },
      agent_id: { type: 'keyword' },
      tool_name: { type: 'keyword' },
      error_message: { type: 'text' },
      file_path: { type: 'keyword' }
    }
  },
  [INDICES.PUBLISH_EVENTS]: {
    properties: {
      es_id: { type: 'keyword' },
      timestamp: { type: 'date' },
      app_id: { type: 'keyword' },
      event_type: { type: 'keyword' },
      success: { type: 'boolean' },
      error_message: { type: 'text' },
      commit_hash: { type: 'keyword' }
    }
  },
  [INDICES.CLIENT_ERRORS]: {
    properties: {
      es_id: { type: 'keyword' },
      timestamp: { type: 'date' },
      app_id: { type: 'keyword' },
      event_type: { type: 'keyword' },
      error_message: { type: 'text' },
      customer_id: { type: 'keyword' },
      session_id: { type: 'keyword' },
      client_ip: { type: 'keyword' },
      user_agent: { type: 'text' },
      page_url: { type: 'keyword' },
      conversation_id: { type: 'keyword' },
      extra_data: { type: 'object', enabled: false }
    }
  },
  [INDICES.CREDIT_PACKS]: {
    properties: {
      es_id: { type: 'keyword' },
      timestamp: { type: 'date' },
      app_id: { type: 'keyword' },
      subscription_id: { type: 'keyword' },
      status: { type: 'keyword' },
      credits_max: { type: 'integer' },
      use_before: { type: 'date' },
      next_credit_allowed_after: { type: 'date' },
      added_by_shopper_id: { type: 'keyword' },
      added_by_cid: { type: 'keyword' },
      added_by_email: { type: 'keyword' },
      llm_budget_user_id: { type: 'keyword' },
      // Used by lock documents; requires an ILM policy with a delete phase
      // keyed on this field to auto-clean stale locks
      expire_at: { type: 'date' },
      notes: {
        type: 'text',
        fields: {
          keyword: { type: 'keyword', ignore_above: 32000 }
        }
      }
    }
  }
};

export async function initIndices(indicesToInit: string[] = Object.values(INDICES), forceUpdate: boolean = false) {
  for (const indexName of indicesToInit) {
    const mapping = MAPPINGS[indexName as keyof typeof MAPPINGS];
    if (!mapping) {
      logger.warn('es.index.init.no-mapping', { indexName });
      continue;
    }
    const exists = await writeClient.indices.exists({ index: indexName });
    if (!exists) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await writeClient.indices.create({ index: indexName, mappings: mapping } as any);
      logger.info('es.index.init.created', { indexName });
    } else if (forceUpdate) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await writeClient.indices.putMapping({ index: indexName, ...mapping } as any);
        logger.info('es.index.mapping.updated', { indexName });
      } catch (error) {
        logger.error('es.index.mapping.update.failed', { indexName }, { error: error as Error });
      }
    } else {
      logger.info('es.index.init.exists', { indexName });
    }
  }
}

// Bulk operations helper
interface BulkDoc {
  index: string;
  id: string;
  doc: Record<string, unknown>;
}

export async function bulkIndex(docs: BulkDoc[]) {
  if (docs.length === 0) return;

  const body = docs.flatMap(({ index, id, doc }) => [
    { index: { _index: index, _id: id } },
    doc
  ]);

  const result = await writeClient.bulk({ body, refresh: false });

  if (result.errors) {
    const errorItems = result.items.filter(item => item.index?.error);
    const samples = errorItems.slice(0, 3).map(item => ({
      index: item.index?._index,
      error: item.index?.error,
    }));
    logger.error('es.bulk.errors', {
      errorCount: errorItems.length,
      samples,
    });
    // Throw so flushPendingDocs's catch block actually fires on partial
    // failures (mapping conflicts, auth-rejected docs). Without this throw,
    // partial failures clear `pendingDocs` without re-queueing un-attempted
    // sub-batches; the docs near the watermark boundary are then dropped
    // with no retry path.
    const firstReason =
      typeof samples[0]?.error === 'object' && samples[0]?.error !== null
        ? (samples[0].error as { reason?: string }).reason || JSON.stringify(samples[0].error)
        : String(samples[0]?.error ?? 'unknown');
    throw new Error(
      `Bulk index reported ${errorItems.length} error(s). First: ${firstReason}`,
    );
  }

  return result;
}

// "airobuilde" (no trailing 'r') matches the actual ES domain naming convention
export function isProdES(): boolean {
  return WRITE_ES_URL.startsWith('https://airobuilde-prod-');
}
