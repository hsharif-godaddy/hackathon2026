import type { FieldMapping } from './log-sources';

export interface LokiQueryParams {
  query: string;
  start: string;  // Nanosecond timestamp
  end: string;    // Nanosecond timestamp
  limit: number;
  direction: 'backward' | 'forward';
}

export interface LokiStream {
  stream: Record<string, string>;  // Labels
  values: Array<[string, string]>; // [timestamp_ns, log_line]
}

export interface LokiQueryResponse {
  status: 'success' | 'error';
  data: {
    resultType: 'streams';
    result: LokiStream[];
    stats?: Record<string, unknown>;
  };
  error?: string;
}

export interface LogEntry {
  id: string;
  timestamp: string;
  level: string;
  message: string;
  event?: string;
  appId?: string;
  logger?: string;
  service?: string;
  hostname?: string;
  environment?: string;
  region?: string;
  version?: string;
  sourceId?: string;
  data?: Record<string, unknown>;
  raw: Record<string, unknown>;
}

interface BuildQueryParams {
  levelFilter?: string;
  levelsFilter?: string;
  query?: string;
  appId?: string;
  startTime?: string;
  endTime?: string;
  size?: number;
  from?: number;
}

interface LokiConfig {
  lokiEndpoint?: string;
  lokiApiKey?: string;
  lokiLabels?: Record<string, string>;
  environment?: string;
}

/**
 * Escape a value for safe interpolation into LogQL string literals
 * Escapes backslashes and double quotes to prevent query injection
 */
