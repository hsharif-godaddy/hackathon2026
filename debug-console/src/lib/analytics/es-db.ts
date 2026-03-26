import { writeClient, INDICES, bulkIndex, initIndices } from './es-client';

// Claude pricing per million tokens
const PRICING = {
  'sonnet-4.5': { input: 3.0, output: 15.0 },
  'opus-4.5': { input: 5.0, output: 25.0 },
  'haiku-4.5': { input: 1.0, output: 5.0 },
};

const CURRENT_MODEL = 'sonnet-4.5';
const INPUT_COST_PER_MILLION = PRICING[CURRENT_MODEL].input;
const OUTPUT_COST_PER_MILLION = PRICING[CURRENT_MODEL].output;

// Batch for bulk inserts
let pendingDocs: Array<{ index: string; id: string; doc: Record<string, unknown> }> = [];

export function insertRun(run: {
  es_id: string;
  timestamp: string;
  app_id: string;
  agent_id: string;
  agent_name?: string;
  finish_reason?: string;
  steps: number;
  input_tokens: number;
  output_tokens: number;
  cached_input_tokens?: number;
}) {
  const cost = (run.input_tokens / 1_000_000) * INPUT_COST_PER_MILLION +
               (run.output_tokens / 1_000_000) * OUTPUT_COST_PER_MILLION;

  pendingDocs.push({
    index: INDICES.AGENT_RUNS,
    id: run.es_id,
    doc: {
      es_id: run.es_id,
      timestamp: run.timestamp,
      app_id: run.app_id,
      agent_id: run.agent_id,
      agent_name: run.agent_name || null,
      finish_reason: run.finish_reason || null,
      steps: run.steps,
      input_tokens: run.input_tokens,
      output_tokens: run.output_tokens,
      cached_input_tokens: run.cached_input_tokens || 0,
      total_tokens: run.input_tokens + run.output_tokens,
      cost
    }
  });
}

export function insertCompression(comp: {
  es_id: string;
  timestamp: string;
  app_id: string;
  total_messages: number;
  compressed_messages: number;
  original_bytes: number;
  compressed_bytes: number;
  compression_ratio: number;
  saved_bytes: number;
  strategies?: Record<string, number>;
}) {
  pendingDocs.push({
    index: INDICES.COMPRESSIONS,
    id: comp.es_id,
    doc: {
      es_id: comp.es_id,
      timestamp: comp.timestamp,
      app_id: comp.app_id,
      total_messages: comp.total_messages,
      compressed_messages: comp.compressed_messages,
      original_bytes: comp.original_bytes,
      compressed_bytes: comp.compressed_bytes,
      compression_ratio: comp.compression_ratio,
      saved_bytes: comp.saved_bytes,
      strategies: comp.strategies || null
    }
  });
}

export function insertError(err: {
  es_id: string;
  timestamp: string;
  app_id: string;
  event_type: string;
  error_message?: string;
  status_code?: number;
  url?: string;
}) {
  pendingDocs.push({
    index: INDICES.ERRORS,
    id: err.es_id,
    doc: {
      es_id: err.es_id,
      timestamp: err.timestamp,
      app_id: err.app_id,
      event_type: err.event_type,
      error_message: err.error_message || null,
      status_code: err.status_code || null,
      url: err.url || null
    }
  });
}

export function insertConversation(conv: {
  es_id: string;
  timestamp: string;
  app_id: string;
  agent_id?: string;
  event_type: string;
  socket_id?: string;
  dropped_messages?: number;
  processed_messages?: number;
}) {
  pendingDocs.push({
    index: INDICES.CONVERSATIONS,
    id: conv.es_id,
    doc: {
      es_id: conv.es_id,
      timestamp: conv.timestamp,
      app_id: conv.app_id,
      agent_id: conv.agent_id || null,
      event_type: conv.event_type,
      socket_id: conv.socket_id || null,
      dropped_messages: conv.dropped_messages || 0,
      processed_messages: conv.processed_messages || 0
    }
  });
}

export function insertSummarization(sum: {
  es_id: string;
  timestamp: string;
  app_id: string;
  original_tokens?: number;
  summary_tokens?: number;
  compression_ratio?: number;
  success: boolean;
  error_message?: string;
}) {
  pendingDocs.push({
    index: INDICES.SUMMARIZATIONS,
    id: sum.es_id,
    doc: {
      es_id: sum.es_id,
      timestamp: sum.timestamp,
      app_id: sum.app_id,
      original_tokens: sum.original_tokens || 0,
      summary_tokens: sum.summary_tokens || 0,
      compression_ratio: sum.compression_ratio || 0,
      success: sum.success,
      error_message: sum.error_message || null
    }
  });
}

export function insertToolFailure(failure: {
  es_id: string;
  timestamp: string;
  app_id: string;
  agent_id?: string;
  tool_name: string;
  error_message?: string;
  file_path?: string;
}) {
  pendingDocs.push({
    index: INDICES.TOOL_FAILURES,
    id: failure.es_id,
    doc: {
      es_id: failure.es_id,
      timestamp: failure.timestamp,
      app_id: failure.app_id,
      agent_id: failure.agent_id || null,
      tool_name: failure.tool_name,
      error_message: failure.error_message || null,
      file_path: failure.file_path || null
    }
  });
}

export function insertPublishEvent(pub: {
  es_id: string;
  timestamp: string;
  app_id: string;
  event_type: 'begin' | 'success' | 'build_failed' | 'archive_failed' | 'other_failed';
  success: boolean;
  error_message?: string;
  commit_hash?: string;
}) {
  pendingDocs.push({
    index: INDICES.PUBLISH_EVENTS,
    id: pub.es_id,
    doc: {
      es_id: pub.es_id,
      timestamp: pub.timestamp,
      app_id: pub.app_id,
      event_type: pub.event_type,
      success: pub.success,
      error_message: pub.error_message || null,
      commit_hash: pub.commit_hash || null
    }
  });
}

export function insertClientError(err: {
  es_id: string;
  timestamp: string;
  app_id: string;
  event_type: string;
  error_message?: string;
  customer_id?: string;
  session_id?: string;
  client_ip?: string;
  user_agent?: string;
  page_url?: string;
  conversation_id?: string;
  extra_data?: Record<string, unknown>;
}) {
  pendingDocs.push({
    index: INDICES.CLIENT_ERRORS,
    id: err.es_id,
    doc: {
      es_id: err.es_id,
      timestamp: err.timestamp,
      app_id: err.app_id,
      event_type: err.event_type,
      error_message: err.error_message || null,
      customer_id: err.customer_id || null,
      session_id: err.session_id || null,
      client_ip: err.client_ip || null,
      user_agent: err.user_agent || null,
      page_url: err.page_url || null,
      conversation_id: err.conversation_id || null,
      extra_data: err.extra_data || null
    }
  });
}

// Flush pending documents to ES in batches
const BATCH_SIZE = 5000;

