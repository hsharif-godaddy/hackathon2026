import { createHash } from 'node:crypto';

import { logger } from '@/lib/logger';
import { requireLokiEndpoint } from '@/lib/log-sources';
import type { LokiStream } from '@/lib/loki-client';

import { INDICES, writeClient } from './es-client';
import {
  init,
  insertRun,
  insertCompression,
  insertError,
  insertConversation,
  insertSummarization,
  insertToolFailure,
  insertPublishEvent,
  insertClientError,
  flushPendingDocs
} from './es-db';

// Pioneer events to fetch
const PIONEER_EVENTS = [
  'agent.run.finish',
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
  'route.publish.strategy-selected',
  'route.publish.default.begin',
  'route.publish.paas.begin',
  'route.publish.success',
  'route.publish.default.build.failed',
  'route.publish.paas.build.failed',
  'route.publish.default.archive.failed',
  'route.publish.paas.archive.failed',
  'route.publish.supervisor.begin',
  'route.publish.supervisor.failed',
  // Legacy event names (backward compatibility for older logs)
  'route.publish.begin',
  'route.publish.build.failed',
  'route.publish.archive.failed',
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
  error?: { name: string; message: string; stack?: string };
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
        const d = log.data as { filePath?: string };
        insertToolFailure({
          es_id: log._id,
          timestamp: log.timestamp,
          app_id: log.app_id,
          agent_id: log.agentId,
          tool_name: 'fileEdit',
          error_message: log.error?.message,
          file_path: d.filePath
        });
      return true;
      }

      case 'tool.git.operation.failure': {
        insertToolFailure({
          es_id: log._id,
          timestamp: log.timestamp,
          app_id: log.app_id,
          agent_id: log.agentId,
          tool_name: 'git',
          error_message: log.error?.message
        });
      return true;
      }

      case 'tool.image.search.failure': {
        insertToolFailure({
          es_id: log._id,
          timestamp: log.timestamp,
          app_id: log.app_id,
          agent_id: log.agentId,
          tool_name: 'imageSearch',
          error_message: log.error?.message
        });
      return true;
      }

      case 'tool.ast.edit.failure': {
        const d = log.data as { filePath?: string };
        insertToolFailure({
          es_id: log._id,
          timestamp: log.timestamp,
          app_id: log.app_id,
          agent_id: log.agentId,
          tool_name: 'astEdit',
          error_message: log.error?.message,
          file_path: d.filePath
        });
      return true;
      }

    // Use strategy-selected as the canonical "begin" — fires once per publish.
    // default.begin / paas.begin / supervisor.begin are sub-steps; skip to avoid inflating begin count.
    case 'route.publish.strategy-selected':
    case 'route.publish.begin': { // Legacy
      insertPublishEvent({
        es_id: log._id,
        timestamp: log.timestamp,
        app_id: log.app_id,
        event_type: 'begin',
        success: true
      });
      return true;
    }

    // Sub-step events — acknowledged but not indexed to avoid double-counting
    case 'route.publish.default.begin':
    case 'route.publish.paas.begin':
    case 'route.publish.supervisor.begin':
      return true;

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

    case 'route.publish.default.build.failed':
    case 'route.publish.paas.build.failed':
    case 'route.publish.build.failed': { // Legacy
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

    case 'route.publish.supervisor.failed': {
      const d = log.data as { error?: string };
      insertPublishEvent({
        es_id: log._id,
        timestamp: log.timestamp,
        app_id: log.app_id,
        event_type: 'other_failed',
        success: false,
        error_message: d.error?.slice(0, 2000)
      });
      return true;
    }

    case 'route.publish.default.archive.failed':
    case 'route.publish.paas.archive.failed':
    case 'route.publish.archive.failed':
    case 'route.publish.git-archive.failed': { // Legacy
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

// Loki endpoint / auth - mirror the log-sources.ts Loki config so the scheduler
// reads from the same backend as the Logs tab. Missing config is a hard error
// (same policy we enforce for airo-agents in log-sources). Callers invoke
// requireLokiEndpoint('the analytics scheduler') directly.
const LOKI_MAX_LIMIT = 5000;
// Escape characters that would otherwise alter how the literal is interpreted
// either by the RE2 engine (regex metacharacters) or by LogQL's surrounding
// quoted-string parser. Events contain dots (`agent.run.finish`) — we escape so
// `.` doesn't match arbitrary characters; `"` is escaped because callers embed
// the result in a `|~ "..."` LogQL filter where an unescaped quote would
// terminate the string and produce a malformed query. RE2 treats `\"` as a
// literal `"`, and LogQL's Go-style string parser turns `\"` into `"` before
// passing the regex to RE2, so escaping is safe at both layers.
export function escapeRegex(literal: string): string {
  return literal.replace(/[.^$*+?()[\]{}|\\"]/g, '\\$&');
}

// Short content-addressed suffix for synthesizing stable `_id` values from
// Loki log lines. SHA-256 truncated to 16 hex chars (64 bits) - enough
// collision resistance within a single-nanosecond bucket. The hash is
// persisted as part of the analytics doc `_id` so every backfill or
// scheduled run with the same Loki line produces the same id and we
// upsert instead of duplicating. Changing the hash algorithm here would
// re-id every existing doc, so the algo is locked in for the lifetime of
// the index.
export function hashLine(line: string): string {
  return createHash('sha256').update(line).digest('hex').slice(0, 16);
}

interface LokiQueryRangeResponse {
  status?: string;
  error?: string;
  errorType?: string;
  data: { result: LokiStream[] };
}

/**
 * Default Loki stream selector for the agents service. Callers that need to
 * tail a different job (e.g. preview/publish containers if those ever feed
 * Pioneer-style events) can pass their own selector to `iterLokiEventLines`.
 */
export function defaultAgentsStreamSelector(): string {
  const envLabel = (process.env.ENVIRONMENT_NAME || 'dev') === 'prod' ? 'prod' : 'dev';
  return `{job="airo-agents", env="${envLabel}"}`;
}

/**
 * Stream Loki entries for a time range + line-filter regex, yielding one page
 * at a time so callers can process-and-flush incrementally and keep live
 * memory bounded by `LOKI_MAX_LIMIT` (~5000 entries) rather than the full
 * window's volume.
 *
 * Pagination uses a forward time-cursor. Loki caps responses at ~5000
 * entries; when the limit is hit we re-query starting at the last seen
 * timestamp and dedupe any entries already yielded at that nanosecond on the
 * previous page (otherwise `lastNs + 1` would silently drop tied-timestamp
 * entries split across page boundaries).
 *
 * Yields `[timestampNs, logLine]` pairs sorted ascending by timestamp within
 * each page.
 */
export async function* iterLokiEventLines(
  startTime: Date,
  endTime: Date,
  eventsRegex: string,
  streamSelector: string = defaultAgentsStreamSelector()
): AsyncGenerator<Array<[string, string]>> {
  // Trim trailing slash so a `LOKI_ENDPOINT=https://loki.example/` config
  // doesn't produce `//loki/api/...` (matches loki-client's normalization).
  const lokiEndpoint = requireLokiEndpoint('the analytics scheduler').replace(/\/+$/, '');
  const lokiApiKey = process.env.LOKI_API_KEY || '';

  const query = `${streamSelector} |~ "${eventsRegex}"`;

  // Loki expects nanosecond timestamps (stringified). Convert ISO to ns.
  let cursorNs = BigInt(startTime.getTime()) * 1_000_000n;
  const endNs = BigInt(endTime.getTime()) * 1_000_000n;

  // Lines already emitted at the cursor's nanosecond on the previous page,
  // used to dedupe when we re-query at the same ns to catch tied-timestamp
  // entries that spilled past the 5000-entry page boundary.
  let previousCursorLines: Set<string> = new Set();

  while (cursorNs < endNs) {
    const params = new URLSearchParams({
      query,
      start: cursorNs.toString(),
      end: endNs.toString(),
      limit: String(LOKI_MAX_LIMIT),
      direction: 'forward'
    });

    const url = `${lokiEndpoint}/loki/api/v1/query_range?${params}`;
    // 60s timeout matches loki-client.ts so a stalled Loki/Grafana response
    // can't block the scheduler's interval indefinitely. Wrap in try/catch
    // so network errors and AbortSignal timeouts surface as descriptive
    // scheduler errors instead of bare TypeError/AbortError out of fetch.
    let res: Response;
    try {
      res = await fetch(url, {
        headers: lokiApiKey ? { Authorization: `Bearer ${lokiApiKey}` } : undefined,
        signal: AbortSignal.timeout(60_000)
      });
    } catch (err) {
      const isTimeout = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
      const wrapped = new Error(
        isTimeout
          ? `Loki query_range timed out after 60s (cursor=${cursorNs.toString()})`
          : `Loki query_range network error: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err instanceof Error ? err : undefined },
      );
      throw wrapped;
    }

    if (!res.ok) {
      // Distinct sentinel for read failures so an empty body from a network
      // interruption mid-response is distinguishable from Loki returning
      // HTTP 5xx with a literally empty body.
      const body = await res.text().catch(() => '<body read failed>');
      throw new Error(`Loki query_range failed: HTTP ${res.status} - ${body.slice(0, 300)}`);
    }

    // Guard against non-JSON 200s (e.g. an upstream proxy returning an HTML
    // error page) and unexpected response shapes — both used to throw bare
    // SyntaxError/TypeError out of the generator and kill the entire chunk.
    let json: LokiQueryRangeResponse;
    try {
      json = (await res.json()) as LokiQueryRangeResponse;
    } catch (err) {
      throw new Error(
        `Loki query_range returned a non-JSON 200 response: ${err instanceof Error ? err.message : 'parse error'}`,
        { cause: err instanceof Error ? err : undefined },
      );
    }
    // Loki returns HTTP 200 with `{"status":"error",...}` on server-side
    // query timeouts, malformed LogQL, and label-selector mismatches. Without
    // this check the empty `data.result` would be treated as an empty window,
    // the cursor would advance past the chunk, and the data would be
    // permanently lost on the next forward-incremental run.
    if (json?.status === 'error') {
      throw new Error(
        `Loki query_range returned status=error: ${json.errorType || 'unknown'} - ${json.error || 'no message'}`,
      );
    }
    const streams = json?.data?.result;
    if (!Array.isArray(streams)) {
      throw new Error(
        `Loki query_range returned an unexpected response shape (missing data.result array)`
      );
    }

    // Flatten all streams into a single entries array. Each stream may carry
    // a different label set (different pods/allocations) but we don't care
    // here because we re-parse the JSON log line to extract fields.
    const pageEntries: Array<[string, string]> = [];
    for (const stream of streams) {
      for (const entry of stream.values) {
        pageEntries.push(entry);
      }
    }

    if (pageEntries.length === 0) break;

    // Sort ascending by timestamp; return 0 on ties so the comparator is a
    // total order (otherwise sort stability isn't guaranteed for same-ns
    // entries and dedup reasoning below gets harder).
    pageEntries.sort((a, b) => {
      const aNs = BigInt(a[0]);
      const bNs = BigInt(b[0]);
      if (aNs < bNs) return -1;
      if (aNs > bNs) return 1;
      return 0;
    });

    // Filter out entries we already emitted in the previous page's trailing
    // nanosecond (see dedup explanation above).
    const emittedEntries: Array<[string, string]> = [];
    for (const entry of pageEntries) {
      if (BigInt(entry[0]) === cursorNs && previousCursorLines.has(entry[1])) {
        continue;
      }
      emittedEntries.push(entry);
    }

    if (emittedEntries.length > 0) {
      yield emittedEntries;
    }

    // Short page means we've drained the window.
    if (pageEntries.length < LOKI_MAX_LIMIT) break;

    // Advance the cursor to the last entry's timestamp (NOT +1) so we can
    // pick up any additional entries sharing that nanosecond that were
    // trimmed by the 5000-entry page cap. Record the lines we already
    // emitted at that ns so the next page can dedupe them.
    const lastNs = BigInt(pageEntries[pageEntries.length - 1][0]);
    if (lastNs < cursorNs) break; // defensive: should never regress
    // Cursor can't advance — Loki returned a full page entirely at one
    // nanosecond (more entries at this ns than fit in a single page) or
    // returned the same window again. Bail to avoid an infinite loop. In
    // forward-incremental mode the next scheduler run starts from the max
    // timestamp already in ES (>= lastNs) so any entries trimmed at this ns
    // are PERMANENTLY DROPPED — log at error level so operators see the data
    // loss instead of debugging mystery gaps later.
    if (lastNs === cursorNs) {
      const lastNsIso = new Date(Number(lastNs / 1_000_000n)).toISOString();
      logger.error('scheduler.loki.stuckNanosecond', {
        stuckNs: lastNs.toString(),
        stuckNsIso: lastNsIso,
        emittedAtStuckNs: pageEntries.length,
        message: 'Loki paginator bailed at a single-nanosecond hot spot; further entries at this ns are LOST',
      });
      break;
    }
    const nextCursorLines = new Set<string>();
    for (const entry of pageEntries) {
      if (BigInt(entry[0]) === lastNs) {
        nextCursorLines.add(entry[1]);
      }
    }
    cursorNs = lastNs;
    previousCursorLines = nextCursorLines;
  }
}

// Loki-backed streaming fetch for Pioneer events. Replaces the previous
// ES scroll implementation that required PIONEER_ES_ENDPOINT. Scans the
// `airo-agents` Loki stream for all configured events in a single regex pass
// per time chunk so we don't re-read the stream N times for N events.
export async function fetchAndProcessPioneerEvents(
  startTime: Date,
  endTime: Date,
  events: string[],
  pendingCount: { value: number }
): Promise<Record<string, number>> {
  const perEventCounts: Record<string, number> = {};
  if (events.length === 0) return perEventCounts;

  // Assumes the agents logger emits compact JSON (`"event":"x"`) with no
  // whitespace around `:`. If that invariant ever changes the line-filter
  // regex below will silently drop all events for a chunk, so keep the
  // assumption explicit.
  const eventsRegex = `\\"event\\":\\"(${events.map(escapeRegex).join('|')})\\"`;

  // Track JSON.parse failures so a logger-format regression (multi-line output,
  // pretty-printing enabled, etc.) is observable in scheduler logs instead of
  // silently reporting zero events for the chunk.
  let jsonParseFailures = 0;
  const sampleMalformedLines: string[] = [];
  // Count lines that matched the events regex AND parsed as JSON but were
  // dropped downstream (missing app_id, zero tokens, etc. in processPioneerLog).
  // If everything that matched gets dropped, the format probably regressed
  // and we want to surface that rather than report 0 events.
  let parsedMatchedLines = 0;
  let processedLines = 0;

  for await (const page of iterLokiEventLines(startTime, endTime, eventsRegex)) {
    for (const [timestampNs, logLine] of page) {
      // Parse the JSON log line. Non-JSON lines are skipped (shouldn't happen
      // for agents logs but be defensive).
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(logLine);
      } catch {
        jsonParseFailures++;
        if (sampleMalformedLines.length < 3) {
          sampleMalformedLines.push(logLine.slice(0, 200));
        }
        continue;
      }

      const event = typeof parsed.event === 'string' ? parsed.event : undefined;
      if (!event || !events.includes(event)) continue;
      parsedMatchedLines++;

      const timestampMs = Number(BigInt(timestampNs) / 1_000_000n);
      const timestamp = new Date(timestampMs).toISOString();

      // Content-addressed `_id` keeps writes idempotent across scheduler runs:
      // replaying the same window (overlapping fetch+backfill, retry after a
      // flush failure, etc.) re-indexes the same document instead of creating
      // duplicates.
      const log: LogEntry = {
        _id: `loki-${timestampNs}-${hashLine(logLine)}`,
        timestamp,
        '@timestamp': timestamp,
        event,
        app_id: (parsed.app_id as string) || (parsed.appId as string) || '',
        agentId: parsed.agentId as string | undefined,
        data: (parsed.data as Record<string, unknown>) || {},
        error: parsed.error as LogEntry['error']
      };

      if (processPioneerLog(log)) {
        processedLines++;
        perEventCounts[event] = (perEventCounts[event] || 0) + 1;
        pendingCount.value++;

        if (pendingCount.value >= FLUSH_THRESHOLD) {
          // try/finally: pendingCount must reset even if flush throws,
          // otherwise the shared counter stays at threshold and we'd re-fire
          // the doomed flush on every subsequent line. flushPendingDocs
          // itself drains its buffer up-front (see es-db.ts), so this is
          // pure counter hygiene. The catch block surfaces the chunk window
          // and pending count before re-throwing so the top-level
          // "Fetch failed" doesn't bury which chunk lost docs.
          const flushCount = pendingCount.value;
          try {
            await flushPendingDocs();
          } catch (err) {
            logger.error(
              'scheduler.events.midLoopFlushFailed',
              {
                pendingDocs: flushCount,
                windowStart: startTime.toISOString(),
                windowEnd: endTime.toISOString(),
                event,
              },
              { error: err instanceof Error ? err : new Error(String(err)) },
            );
            throw err;
          } finally {
            pendingCount.value = 0;
          }
        }
      }
    }
  }

  if (jsonParseFailures > 0) {
    // 100% parse-failure means a complete logger-format regression for this
    // window (every event silently dropped) - escalate to error so paging /
    // alerting picks it up. Anything less is a noisy partial drop and stays
    // a warn. parsedMatchedLines==0 here means no entry survived parsing.
    const emit = parsedMatchedLines === 0 ? logger.error : logger.warn;
    emit('scheduler.loki.jsonParseFailures', {
      jsonParseFailures,
      parsedMatchedLines,
      windowStart: startTime.toISOString(),
      windowEnd: endTime.toISOString(),
      sampleMalformedLines,
    });
  }

  // Matched + parsed entries that were entirely rejected by processPioneerLog
  // usually mean a logger schema change (e.g. `app_id` renamed, tokens missing).
  // Without this warning the scheduler reports 0 events - indistinguishable
  // from a legitimately quiet window.
  if (parsedMatchedLines > 0 && processedLines === 0) {
    logger.warn('scheduler.events.allDropped', {
      parsedMatchedLines,
      processedLines,
      windowStart: startTime.toISOString(),
      windowEnd: endTime.toISOString(),
      message: 'All matched event lines dropped by processPioneerLog (likely missing app_id or zero tokens). Check the agents logger schema.',
    });
  }

  return perEventCounts;
}

// Streaming fetch for Katana logs. Exported so tests can pre-seed
// `pendingCount` to exercise the mid-loop flush failure paths (the public
// runBackfill API constructs pendingCount internally and would require
// ~1000 hits to reach FLUSH_THRESHOLD).
export async function fetchAndProcessKatanaErrors(
  startTime: Date,
  endTime: Date,
  pendingCount: { value: number }
): Promise<number> {
  let scrollId: string | undefined;
  let processedCount = 0;
  // Set by the inner mid-loop flush catch blocks so the outer catch
  // doesn't double-log: `scheduler.katana.fetchFailed` is the label for
  // genuine scroll/auth errors, and operators triaging it shouldn't be
  // pointed at scroll/connectivity when the real fault is the bulk write.
  let errorAlreadyLogged = false;

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
      // Same try/catch contract as the Pioneer mid-loop flush: a flush
      // failure here would otherwise propagate to the outer catch which
      // logs `processedCount` (Katana docs read), not the failing flush
      // batch size. Surface the chunk window + flush batch context so an
      // operator can distinguish flush failures from scroll/auth failures.
      const flushCount = pendingCount.value;
      try {
        await flushPendingDocs();
      } catch (err) {
        logger.error(
          'scheduler.katana.midLoopFlushFailed',
          {
            pendingDocs: flushCount,
            windowStart: startTime.toISOString(),
            windowEnd: endTime.toISOString(),
            scrollPhase: 'initial',
          },
          { error: err instanceof Error ? err : new Error(String(err)) },
        );
        errorAlreadyLogged = true;
        throw err;
      } finally {
        pendingCount.value = 0;
      }
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
        const flushCount = pendingCount.value;
        try {
          await flushPendingDocs();
        } catch (err) {
          logger.error(
            'scheduler.katana.midLoopFlushFailed',
            {
              pendingDocs: flushCount,
              windowStart: startTime.toISOString(),
              windowEnd: endTime.toISOString(),
              scrollPhase: 'continuation',
            },
            { error: err instanceof Error ? err : new Error(String(err)) },
          );
          errorAlreadyLogged = true;
          throw err;
        } finally {
          pendingCount.value = 0;
        }
      }
    }
  } catch (error) {
    // Used to swallow the error (console.error only), which masked auth /
    // connectivity drops AND silently dropped any pendingDocs that flushed
    // after this throw. Surface it so runFetch's catch records the failure
    // and so a flush-side throw doesn't pretend to have processed katana.
    // Skip if a mid-loop flush already logged a more specific event
    // (`scheduler.katana.midLoopFlushFailed`) - double-logging the same
    // error under both labels would point operators at scroll/auth issues
    // when the real fault is the bulk write.
    if (!errorAlreadyLogged) {
      logger.error(
        'scheduler.katana.fetchFailed',
        {
          windowStart: startTime.toISOString(),
          windowEnd: endTime.toISOString(),
          processedCount,
        },
        { error: error instanceof Error ? error : new Error(String(error)) },
      );
    }
    throw error;
  } finally {
    if (scrollId) {
      // Empty `.catch(() => {})` violated the project's no-silent-error rule
      // and masked auth/connectivity drops that would also affect the next
      // run. Un-cleared scroll contexts also stay alive until ES TTL expiry.
      await writeClient.clearScroll({ scroll_id: scrollId }).catch((err: unknown) => {
        logger.warn(
          'scheduler.es.clearScrollFailed',
          {
            message: 'ES clearScroll failed; context will expire via TTL',
          },
          { error: err instanceof Error ? err : new Error(String(err)) },
        );
      });
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
    } catch (err) {
      // Distinct from the empty-index branch above (which is the normal
      // first-run case): an ES auth/network failure here silently triggers
      // a full DEFAULT_PIONEER_BACKFILL_DAYS-day backfill on every scheduler
      // run, potentially re-indexing weeks of data. logger.error so it
      // surfaces in alerting instead of getting buried as a warn.
      logger.error(
        'scheduler.es.pioneerMaxTimestampFailed',
        {
          index,
          source: 'pioneer',
          fallbackDays: DEFAULT_PIONEER_BACKFILL_DAYS,
        },
        { error: err instanceof Error ? err : new Error(String(err)) },
      );
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
  } catch (err) {
    logger.error(
      'scheduler.es.katanaMaxTimestampFailed',
      {
        index: INDICES.CLIENT_ERRORS,
        source: 'katana',
        fallbackDays: DEFAULT_KATANA_BACKFILL_DAYS,
      },
      { error: err instanceof Error ? err : new Error(String(err)) },
    );
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

  // Process in daily chunks. A single Loki scan per chunk covers all events
  // via a regex OR — much cheaper than N separate stream scans.
  let chunkStart = new Date(pioneerStart);
  while (chunkStart < endTime) {
    const chunkEnd = new Date(Math.min(chunkStart.getTime() + ONE_DAY_MS, endTime.getTime()));

    const chunkCounts = await fetchAndProcessPioneerEvents(chunkStart, chunkEnd, PIONEER_EVENTS, pendingCount);
    for (const [event, count] of Object.entries(chunkCounts)) {
      pioneerCounts[event] = (pioneerCounts[event] || 0) + count;
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

  // Final flush is unconditional. `flushPendingDocs` is a cheap no-op when
  // empty (returns 0 immediately), and gating on `pendingCount` is unsafe:
  // a mid-loop flush throw re-queues un-attempted sub-batches into
  // `pendingDocs` and resets `pendingCount` to 0, so a `pendingCount > 0`
  // gate would leak the un-attempted batch until the next ingest tick.
  const finalCount = pendingCount.value;
  try {
    await flushPendingDocs();
  } catch (err) {
    logger.error(
      'scheduler.runFetch.finalFlushFailed',
      {
        pendingDocs: finalCount,
        windowStart: startTime.toISOString(),
        windowEnd: endTime.toISOString(),
      },
      { error: err instanceof Error ? err : new Error(String(err)) },
    );
    throw err;
  } finally {
    pendingCount.value = 0;
  }

  return { startTime, endTime, pioneerCounts, katanaCount };
}

// Valid index filter values for backfill
export type BackfillIndexFilter = 'all' | 'errors' | 'agent_runs' | 'compressions' | 'conversations' | 'summarizations' | 'tool_failures' | 'publish_events' | 'client_errors';

// Map index filter to Pioneer events
const INDEX_TO_EVENTS: Record<BackfillIndexFilter, string[] | 'all' | 'katana'> = {
  all: 'all',
  errors: ['websocket.conversation.error', 'knowb-driver.proxy.error'],
  agent_runs: ['agent.run.finish'],
  compressions: ['compression.batch.complete'],
  conversations: ['conversation.history.loader.token_limit_reached', 'websocket.conversation.error', 'conversation.start', 'conversation.continue'],
  summarizations: ['summarization.background.complete', 'summarization.detailed_llm.failure', 'summarization.detailed_llm.token_budget_exceeded'],
  tool_failures: ['tool.file.edit.operation.failure', 'tool.file.edit.batch.failure', 'tool.git.operation.failure', 'tool.image.search.failure', 'tool.ast.edit.failure'],
  publish_events: ['route.publish.strategy-selected', 'route.publish.success', 'route.publish.supervisor.failed', 'route.publish.default.build.failed', 'route.publish.paas.build.failed', 'route.publish.default.archive.failed', 'route.publish.paas.archive.failed', 'route.publish.begin', 'route.publish.build.failed', 'route.publish.archive.failed', 'route.publish.git-archive.failed'],
  client_errors: 'katana'
};

export async function runBackfill(days: number, indexFilter: BackfillIndexFilter = 'all'): Promise<FetchResult> {
  // Limit to 30 days because ES retention policy doesn't hold data beyond that
  if (days < 1 || days > 30) {
    throw new Error(`Invalid backfill days: ${days}. Must be between 1 and 30.`);
  }

  await init();

  const endTime = new Date();
  const startTime = new Date(endTime.getTime() - days * 24 * 60 * 60 * 1000);

  logger.info('scheduler.runBackfill.started', {
    days,
    indexFilter,
    windowStart: startTime.toISOString(),
    windowEnd: endTime.toISOString(),
  });

  const pioneerCounts: Record<string, number> = {};
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;
  const pendingCount = { value: 0 };

  const eventMapping = INDEX_TO_EVENTS[indexFilter];
  const shouldProcessPioneer = eventMapping !== 'katana';
  const shouldProcessKatana = indexFilter === 'all' || indexFilter === 'client_errors';

  // Determine which Pioneer events to process
  const eventsToProcess = eventMapping === 'all' ? PIONEER_EVENTS :
    eventMapping === 'katana' ? [] : eventMapping;

  // Process Pioneer events in daily chunks
  if (shouldProcessPioneer && eventsToProcess.length > 0) {
    let chunkStart = new Date(startTime);
    while (chunkStart < endTime) {
      const chunkEnd = new Date(Math.min(chunkStart.getTime() + ONE_DAY_MS, endTime.getTime()));

      const chunkCounts = await fetchAndProcessPioneerEvents(chunkStart, chunkEnd, eventsToProcess, pendingCount);
      for (const [event, count] of Object.entries(chunkCounts)) {
        pioneerCounts[event] = (pioneerCounts[event] || 0) + count;
      }

      chunkStart = chunkEnd;
    }
  }

  // Process Katana logs
  let katanaCount = 0;
  if (shouldProcessKatana) {
    let chunkStart = new Date(startTime);
    while (chunkStart < endTime) {
      const chunkEnd = new Date(Math.min(chunkStart.getTime() + ONE_DAY_MS, endTime.getTime()));
      katanaCount += await fetchAndProcessKatanaErrors(chunkStart, chunkEnd, pendingCount);
      chunkStart = chunkEnd;
    }
  }

  // Final flush is unconditional - see runFetch for the invariant.
  const finalCount = pendingCount.value;
  try {
    await flushPendingDocs();
  } catch (err) {
    logger.error(
      'scheduler.runBackfill.finalFlushFailed',
      {
        pendingDocs: finalCount,
        windowStart: startTime.toISOString(),
        windowEnd: endTime.toISOString(),
        indexFilter,
      },
      { error: err instanceof Error ? err : new Error(String(err)) },
    );
    throw err;
  } finally {
    pendingCount.value = 0;
  }

  const totalPioneer = Object.values(pioneerCounts).reduce((a, b) => a + b, 0);
  logger.info('scheduler.runBackfill.completed', {
    indexFilter,
    pioneerEvents: totalPioneer,
    katanaCount,
  });

  return { startTime, endTime, pioneerCounts, katanaCount };
}

let schedulerInterval: ReturnType<typeof setInterval> | null = null;
let isRunning = false;
let lastRun: FetchResult | null = null;

export function startScheduler(intervalMinutes = 15) {
  if (schedulerInterval) {
    logger.info('scheduler.start.alreadyRunning', { intervalMinutes });
    return;
  }

  const intervalMs = intervalMinutes * 60 * 1000;
  logger.info('scheduler.start.scheduled', { intervalMinutes });

  runScheduledFetch();
  schedulerInterval = setInterval(runScheduledFetch, intervalMs);
}

async function runScheduledFetch() {
  if (isRunning) {
    logger.info('scheduler.run.skippedInProgress');
    return;
  }

  isRunning = true;
  const startedAt = new Date();
  logger.info('scheduler.run.started', { startedAt: startedAt.toISOString() });

  try {
    lastRun = await runFetch();
    const duration = Date.now() - startedAt.getTime();
    const totalPioneer = Object.values(lastRun.pioneerCounts).reduce((a, b) => a + b, 0);
    logger.info('scheduler.run.completed', {
      durationMs: duration,
      pioneerEvents: totalPioneer,
      katanaCount: lastRun.katanaCount,
    });
  } catch (error) {
    logger.error(
      'scheduler.run.failed',
      {
        startedAt: startedAt.toISOString(),
        durationMs: Date.now() - startedAt.getTime(),
      },
      { error: error instanceof Error ? error : new Error(String(error)) },
    );
  } finally {
    isRunning = false;
  }
}

export function stopScheduler() {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
    logger.info('scheduler.stop.completed');
  }
}

export function getSchedulerStatus() {
  return {
    running: schedulerInterval !== null,
    lastRun,
    isCurrentlyFetching: isRunning
  };
}
