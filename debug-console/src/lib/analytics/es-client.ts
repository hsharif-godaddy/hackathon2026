import { Client } from '@elastic/elasticsearch';

const SOURCE_ES_URL = process.env.PIONEER_ES_ENDPOINT || 'http://localhost:9200';
const SOURCE_INDEX = 'airo-agents-prod';

const WRITE_ES_URL = process.env.AIRO_BUILDER_ES_ENDPOINT || 'http://localhost:9200';

// Source client for reading raw logs from C1 prod
export const sourceClient = new Client({
  node: SOURCE_ES_URL,
  auth: {
    apiKey: process.env.PIONEER_ES_API_KEY || ''
  }
});

// Write client for local ES storage (analytics data)
export const writeClient = new Client({
  node: WRITE_ES_URL,
  auth: {
    apiKey: process.env.AIRO_BUILDER_ES_API_KEY || ''
  }
});

export const SOURCE_INDEX_NAME = SOURCE_INDEX;

// Index prefix for all analytics indices
const INDEX_PREFIX = process.env.ES_INDEX_PREFIX || 'airo_analytics_';

// Index names for processed data
export const INDICES = {
  AGENT_RUNS: `${INDEX_PREFIX}agent_runs`,
  TOOL_EXECUTIONS: `${INDEX_PREFIX}tool_executions`,
  LLM_CALLS: `${INDEX_PREFIX}llm_calls`,
  COMPRESSIONS: `${INDEX_PREFIX}compressions`,
  ERRORS: `${INDEX_PREFIX}errors`,
  CONVERSATIONS: `${INDEX_PREFIX}conversations`,
  SUMMARIZATIONS: `${INDEX_PREFIX}summarizations`,
  TOOL_FAILURES: `${INDEX_PREFIX}tool_failures`,
  PUBLISH_EVENTS: `${INDEX_PREFIX}publish_events`,
  MODEL_SELECTIONS: `${INDEX_PREFIX}model_selections`,
  COMMAND_EXECUTIONS: `${INDEX_PREFIX}command_executions`
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
  [INDICES.TOOL_EXECUTIONS]: {
    properties: {
      es_id: { type: 'keyword' },
      timestamp: { type: 'date' },
      app_id: { type: 'keyword' },
      agent_id: { type: 'keyword' },
      tool_name: { type: 'keyword' }
    }
  },
  [INDICES.LLM_CALLS]: {
    properties: {
      es_id: { type: 'keyword' },
      timestamp: { type: 'date' },
      app_id: { type: 'keyword' },
      agent_id: { type: 'keyword' },
      model: { type: 'keyword' },
      provider: { type: 'keyword' },
      duration_ms: { type: 'integer' },
      input_tokens: { type: 'long' },
      output_tokens: { type: 'long' },
      finish_reason: { type: 'keyword' },
      tool_call_count: { type: 'integer' }
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
      duration_ms: { type: 'integer' },
      error_message: { type: 'text' }
    }
  },
  [INDICES.MODEL_SELECTIONS]: {
    properties: {
      es_id: { type: 'keyword' },
      timestamp: { type: 'date' },
      app_id: { type: 'keyword' },
      model: { type: 'keyword' },
      provider: { type: 'keyword' }
    }
  },
  [INDICES.COMMAND_EXECUTIONS]: {
    properties: {
      es_id: { type: 'keyword' },
      timestamp: { type: 'date' },
      app_id: { type: 'keyword' },
      command: { type: 'text', fields: { keyword: { type: 'keyword' } } },
      success: { type: 'boolean' },
      duration_ms: { type: 'integer' },
      exit_code: { type: 'integer' }
    }
  }
};

export async function initIndices() {
  for (const [indexName, mapping] of Object.entries(MAPPINGS)) {
    const exists = await writeClient.indices.exists({ index: indexName });
    if (!exists) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await writeClient.indices.create({ index: indexName, mappings: mapping } as any);
      console.log(`Created index: ${indexName}`);
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
    console.error(`Bulk index errors: ${errorItems.length}`);
    errorItems.slice(0, 3).forEach(item => {
      console.error(`  Index: ${item.index?._index}, Error: ${JSON.stringify(item.index?.error)}`);
    });
  }

  return result;
}