export async function flushPendingDocs() {
  if (pendingDocs.length === 0) return 0;
  const count = pendingDocs.length;

  for (let i = 0; i < pendingDocs.length; i += BATCH_SIZE) {
    const batch = pendingDocs.slice(i, i + BATCH_SIZE);
    await bulkIndex(batch);
  }

  pendingDocs = [];
  return count;
}

// ========== Query Functions ==========

function buildDateFilter(startDate?: string, endDate?: string) {
  const range: Record<string, string> = {};
  if (startDate) range.gte = startDate;
  if (endDate) range.lte = endDate;
  if (Object.keys(range).length === 0) return null;
  return { range: { timestamp: range } };
}

export async function getSummary(startDate?: string, endDate?: string) {
  const filter = buildDateFilter(startDate, endDate);
  const query = filter ? { bool: { filter: [filter] } } : { match_all: {} };

  const result = await writeClient.search({
    index: INDICES.AGENT_RUNS,
    size: 0,
    body: {
      query,
      aggs: {
        total_apps: { cardinality: { field: 'app_id' } },
        total_input_tokens: { sum: { field: 'input_tokens' } },
        total_output_tokens: { sum: { field: 'output_tokens' } },
        total_cost: { sum: { field: 'cost' } },
        start_date: { min: { field: 'timestamp' } },
        end_date: { max: { field: 'timestamp' } },
        apps_by_day: {
          date_histogram: { field: 'timestamp', calendar_interval: '1d' },
          aggs: {
            unique_apps: { cardinality: { field: 'app_id' } },
            cost: { sum: { field: 'cost' } },
            steps: { sum: { field: 'steps' } }
          }
        },
        agent_totals: {
          terms: { field: 'agent_id', size: 100 },
          aggs: {
            input_tokens: { sum: { field: 'input_tokens' } },
            output_tokens: { sum: { field: 'output_tokens' } },
            cost: { sum: { field: 'cost' } }
          }
        },
        top_apps: {
          terms: { field: 'app_id', size: 20, order: { cost: 'desc' } },
          aggs: {
            cost: { sum: { field: 'cost' } },
            input_tokens: { sum: { field: 'input_tokens' } },
            output_tokens: { sum: { field: 'output_tokens' } },
            steps: { sum: { field: 'steps' } }
          }
        }
      }
    }
  });

  const aggs = result.aggregations as Record<string, unknown>;
  const totalRuns = (result.hits.total as { value: number }).value;
  const totalInputTokens = (aggs.total_input_tokens as { value: number }).value || 0;
  const totalOutputTokens = (aggs.total_output_tokens as { value: number }).value || 0;
  const totalCost = (aggs.total_cost as { value: number }).value || 0;
  const totalApps = (aggs.total_apps as { value: number }).value || 0;

  // Calculate apps per day and build daily stats
  const dayBuckets = (aggs.apps_by_day as { buckets: Array<{ key_as_string: string; doc_count: number; unique_apps: { value: number }; cost: { value: number }; steps: { value: number } }> })?.buckets || [];
  const numDays = dayBuckets.length || 1;
  const appsPerDay = totalApps / numDays;

  const dailyStats = dayBuckets.map(b => ({
    date: b.key_as_string,
    apps: b.unique_apps.value,
    cost: b.cost.value,
    runs: b.doc_count,
    steps: b.steps.value,
    avg_cost_per_app: b.unique_apps.value > 0 ? b.cost.value / b.unique_apps.value : 0,
    avg_steps_per_run: b.doc_count > 0 ? b.steps.value / b.doc_count : 0
  }));

  const modelCosts = {
    'sonnet-4.5': (totalInputTokens / 1_000_000) * PRICING['sonnet-4.5'].input + (totalOutputTokens / 1_000_000) * PRICING['sonnet-4.5'].output,
    'opus-4.5': (totalInputTokens / 1_000_000) * PRICING['opus-4.5'].input + (totalOutputTokens / 1_000_000) * PRICING['opus-4.5'].output,
    'haiku-4.5': (totalInputTokens / 1_000_000) * PRICING['haiku-4.5'].input + (totalOutputTokens / 1_000_000) * PRICING['haiku-4.5'].output,
  };

  const agentBuckets = (aggs.agent_totals as { buckets: Array<{ key: string; doc_count: number; input_tokens: { value: number }; output_tokens: { value: number }; cost: { value: number } }> }).buckets;
  const appBuckets = (aggs.top_apps as { buckets: Array<{ key: string; doc_count: number; cost: { value: number }; input_tokens: { value: number }; output_tokens: { value: number }; steps: { value: number } }> }).buckets;

  return {
    total_apps: totalApps,
    apps_per_day: appsPerDay,
    total_runs: totalRuns,
    total_input_tokens: totalInputTokens,
    total_output_tokens: totalOutputTokens,
    total_cost: totalCost,
    start_date: (aggs.start_date as { value_as_string?: string }).value_as_string,
    end_date: (aggs.end_date as { value_as_string?: string }).value_as_string,
    avg_cost_per_app: totalApps > 0 ? totalCost / totalApps : 0,
    agent_totals: agentBuckets.map(b => ({
      agent_id: b.key,
      input_tokens: b.input_tokens.value,
      output_tokens: b.output_tokens.value,
      cost: b.cost.value,
      runs: b.doc_count
    })),
    top_apps: appBuckets.map(b => ({
      app_id: b.key,
      cost: b.cost.value,
      runs: b.doc_count,
      input_tokens: b.input_tokens.value,
      output_tokens: b.output_tokens.value,
      steps: b.steps.value
    })),
    model_costs: modelCosts,
    current_model: CURRENT_MODEL,
    daily_stats: dailyStats
  };
}

export async function getHourlyStats(date: string) {
  const startOfDay = new Date(date);
  startOfDay.setUTCHours(0, 0, 0, 0);
  const endOfDay = new Date(date);
  endOfDay.setUTCHours(23, 59, 59, 999);

  const result = await writeClient.search({
    index: INDICES.AGENT_RUNS,
    size: 0,
    body: {
      query: {
        range: {
          timestamp: {
            gte: startOfDay.toISOString(),
            lte: endOfDay.toISOString()
          }
        }
      },
      aggs: {
        by_hour: {
          date_histogram: { field: 'timestamp', calendar_interval: '1h' },
          aggs: {
            unique_apps: { cardinality: { field: 'app_id' } },
            cost: { sum: { field: 'cost' } },
            steps: { sum: { field: 'steps' } }
          }
        }
      }
    }
  });

  const aggs = result.aggregations as Record<string, unknown>;
  const hourBuckets = (aggs.by_hour as { buckets: Array<{ key_as_string: string; doc_count: number; unique_apps: { value: number }; cost: { value: number }; steps: { value: number } }> })?.buckets || [];

  return {
    date,
    hourly_stats: hourBuckets.map(b => ({
      hour: new Date(b.key_as_string).getUTCHours(),
      apps: b.unique_apps.value,
      runs: b.doc_count,
      cost: b.cost.value,
      steps: b.steps.value,
      avg_steps_per_run: b.doc_count > 0 ? b.steps.value / b.doc_count : 0
    }))
  };
}

