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
  flushPendingDocs,
  getMaxTimestamp
} from './es-db';

const EVENTS = [
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
  'dev_supervisor.exec.failure'
];

interface LogEntry {
  _id: string;
  timestamp: string;
  '@timestamp': string;
  event: string;
  app_id: string;
  agentId?: string;
  data: Record<string, unknown>;
}

function safeNum(val: unknown): number {
  if (typeof val === 'number' && !isNaN(val)) return val;
  if (typeof val === 'string') {
    const n = parseInt(val, 10);
    if (!isNaN(n)) return n;
  }
  return 0;
}

function processLogs(logs: LogEntry[]) {
  const counts: Record<string, number> = {};

  for (const log of logs) {
    if (!log.app_id) continue;
    const event = log.event;
    counts[event] = (counts[event] || 0) + 1;

    switch (event) {
      case 'agent.run.finish': {
        const d = log.data as {
          agentName?: string;
          finishReason?: string;
          steps?: unknown;
          totalUsage?: { inputTokens?: unknown; outputTokens?: unknown; cachedInputTokens?: unknown };
        };
        if (!d.totalUsage) break;
        const input = safeNum(d.totalUsage.inputTokens);
        const output = safeNum(d.totalUsage.outputTokens);
        if (input === 0 && output === 0) break;
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
        break;
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
        break;
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
        break;
      }

      case 'develop_agent.tool.execution.complete': {
        const d = log.data as { toolName?: string };
        if (d.toolName) {
          insertToolExecution({
            es_id: log._id,
            timestamp: log.timestamp,
            app_id: log.app_id,
            agent_id: log.agentId,
            tool_name: d.toolName
          });
        }
        break;
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
        break;
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
        break;
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
        break;
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
        break;
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
        break;
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
        break;
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
        break;
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
        break;
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
        break;
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
        break;
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
        break;
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
        break;
      }

      case 'model.provider.selected': {
        const d = log.data as { model?: string; provider?: string };
        if (d.model) {
          insertModelSelection({
            es_id: log._id,
            timestamp: log.timestamp,
            app_id: log.app_id,
            model: d.model,
            provider: d.provider
          });
        }
        break;
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
        break;
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
        break;
      }
    }
  }

  return counts;
}

async function fetchEventsRange(startTime: Date, endTime: Date, event: string): Promise<LogEntry[]> {
  let scrollId: string | undefined;
  const results: LogEntry[] = [];

  const query = {
    size: 10000,
    _source: true,
    query: {
      bool: {
        must: [{ match: { 'event.keyword': event } }],
        filter: [{ range: { '@timestamp': { gte: startTime.toISOString(), lte: endTime.toISOString() } } }]
      }
    },
    sort: [{ '@timestamp': 'asc' }]
  };

  let response = await sourceClient.search({
    index: SOURCE_INDEX_NAME,
    scroll: '2m',
    body: query
  });

  scrollId = response._scroll_id;

  for (const hit of response.hits.hits) {
    results.push({ _id: hit._id!, ...hit._source as Omit<LogEntry, '_id'> });
  }

  while (response.hits.hits.length > 0 && scrollId) {
    response = await sourceClient.scroll({
      scroll_id: scrollId,
      scroll: '2m'
    });
    scrollId = response._scroll_id;

    for (const hit of response.hits.hits) {
      results.push({ _id: hit._id!, ...hit._source as Omit<LogEntry, '_id'> });
    }
  }

  if (scrollId) {
    await sourceClient.clearScroll({ scroll_id: scrollId });
  }

  return results;
}

async function getMaxTimestampFromIndices(): Promise<Date | null> {
  const indices = Object.values(INDICES);
  let maxDate: Date | null = null;

  for (const index of indices) {
    try {
      const result = await writeClient.search({
        index,
        size: 0,
        body: {
          aggs: {
            max_ts: { max: { field: 'timestamp' } }
          }
        }
      });
      const maxTs = (result.aggregations?.max_ts as { value_as_string?: string })?.value_as_string;
      if (maxTs) {
        const date = new Date(maxTs);
        if (!maxDate || date > maxDate) {
          maxDate = date;
        }
      }
    } catch {
      // Index might not exist yet
    }
  }

  return maxDate;
}

async function fetchTimeRange(startTime: Date, endTime: Date): Promise<Record<string, number>> {
  let allLogs: LogEntry[] = [];

  for (const event of EVENTS) {
    const logs = await fetchEventsRange(startTime, endTime, event);
    allLogs = allLogs.concat(logs);
  }

  const counts = processLogs(allLogs);
  await flushPendingDocs();

  return counts;
}

export async function runFetch(): Promise<{ startTime: Date; endTime: Date; counts: Record<string, number> }> {
  await init();

  const endTime = new Date();
  let startTime: Date;

  // Auto-detect from max timestamp in indices
  const maxTs = await getMaxTimestampFromIndices();
  if (maxTs) {
    startTime = maxTs;
  } else {
    // Default to 1 day if no data exists
    startTime = new Date(endTime.getTime() - 24 * 60 * 60 * 1000);
  }

  const totalCounts: Record<string, number> = {};
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;
  let chunkStart = new Date(startTime);

  while (chunkStart < endTime) {
    const chunkEnd = new Date(Math.min(chunkStart.getTime() + ONE_DAY_MS, endTime.getTime()));
    const counts = await fetchTimeRange(chunkStart, chunkEnd);

    for (const [event, count] of Object.entries(counts)) {
      totalCounts[event] = (totalCounts[event] || 0) + count;
    }

    chunkStart = chunkEnd;
  }

  return { startTime, endTime, counts: totalCounts };
}

let schedulerInterval: ReturnType<typeof setInterval> | null = null;
let isRunning = false;
let lastRun: { startTime: Date; endTime: Date; counts: Record<string, number> } | null = null;

export function startScheduler(intervalMinutes = 15) {
  if (schedulerInterval) {
    console.log('[Analytics Scheduler] Already running');
    return;
  }

  const intervalMs = intervalMinutes * 60 * 1000;
  console.log(`[Analytics Scheduler] Starting with ${intervalMinutes} minute interval`);

  // Run immediately on start
  runScheduledFetch();

  schedulerInterval = setInterval(runScheduledFetch, intervalMs);
}

async function runScheduledFetch() {
  if (isRunning) {
    console.log('[Analytics Scheduler] Previous run still in progress, skipping');
    return;
  }

  isRunning = true;
  console.log(`[Analytics Scheduler] Starting fetch at ${new Date().toISOString()}`);

  try {
    lastRun = await runFetch();
    console.log(`[Analytics Scheduler] Completed fetch from ${lastRun.startTime.toISOString()} to ${lastRun.endTime.toISOString()}`);
  } catch (error) {
    console.error('[Analytics Scheduler] Fetch failed:', error);
  } finally {
    isRunning = false;
  }
}

export function stopScheduler() {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
    console.log('[Analytics Scheduler] Stopped');
  }
}

export function getSchedulerStatus() {
  return {
    running: schedulerInterval !== null,
    lastRun,
    isCurrentlyFetching: isRunning
  };
}