function escapeLogQLString(value: string): string {
  return value
    .replace(/\\/g, '\\\\')  // Escape backslashes first
    .replace(/"/g, '\\"');   // Then escape quotes
}

/**
 * Convert ISO timestamp to Loki nanosecond timestamp
 * Uses BigInt to preserve precision beyond Number.MAX_SAFE_INTEGER
 */
function toNanoseconds(isoString: string): string {
  const ms = new Date(isoString).getTime();
  return (BigInt(ms) * 1000000n).toString();
}

/**
 * Allow-list of log levels accepted by the level filter.
 *
 * `levelFilter`/`levelsFilter` arrive from URL query params and flow into a
 * Loki `|~` regex. `escapeLogQLString` only escapes string-literal characters
 * (`"` and `\`), not regex metacharacters, so raw pass-through would let a
 * caller widen the filter with e.g. `?level=error|.*`. Reject anything outside
 * this set before building the pattern.
 */
const KNOWN_LEVELS = new Set(['error', 'warn', 'info', 'debug', 'fatal']);

function sanitizeLevels(raw: Iterable<string>): string[] {
  const out: string[] = [];
  for (const value of raw) {
    const normalized = value.trim().toLowerCase();
    if (normalized && KNOWN_LEVELS.has(normalized) && !out.includes(normalized)) {
      out.push(normalized);
    }
  }
  return out;
}

/**
 * Build LogQL query from ES-style parameters
 */
export async function buildLokiQuery(
  params: BuildQueryParams,
  config: LokiConfig
): Promise<LokiQueryParams> {
  const labels: string[] = [];
  const lineFilters: string[] = [];

  // Add static labels from config (job, env, service_name)
  if (config.lokiLabels) {
    for (const [key, value] of Object.entries(config.lokiLabels)) {
      if (value) {
        labels.push(`${key}="${value}"`);
      }
    }
  }

  // Extract level filters from query parameter if present
  // UI sends level checkboxes as part of query string: "error warn"
  let queryTerms = params.query || '';
  const detectedLevels: string[] = [];

  if (queryTerms) {
    const terms = queryTerms.toLowerCase().split(/\s+/);
    const remainingTerms: string[] = [];

    for (const term of terms) {
      if (KNOWN_LEVELS.has(term)) {
        detectedLevels.push(term);
      } else {
        remainingTerms.push(term);
      }
    }

    // Update query to exclude detected level terms
    queryTerms = remainingTerms.join(' ');
  }

  // Handle level filtering using line filters (level is in JSON, not a label).
  // Use a case-insensitive regex so we match both lower-case (agents:
  // `"level":"error"`) and upper-case (preview/publish containers:
  // `"level":"ERROR"`) log producers with a single filter. The leading `[{,]`
  // anchors on the exact `level` JSON key (either the first field after `{`
  // or a subsequent field after `,`) so we don't match `detected_level`,
  // `parent_level`, etc. This assumes compact JSON output from log producers;
  // pretty-printed lines with space-padded keys would not match.
  //
  // Priority: explicit params > detected from query. All inputs are routed
  // through `sanitizeLevels`, which drops anything outside `KNOWN_LEVELS`, so
  // regex metacharacters sneaking in via URL params can't broaden the filter.
  const effectiveLevels = params.levelsFilter
    ? sanitizeLevels(params.levelsFilter.split(','))
    : (params.levelFilter && params.levelFilter !== 'all')
      ? sanitizeLevels([params.levelFilter])
      : detectedLevels;

  if (effectiveLevels.length > 0) {
    const levelPattern = effectiveLevels.join('|');
    lineFilters.push(`|~ "(?i)[{,]\\"level\\":\\"(${levelPattern})\\""`);
  }

  const now = new Date();
  const defaultStart = new Date(now.getTime() - 24 * 60 * 60 * 1000); // 24 hours ago
  const startTimeISO = params.startTime || defaultStart.toISOString();
  const endTimeISO = params.endTime || now.toISOString();

  // Note: we intentionally do NOT add a `cluster` label selector here. A
  // previous iteration looked up the app's cluster via a Prometheus recording
  // rule to shrink the line-filter scan, but it silently dropped logs when an
  // allocation migrated clusters. We accept the broader scan in exchange for
  // correctness; revisit with a multi-cluster regex filter if this becomes a
  // perf hotspot.

  // Handle app ID filtering - CRITICAL: app_id is in log line, NOT a label
  // Use exact string match (faster than regex)
  if (params.appId) {
    const escapedAppId = escapeLogQLString(params.appId);
    lineFilters.push(`|= "\\"app_id\\":\\"${escapedAppId}\\""`);
  }

  // Handle free-text search query (with level terms already extracted)
  if (queryTerms) {
    const terms = queryTerms.trim().split(/\s+/);
    for (const term of terms) {
      if (term) {
        // Escape only quotes and backslashes for LogQL string context (not regex metacharacters)
        // since |= is literal substring match, not regex
        const escaped = escapeLogQLString(term);
        lineFilters.push(`|= "${escaped}"`);
      }
    }
  }

  // Build final LogQL query: {labels} line_filters
  const labelSelector = labels.length > 0 ? `{${labels.join(',')}}` : '{}';
  const logQL = labelSelector + lineFilters.join(' ');

  // Convert time range to nanoseconds for Loki
  const start = toNanoseconds(startTimeISO);
  const end = toNanoseconds(endTimeISO);

  // Handle pagination - Loki doesn't have native offset
  // Fetch all logs for the time range (up to 5000 cap) so we can count them accurately
  const limit = params.size ?? 5000; // Fetch all logs up to cap for accurate total count

  return {
    query: logQL,
    start,
    end,
    limit,
    direction: 'backward' // Most recent first
  };
}

/**
 * Query Loki API
 */
export async function queryLoki(
  config: LokiConfig,
  params: LokiQueryParams
): Promise<LokiQueryResponse> {
  const endpoint = config.lokiEndpoint;
  if (!endpoint) {
    throw new Error('Loki endpoint not configured');
  }

  // Build query URL
  // Handle both direct Loki endpoints and Grafana proxy URLs
  const baseUrl = endpoint.endsWith('/') ? endpoint.slice(0, -1) : endpoint;
  const url = new URL(`${baseUrl}/loki/api/v1/query_range`);
  url.searchParams.set('query', params.query);
  url.searchParams.set('start', params.start);
  url.searchParams.set('end', params.end);
  url.searchParams.set('limit', params.limit.toString());
  url.searchParams.set('direction', params.direction);

  // Make request
  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  };

  if (config.lokiApiKey) {
    headers['Authorization'] = `Bearer ${config.lokiApiKey}`;
  }

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers,
    signal: AbortSignal.timeout(60000)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Loki query failed (${response.status}): ${errorText}`);
  }

  // Guard against non-JSON 200s (e.g. an upstream Grafana proxy returning an
  // HTML error page) — without this, response.json() throws a bare SyntaxError
  // that's hard to debug at the caller. Mirrors iterLokiEventLines in
  // analytics/scheduler.ts.
  let data: LokiQueryResponse;
  try {
    data = await response.json() as LokiQueryResponse;
  } catch (err) {
    throw new Error(
      `Loki query returned a non-JSON 200 response: ${err instanceof Error ? err.message : 'parse error'}`
    );
  }

  if (data.status === 'error') {
    throw new Error(`Loki returned error: ${data.error || 'Unknown error'}`);
  }

  return data;
}

/**
 * Transform Loki response to LogEntry format
 */
export function transformLokiResponse(
  response: LokiQueryResponse,
  fieldMapping: FieldMapping,
  sourceId: string
): LogEntry[] {
  const logs: LogEntry[] = [];
  // Position-based counter ensures ids are unique even when two entries share
  // the same nanosecond timestamp and identical leading log content.
  let entryIndex = 0;

  for (const stream of response.data.result) {
    for (const [timestampNs, logLine] of stream.values) {
      try {
        // Convert nanosecond timestamp to ISO string
        // Use BigInt to preserve sub-millisecond precision for accurate sorting
        const timestampMs = Number(BigInt(timestampNs) / 1000000n);
        const timestamp = new Date(timestampMs).toISOString();

        // Try to parse log line as JSON
        let parsedLog: Record<string, unknown> = {};
        try {
          parsedLog = JSON.parse(logLine);
        } catch {
          // If not JSON, treat as plain text
          parsedLog = { log: logLine };
        }

        // Extract fields using multi-tier strategy:
        // 1. Check stream labels first (fast, indexed)
        // 2. Check parsed JSON log line
        // 3. Fall back to defaults

        const level =
          stream.stream.detected_level ||
          (parsedLog.level as string) ||
          'unknown';

        const message =
          (parsedLog.message as string) ||
          (parsedLog.msg as string) ||
          logLine;

        const appId = parsedLog.app_id as string | undefined;
        const event = parsedLog.event as string | undefined;
        const service =
          stream.stream.service_name ||
          (parsedLog.service as string) ||
          undefined;

        const id = `${timestampNs}-${entryIndex++}-${logLine.substring(0, 50).replace(/[^a-zA-Z0-9]/g, '')}`;

        const logEntry: LogEntry = {
          id,
          timestamp,
          level: level.toLowerCase(),
          message,
          event,
          appId,
          logger: parsedLog.logger as string | undefined,
          service,
          hostname: parsedLog.hostname as string | undefined,
          environment: stream.stream.env || (parsedLog.environment as string) || undefined,
          region: stream.stream.region || (parsedLog.region as string) || undefined,
          version: parsedLog.version as string | undefined,
          sourceId,
          data: parsedLog.data as Record<string, unknown> | undefined,
          raw: {
            ...stream.stream,
            ...parsedLog,
            '@timestamp': timestamp,
            _loki_timestamp_ns: timestampNs
          }
        };

        logs.push(logEntry);
      } catch (error) {
        console.error('[loki-client] Failed to parse log entry:', error);
        // Skip malformed entries
      }
    }
  }

  // Sort by timestamp descending (most recent first)
  logs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  return logs;
}
