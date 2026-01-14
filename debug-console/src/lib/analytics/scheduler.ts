import { sourceClient, SOURCE_INDEX_NAME, INDICES, writeClient } from './es-client';
import {
  init,
  insertRun,
  insertToolExecution,
  insertLlmCall,
  insertCompression,
  insertError,
  insertConversation,
  insertSummarization,
  insertToolFailure,
  insertModelSelection,
  insertCommandExecution,
  insertPublishEvent,
  insertClientError,
  flushPendingDocs
} from './es-db';

// Pioneer events to fetch
const PIONEER_EVENTS = [
  'agent.run.finish',
  'agent.step.finish',
  'develop_agent.tool.execution.complete',
  'observability.llm.ended',
  'compression.batch.complete',
  'conversation.history.loader.token_limit_reached',
  'summarization.background.complete',
  'summarization.detailed_llm.failure',
  'summarization.detailed_llm.token_budget_exceeded',
  'knowb-driver.proxy.error',
  'websocket.conversation.error',
  'tool.file.edit.operation.failure',
  'tool.file.edit.batch.failure',
  'tool.git.operation.failure',
  'tool.image.search.failure',
  'tool.ast.edit.failure',
  'conversation.start',
  'conversation.continue',
  'model.provider.selected',
  'dev_supervisor.exec.success',
  'dev_supervisor.exec.failure',
  'route.publish.begin',
  'route.publish.success',
  'route.publish.build.failed',
  'route.publish.git-archive.failed'
];

// Katana client error events
const KATANA_ERROR_EVENTS = [
  'client.websocket.connection.error',
  'client.websocket.machine.stream.error',
  'client.websocket.client-action.publish.error',
  'client.paywall.eligibility.switchboard.check-failed',
  'client.paywall.eligibility.access-denied'
];

const KATANA_INDEX = '.ds-logs-gdelastic.katana.app-prod-ecs-*';

// Batch size for processing - smaller chunks = less memory
const SCROLL_BATCH_SIZE = 2000;
const FLUSH_THRESHOLD = 1000;

interface LogEntry {
  _id: string;
  timestamp: string;
  '@timestamp': string;
  event: string;
  app_id: string;
  agentId?: string;
  data: Record<string, unknown>;
}

interface KatanaLogEntry {
  _id: string;
  '@timestamp': string;
  event: string;
  level: string;
  message?: string;
  customerId?: string;
  data?: {
    appId?: string;
    siteId?: string;
    message?: string;
    error?: string;
    clientIp?: string;
    sessionId?: string;
    userAgent?: string;
    pageUrl?: string;
    conversationId?: string;
    retryable?: boolean;
    isTLA?: boolean;
  };
}

function safeNum(val: unknown): number {
  if (typeof val === 'number' && !isNaN(val)) return val;
  if (typeof val === 'string') {
    const n = parseInt(val, 10);
    if (!isNaN(n)) return n;
  }
  return 0;
}