export async function getLast24HoursStats() {
  const now = new Date();
  const start = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const result = await writeClient.search({
    index: INDICES.AGENT_RUNS,
    size: 0,
    body: {
      query: {
        range: {
          timestamp: {
            gte: start.toISOString(),
            lte: now.toISOString()
          }
        }
      },
      aggs: {
        by_hour: {
          date_histogram: { field: 'timestamp', fixed_interval: '1h' },
          aggs: {
            unique_apps: { cardinality: { field: 'app_id' } },
            cost: { sum: { field: 'cost' } },
            steps: { sum: { field: 'steps' } }
          }
        }
      }
    }
  });

  const aggs = result.aggregations as Record<string, unknown>;
  const hourBuckets = (aggs.by_hour as { buckets: Array<{ key_as_string: string; doc_count: number; unique_apps: { value: number }; cost: { value: number }; steps: { value: number } }> })?.buckets || [];

  // Build a map of hour offsets (0 = now, 1 = 1 hour ago, etc.)
  const hourlyStats: Array<{ hoursAgo: number; timestamp: string; apps: number; runs: number; cost: number; steps: number }> = [];

  for (const b of hourBuckets) {
    const bucketTime = new Date(b.key_as_string);
    const hoursAgo = Math.floor((now.getTime() - bucketTime.getTime()) / (60 * 60 * 1000));
    hourlyStats.push({
      hoursAgo,
      timestamp: b.key_as_string,
      apps: b.unique_apps.value,
      runs: b.doc_count,
      cost: b.cost.value,
      steps: b.steps.value
    });
  }

  return {
    start: start.toISOString(),
    end: now.toISOString(),
    hourly_stats: hourlyStats.sort((a, b) => b.hoursAgo - a.hoursAgo) // oldest first (23 hours ago to now)
  };
}

export async function getLast24HoursErrorStats(errorType: 'websocket' | 'budget') {
  const now = new Date();
  const start = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const eventType = errorType === 'websocket' ? 'websocket.conversation.error' : 'budget_exceeded';

  const result = await writeClient.search({
    index: INDICES.ERRORS,
    size: 0,
    body: {
      query: {
        bool: {
          filter: [
            { range: { timestamp: { gte: start.toISOString(), lte: now.toISOString() } } },
            { term: { event_type: eventType } }
          ]
        }
      },
      aggs: {
        by_hour: {
          date_histogram: { field: 'timestamp', fixed_interval: '1h' },
          aggs: { unique_apps: { cardinality: { field: 'app_id' } } }
        }
      }
    }
  });

  const aggs = result.aggregations as Record<string, unknown>;
  const hourBuckets = (aggs.by_hour as { buckets: Array<{ key_as_string: string; doc_count: number; unique_apps: { value: number } }> })?.buckets || [];

  const hourlyStats: Array<{ hoursAgo: number; timestamp: string; errors: number; apps: number }> = [];

  for (const b of hourBuckets) {
    const bucketTime = new Date(b.key_as_string);
    const hoursAgo = Math.floor((now.getTime() - bucketTime.getTime()) / (60 * 60 * 1000));
    hourlyStats.push({
      hoursAgo,
      timestamp: b.key_as_string,
      errors: b.doc_count,
      apps: b.unique_apps.value
    });
  }

  return {
    errorType,
    start: start.toISOString(),
    end: now.toISOString(),
    hourly_stats: hourlyStats.sort((a, b) => b.hoursAgo - a.hoursAgo)
  };
}

export async function getErrorStats(startDate?: string, endDate?: string) {
  const filter = buildDateFilter(startDate, endDate);

  // Query for websocket errors (excluding budget_exceeded)
  const wsQuery = filter
    ? { bool: { filter: [filter, { term: { event_type: 'websocket.conversation.error' } }] } }
    : { term: { event_type: 'websocket.conversation.error' } };

  // Query for budget errors
  const budgetQuery = filter
    ? { bool: { filter: [filter, { term: { event_type: 'budget_exceeded' } }] } }
    : { term: { event_type: 'budget_exceeded' } };

  const [wsResult, budgetResult] = await Promise.all([
    writeClient.search({
      index: INDICES.ERRORS,
      size: 0,
      body: {
        query: wsQuery,
        aggs: {
          by_day: {
            date_histogram: { field: 'timestamp', calendar_interval: '1d' },
            aggs: { unique_apps: { cardinality: { field: 'app_id' } } }
          }
        }
      }
    }),
    writeClient.search({
      index: INDICES.ERRORS,
      size: 0,
      body: {
        query: budgetQuery,
        aggs: {
          by_day: {
            date_histogram: { field: 'timestamp', calendar_interval: '1d' },
            aggs: { unique_apps: { cardinality: { field: 'app_id' } } }
          }
        }
      }
    })
  ]);

  const wsAggs = wsResult.aggregations as Record<string, unknown>;
  const budgetAggs = budgetResult.aggregations as Record<string, unknown>;

  const wsDayBuckets = (wsAggs.by_day as { buckets: Array<{ key_as_string: string; doc_count: number; unique_apps: { value: number } }> })?.buckets || [];
  const budgetDayBuckets = (budgetAggs.by_day as { buckets: Array<{ key_as_string: string; doc_count: number; unique_apps: { value: number } }> })?.buckets || [];

  return {
    websocket: {
      total: (wsResult.hits.total as { value: number }).value,
      daily_stats: wsDayBuckets.map(b => ({
        date: b.key_as_string,
        errors: b.doc_count,
        apps: b.unique_apps.value
      }))
    },
    budget: {
      total: (budgetResult.hits.total as { value: number }).value,
      daily_stats: budgetDayBuckets.map(b => ({
        date: b.key_as_string,
        errors: b.doc_count,
        apps: b.unique_apps.value
      }))
    }
  };
}

export async function getHourlyErrorStats(date: string, errorType: 'websocket' | 'budget') {
  const startOfDay = new Date(date);
  startOfDay.setUTCHours(0, 0, 0, 0);
  const endOfDay = new Date(date);
  endOfDay.setUTCHours(23, 59, 59, 999);

  const eventType = errorType === 'websocket' ? 'websocket.conversation.error' : 'budget_exceeded';

  const result = await writeClient.search({
    index: INDICES.ERRORS,
    size: 0,
    body: {
      query: {
        bool: {
          filter: [
            { range: { timestamp: { gte: startOfDay.toISOString(), lte: endOfDay.toISOString() } } },
            { term: { event_type: eventType } }
          ]
        }
      },
      aggs: {
        by_hour: {
          date_histogram: { field: 'timestamp', calendar_interval: '1h' },
          aggs: { unique_apps: { cardinality: { field: 'app_id' } } }
        }
      }
    }
  });

  const aggs = result.aggregations as Record<string, unknown>;
  const hourBuckets = (aggs.by_hour as { buckets: Array<{ key_as_string: string; doc_count: number; unique_apps: { value: number } }> })?.buckets || [];

  return {
    date,
    errorType,
    hourly_stats: hourBuckets.map(b => ({
      hour: new Date(b.key_as_string).getUTCHours(),
      errors: b.doc_count,
      apps: b.unique_apps.value
    }))
  };
}

