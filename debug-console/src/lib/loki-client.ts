import type { FieldMapping } from './log-sources';

// In-memory cache for appId -> cluster mappings
interface ClusterCacheEntry {
  cluster: string;
  timestamp: number;
}

const clusterCache = new Map<string, ClusterCacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_CACHE_SIZE = 1000; // Prevent unbounded growth

/**
 * Clean up expired entries and enforce max cache size
 */
function cleanupClusterCache() {
  const now = Date.now();

  // Remove expired entries
  for (const [appId, entry] of clusterCache.entries()) {
    if (now - entry.timestamp > CACHE_TTL_MS) {
      clusterCache.delete(appId);
    }
  }

  // Enforce max size by removing oldest entries
  if (clusterCache.size > MAX_CACHE_SIZE) {
    const entries = Array.from(clusterCache.entries())
      .sort((a, b) => a[1].timestamp - b[1].timestamp);
    const toRemove = entries.slice(0, clusterCache.size - MAX_CACHE_SIZE);
    for (const [appId] of toRemove) {
      clusterCache.delete(appId);
    }
  }
}

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
 * Look up which cluster an appId is running in
 * Always queries last 24 hours of recording rule data regardless of user's time range
 * since we just need to know which cluster the app is in, not when it was there
 */
async function lookupClusterForAppId(
  appId: string,
  config: LokiConfig
): Promise<string | null> {
  // Clean up cache periodically
  cleanupClusterCache();

  // Check cache first
  const cached = clusterCache.get(appId);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.cluster;
  }

  try {
    const endpoint = config.lokiEndpoint;
    if (!endpoint) {
      return null;
    }

    // Query recording rule metric for fast lookup
    // Recording rules are in Prometheus, not Loki, so use Prometheus datasource
    const grafanaBaseUrl = endpoint.includes('grafana.monitoring.gd3p.tools')
      ? 'https://grafana.monitoring.gd3p.tools/api/datasources/proxy/uid/beojxs8t38ttsb'
      : endpoint.replace('/uid/ff18mpwxpc7wgd', '/uid/beojxs8t38ttsb');
    const escapedAppId = escapeLogQLString(appId);

    // Always query last 24 hours of recording rule data
    // We just need to know which cluster the app is in, not when it was there
    const metricQuery = `airo_agents:log_lines_by_app:rate5m{app_id="${escapedAppId}"}`;
    const url = new URL(`${grafanaBaseUrl}/api/v1/query_range`);
    url.searchParams.set('query', metricQuery);

    // Query last 24 hours (Prometheus expects Unix seconds)
    const endSec = Math.floor(Date.now() / 1000);
    const startSec = endSec - (24 * 60 * 60); // 24 hours ago
    url.searchParams.set('start', startSec.toString());
    url.searchParams.set('end', endSec.toString());
    url.searchParams.set('step', '300'); // 5m step (matches recording rule interval)

    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };

    if (config.lokiApiKey) {
      headers['Authorization'] = config.lokiApiKey.startsWith('glsa_')
        ? `Bearer ${config.lokiApiKey}`
        : `Bearer ${config.lokiApiKey}`;
    }

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(3000) // 3 second timeout (slightly longer for range query)
    });

    if (!response.ok) {
      return null;
    }

    // Prometheus range query response format
    const data: {
      status: string;
      data: {
        resultType: string;
        result: Array<{
          metric: Record<string, string>;
          values: Array<[number, string]>; // [timestamp, value] pairs
        }>;
      };
    } = await response.json();

    if (data.status === 'success' && data.data.result.length > 0) {
      // Take the first result (most recent app_id match)
      const cluster = data.data.result[0].metric.cluster;
      if (cluster) {
        // Cache the result
        clusterCache.set(appId, { cluster, timestamp: Date.now() });
        return cluster;
      }
    }

    return null;
  } catch (error) {
    return null;
  }
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
  const knownLevels = ['error', 'warn', 'info', 'debug', 'fatal'];
  const detectedLevels: string[] = [];

  if (queryTerms) {
    const terms = queryTerms.toLowerCase().split(/\s+/);
    const remainingTerms: string[] = [];

    for (const term of terms) {
      if (knownLevels.includes(term)) {
        detectedLevels.push(term);
      } else {
        remainingTerms.push(term);
      }
    }

    // Update query to exclude detected level terms
    queryTerms = remainingTerms.join(' ');
  }

  // Handle level filtering using line filters (level is in JSON, not a label)
  // Use exact string match for better performance
  // Pattern matches both "level":"error" and "detected_level":"error"
  // Priority: explicit params > detected from query
  if (params.levelsFilter) {
    const levels = params.levelsFilter.split(',').map(l => escapeLogQLString(l.trim().toLowerCase()));
    if (levels.length === 1) {
      // Single level - exact string match (catches both level and detected_level)
      lineFilters.push(`|= "level\\":\\"${levels[0]}\\""`);
    } else if (levels.length > 1) {
      // Multiple levels: use regex OR pattern (no exact match operator for OR in LogQL)
      const levelPattern = levels.map(l => `level\\":\\"${l}\\"`).join('|');
      lineFilters.push(`|~ "${levelPattern}"`);
    }
  } else if (params.levelFilter && params.levelFilter !== 'all') {
    const escapedLevel = escapeLogQLString(params.levelFilter.toLowerCase());
    lineFilters.push(`|= "level\\":\\"${escapedLevel}\\""`);
  } else if (detectedLevels.length > 0) {
    // Use levels detected from query parameter (already validated against knownLevels)
    if (detectedLevels.length === 1) {
      lineFilters.push(`|= "level\\":\\"${detectedLevels[0]}\\""`);
    } else {
      const levelPattern = detectedLevels.map(l => `level\\":\\"${l}\\"`).join('|');
      lineFilters.push(`|~ "${levelPattern}"`);
    }
  }

  // Handle time range (calculate early for cluster lookup)
  const now = new Date();
  const defaultStart = new Date(now.getTime() - 24 * 60 * 60 * 1000); // 24 hours ago
  const startTimeISO = params.startTime || defaultStart.toISOString();
  const endTimeISO = params.endTime || now.toISOString();

  // OPTIMIZATION: Look up cluster for appId to add indexed label selector
  // This significantly reduces the scope of the expensive line filter scan
  // Cluster lookup always queries last 24h of recording rule data (not user's time range)
  if (params.appId) {
    const cluster = await lookupClusterForAppId(params.appId, config);
    if (cluster) {
      labels.push(`cluster="${cluster}"`);
    }
  }

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
  const limit = 5000; // Fetch all logs up to cap for accurate total count

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
    // Support both Bearer token and basic Grafana API key
    headers['Authorization'] = config.lokiApiKey.startsWith('glsa_')
      ? `Bearer ${config.lokiApiKey}`
      : `Bearer ${config.lokiApiKey}`;
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

  const data: LokiQueryResponse = await response.json();

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