// Process a single pioneer log entry - returns true if processed
function processPioneerLog(log: LogEntry): boolean {
  if (!log.app_id) return false;
  const event = log.event;

  switch (event) {
    case 'agent.run.finish': {
      const d = log.data as {
        agentName?: string;
        finishReason?: string;
        steps?: unknown;
        totalUsage?: { inputTokens?: unknown; outputTokens?: unknown; cachedInputTokens?: unknown };
      };
      if (!d.totalUsage) return false;
      const input = safeNum(d.totalUsage.inputTokens);
      const output = safeNum(d.totalUsage.outputTokens);
      if (input === 0 && output === 0) return false;
      insertRun({
        es_id: log._id,
        timestamp: log.timestamp,
        app_id: log.app_id,
        agent_id: log.agentId || 'unknown',
        agent_name: d.agentName,
        finish_reason: d.finishReason,
        steps: safeNum(d.steps),
        input_tokens: input,
        output_tokens: output,
        cached_input_tokens: safeNum(d.totalUsage.cachedInputTokens)
      });
      return true;
    }

    case 'agent.step.finish': {
      const d = log.data as {
        model?: string;
        provider?: string;
        inputTokens?: number;
        outputTokens?: number;
        finishReason?: string;
        toolCallCount?: number;
      };
      insertLlmCall({
        es_id: log._id,
        timestamp: log.timestamp,
        app_id: log.app_id,
        agent_id: log.agentId,
        model: d.model,
        provider: d.provider,
        input_tokens: d.inputTokens || 0,
        output_tokens: d.outputTokens || 0,
        finish_reason: d.finishReason,
        tool_call_count: d.toolCallCount || 0
      });
      return true;
    }

    case 'observability.llm.ended': {
      const d = log.data as {
        model?: string;
        provider?: string;
        durationMs?: number;
        finishReason?: string;
      };
      insertLlmCall({
        es_id: log._id,
        timestamp: log.timestamp,
        app_id: log.app_id,
        agent_id: log.agentId,
        model: d.model,
        provider: d.provider,
        duration_ms: d.durationMs || 0,
        finish_reason: d.finishReason
      });
      return true;
    }

    case 'develop_agent.tool.execution.complete': {
      const d = log.data as { toolName?: string };
      if (!d.toolName) return false;
      insertToolExecution({
        es_id: log._id,
        timestamp: log.timestamp,
        app_id: log.app_id,
        agent_id: log.agentId,
        tool_name: d.toolName
      });
      return true;
    }

    case 'compression.batch.complete': {
      const d = log.data as {
        totalMessages?: number;
        compressedMessages?: number;
        originalTotalLength?: number;
        compressedTotalLength?: number;
        compressionRatio?: number;
        savedBytes?: number;
        strategiesUsed?: Record<string, number>;
      };
      insertCompression({
        es_id: log._id,
        timestamp: log.timestamp,
        app_id: log.app_id,
        total_messages: d.totalMessages || 0,
        compressed_messages: d.compressedMessages || 0,
        original_bytes: d.originalTotalLength || 0,
        compressed_bytes: d.compressedTotalLength || 0,
        compression_ratio: d.compressionRatio || 0,
        saved_bytes: d.savedBytes || 0,
        strategies: d.strategiesUsed
      });
      return true;
    }

    case 'conversation.history.loader.token_limit_reached': {
      const d = log.data as { droppedMessages?: number; processedMessages?: number };
      insertConversation({
        es_id: log._id,
        timestamp: log.timestamp,
        app_id: log.app_id,
        agent_id: log.agentId,
        event_type: 'token_limit_reached',
        dropped_messages: d.droppedMessages || 0,
        processed_messages: d.processedMessages || 0
      });
      return true;
    }

    case 'summarization.background.complete': {
      const d = log.data as {
        originalTokens?: number;
        summaryTokens?: number;
        compressionRatio?: number;
      };
      insertSummarization({
        es_id: log._id,
        timestamp: log.timestamp,
        app_id: log.app_id,
        original_tokens: d.originalTokens || 0,
        summary_tokens: d.summaryTokens || 0,
        compression_ratio: d.compressionRatio || 0,
        success: true
      });
      return true;
    }

    case 'summarization.detailed_llm.failure': {
      const d = log.data as { error?: string; message?: string };
      insertSummarization({
        es_id: log._id,
        timestamp: log.timestamp,
        app_id: log.app_id,
        success: false,
        error_message: d.error || d.message
      });
      return true;
    }

    case 'summarization.detailed_llm.token_budget_exceeded': {
      const d = log.data as { message?: string };
      insertSummarization({
        es_id: log._id,
        timestamp: log.timestamp,
        app_id: log.app_id,
        success: false,
        error_message: d.message || 'Token budget exceeded'
      });
      return true;
    }

    case 'knowb-driver.proxy.error': {
      const d = log.data as { status?: number; error?: string };
      insertError({
        es_id: log._id,
        timestamp: log.timestamp,
        app_id: log.app_id,
        event_type: 'knowb-driver.proxy.error',
        status_code: d.status,
        error_message: d.error
      });
      return true;
    }

    case 'conversation.start':
    case 'conversation.continue': {
      const d = log.data as { socketId?: string };
      insertConversation({
        es_id: log._id,
        timestamp: log.timestamp,
        app_id: log.app_id,
        agent_id: log.agentId,
        event_type: event,
        socket_id: d.socketId
      });
      return true;
    }

    case 'websocket.conversation.error': {
      const d = log.data as { error?: string; socketId?: string };
      const isBudgetError = d.error?.toLowerCase().includes('budget');
      insertConversation({
        es_id: log._id,
        timestamp: log.timestamp,
        app_id: log.app_id,
        agent_id: log.agentId,
        event_type: isBudgetError ? 'budget_exceeded' : 'conversation_error',
        socket_id: d.socketId
      });
      insertError({
        es_id: log._id + '_err',
        timestamp: log.timestamp,
        app_id: log.app_id,
        event_type: isBudgetError ? 'budget_exceeded' : 'websocket.conversation.error',
        error_message: d.error
      });
      return true;
    }

    case 'tool.file.edit.operation.failure':
    case 'tool.file.edit.batch.failure': {
      const d = log.data as { filePath?: string; error?: string; message?: string };
      insertToolFailure({
        es_id: log._id,
        timestamp: log.timestamp,
        app_id: log.app_id,
        agent_id: log.agentId,
        tool_name: 'fileEdit',
        error_message: d.error || d.message,
        file_path: d.filePath
      });
      return true;
    }

    case 'tool.git.operation.failure': {
      const d = log.data as { error?: string };
      insertToolFailure({
        es_id: log._id,
        timestamp: log.timestamp,
        app_id: log.app_id,
        agent_id: log.agentId,
        tool_name: 'git',
        error_message: d.error
      });
      return true;
    }

    case 'tool.image.search.failure': {
      const d = log.data as { error?: string };
      insertToolFailure({
        es_id: log._id,
        timestamp: log.timestamp,
        app_id: log.app_id,
        agent_id: log.agentId,
        tool_name: 'imageSearch',
        error_message: d.error
      });
      return true;
    }

    case 'tool.ast.edit.failure': {
      const d = log.data as { filePath?: string; error?: string };
      insertToolFailure({
        es_id: log._id,
        timestamp: log.timestamp,
        app_id: log.app_id,
        agent_id: log.agentId,
        tool_name: 'astEdit',
        error_message: d.error,
        file_path: d.filePath
      });
      return true;
    }

    case 'model.provider.selected': {
      const d = log.data as { model?: string; provider?: string };
      if (!d.model) return false;
      insertModelSelection({
        es_id: log._id,
        timestamp: log.timestamp,
        app_id: log.app_id,
        model: d.model,
        provider: d.provider
      });
      return true;
    }

    case 'dev_supervisor.exec.success': {
      const d = log.data as { command?: string; durationMs?: number; exitCode?: number };
      insertCommandExecution({
        es_id: log._id,
        timestamp: log.timestamp,
        app_id: log.app_id,
        command: d.command,
        success: true,
        duration_ms: d.durationMs,
        exit_code: d.exitCode
      });
      return true;
    }

    case 'dev_supervisor.exec.failure': {
      const d = log.data as { command?: string; durationMs?: number; exitCode?: number };
      insertCommandExecution({
        es_id: log._id,
        timestamp: log.timestamp,
        app_id: log.app_id,
        command: d.command,
        success: false,
        duration_ms: d.durationMs,
        exit_code: d.exitCode
      });
      return true;
    }

    case 'route.publish.begin': {
      insertPublishEvent({
        es_id: log._id,
        timestamp: log.timestamp,
        app_id: log.app_id,
        event_type: 'begin',
        success: true
      });
      return true;
    }

    case 'route.publish.success': {
      const d = log.data as { commitHash?: string };
      insertPublishEvent({
        es_id: log._id,
        timestamp: log.timestamp,
        app_id: log.app_id,
        event_type: 'success',
        success: true,
        commit_hash: d.commitHash
      });
      return true;
    }

    case 'route.publish.build.failed': {
      const d = log.data as { stderr?: string; commitHash?: string };
      insertPublishEvent({
        es_id: log._id,
        timestamp: log.timestamp,
        app_id: log.app_id,
        event_type: 'build_failed',
        success: false,
        error_message: d.stderr?.slice(0, 2000),
        commit_hash: d.commitHash
      });
      return true;
    }

    case 'route.publish.git-archive.failed': {
      const d = log.data as { error?: string };
      insertPublishEvent({
        es_id: log._id,
        timestamp: log.timestamp,
        app_id: log.app_id,
        event_type: 'archive_failed',
        success: false,
        error_message: d.error?.slice(0, 2000)
      });
      return true;
    }

    default:
      return false;
  }
}