export async function getClientErrorStats(startDate?: string, endDate?: string) {
  const filter = buildDateFilter(startDate, endDate);
  const query = filter ? { bool: { filter: [filter] } } : { match_all: {} };

  const result = await writeClient.search({
    index: INDICES.CLIENT_ERRORS,
    size: 0,
    body: {
      query,
      aggs: {
        by_day: {
          date_histogram: { field: 'timestamp', calendar_interval: '1d' },
          aggs: { unique_apps: { cardinality: { field: 'app_id' } } }
        }
      }
    }
  });

  const aggs = result.aggregations as Record<string, unknown>;
  const dayBuckets = (aggs.by_day as { buckets: Array<{ key_as_string: string; doc_count: number; unique_apps: { value: number } }> })?.buckets || [];

  return {
    total: dayBuckets.reduce((sum, b) => sum + b.doc_count, 0),
    daily_stats: dayBuckets.map(b => ({
      date: b.key_as_string,
      errors: b.doc_count,
      apps: b.unique_apps.value
    }))
  };
}

export async function getHourlyClientErrorStats(date: string) {
  const startOfDay = new Date(date);
  startOfDay.setUTCHours(0, 0, 0, 0);
  const endOfDay = new Date(date);
  endOfDay.setUTCHours(23, 59, 59, 999);

  const result = await writeClient.search({
    index: INDICES.CLIENT_ERRORS,
    size: 0,
    body: {
      query: {
        bool: {
          filter: [
            { range: { timestamp: { gte: startOfDay.toISOString(), lte: endOfDay.toISOString() } } }
          ]
        }
      },
      aggs: {
        by_hour: {
          date_histogram: { field: 'timestamp', calendar_interval: '1h' },
          aggs: { unique_apps: { cardinality: { field: 'app_id' } } }
        }
      }
    }
  });

  const aggs = result.aggregations as Record<string, unknown>;
  const hourBuckets = (aggs.by_hour as { buckets: Array<{ key_as_string: string; doc_count: number; unique_apps: { value: number } }> })?.buckets || [];

  return {
    date,
    hourly_stats: hourBuckets.map(b => ({
      hour: new Date(b.key_as_string).getUTCHours(),
      errors: b.doc_count,
      apps: b.unique_apps.value
    }))
  };
}

export async function getRollingHourlyClientErrors() {
  const now = new Date();
  const past24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const result = await writeClient.search({
    index: INDICES.CLIENT_ERRORS,
    size: 0,
    body: {
      query: {
        bool: {
          filter: [
            { range: { timestamp: { gte: past24h.toISOString(), lte: now.toISOString() } } }
          ]
        }
      },
      aggs: {
        by_hour: {
          date_histogram: { field: 'timestamp', fixed_interval: '1h' },
          aggs: { unique_apps: { cardinality: { field: 'app_id' } } }
        }
      }
    }
  });

  const aggs = result.aggregations as Record<string, unknown>;
  const hourBuckets = (aggs.by_hour as { buckets: Array<{ key_as_string: string; doc_count: number; unique_apps: { value: number } }> })?.buckets || [];

  // Convert to hoursAgo format to match other rolling 24h endpoints
  const nowHour = now.getTime();
  return {
    start: past24h.toISOString(),
    end: now.toISOString(),
    hourly_stats: hourBuckets.map(b => {
      const bucketTime = new Date(b.key_as_string).getTime();
      const hoursAgo = Math.floor((nowHour - bucketTime) / (60 * 60 * 1000));
      return {
        hoursAgo,
        timestamp: b.key_as_string,
        errors: b.doc_count,
        apps: b.unique_apps.value
      };
    })
  };
}

export async function getSummarizationStats(startDate?: string, endDate?: string) {
  const filter = buildDateFilter(startDate, endDate);
  const query = filter ? { bool: { filter: [filter] } } : { match_all: {} };

  const result = await writeClient.search({
    index: INDICES.SUMMARIZATIONS,
    size: 0,
    track_total_hits: true,
    body: {
      query,
      aggs: {
        by_day: {
          date_histogram: { field: 'timestamp', calendar_interval: '1d' },
          aggs: {
            unique_apps: { cardinality: { field: 'app_id' } },
            successful: { filter: { term: { success: true } } },
            failed: { filter: { term: { success: false } } }
          }
        }
      }
    }
  });

  const aggs = result.aggregations as Record<string, unknown>;
  const dayBuckets = (aggs.by_day as { buckets: Array<{ key_as_string: string; doc_count: number; unique_apps: { value: number }; successful: { doc_count: number }; failed: { doc_count: number } }> })?.buckets || [];

  // Sum from aggregations for accurate total (avoids track_total_hits issues)
  const totalFromAggs = dayBuckets.reduce((sum, b) => sum + b.doc_count, 0);

  return {
    total: totalFromAggs,
    daily_stats: dayBuckets.map(b => ({
      date: b.key_as_string,
      total: b.doc_count,
      successful: b.successful.doc_count,
      failed: b.failed.doc_count,
      apps: b.unique_apps.value
    }))
  };
}

export async function getHourlySummarizationStats(date: string) {
  const startOfDay = new Date(date);
  startOfDay.setUTCHours(0, 0, 0, 0);
  const endOfDay = new Date(date);
  endOfDay.setUTCHours(23, 59, 59, 999);

  const result = await writeClient.search({
    index: INDICES.SUMMARIZATIONS,
    size: 0,
    body: {
      query: {
        bool: {
          filter: [
            { range: { timestamp: { gte: startOfDay.toISOString(), lte: endOfDay.toISOString() } } }
          ]
        }
      },
      aggs: {
        by_hour: {
          date_histogram: { field: 'timestamp', calendar_interval: '1h' },
          aggs: {
            unique_apps: { cardinality: { field: 'app_id' } },
            successful: { filter: { term: { success: true } } },
            failed: { filter: { term: { success: false } } }
          }
        }
      }
    }
  });

  const aggs = result.aggregations as Record<string, unknown>;
  const hourBuckets = (aggs.by_hour as { buckets: Array<{ key_as_string: string; doc_count: number; unique_apps: { value: number }; successful: { doc_count: number }; failed: { doc_count: number } }> })?.buckets || [];

  return {
    date,
    hourly_stats: hourBuckets.map(b => ({
      hour: new Date(b.key_as_string).getUTCHours(),
      total: b.doc_count,
      successful: b.successful.doc_count,
      failed: b.failed.doc_count,
      apps: b.unique_apps.value
    }))
  };
}

