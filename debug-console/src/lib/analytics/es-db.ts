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

export function insertToolExecution(tool: {
  es_id: string;
  timestamp: string;
  app_id: string;
  agent_id?: string;
  tool_name: string;
}) {
  pendingDocs.push({
    index: INDICES.TOOL_EXECUTIONS,
    id: tool.es_id,
    doc: {
      es_id: tool.es_id,
      timestamp: tool.timestamp,
      app_id: tool.app_id,
      agent_id: tool.agent_id || null,
      tool_name: tool.tool_name
    }
  });
}

export function insertLlmCall(call: {
  es_id: string;
  timestamp: string;
  app_id: string;
  agent_id?: string;
  model?: string;
  provider?: string;
  duration_ms?: number;
  input_tokens?: number;
  output_tokens?: number;
  finish_reason?: string;
  tool_call_count?: number;
}) {
  pendingDocs.push({
    index: INDICES.LLM_CALLS,
    id: call.es_id,
    doc: {
      es_id: call.es_id,
      timestamp: call.timestamp,
      app_id: call.app_id,
      agent_id: call.agent_id || null,
      model: call.model || null,
      provider: call.provider || null,
      duration_ms: call.duration_ms || 0,
      input_tokens: call.input_tokens || 0,
      output_tokens: call.output_tokens || 0,
      finish_reason: call.finish_reason || null,
      tool_call_count: call.tool_call_count || 0
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

export function insertModelSelection(selection: {
  es_id: string;
  timestamp: string;
  app_id: string;
  model: string;
  provider?: string;
}) {
  pendingDocs.push({
    index: INDICES.MODEL_SELECTIONS,
    id: selection.es_id,
    doc: {
      es_id: selection.es_id,
      timestamp: selection.timestamp,
      app_id: selection.app_id,
      model: selection.model,
      provider: selection.provider || null
    }
  });
}

export function insertCommandExecution(cmd: {
  es_id: string;
  timestamp: string;
  app_id: string;
  command?: string;
  success: boolean;
  duration_ms?: number;
  exit_code?: number;
}) {
  pendingDocs.push({
    index: INDICES.COMMAND_EXECUTIONS,
    id: cmd.es_id,
    doc: {
      es_id: cmd.es_id,
      timestamp: cmd.timestamp,
      app_id: cmd.app_id,
      command: cmd.command || null,
      success: cmd.success,
      duration_ms: cmd.duration_ms || 0,
      exit_code: cmd.exit_code || null
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
            cost: { sum: { field: 'cost' } }
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
  const dayBuckets = (aggs.apps_by_day as { buckets: Array<{ key_as_string: string; unique_apps: { value: number }; cost: { value: number } }> })?.buckets || [];
  const numDays = dayBuckets.length || 1;
  const appsPerDay = totalApps / numDays;

  const dailyStats = dayBuckets.map(b => ({
    date: b.key_as_string,
    apps: b.unique_apps.value,
    cost: b.cost.value,
    avg_cost_per_app: b.unique_apps.value > 0 ? b.cost.value / b.unique_apps.value : 0
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

// Helper to scroll through all documents for an app
async function scrollAllDocs(index: string, query: Record<string, unknown>): Promise<Array<Record<string, unknown>>> {
  const allDocs: Array<Record<string, unknown>> = [];
  const response = await writeClient.search({
    index,
    scroll: '1m',
    size: 1000,
    body: { query, sort: [{ timestamp: 'desc' }] }
  });

  let scrollId = response._scroll_id;
  allDocs.push(...response.hits.hits.map(h => h._source as Record<string, unknown>));

  while (response.hits.hits.length > 0) {
    const scrollResponse = await writeClient.scroll({ scroll_id: scrollId, scroll: '1m' });
    if (scrollResponse.hits.hits.length === 0) break;
    allDocs.push(...scrollResponse.hits.hits.map(h => h._source as Record<string, unknown>));
    scrollId = scrollResponse._scroll_id;
  }

  if (scrollId) {
    try { await writeClient.clearScroll({ scroll_id: scrollId }); } catch { /* ignore */ }
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

  const toolResult = await writeClient.search({
    index: INDICES.TOOL_EXECUTIONS,
    size: 0,
    body: {
      query: appFilter,
      aggs: {
        by_tool: { terms: { field: 'tool_name', size: 100 } }
      }
    }
  });

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
  const [runsDocs, errorsDocs, sumDocs, compDocs, toolDocs, convDocs] = await Promise.all([
    scrollAllDocs(INDICES.AGENT_RUNS, appFilter),
    scrollAllDocs(INDICES.ERRORS, appFilter),
    scrollAllDocs(INDICES.SUMMARIZATIONS, appFilter),
    scrollAllDocs(INDICES.COMPRESSIONS, appFilter),
    scrollAllDocs(INDICES.TOOL_EXECUTIONS, appFilter),
    scrollAllDocs(INDICES.CONVERSATIONS, appFilter)
  ]);

  const agentBuckets = (runsAggs.agent_breakdown as { buckets: Array<{ key: string; doc_count: number; input_tokens: { value: number }; output_tokens: { value: number }; steps: { value: number }; cost: { value: number } }> }).buckets;
  const toolBuckets = (toolResult.aggregations?.by_tool as { buckets: Array<{ key: string; doc_count: number }> })?.buckets || [];
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

  // Add tool executions
  for (const s of toolDocs) {
    timeline.push({
      timestamp: s.timestamp as string,
      type: 'tool',
      detail: s.tool_name as string,
      extra_info: s.agent_id as string
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
    tool_usage: toolBuckets.map(b => ({ tool_name: b.key, count: b.doc_count })),
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

  while (true) {
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

    if (!agg.after_key) break;
    afterKey = agg.after_key;
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

  while (true) {
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

    if (!agg.after_key) break;
    afterKey = agg.after_key;
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
  const [sumMap, compMap, errMap, tokenLimitMap, budgetMap] = await Promise.all([
    getAppCountsComposite(INDICES.SUMMARIZATIONS),
    getAppCountsComposite(INDICES.COMPRESSIONS),
    getAppCountsComposite(INDICES.ERRORS),
    getAppCountsComposite(INDICES.CONVERSATIONS, { term: { event_type: 'token_limit_reached' } }),
    getAppCountsComposite(INDICES.CONVERSATIONS, { term: { event_type: 'budget_exceeded' } })
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
    budget_errors: budgetMap.get(b.key.app_id) || 0
  }));

  // Sort by cost descending
  apps.sort((a, b) => b.total_cost - a.total_cost);

  return apps;
}

export async function getToolStats(startDate?: string, endDate?: string) {
  const filter = buildDateFilter(startDate, endDate);
  const query = filter ? { bool: { filter: [filter] } } : { match_all: {} };

  const result = await writeClient.search({
    index: INDICES.TOOL_EXECUTIONS,
    size: 0,
    body: {
      query,
      aggs: {
        by_tool: {
          terms: { field: 'tool_name', size: 100 },
          aggs: { apps: { cardinality: { field: 'app_id' } } }
        }
      }
    }
  });

  const buckets = (result.aggregations?.by_tool as { buckets: Array<{ key: string; doc_count: number; apps: { value: number } }> })?.buckets || [];
  return buckets.map(b => ({ tool_name: b.key, count: b.doc_count, apps: b.apps.value }));
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

// Get max timestamp from all indices (for scheduler)
export async function getMaxTimestamp(): Promise<Date | null> {
  const maxTimestamps = await Promise.all(Object.values(INDICES).map(async (indexName) => {
    try {
      const response = await writeClient.search({
        index: indexName,
        size: 1,
        body: {
          sort: [{ timestamp: 'desc' }],
          _source: ['timestamp']
        }
      });
      if (response.hits.hits.length > 0) {
        return new Date((response.hits.hits[0]._source as { timestamp: string }).timestamp);
      }
    } catch {
      // Index might not exist
    }
    return null;
  }));

  return maxTimestamps.reduce((latest, current) => {
    if (!latest) return current;
    if (!current) return latest;
    return current > latest ? current : latest;
  }, null);
}

export async function init() {
  await initIndices();
}

export { INDICES };