// Process Katana log entry
function processKatanaLog(log: KatanaLogEntry): boolean {
  const appId = log.data?.appId || log.data?.siteId;
  if (!appId) return false;

  insertClientError({
    es_id: log._id,
    timestamp: log['@timestamp'],
    app_id: appId,
    event_type: log.event,
    error_message: log.data?.error || log.data?.message || log.message,
    customer_id: log.customerId,
    session_id: log.data?.sessionId,
    client_ip: log.data?.clientIp,
    user_agent: log.data?.userAgent,
    page_url: log.data?.pageUrl,
    conversation_id: log.data?.conversationId,
    extra_data: {
      retryable: log.data?.retryable,
      isTLA: log.data?.isTLA
    }
  });
  return true;
}

// Streaming fetch with incremental processing - avoids loading all into memory
async function fetchAndProcessPioneerEvents(
  startTime: Date,
  endTime: Date,
  event: string,
  pendingCount: { value: number }
): Promise<number> {
  let scrollId: string | undefined;
  let processedCount = 0;

  const query = {
    size: SCROLL_BATCH_SIZE,
    _source: true,
    query: {
      bool: {
        must: [{ match: { 'event.keyword': event } }],
        filter: [{ range: { '@timestamp': { gte: startTime.toISOString(), lte: endTime.toISOString() } } }]
      }
    },
    sort: [{ '@timestamp': 'asc' }]
  };

  try {
    let response = await sourceClient.search({
      index: SOURCE_INDEX_NAME,
      scroll: '2m',
      body: query
    });

    scrollId = response._scroll_id;

    // Process first batch
    for (const hit of response.hits.hits) {
      const log = { _id: hit._id!, ...hit._source as Omit<LogEntry, '_id'> };
      if (processPioneerLog(log)) {
        processedCount++;
        pendingCount.value++;
      }
    }

    // Flush if threshold reached
    if (pendingCount.value >= FLUSH_THRESHOLD) {
      await flushPendingDocs();
      pendingCount.value = 0;
    }

    // Continue scrolling
    while (response.hits.hits.length > 0 && scrollId) {
      response = await sourceClient.scroll({
        scroll_id: scrollId,
        scroll: '2m'
      });
      scrollId = response._scroll_id;

      for (const hit of response.hits.hits) {
        const log = { _id: hit._id!, ...hit._source as Omit<LogEntry, '_id'> };
        if (processPioneerLog(log)) {
          processedCount++;
          pendingCount.value++;
        }
      }

      if (pendingCount.value >= FLUSH_THRESHOLD) {
        await flushPendingDocs();
        pendingCount.value = 0;
      }
    }
  } finally {
    if (scrollId) {
      await sourceClient.clearScroll({ scroll_id: scrollId }).catch(() => {});
    }
  }

  return processedCount;
}