export async function getRollingHourlySummarizations() {
  const now = new Date();
  const start = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const result = await writeClient.search({
    index: INDICES.SUMMARIZATIONS,
    size: 0,
    body: {
      query: {
        bool: {
          filter: [{ range: { timestamp: { gte: start.toISOString(), lte: now.toISOString() } } }]
        }
      },
      aggs: {
        by_hour: {
          date_histogram: { field: 'timestamp', fixed_interval: '1h' },
          aggs: {
            unique_apps: { cardinality: { field: 'app_id' } },
            successful: { filter: { term: { success: true } } },
            failed: { filter: { term: { success: false } } }
          }
        }
      }
    }
  });

  const aggs = result.aggregations as Record<string, unknown>;
  const hourBuckets = (aggs.by_hour as { buckets: Array<{ key_as_string: string; doc_count: number; unique_apps: { value: number }; successful: { doc_count: number }; failed: { doc_count: number } }> })?.buckets || [];

  // Build a map of hours ago to stats
  const statsMap = new Map<number, { total: number; successful: number; failed: number; apps: number; timestamp: string }>();
  for (const b of hourBuckets) {
    const bucketTime = new Date(b.key_as_string);
    const hoursAgo = Math.floor((now.getTime() - bucketTime.getTime()) / (60 * 60 * 1000));
    if (hoursAgo >= 0 && hoursAgo < 24) {
      statsMap.set(hoursAgo, {
        total: b.doc_count,
        successful: b.successful.doc_count,
        failed: b.failed.doc_count,
        apps: b.unique_apps.value,
        timestamp: b.key_as_string
      });
    }
  }

  return {
    start: start.toISOString(),
    end: now.toISOString(),
    hourly_stats: Array.from({ length: 24 }, (_, i) => {
      const hoursAgo = i;
      const stat = statsMap.get(hoursAgo);
      return {
        hoursAgo,
        timestamp: stat?.timestamp || '',
        total: stat?.total || 0,
        successful: stat?.successful || 0,
        failed: stat?.failed || 0,
        apps: stat?.apps || 0
      };
    })
  };
}

// Publish event stats
export async function getPublishStats(startDate: string, endDate: string) {
  const result = await writeClient.search({
    index: INDICES.PUBLISH_EVENTS,
    size: 0,
    body: {
      query: {
        bool: {
          filter: [{ range: { timestamp: { gte: startDate, lte: endDate } } }]
        }
      },
      aggs: {
        by_day: {
          date_histogram: { field: 'timestamp', calendar_interval: 'day' },
          aggs: {
            unique_apps: { cardinality: { field: 'app_id' } },
            begins: { filter: { term: { event_type: 'begin' } } },
            successes: { filter: { term: { event_type: 'success' } } },
            build_failed: { filter: { term: { event_type: 'build_failed' } } },
            archive_failed: { filter: { term: { event_type: 'archive_failed' } } }
          }
        }
      }
    }
  });

  const aggs = result.aggregations as Record<string, unknown>;
  const dayBuckets = (aggs.by_day as { buckets: Array<{
    key_as_string: string;
    doc_count: number;
    unique_apps: { value: number };
    begins: { doc_count: number };
    successes: { doc_count: number };
    build_failed: { doc_count: number };
    archive_failed: { doc_count: number };
  }> })?.buckets || [];

  let total = 0, successes = 0, failures = 0;
  const daily_stats = dayBuckets.map(b => {
    const daySuccesses = b.successes.doc_count;
    const dayFailures = b.build_failed.doc_count + b.archive_failed.doc_count;
    total += daySuccesses + dayFailures;
    successes += daySuccesses;
    failures += dayFailures;
    return {
      date: b.key_as_string,
      apps: b.unique_apps.value,
      begins: b.begins.doc_count,
      successes: daySuccesses,
      build_failed: b.build_failed.doc_count,
      archive_failed: b.archive_failed.doc_count,
      failures: dayFailures
    };
  });

  return { total, successes, failures, daily_stats };
}

export async function getHourlyPublishStats(date: string) {
  const startDate = new Date(date);
  startDate.setHours(0, 0, 0, 0);
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + 1);

  const result = await writeClient.search({
    index: INDICES.PUBLISH_EVENTS,
    size: 0,
    body: {
      query: {
        bool: {
          filter: [{ range: { timestamp: { gte: startDate.toISOString(), lt: endDate.toISOString() } } }]
        }
      },
      aggs: {
        by_hour: {
          date_histogram: { field: 'timestamp', fixed_interval: '1h' },
          aggs: {
            begins: { filter: { term: { event_type: 'begin' } } },
            successes: { filter: { term: { event_type: 'success' } } },
            build_failed: { filter: { term: { event_type: 'build_failed' } } },
            archive_failed: { filter: { term: { event_type: 'archive_failed' } } }
          }
        }
      }
    }
  });

  const aggs = result.aggregations as Record<string, unknown>;
  const hourBuckets = (aggs.by_hour as { buckets: Array<{
    key_as_string: string;
    begins: { doc_count: number };
    successes: { doc_count: number };
    build_failed: { doc_count: number };
    archive_failed: { doc_count: number };
  }> })?.buckets || [];

  return {
    date,
    hourly_stats: hourBuckets.map(b => ({
      hour: b.key_as_string,
      begins: b.begins.doc_count,
      successes: b.successes.doc_count,
      failures: b.build_failed.doc_count + b.archive_failed.doc_count
    }))
  };
}

export async function getRollingHourlyPublish() {
  const now = new Date();
  const start = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const result = await writeClient.search({
    index: INDICES.PUBLISH_EVENTS,
    size: 0,
    body: {
      query: {
        bool: {
          filter: [{ range: { timestamp: { gte: start.toISOString(), lte: now.toISOString() } } }]
        }
      },
      aggs: {
        by_hour: {
          date_histogram: { field: 'timestamp', fixed_interval: '1h' },
          aggs: {
            begins: { filter: { term: { event_type: 'begin' } } },
            successes: { filter: { term: { event_type: 'success' } } },
            build_failed: { filter: { term: { event_type: 'build_failed' } } },
            archive_failed: { filter: { term: { event_type: 'archive_failed' } } }
          }
        }
      }
    }
  });

  const aggs = result.aggregations as Record<string, unknown>;
  const hourBuckets = (aggs.by_hour as { buckets: Array<{
    key_as_string: string;
    begins: { doc_count: number };
    successes: { doc_count: number };
    build_failed: { doc_count: number };
    archive_failed: { doc_count: number };
  }> })?.buckets || [];

  const statsMap = new Map<number, { begins: number; successes: number; failures: number; timestamp: string }>();
  for (const b of hourBuckets) {
    const bucketTime = new Date(b.key_as_string);
    const hoursAgo = Math.floor((now.getTime() - bucketTime.getTime()) / (60 * 60 * 1000));
    if (hoursAgo >= 0 && hoursAgo < 24) {
      statsMap.set(hoursAgo, {
        begins: b.begins.doc_count,
        successes: b.successes.doc_count,
        failures: b.build_failed.doc_count + b.archive_failed.doc_count,
        timestamp: b.key_as_string
      });
    }
  }

  return {
    start: start.toISOString(),
    end: now.toISOString(),
    hourly_stats: Array.from({ length: 24 }, (_, i) => {
      const stat = statsMap.get(i);
      return {
        hoursAgo: i,
        timestamp: stat?.timestamp || '',
        begins: stat?.begins || 0,
        successes: stat?.successes || 0,
        failures: stat?.failures || 0
      };
    })
  };
}