// Streaming fetch for Katana logs
async function fetchAndProcessKatanaErrors(
  startTime: Date,
  endTime: Date,
  pendingCount: { value: number }
): Promise<number> {
  let scrollId: string | undefined;
  let processedCount = 0;

  const query = {
    size: SCROLL_BATCH_SIZE,
    query: {
      bool: {
        must: [
          { term: { level: 'error' } },
          { terms: { event: KATANA_ERROR_EVENTS } }
        ],
        filter: [
          { range: { '@timestamp': { gte: startTime.toISOString(), lte: endTime.toISOString() } } }
        ]
      }
    },
    sort: [{ '@timestamp': 'asc' }]
  };

  try {
    let response = await writeClient.search({
      index: KATANA_INDEX,
      scroll: '2m',
      body: query
    });

    scrollId = response._scroll_id;

    for (const hit of response.hits.hits) {
      const log = { _id: hit._id!, ...hit._source as Omit<KatanaLogEntry, '_id'> };
      if (processKatanaLog(log)) {
        processedCount++;
        pendingCount.value++;
      }
    }

    if (pendingCount.value >= FLUSH_THRESHOLD) {
      await flushPendingDocs();
      pendingCount.value = 0;
    }

    while (response.hits.hits.length > 0 && scrollId) {
      response = await writeClient.scroll({
        scroll_id: scrollId,
        scroll: '2m'
      });
      scrollId = response._scroll_id;

      for (const hit of response.hits.hits) {
        const log = { _id: hit._id!, ...hit._source as Omit<KatanaLogEntry, '_id'> };
        if (processKatanaLog(log)) {
          processedCount++;
          pendingCount.value++;
        }
      }

      if (pendingCount.value >= FLUSH_THRESHOLD) {
        await flushPendingDocs();
        pendingCount.value = 0;
      }
    }
  } catch (error) {
    console.error('[Scheduler] Katana fetch error:', error);
  } finally {
    if (scrollId) {
      await writeClient.clearScroll({ scroll_id: scrollId }).catch(() => {});
    }
  }

  return processedCount;
}