// Helper to scroll through documents for an app with a safety limit
const MAX_SCROLL_DOCS = 10000;

async function scrollAllDocs(index: string, query: Record<string, unknown>, maxDocs = MAX_SCROLL_DOCS): Promise<Array<Record<string, unknown>>> {
  const allDocs: Array<Record<string, unknown>> = [];
  const response = await writeClient.search({
    index,
    scroll: '1m',
    size: 1000,
    body: { query, sort: [{ timestamp: 'desc' }] }
  });

  let scrollId = response._scroll_id;
  allDocs.push(...response.hits.hits.map(h => h._source as Record<string, unknown>));

  while (response.hits.hits.length > 0 && allDocs.length < maxDocs) {
    const scrollResponse = await writeClient.scroll({ scroll_id: scrollId, scroll: '1m' });
    if (scrollResponse.hits.hits.length === 0) break;
    allDocs.push(...scrollResponse.hits.hits.map(h => h._source as Record<string, unknown>));
    scrollId = scrollResponse._scroll_id;
  }

  if (scrollId) {
    try {
      await writeClient.clearScroll({ scroll_id: scrollId });
    } catch (err) {
      console.warn('es.scroll.clear.failed', { index, error: String(err) });
    }
  }

  if (allDocs.length >= maxDocs) {
    console.warn('es.scroll.limit.reached', { index, maxDocs, actualDocs: allDocs.length });
  }

  return allDocs;
}

export async function getAppDetails(appId: string) {
  const appFilter = { term: { app_id: appId } };

  // Get aggregations for runs (still need aggs)
  const runsAggResult = await writeClient.search({
    index: INDICES.AGENT_RUNS,
    size: 0,
    body: {
      query: appFilter,
      aggs: {
        total_input_tokens: { sum: { field: 'input_tokens' } },
        total_output_tokens: { sum: { field: 'output_tokens' } },
        total_steps: { sum: { field: 'steps' } },
        total_cost: { sum: { field: 'cost' } },
        agent_breakdown: {
          terms: { field: 'agent_id', size: 50 },
          aggs: {
            input_tokens: { sum: { field: 'input_tokens' } },
            output_tokens: { sum: { field: 'output_tokens' } },
            steps: { sum: { field: 'steps' } },
            cost: { sum: { field: 'cost' } }
          }
        }
      }
    }
  });

  const runsAggs = runsAggResult.aggregations as Record<string, unknown>;
  const runCount = (runsAggResult.hits.total as { value: number }).value;

  const compResult = await writeClient.search({
    index: INDICES.COMPRESSIONS,
    size: 0,
    body: {
      query: appFilter,
      aggs: {
        total_saved: { sum: { field: 'saved_bytes' } },
        avg_ratio: { avg: { field: 'compression_ratio' } }
      }
    }
  });

  const sumAggResult = await writeClient.search({
    index: INDICES.SUMMARIZATIONS,
    size: 0,
    body: {
      query: appFilter,
      aggs: {
        successful: { filter: { term: { success: true } } },
        failed: { filter: { term: { success: false } } },
        avg_ratio: { avg: { field: 'compression_ratio' } }
      }
    }
  });

  // Scroll through all documents for timeline (parallel fetches)
  const [runsDocs, errorsDocs, sumDocs, compDocs, convDocs, publishDocs, clientErrorDocs] = await Promise.all([
    scrollAllDocs(INDICES.AGENT_RUNS, appFilter),
    scrollAllDocs(INDICES.ERRORS, appFilter),
    scrollAllDocs(INDICES.SUMMARIZATIONS, appFilter),
    scrollAllDocs(INDICES.COMPRESSIONS, appFilter),
    scrollAllDocs(INDICES.CONVERSATIONS, appFilter),
    scrollAllDocs(INDICES.PUBLISH_EVENTS, appFilter),
    scrollAllDocs(INDICES.CLIENT_ERRORS, appFilter)
  ]);

  const agentBuckets = (runsAggs.agent_breakdown as { buckets: Array<{ key: string; doc_count: number; input_tokens: { value: number }; output_tokens: { value: number }; steps: { value: number }; cost: { value: number } }> }).buckets;
  const compAggs = compResult.aggregations as Record<string, { value: number }>;
  const sumAggs = sumAggResult.aggregations as Record<string, { doc_count?: number; value?: number }>;

  // Build timeline from all documents
  type TimelineEntry = { timestamp: string; type: string; detail?: string; steps?: number; input_tokens?: number; output_tokens?: number; cost?: number; extra_info?: string };
  const timeline: TimelineEntry[] = [];

  // Add runs
  for (const s of runsDocs) {
    timeline.push({
      timestamp: s.timestamp as string,
      type: 'run',
      detail: s.agent_id as string,
      steps: s.steps as number,
      input_tokens: s.input_tokens as number,
      output_tokens: s.output_tokens as number,
      cost: s.cost as number
    });
  }

  // Add errors
  for (const s of errorsDocs) {
    timeline.push({
      timestamp: s.timestamp as string,
      type: 'error',
      detail: s.event_type as string,
      extra_info: s.error_message as string
    });
  }

  // Add summarizations
  for (const s of sumDocs) {
    timeline.push({
      timestamp: s.timestamp as string,
      type: 'summarization',
      detail: s.success ? 'success' : 'failed',
      input_tokens: s.original_tokens as number,
      output_tokens: s.summary_tokens as number,
      cost: s.compression_ratio as number,
      extra_info: s.error_message as string
    });
  }

  // Add compressions
  for (const s of compDocs) {
    timeline.push({
      timestamp: s.timestamp as string,
      type: 'compression',
      input_tokens: s.original_bytes as number,
      output_tokens: s.compressed_bytes as number,
      cost: s.compression_ratio as number
    });
  }

  // Add conversations
  for (const s of convDocs) {
    timeline.push({
      timestamp: s.timestamp as string,
      type: 'conversation',
      detail: s.event_type as string,
      input_tokens: s.processed_messages as number,
      output_tokens: s.dropped_messages as number,
      extra_info: s.socket_id as string
    });
  }

  // Add publish events
  for (const s of publishDocs) {
    timeline.push({
      timestamp: s.timestamp as string,
      type: 'publish',
      detail: s.event_type as string,
      extra_info: s.commit_hash as string || s.error_message as string
    });
  }

  // Add client errors (from Katana logs)
  for (const s of clientErrorDocs) {
    timeline.push({
      timestamp: s.timestamp as string,
      type: 'client_error',
      detail: s.event_type as string,
      extra_info: s.error_message as string
    });
  }

  // Sort timeline by timestamp descending
  timeline.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  return {
    app_id: appId,
    run_count: runCount,
    total_input_tokens: (runsAggs.total_input_tokens as { value: number }).value,
    total_output_tokens: (runsAggs.total_output_tokens as { value: number }).value,
    total_steps: (runsAggs.total_steps as { value: number }).value,
    total_cost: (runsAggs.total_cost as { value: number }).value,
    agent_breakdown: agentBuckets.map(b => ({
      agent_id: b.key,
      input_tokens: b.input_tokens.value,
      output_tokens: b.output_tokens.value,
      steps: b.steps.value,
      run_count: b.doc_count,
      cost: b.cost.value
    })),
    runs: runsDocs,
    timeline,
    tool_usage: [],
    compression_stats: {
      events: (compResult.hits.total as { value: number }).value,
      total_saved_bytes: compAggs.total_saved?.value || 0,
      avg_compression_ratio: compAggs.avg_ratio?.value || 0
    },
    summarization_stats: {
      total: sumDocs.length,
      successful: sumAggs.successful?.doc_count || 0,
      failed: sumAggs.failed?.doc_count || 0,
      avg_compression_ratio: sumAggs.avg_ratio?.value || 0
    },
    errors: errorsDocs
  };
}