// Get min of max timestamps across all indices for backfill detection
async function getMinMaxTimestamp(): Promise<{ pioneer: Date | null; katana: Date | null }> {
  const DEFAULT_PIONEER_BACKFILL_DAYS = 30;
  const DEFAULT_KATANA_BACKFILL_DAYS = 7;

  // Pioneer indices (exclude CLIENT_ERRORS)
  const pioneerIndices = Object.values(INDICES).filter(i => i !== INDICES.CLIENT_ERRORS);
  let pioneerMinMax: Date | null = null;

  for (const index of pioneerIndices) {
    try {
      const result = await writeClient.search({
        index,
        size: 0,
        body: { aggs: { max_ts: { max: { field: 'timestamp' } } } }
      });
      const maxTs = (result.aggregations?.max_ts as { value_as_string?: string })?.value_as_string;
      if (maxTs) {
        const date = new Date(maxTs);
        if (!pioneerMinMax || date < pioneerMinMax) {
          pioneerMinMax = date;
        }
      } else {
        const backfillStart = new Date(Date.now() - DEFAULT_PIONEER_BACKFILL_DAYS * 24 * 60 * 60 * 1000);
        if (!pioneerMinMax || backfillStart < pioneerMinMax) {
          pioneerMinMax = backfillStart;
        }
      }
    } catch {
      const backfillStart = new Date(Date.now() - DEFAULT_PIONEER_BACKFILL_DAYS * 24 * 60 * 60 * 1000);
      if (!pioneerMinMax || backfillStart < pioneerMinMax) {
        pioneerMinMax = backfillStart;
      }
    }
  }

  // Katana (CLIENT_ERRORS only)
  let katanaMaxTs: Date | null = null;
  try {
    const result = await writeClient.search({
      index: INDICES.CLIENT_ERRORS,
      size: 0,
      body: { aggs: { max_ts: { max: { field: 'timestamp' } } } }
    });
    const maxTs = (result.aggregations?.max_ts as { value_as_string?: string })?.value_as_string;
    katanaMaxTs = maxTs ? new Date(maxTs) : new Date(Date.now() - DEFAULT_KATANA_BACKFILL_DAYS * 24 * 60 * 60 * 1000);
  } catch {
    katanaMaxTs = new Date(Date.now() - DEFAULT_KATANA_BACKFILL_DAYS * 24 * 60 * 60 * 1000);
  }

  return { pioneer: pioneerMinMax, katana: katanaMaxTs };
}