// Helper to paginate through composite aggregation
async function getAllAppBucketsComposite(
  index: string,
  query: Record<string, unknown>,
  subAggs: Record<string, unknown>
): Promise<Array<{ key: { app_id: string }; doc_count: number; [k: string]: unknown }>> {
  const allBuckets: Array<{ key: { app_id: string }; doc_count: number; [k: string]: unknown }> = [];
  let afterKey: { app_id: string } | undefined;
  let hasMore = true;

  while (hasMore) {
    const body: Record<string, unknown> = {
      query,
      aggs: {
        apps: {
          composite: {
            size: 5000,
            sources: [{ app_id: { terms: { field: 'app_id' } } }],
            ...(afterKey ? { after: afterKey } : {})
          },
          aggs: subAggs
        }
      }
    };

    const result = await writeClient.search({ index, size: 0, body });
    const agg = result.aggregations?.apps as { buckets: Array<{ key: { app_id: string }; doc_count: number; [k: string]: unknown }>; after_key?: { app_id: string } };

    if (!agg?.buckets?.length) break;
    allBuckets.push(...agg.buckets);

    hasMore = !!agg.after_key;
    if (hasMore) afterKey = agg.after_key;
  }

  return allBuckets;
}

// Simple composite for counts only
async function getAppCountsComposite(
  index: string,
  query?: Record<string, unknown>
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  let afterKey: { app_id: string } | undefined;
  let hasMore = true;

  while (hasMore) {
    const body: Record<string, unknown> = {
      ...(query ? { query } : {}),
      aggs: {
        apps: {
          composite: {
            size: 5000,
            sources: [{ app_id: { terms: { field: 'app_id' } } }],
            ...(afterKey ? { after: afterKey } : {})
          }
        }
      }
    };

    const result = await writeClient.search({ index, size: 0, body });
    const agg = result.aggregations?.apps as { buckets: Array<{ key: { app_id: string }; doc_count: number }>; after_key?: { app_id: string } };

    if (!agg?.buckets?.length) break;
    for (const b of agg.buckets) {
      counts.set(b.key.app_id, b.doc_count);
    }

    hasMore = !!agg.after_key;
    if (hasMore) afterKey = agg.after_key;
  }

  return counts;
}

export async function getAllApps(startDate?: string, endDate?: string) {
  const filter = buildDateFilter(startDate, endDate);
  const query = filter ? { bool: { filter: [filter] } } : { match_all: {} };

  // Use composite aggregation for unlimited pagination
  const appBuckets = await getAllAppBucketsComposite(INDICES.AGENT_RUNS, query, {
    cost: { sum: { field: 'cost' } },
    steps: { sum: { field: 'steps' } },
    input_tokens: { sum: { field: 'input_tokens' } },
    output_tokens: { sum: { field: 'output_tokens' } },
    first_event: { min: { field: 'timestamp' } },
    last_event: { max: { field: 'timestamp' } }
  });

  // Get counts from other indices with composite pagination
  const [sumMap, compMap, errMap, tokenLimitMap, budgetMap, wsErrorMap, publishMap, publishSuccessMap, publishFailedMap, clientErrorMap] = await Promise.all([
    getAppCountsComposite(INDICES.SUMMARIZATIONS),
    getAppCountsComposite(INDICES.COMPRESSIONS),
    getAppCountsComposite(INDICES.ERRORS),
    getAppCountsComposite(INDICES.CONVERSATIONS, { term: { event_type: 'token_limit_reached' } }),
    getAppCountsComposite(INDICES.CONVERSATIONS, { term: { event_type: 'budget_exceeded' } }),
    getAppCountsComposite(INDICES.ERRORS, { term: { event_type: 'websocket.conversation.error' } }),
    getAppCountsComposite(INDICES.PUBLISH_EVENTS, { term: { event_type: 'begin' } }),
    getAppCountsComposite(INDICES.PUBLISH_EVENTS, { term: { event_type: 'success' } }),
    getAppCountsComposite(INDICES.PUBLISH_EVENTS, { bool: { should: [{ term: { event_type: 'build_failed' } }, { term: { event_type: 'archive_failed' } }], minimum_should_match: 1 } }),
    getAppCountsComposite(INDICES.CLIENT_ERRORS)
  ]);

  // Map and sort by cost descending
  const apps = appBuckets.map(b => ({
    app_id: b.key.app_id,
    run_count: b.doc_count,
    total_steps: (b.steps as { value: number }).value,
    total_input_tokens: (b.input_tokens as { value: number }).value,
    total_output_tokens: (b.output_tokens as { value: number }).value,
    total_cost: (b.cost as { value: number }).value,
    first_event: (b.first_event as { value_as_string: string }).value_as_string,
    last_event: (b.last_event as { value_as_string: string }).value_as_string,
    summarizations: sumMap.get(b.key.app_id) || 0,
    compressions: compMap.get(b.key.app_id) || 0,
    errors: errMap.get(b.key.app_id) || 0,
    token_limits: tokenLimitMap.get(b.key.app_id) || 0,
    budget_errors: budgetMap.get(b.key.app_id) || 0,
    ws_errors: wsErrorMap.get(b.key.app_id) || 0,
    publish_total: publishMap.get(b.key.app_id) || 0,
    publish_success: publishSuccessMap.get(b.key.app_id) || 0,
    publish_failed: publishFailedMap.get(b.key.app_id) || 0,
    client_errors: clientErrorMap.get(b.key.app_id) || 0
  }));

  // Sort by cost descending
  apps.sort((a, b) => b.total_cost - a.total_cost);

  return apps;
}