interface FetchResult {
  startTime: Date;
  endTime: Date;
  pioneerCounts: Record<string, number>;
  katanaCount: number;
}

export async function runFetch(): Promise<FetchResult> {
  await init();

  const endTime = new Date();
  const timestamps = await getMinMaxTimestamp();

  const pioneerStart = timestamps.pioneer || new Date(endTime.getTime() - 30 * 24 * 60 * 60 * 1000);
  const katanaStart = timestamps.katana || new Date(endTime.getTime() - 7 * 24 * 60 * 60 * 1000);

  const startTime = new Date(Math.min(pioneerStart.getTime(), katanaStart.getTime()));

  const pioneerCounts: Record<string, number> = {};
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;
  const pendingCount = { value: 0 };

  // Process in daily chunks
  let chunkStart = new Date(pioneerStart);
  while (chunkStart < endTime) {
    const chunkEnd = new Date(Math.min(chunkStart.getTime() + ONE_DAY_MS, endTime.getTime()));

    // Process each pioneer event type sequentially (memory efficient)
    for (const event of PIONEER_EVENTS) {
      const count = await fetchAndProcessPioneerEvents(chunkStart, chunkEnd, event, pendingCount);
      if (count > 0) {
        pioneerCounts[event] = (pioneerCounts[event] || 0) + count;
      }
    }

    chunkStart = chunkEnd;
  }

  // Process Katana logs
  let katanaCount = 0;
  chunkStart = new Date(katanaStart);
  while (chunkStart < endTime) {
    const chunkEnd = new Date(Math.min(chunkStart.getTime() + ONE_DAY_MS, endTime.getTime()));
    katanaCount += await fetchAndProcessKatanaErrors(chunkStart, chunkEnd, pendingCount);
    chunkStart = chunkEnd;
  }

  // Final flush
  if (pendingCount.value > 0) {
    await flushPendingDocs();
  }

  return { startTime, endTime, pioneerCounts, katanaCount };
}

let schedulerInterval: ReturnType<typeof setInterval> | null = null;
let isRunning = false;
let lastRun: FetchResult | null = null;

export function startScheduler(intervalMinutes = 15) {
  if (schedulerInterval) {
    console.log('[Scheduler] Already running');
    return;
  }

  const intervalMs = intervalMinutes * 60 * 1000;
  console.log(`[Scheduler] Starting with ${intervalMinutes} minute interval`);

  runScheduledFetch();
  schedulerInterval = setInterval(runScheduledFetch, intervalMs);
}

async function runScheduledFetch() {
  if (isRunning) {
    console.log('[Scheduler] Previous run still in progress, skipping');
    return;
  }

  isRunning = true;
  const startedAt = new Date();
  console.log(`[Scheduler] Starting fetch at ${startedAt.toISOString()}`);

  try {
    lastRun = await runFetch();
    const duration = Date.now() - startedAt.getTime();
    const totalPioneer = Object.values(lastRun.pioneerCounts).reduce((a, b) => a + b, 0);
    console.log(`[Scheduler] Completed in ${(duration / 1000).toFixed(1)}s: ${totalPioneer} pioneer events, ${lastRun.katanaCount} client errors`);
  } catch (error) {
    console.error('[Scheduler] Fetch failed:', error);
  } finally {
    isRunning = false;
  }
}

export function stopScheduler() {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
    console.log('[Scheduler] Stopped');
  }
}

export function getSchedulerStatus() {
  return {
    running: schedulerInterval !== null,
    lastRun,
    isCurrentlyFetching: isRunning
  };
}