export async function getToolStats(_startDate?: string, _endDate?: string) {
  // TOOL_EXECUTIONS index removed - returning empty array
  return [] as Array<{ tool_name: string; count: number; apps: number }>;
}

export async function getHealthMetrics() {
  const errorRate = await writeClient.search({
    index: INDICES.ERRORS,
    size: 0,
    body: {
      aggs: {
        by_hour: { date_histogram: { field: 'timestamp', calendar_interval: '1h' } }
      }
    }
  });

  const tokenLimits = await writeClient.search({
    index: INDICES.CONVERSATIONS,
    size: 0,
    body: {
      query: { term: { event_type: 'token_limit_reached' } },
      aggs: { by_day: { date_histogram: { field: 'timestamp', calendar_interval: '1d' } } }
    }
  });

  const sumStats = await writeClient.search({
    index: INDICES.SUMMARIZATIONS,
    size: 0,
    body: {
      aggs: { failed: { filter: { term: { success: false } } } }
    }
  });

  const errorBuckets = (errorRate.aggregations?.by_hour as { buckets: Array<{ key_as_string: string; doc_count: number }> })?.buckets || [];
  const tokenBuckets = (tokenLimits.aggregations?.by_day as { buckets: Array<{ key_as_string: string; doc_count: number }> })?.buckets || [];
  const sumTotal = (sumStats.hits.total as { value: number }).value;
  const sumFailed = (sumStats.aggregations?.failed as { doc_count: number })?.doc_count || 0;

  return {
    error_rate_by_hour: errorBuckets.slice(-24).map(b => ({ hour: b.key_as_string, errors: b.doc_count })),
    token_limits_by_day: tokenBuckets.slice(-7).map(b => ({ day: b.key_as_string, count: b.doc_count })),
    summarization_failure_rate: sumTotal > 0 ? (sumFailed / sumTotal * 100).toFixed(1) : '0'
  };
}

export async function init() {
  await initIndices();
}

// Diagnostic function to check index health and data coverage
export async function getDiagnostics() {
  const results: Record<string, {
    exists: boolean;
    docCount: number;
    oldestDoc: string | null;
    newestDoc: string | null;
    error?: string;
  }> = {};

  for (const [name, indexName] of Object.entries(INDICES)) {
    try {
      const exists = await writeClient.indices.exists({ index: indexName });
      if (!exists) {
        results[name] = { exists: false, docCount: 0, oldestDoc: null, newestDoc: null };
        continue;
      }

      const countResult = await writeClient.count({ index: indexName });
      const docCount = countResult.count;

      let oldestDoc: string | null = null;
      let newestDoc: string | null = null;

      if (docCount > 0) {
        const [oldestResult, newestResult] = await Promise.all([
          writeClient.search({
            index: indexName,
            size: 1,
            body: { sort: [{ timestamp: 'asc' }], _source: ['timestamp'] }
          }),
          writeClient.search({
            index: indexName,
            size: 1,
            body: { sort: [{ timestamp: 'desc' }], _source: ['timestamp'] }
          })
        ]);

        if (oldestResult.hits.hits[0]) {
          oldestDoc = (oldestResult.hits.hits[0]._source as { timestamp: string }).timestamp;
        }
        if (newestResult.hits.hits[0]) {
          newestDoc = (newestResult.hits.hits[0]._source as { timestamp: string }).timestamp;
        }
      }

      results[name] = { exists: true, docCount, oldestDoc, newestDoc };
    } catch (error) {
      results[name] = {
        exists: false,
        docCount: 0,
        oldestDoc: null,
        newestDoc: null,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  return {
    indices: results,
    writeEndpoint: process.env.AIRO_BUILDER_ES_ENDPOINT ? 'configured' : 'missing',
    sourceEndpoint: process.env.PIONEER_ES_ENDPOINT ? 'configured' : 'missing'
  };
}

/**
 * Fast errors-only fetch for an app
 * Groups duplicate errors and returns with counts
 * @param fromTimestamp - Only include errors from this timestamp onwards
 */
export async function getAppErrors(appId: string, fromTimestamp?: string) {
  // Build filter with optional timestamp range
  const filters: Record<string, unknown>[] = [{ term: { app_id: appId } }];
  if (fromTimestamp) {
    filters.push({ range: { timestamp: { gte: fromTimestamp } } });
  }
  const appFilter: Record<string, unknown> = filters.length === 1 ? filters[0] : { bool: { must: filters } };

  // Fetch errors and client errors in parallel
  const [errorsDocs, clientErrorsDocs] = await Promise.all([
    scrollAllDocs(INDICES.ERRORS, appFilter),
    scrollAllDocs(INDICES.CLIENT_ERRORS, appFilter)
  ]);

  interface ErrorEntry {
    timestamp: string;
    type: 'error' | 'client_error';
    message: string;
    eventType?: string;
    count: number;
    firstSeen: string;
    lastSeen: string;
  }

  // Group errors by message to dedupe
  const errorMap = new Map<string, ErrorEntry>();

  for (const doc of errorsDocs) {
    const message = (doc.error_message as string) || 'Unknown error';
    const timestamp = doc.timestamp as string;
    const key = `error:${message}`;

    if (errorMap.has(key)) {
      const existing = errorMap.get(key)!;
      existing.count++;
      if (timestamp < existing.firstSeen) existing.firstSeen = timestamp;
      if (timestamp > existing.lastSeen) existing.lastSeen = timestamp;
    } else {
      errorMap.set(key, {
        timestamp,
        type: 'error',
        message,
        eventType: doc.event_type as string,
        count: 1,
        firstSeen: timestamp,
        lastSeen: timestamp
      });
    }
  }

  for (const doc of clientErrorsDocs) {
    const message = (doc.error_message as string) || (doc.error_type as string) || 'Unknown client error';
    const timestamp = doc.timestamp as string;
    const key = `client:${message}`;

    if (errorMap.has(key)) {
      const existing = errorMap.get(key)!;
      existing.count++;
      if (timestamp < existing.firstSeen) existing.firstSeen = timestamp;
      if (timestamp > existing.lastSeen) existing.lastSeen = timestamp;
    } else {
      errorMap.set(key, {
        timestamp,
        type: 'client_error',
        message,
        eventType: doc.error_type as string,
        count: 1,
        firstSeen: timestamp,
        lastSeen: timestamp
      });
    }
  }

  // Convert to array and sort by lastSeen (most recent first)
  const errors = Array.from(errorMap.values())
    .sort((a, b) => new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime());

  return {
    errors,
    totalErrors: errorsDocs.length,
    totalClientErrors: clientErrorsDocs.length,
    uniqueErrors: errors.length
  };
}

export { INDICES };