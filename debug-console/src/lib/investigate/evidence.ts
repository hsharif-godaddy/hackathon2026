import { buildAppIdQuery, getLogSourceConfig, getNestedValue, type LogSourceConfig } from '@/lib/log-sources';
import { buildAppIdFilter, getLangfuseEbConfig } from '@/lib/langfuse-eb-client';
import {
  buildAiroSegmentQuery,
  callFullstoryMcpTool,
  FullstoryMcpError,
  getFullstoryMcpConfig,
  parseFullstorySessionUrl,
  type FullstoryMcpConfig,
} from '@/lib/fullstory-mcp-client';
import { parseTimeRange } from '@/lib/time-range';
import mgmtControlPlaneAdapter from '@/lib/mgmt-control-plane-adapter';
import { logger } from '@/lib/logger';

export const DEFAULT_EVIDENCE_SOURCE_IDS = [
  'airo-app',
  'control_plane',
  'airo-agents',
  'airo-preview',
  'airo-publish',
  'langfuse',
  'fullstory',
] as const;

export type EvidenceSourceId = typeof DEFAULT_EVIDENCE_SOURCE_IDS[number];

const KNOWN_EVIDENCE_SOURCE_IDS = new Set<string>(DEFAULT_EVIDENCE_SOURCE_IDS);
const MAX_WINDOW_HOURS = 24 * 7;
const DEFAULT_BUCKET_HOURS = 6;
const LOKI_LIMIT = 5000;
const LOKI_JOB_TO_SOURCE_ID: Record<string, string> = {
  'airo-agents': 'airo-agents',
  'airo-preview-application': 'airo-preview',
  'airo-publish-application': 'airo-publish',
};
const ES_PAGE_SIZE = 1000;
const LANGFUSE_PAGE_SIZE = 100;
const LANGFUSE_DETAIL_BATCH_SIZE = 20;
const MAX_LANGFUSE_PAGES = 200;
const MAX_LANGFUSE_DETAIL_FAILURES = 20;
const MAX_LANGFUSE_DETAIL_ERROR_SAMPLES = 5;
// Wall-clock ceiling for a single Langfuse collection pass. MAX_LANGFUSE_PAGES
// alone can still chew ~5min on a 7-day, high-traffic app (200 pages × 5 batches
// of 20 parallel detail fetches × ~300ms/batch), which is uncomfortably close to
// the Lambda's 15-minute cap once other sources run alongside.
const MAX_LANGFUSE_ELAPSED_MS = 4 * 60 * 1000;

export interface EvidenceLog {
  id?: string;
  timestamp: string;
  level: string;
  message: string;
  event?: string;
  sourceId: string;
  raw: Record<string, unknown>;
}

export interface EvidenceRawPage {
  page: number;
  bucket: string;
  start: string;
  end: string;
  logs: EvidenceLog[];
}

export interface EvidenceDiagnostics {
  elapsedMs: number;
  pageCount: number;
  query: string;
  truncated: boolean;
  error?: string;
  /**
   * Informational messages that do NOT indicate incomplete coverage — e.g.
   * "paged to first 3 of 10 matched sessions", "used segment discovery
   * because the URL was a UUID share link". Kept separate from
   * coverage.incomplete so the AI investigator can distinguish "I am missing
   * data" from "I chose this path for a good reason".
   */
  notes?: string[];
}

export interface EvidenceIndex {
  appId: string;
  source: {
    id: string;
    name: string;
    consoleSource: string;
    backendType: LogSourceConfig['backendType'] | 'langfuse' | 'fullstory';
    description: string;
  };
  window: { label: string; start: string; end: string };
  coverage: {
    readonly complete: boolean;
    fetchedLogCount: number;
    readonly incompleteBucketCount: number;
    incomplete: Array<{ bucket: string; start: string; end: string; error: string }>;
  };
  diagnostics: EvidenceDiagnostics;
  levelCounts: Record<string, number>;
  topSignatures: Array<{ signature: string; count: number; rawRef: string }>;
  rareErrorSignatures: Array<{ signature: string; count: number; rawRef: string }>;
  rawRefs: string[];
}

export interface EvidenceSourceResult {
  sourceId: string;
  complete: boolean;
  rawPages: EvidenceRawPage[];
  index: EvidenceIndex;
}

export interface NormalizedEvidenceRequest {
  appId: string;
  timeWindow: string;
  sources: EvidenceSourceId[];
  bucketHours: number;
  fullstoryUrl?: string;
}

interface LokiStream {
  stream: Record<string, string>;
  values: Array<[string, string]>;
}

interface LokiQueryRangeResponse {
  status?: string;
  error?: string;
  errorType?: string;
  data?: { result?: LokiStream[] };
}

type FetchImpl = typeof fetch;

interface EvidenceBucket {
  label: string;
  startTime: Date;
  endTime: Date;
}

function escapeLogQLString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function toNs(date: Date): string {
  return (BigInt(date.getTime()) * 1_000_000n).toString();
}

function nsToIso(ns: string): string {
  return new Date(Number(BigInt(ns) / 1_000_000n)).toISOString();
}

function normalizeSourceId(source: string): string {
  return source === 'control-plane' ? 'control_plane' : source;
}

function isEvidenceSourceId(source: string): source is EvidenceSourceId {
  return KNOWN_EVIDENCE_SOURCE_IDS.has(source);
}

function clampWindow(raw: string | undefined): string {
  const value = raw || '24h';
  const match = value.match(/^(\d+)([mhd])$/i);
  if (!match) return '24h';
  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  const hours = unit === 'd' ? amount * 24 : unit === 'h' ? amount : Math.ceil(amount / 60);
  if (hours > MAX_WINDOW_HOURS) return '7d';
  return `${amount}${unit}`;
}

export function normalizeEvidenceRequest(body: unknown): NormalizedEvidenceRequest {
  const input = body && typeof body === 'object' ? body as Record<string, unknown> : {};
  const appId = typeof input.appId === 'string' ? input.appId.trim() : '';
  if (!appId) {
    throw new Error('appId is required');
  }

  const rawSources = Array.isArray(input.sources) ? input.sources : DEFAULT_EVIDENCE_SOURCE_IDS;
  const sources: EvidenceSourceId[] = [];
  for (const raw of rawSources) {
    if (typeof raw !== 'string') continue;
    const sourceId = normalizeSourceId(raw);
    if (isEvidenceSourceId(sourceId) && !sources.includes(sourceId)) {
      sources.push(sourceId);
    }
  }

  const bucketHours = typeof input.bucketHours === 'number' && input.bucketHours > 0
    ? Math.min(Math.floor(input.bucketHours), 24)
    : DEFAULT_BUCKET_HOURS;

  const fullstoryUrlRaw = typeof input.fullstoryUrl === 'string' ? input.fullstoryUrl.trim() : '';

  return {
    appId,
    timeWindow: clampWindow(typeof input.timeWindow === 'string' ? input.timeWindow : undefined),
    sources: sources.length > 0 ? sources : [...DEFAULT_EVIDENCE_SOURCE_IDS],
    bucketHours,
    ...(fullstoryUrlRaw ? { fullstoryUrl: fullstoryUrlRaw } : {}),
  };
}

export function buildLokiEvidenceQuery(sourceConfig: LogSourceConfig, appId: string): string {
  const labels = Object.entries(sourceConfig.lokiLabels || {})
    .filter(([, value]) => value)
    .map(([key, value]) => `${key}="${escapeLogQLString(value)}"`);
  const selector = `{${labels.join(',')}}`;
  return `${selector} |= "\\"app_id\\":\\"${escapeLogQLString(appId)}\\""`;
}

export function extractClusterFromUrl(url: string): string | null {
  try {
    const normalized = url.includes('://') ? url : `https://${url}`;
    const { hostname } = new URL(normalized);
    // Expected pattern: <appId>.<service>.<cluster>.airoapp.ai
    const parts = hostname.split('.');
    if (
      parts.length >= 4 &&
      parts[parts.length - 2] === 'airoapp' &&
      parts[parts.length - 1] === 'ai'
    ) {
      return parts[parts.length - 3] || null;
    }
    return null;
  } catch {
    return null;
  }
}

const MERGED_LOKI_JOB_PATTERN = 'airo-agents|airo-preview-application|airo-publish-application';

export function buildMergedLokiQuery(
  cluster: string | null,
  env: string,
  appId: string,
): string {
  const labels: string[] = [`job=~"(${MERGED_LOKI_JOB_PATTERN})"`];
  if (cluster) labels.push(`cluster="${escapeLogQLString(cluster)}"`);
  labels.push(`env="${escapeLogQLString(env)}"`);
  return `{${labels.join(',')}} |= "\\"app_id\\":\\"${escapeLogQLString(appId)}\\""`;
}

// Cluster IDs are derived from the agent URL (`<appId>.<svc>.<cluster>.airoapp.ai`)
// and effectively never change for a given app. The mgmt roundtrip costs ~3.5s
// on a cold call — well above the 30s shared cache in mgmt-control-plane-adapter
// (which gets evicted between page loads at the Logs tab cadence). A dedicated
// 5-min cache here means a refreshed Logs tab pays the cost once per session
// instead of every fetch. Cache `null` too — a non-matching URL pattern (or a
// failed lookup) won't quietly fix itself in 5 min, and re-paying 3.5s per
// query for a flaky upstream is worse than briefly serving a stale `null`.
const CLUSTER_CACHE_TTL_MS = 5 * 60_000;
// Bound on entries — support engineers can browse hundreds of distinct apps
// per session and Map.size only shrinks at TTL expiry. 500 covers a long
// debugging session while keeping memory bounded; oldest-insertion eviction
// matches the pattern used in mgmt-control-plane-adapter and useAppContext.
const CLUSTER_CACHE_MAX_ENTRIES = 500;
interface ClusterCacheEntry { value: string | null; expiresAt: number }
const clusterCache = new Map<string, ClusterCacheEntry>();
const clusterInFlight = new Map<string, Promise<string | null>>();

function setClusterCache(appId: string, value: string | null): void {
  if (clusterCache.size >= CLUSTER_CACHE_MAX_ENTRIES) {
    const oldest = clusterCache.keys().next().value;
    if (oldest !== undefined) clusterCache.delete(oldest);
  }
  clusterCache.set(appId, { value, expiresAt: Date.now() + CLUSTER_CACHE_TTL_MS });
}

/** Test-only: clear the resolveAppCluster cache so tests don't leak state. */
export function __clearClusterCacheForTests(): void {
  clusterCache.clear();
  clusterInFlight.clear();
}

export async function resolveAppCluster(
  appId: string,
  getAgentUrl?: (appId: string) => Promise<string>,
): Promise<string | null> {
  // Bypass the cache when a custom resolver is supplied (tests pass a mocked
  // URL fetcher; treating those as cacheable would make the second test see
  // the first test's cluster).
  if (getAgentUrl) {
    try {
      return extractClusterFromUrl(await getAgentUrl(appId));
    } catch {
      return null;
    }
  }

  const hit = clusterCache.get(appId);
  if (hit && Date.now() < hit.expiresAt) return hit.value;

  const inFlight = clusterInFlight.get(appId);
  if (inFlight) return inFlight;

  const promise = (async (): Promise<string | null> => {
    try {
      const url = await mgmtControlPlaneAdapter.getAgentUrl(appId);
      return extractClusterFromUrl(url);
    } catch {
      return null;
    }
  })()
    .then((value) => {
      setClusterCache(appId, value);
      return value;
    })
    .finally(() => {
      clusterInFlight.delete(appId);
    });

  clusterInFlight.set(appId, promise);
  return promise;
}

function parseLokiLog(timestampNs: string, line: string, stream: Record<string, string>, sourceId: string): EvidenceLog {
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(line) as Record<string, unknown>;
  } catch {
    parsed = { log: line };
  }
  const message = String(parsed.message || parsed.msg || parsed.log || line);
  const level = String(stream.detected_level || parsed.level || 'unknown').toLowerCase();
  return {
    id: `${timestampNs}-${line.slice(0, 40).replace(/[^a-zA-Z0-9]/g, '')}`,
    timestamp: nsToIso(timestampNs),
    level,
    message,
    event: (parsed.event || parsed.type) as string | undefined,
    sourceId,
    raw: {
      ...stream,
      ...parsed,
      '@timestamp': nsToIso(timestampNs),
      _loki_timestamp_ns: timestampNs,
      // Preserve stream labels after parsed-JSON spread so routing logic
      // (e.g. LOKI_JOB_TO_SOURCE_ID) always reads the Loki label, not a
      // customer app field that happens to be named 'job'.
      _loki_stream_job: stream.job,
    },
  };
}

export async function collectLokiEvidence(params: {
  sourceConfig: LogSourceConfig;
  appId: string;
  startTime: Date;
  endTime: Date;
  bucketLabel?: string;
  limit?: number;
  timeoutMs?: number;
  fetchImpl?: FetchImpl;
  queryOverride?: string;
}): Promise<{ complete: boolean; logs: EvidenceLog[]; rawPages: EvidenceRawPage[]; diagnostics: EvidenceDiagnostics; incomplete: EvidenceIndex['coverage']['incomplete'] }> {
  const started = Date.now();
  const fetchImpl = params.fetchImpl || fetch;
  const limit = params.limit || LOKI_LIMIT;
  const endpoint = (params.sourceConfig.lokiEndpoint || '').replace(/\/+$/, '');
  if (!endpoint) throw new Error(`Loki endpoint not configured for ${params.sourceConfig.id}`);

  const query = params.queryOverride ?? buildLokiEvidenceQuery(params.sourceConfig, params.appId);
  const endNs = BigInt(toNs(params.endTime));
  let cursorNs = BigInt(toNs(params.startTime));
  let previousCursorLines = new Set<string>();
  const logs: EvidenceLog[] = [];
  const rawPages: EvidenceRawPage[] = [];
  const incomplete: EvidenceIndex['coverage']['incomplete'] = [];
  const bucketLabel = params.bucketLabel || 'loki';
  let pageCount = 0;
  let complete = true;

  while (cursorNs < endNs) {
    const url = new URL(`${endpoint}/loki/api/v1/query_range`);
    url.searchParams.set('query', query);
    url.searchParams.set('start', cursorNs.toString());
    url.searchParams.set('end', endNs.toString());
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('direction', 'forward');

    const headers: Record<string, string> = {};
    if (params.sourceConfig.lokiApiKey) {
      headers.Authorization = `Bearer ${params.sourceConfig.lokiApiKey}`;
    }

    let response: Response;
    try {
      response = await fetchImpl(url, {
        headers,
        signal: AbortSignal.timeout(params.timeoutMs || 60_000),
      });
    } catch (err) {
      complete = false;
      incomplete.push({ bucket: bucketLabel, start: params.startTime.toISOString(), end: params.endTime.toISOString(), error: err instanceof Error ? err.message : String(err) });
      break;
    }
    pageCount++;

    if (!response.ok) {
      const body = await response.text().catch(() => '<body read failed>');
      complete = false;
      incomplete.push({ bucket: bucketLabel, start: params.startTime.toISOString(), end: params.endTime.toISOString(), error: `HTTP ${response.status}: ${body.slice(0, 300)}` });
      break;
    }

    let json: LokiQueryRangeResponse;
    try {
      json = await response.json() as LokiQueryRangeResponse;
    } catch (err) {
      complete = false;
      incomplete.push({ bucket: bucketLabel, start: params.startTime.toISOString(), end: params.endTime.toISOString(), error: `non-JSON response: ${err instanceof Error ? err.message : String(err)}` });
      break;
    }
    if (json.status === 'error') {
      complete = false;
      incomplete.push({ bucket: bucketLabel, start: params.startTime.toISOString(), end: params.endTime.toISOString(), error: `${json.errorType || 'loki'}: ${json.error || 'unknown error'}` });
      break;
    }
    const streams = json.data?.result;
    if (!Array.isArray(streams)) {
      complete = false;
      incomplete.push({ bucket: bucketLabel, start: params.startTime.toISOString(), end: params.endTime.toISOString(), error: 'unexpected Loki response shape' });
      break;
    }

    const pageEntries: Array<{ ts: string; line: string; stream: Record<string, string> }> = [];
    for (const stream of streams) {
      for (const [ts, line] of stream.values) {
        pageEntries.push({ ts, line, stream: stream.stream });
      }
    }
    pageEntries.sort((a, b) => (BigInt(a.ts) < BigInt(b.ts) ? -1 : BigInt(a.ts) > BigInt(b.ts) ? 1 : 0));
    if (pageEntries.length === 0) break;

    const emitted = pageEntries.filter((entry) => !(BigInt(entry.ts) === cursorNs && previousCursorLines.has(entry.line)));
    const pageLogs = emitted.map((entry) => parseLokiLog(entry.ts, entry.line, entry.stream, params.sourceConfig.id));
    logs.push(...pageLogs);
    rawPages.push({
      page: rawPages.length,
      bucket: bucketLabel,
      start: params.startTime.toISOString(),
      end: params.endTime.toISOString(),
      logs: pageLogs,
    });

    if (pageEntries.length < limit) break;
    const lastNs = BigInt(pageEntries[pageEntries.length - 1].ts);
    const nextCursorLines = lastNs === cursorNs
      ? new Set(previousCursorLines)
      : new Set<string>();
    for (const entry of pageEntries) {
      if (BigInt(entry.ts) === lastNs) nextCursorLines.add(entry.line);
    }
    cursorNs = lastNs;
    previousCursorLines = nextCursorLines;
    if (emitted.length === 0) {
      complete = false;
      incomplete.push({ bucket: bucketLabel, start: params.startTime.toISOString(), end: params.endTime.toISOString(), error: `Loki cursor stuck at ${cursorNs.toString()}` });
      break;
    }
  }

  return {
    complete,
    logs,
    rawPages,
    incomplete,
    diagnostics: {
      elapsedMs: Date.now() - started,
      pageCount,
      query,
      truncated: !complete,
      ...(incomplete[0]?.error ? { error: incomplete[0].error } : {}),
    },
  };
}

export async function collectMergedLokiSources(params: {
  appId: string;
  timeWindow: string;
  cluster: string | null;
  bucketHours?: number;
  fetchImpl?: FetchImpl;
}): Promise<EvidenceSourceResult[]> {
  const { startTime, endTime } = parseTimeRange(params.timeWindow);
  const window = { label: params.timeWindow, start: startTime.toISOString(), end: endTime.toISOString() };
  const buckets = buildEvidenceBuckets(startTime, endTime, params.bucketHours || DEFAULT_BUCKET_HOURS);

  const agentsConfig = getLogSourceConfig('airo-agents');
  const previewConfig = getLogSourceConfig('airo-preview');
  const publishConfig = getLogSourceConfig('airo-publish');
  if (!agentsConfig || !previewConfig || !publishConfig) {
    throw new Error('Loki source config missing for merged query');
  }
  const env = agentsConfig.environment || 'prod';
  const mergedQuery = buildMergedLokiQuery(params.cluster, env, params.appId);

  // Synthetic source config: carries endpoint + apiKey, but lokiLabels unused (queryOverride takes precedence)
  const mergedSourceConfig: LogSourceConfig = {
    ...agentsConfig,
    id: 'merged-loki',
    lokiLabels: {},
  };

  const collectedParts = await Promise.all(
    buckets.map((bucket) =>
      collectLokiEvidence({
        sourceConfig: mergedSourceConfig,
        appId: params.appId,
        startTime: bucket.startTime,
        endTime: bucket.endTime,
        bucketLabel: bucket.label,
        fetchImpl: params.fetchImpl,
        queryOverride: mergedQuery,
      }),
    ),
  );

  const merged = mergeCollected(collectedParts);

  // Split rawPages back into per-source buckets using the `job` stream label
  const pagesBySource = new Map<string, EvidenceRawPage[]>([
    ['airo-agents', []],
    ['airo-preview', []],
    ['airo-publish', []],
  ]);

  for (const rawPage of merged.rawPages) {
    const bySource = new Map<string, EvidenceLog[]>([
      ['airo-agents', []],
      ['airo-preview', []],
      ['airo-publish', []],
    ]);
    for (const log of rawPage.logs) {
      const job = String((log.raw as Record<string, unknown>)._loki_stream_job || '');
      const sid = LOKI_JOB_TO_SOURCE_ID[job];
      if (!sid) continue;
      bySource.get(sid)!.push({ ...log, sourceId: sid });
    }
    for (const [sid, logs] of bySource) {
      if (logs.length > 0) {
        pagesBySource.get(sid)!.push({ ...rawPage, logs });
      }
    }
  }

  const sourceConfigs: Record<string, LogSourceConfig> = {
    'airo-agents': agentsConfig,
    'airo-preview': previewConfig,
    'airo-publish': publishConfig,
  };

  return ['airo-agents', 'airo-preview', 'airo-publish'].map((sid) => {
    const rawPages = pagesBySource.get(sid)!;
    const sourceConfig = sourceConfigs[sid];
    const index = buildEvidenceIndex({
      source: sourceConfig,
      appId: params.appId,
      window,
      rawPages,
      incomplete: merged.incomplete,
      diagnostics: { ...merged.diagnostics, query: mergedQuery },
    });
    return {
      sourceId: sid,
      complete: merged.complete && index.coverage.complete,
      rawPages,
      index,
    };
  });
}

function buildSignature(message: string): string {
  return message
    .replace(/https?:\/\/\S+/g, '<url>')
    .replace(/\b[a-f0-9]{8,}\b/gi, '<hex>')
    .replace(/\b[0-9a-f]{2,}(?:-[0-9a-f]{2,})+\b/gi, '<id>')
    .replace(/\b\d+(ms|s)\b/g, '#$1')
    .replace(/\b\d+\b/g, '#')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240);
}

function rawRef(sourceId: string, page: EvidenceRawPage, index = '*'): string {
  return `${sourceId}/${page.bucket}-p${String(page.page).padStart(4, '0')}.json#$.logs[${index}]`;
}

function buildEvidenceBuckets(startTime: Date, endTime: Date, bucketHours: number): EvidenceBucket[] {
  const buckets: EvidenceBucket[] = [];
  const stepMs = Math.max(1, bucketHours) * 60 * 60 * 1000;
  let cursor = startTime.getTime();
  let index = 0;
  while (cursor < endTime.getTime()) {
    const next = Math.min(cursor + stepMs, endTime.getTime());
    buckets.push({
      label: `b${String(index).padStart(3, '0')}`,
      startTime: new Date(cursor),
      endTime: new Date(next),
    });
    cursor = next;
    index++;
  }
  return buckets.length > 0 ? buckets : [{ label: 'b000', startTime, endTime }];
}

function mergeCollected(parts: Array<{
  complete: boolean;
  rawPages: EvidenceRawPage[];
  diagnostics: EvidenceDiagnostics;
  incomplete: EvidenceIndex['coverage']['incomplete'];
}>): { complete: boolean; rawPages: EvidenceRawPage[]; diagnostics: EvidenceDiagnostics; incomplete: EvidenceIndex['coverage']['incomplete'] } {
  return {
    complete: parts.every((part) => part.complete),
    rawPages: parts.flatMap((part) => part.rawPages),
    incomplete: parts.flatMap((part) => part.incomplete),
    diagnostics: {
      elapsedMs: parts.reduce((total, part) => total + part.diagnostics.elapsedMs, 0),
      pageCount: parts.reduce((total, part) => total + part.diagnostics.pageCount, 0),
      query: parts.map((part) => part.diagnostics.query).filter(Boolean).join('\n'),
      truncated: parts.some((part) => part.diagnostics.truncated),
      ...(parts.find((part) => part.diagnostics.error)?.diagnostics.error
        ? { error: parts.find((part) => part.diagnostics.error)?.diagnostics.error }
        : {}),
    },
  };
}

type EvidenceSourceConfig = Pick<EvidenceIndex['source'], 'id' | 'name' | 'description' | 'backendType'>;

export function buildEvidenceIndex(params: {
  source: EvidenceSourceConfig;
  appId: string;
  window: { label: string; start: string; end: string };
  rawPages: EvidenceRawPage[];
  incomplete: EvidenceIndex['coverage']['incomplete'];
  diagnostics: EvidenceDiagnostics;
}): EvidenceIndex {
  const levelCounts = new Map<string, number>();
  const signatureCounts = new Map<string, number>();
  const signatureRefs = new Map<string, string>();
  const rareErrorSignatures: EvidenceIndex['rareErrorSignatures'] = [];
  const allLogs = params.rawPages.flatMap((page) => page.logs.map((log, index) => ({ log, page, index })));

  for (const { log, page, index } of allLogs) {
    const level = log.level || 'unknown';
    levelCounts.set(level, (levelCounts.get(level) || 0) + 1);
    const signature = buildSignature(log.message || '');
    signatureCounts.set(signature, (signatureCounts.get(signature) || 0) + 1);
    if (!signatureRefs.has(signature)) {
      signatureRefs.set(signature, rawRef(params.source.id, page, String(index)));
    }
  }

  for (const [signature, count] of signatureCounts) {
    const lower = signature.toLowerCase();
    if (count <= 3 && /(error|exception|failed|typeerror|referenceerror|blank|\b4#|\b5#)/.test(lower)) {
      rareErrorSignatures.push({ signature, count, rawRef: signatureRefs.get(signature) || '' });
    }
  }

  return {
    appId: params.appId,
    source: {
      id: params.source.id,
      name: params.source.name,
      consoleSource: params.source.id,
      backendType: params.source.backendType,
      description: params.source.description,
    },
    window: params.window,
    coverage: {
      complete: params.incomplete.length === 0 && !params.diagnostics.truncated,
      fetchedLogCount: allLogs.length,
      incompleteBucketCount: params.incomplete.length,
      incomplete: params.incomplete,
    },
    diagnostics: params.diagnostics,
    levelCounts: Object.fromEntries([...levelCounts.entries()].sort((a, b) => b[1] - a[1])),
    topSignatures: [...signatureCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 25)
      .map(([signature, count]) => ({ signature, count, rawRef: signatureRefs.get(signature) || '' })),
    rareErrorSignatures: rareErrorSignatures.slice(0, 50),
    rawRefs: params.rawPages.map((page) => rawRef(params.source.id, page)),
  };
}

function normalizeEsHit(sourceConfig: LogSourceConfig, hit: { _id?: string; _source?: Record<string, unknown> }): EvidenceLog {
  const src = hit._source || {};
  const rawLog = src.log as string | undefined;
  let level = (getNestedValue(src, sourceConfig.fieldMapping.levelField) as string) || '';
  let message = (getNestedValue(src, sourceConfig.fieldMapping.messageField) as string) || '';
  if (!level && rawLog) {
    level = rawLog.match(/\]\s+(DEBUG|INFO|WARN|ERROR|FATAL)\s+/i)?.[1]?.toLowerCase() || '';
  }
  if (!message && rawLog) message = rawLog;
  return {
    id: hit._id,
    timestamp: String(getNestedValue(src, sourceConfig.fieldMapping.timestampField) || ''),
    level: (level || 'unknown').toLowerCase(),
    message,
    event: getNestedValue(src, sourceConfig.fieldMapping.eventField) as string | undefined,
    sourceId: sourceConfig.id,
    raw: src,
  };
}

export async function collectElasticsearchEvidence(params: {
  sourceConfig: LogSourceConfig;
  appId: string;
  startTime: Date;
  endTime: Date;
  bucketLabel?: string;
  fetchImpl?: FetchImpl;
}): Promise<{ complete: boolean; rawPages: EvidenceRawPage[]; diagnostics: EvidenceDiagnostics; incomplete: EvidenceIndex['coverage']['incomplete'] }> {
  const started = Date.now();
  const fetchImpl = params.fetchImpl || fetch;
  const incomplete: EvidenceIndex['coverage']['incomplete'] = [];
  const bucketLabel = params.bucketLabel || 'es';
  const rawPages: EvidenceRawPage[] = [];
  if (!params.sourceConfig.endpoint || !params.sourceConfig.index || !params.sourceConfig.apiKey) {
    incomplete.push({ bucket: bucketLabel, start: params.startTime.toISOString(), end: params.endTime.toISOString(), error: `Elasticsearch config missing for ${params.sourceConfig.id}` });
    return { complete: false, rawPages, incomplete, diagnostics: { elapsedMs: Date.now() - started, pageCount: 0, query: '', truncated: true, error: incomplete[0].error } };
  }

  let from = 0;
  let page = 0;
  let pageCount = 0;
  let complete = true;
  const must: Array<Record<string, unknown>> = [
    { range: { [params.sourceConfig.fieldMapping.timestampField]: { gte: params.startTime.toISOString(), lte: params.endTime.toISOString() } } },
  ];
  const appIdQuery = buildAppIdQuery(params.appId, params.sourceConfig.fieldMapping);
  if (appIdQuery) must.push(appIdQuery);

  while (true) {
    const esQuery = {
      size: ES_PAGE_SIZE,
      from,
      sort: [{ [params.sourceConfig.fieldMapping.timestampField]: { order: 'asc' } }],
      query: { bool: { must } },
    };
    let response: Response;
    try {
      response = await fetchImpl(`${params.sourceConfig.endpoint}/${params.sourceConfig.index}/_search?ignore_unavailable=true&expand_wildcards=open`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `ApiKey ${params.sourceConfig.apiKey}`,
        },
        body: JSON.stringify(esQuery),
      });
    } catch (err) {
      complete = false;
      incomplete.push({ bucket: bucketLabel, start: params.startTime.toISOString(), end: params.endTime.toISOString(), error: err instanceof Error ? err.message : String(err) });
      break;
    }
    pageCount++;
    if (!response.ok) {
      const body = await response.text().catch(() => '<body read failed>');
      complete = false;
      incomplete.push({ bucket: bucketLabel, start: params.startTime.toISOString(), end: params.endTime.toISOString(), error: `HTTP ${response.status}: ${body.slice(0, 300)}` });
      break;
    }
    let json: { hits?: { hits?: Array<{ _id?: string; _source?: Record<string, unknown> }> } };
    try {
      json = await response.json() as { hits?: { hits?: Array<{ _id?: string; _source?: Record<string, unknown> }> } };
    } catch (err) {
      complete = false;
      incomplete.push({ bucket: bucketLabel, start: params.startTime.toISOString(), end: params.endTime.toISOString(), error: `non-JSON response: ${err instanceof Error ? err.message : String(err)}` });
      break;
    }
    const hits = json.hits?.hits || [];
    rawPages.push({
      page,
      bucket: bucketLabel,
      start: params.startTime.toISOString(),
      end: params.endTime.toISOString(),
      logs: hits.map((hit) => normalizeEsHit(params.sourceConfig, hit)),
    });
    if (hits.length < ES_PAGE_SIZE) break;
    from += ES_PAGE_SIZE;
    page++;
  }

  return {
    complete,
    rawPages,
    incomplete,
    diagnostics: { elapsedMs: Date.now() - started, pageCount, query: JSON.stringify({ must }), truncated: !complete, ...(incomplete[0]?.error ? { error: incomplete[0].error } : {}) },
  };
}


interface LangfuseConfig {
  baseUrl: string;
  authHeader: string;
}

interface LangfuseTraceListResponse {
  data?: Array<{ id?: string }>;
  meta?: { totalPages?: number; totalItems?: number };
}

interface LangfuseObservation {
  id?: string;
  name?: string | null;
  type?: string | null;
  level?: string | null;
  statusMessage?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  totalTokens?: number | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  calculatedTotalCost?: number | null;
}

interface LangfuseTraceDetail {
  id?: string;
  name?: string | null;
  timestamp?: string;
  sessionId?: string | null;
  userId?: string | null;
  input?: unknown;
  output?: unknown;
  metadata?: Record<string, unknown> | null;
  tags?: string[];
  totalCost?: number | null;
  latency?: number | null;
  observations?: LangfuseObservation[];
}

function compactJson(value: unknown, limit = 220): string {
  if (value == null) return '';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.replace(/\s+/g, ' ').slice(0, limit);
}

function observationLevel(observation: LangfuseObservation): string {
  return String(observation.level || '').toLowerCase();
}

function isErrorObservation(observation: LangfuseObservation): boolean {
  return observationLevel(observation) === 'error';
}

function normalizeLangfuseTrace(trace: LangfuseTraceDetail): EvidenceLog {
  const observations = Array.isArray(trace.observations) ? trace.observations : [];
  const hasError = observations.some(isErrorObservation);
  const level = hasError ? 'error' : 'info';
  const status = observations.find((obs) => obs.statusMessage)?.statusMessage;
  const messageParts = [trace.name || 'langfuse trace'];
  if (trace.sessionId) messageParts.push(`session=${trace.sessionId}`);
  if (status) messageParts.push(`status=${status}`);
  const output = compactJson(trace.output);
  if (output) messageParts.push(output);

  return {
    id: trace.id,
    timestamp: trace.timestamp || '',
    level,
    message: messageParts.join(' | '),
    event: trace.name || undefined,
    sourceId: 'langfuse',
    raw: {
      ...trace,
      observationCount: observations.length,
      errorObservationCount: observations.filter(isErrorObservation).length,
    } as Record<string, unknown>,
  };
}


interface LangfuseTraceDetailResult {
  trace?: LangfuseTraceDetail;
  error?: string;
}

export async function collectLangfuseEvidence(params: {
  appId: string;
  startTime: Date;
  endTime: Date;
  langfuse: LangfuseConfig;
  fetchImpl?: FetchImpl;
  timeoutMs?: number;
}): Promise<{ complete: boolean; rawPages: EvidenceRawPage[]; diagnostics: EvidenceDiagnostics; incomplete: EvidenceIndex['coverage']['incomplete'] }> {
  const started = Date.now();
  const fetchImpl = params.fetchImpl || fetch;
  const endpoint = params.langfuse.baseUrl.replace(/\/+$/, '');
  const incomplete: EvidenceIndex['coverage']['incomplete'] = [];
  const rawPages: EvidenceRawPage[] = [];
  const appIdFilter = buildAppIdFilter(params.appId);
  const query = JSON.stringify({ filter: appIdFilter, fromTimestamp: params.startTime.toISOString(), toTimestamp: params.endTime.toISOString() });
  let complete = true;
  let page = 1;
  let totalPages = 1;
  // Intentionally not reset between pages: a sustained auth or network failure
  // should terminate the source quickly rather than drain the page budget.
  let detailFailureCount = 0;
  let stopCollection = false;

  while (page <= totalPages) {
    // Global wall-clock ceiling prevents a noisy app from starving other
    // evidence sources of the Lambda's remaining runtime.
    if (Date.now() - started > MAX_LANGFUSE_ELAPSED_MS) {
      complete = false;
      incomplete.push({
        bucket: `p${String(page).padStart(3, '0')}`,
        start: params.startTime.toISOString(),
        end: params.endTime.toISOString(),
        error: `Langfuse collection exceeded ${MAX_LANGFUSE_ELAPSED_MS}ms budget after ${page - 1} pages; stopping`,
      });
      break;
    }
    const bucket = `p${String(page).padStart(3, '0')}`;
    const url = new URL(`${endpoint}/api/public/traces`);
    url.searchParams.set('page', String(page));
    url.searchParams.set('limit', String(LANGFUSE_PAGE_SIZE));
    url.searchParams.set('filter', appIdFilter);
    url.searchParams.set('fromTimestamp', params.startTime.toISOString());
    url.searchParams.set('toTimestamp', params.endTime.toISOString());

    let response: Response;
    try {
      response = await fetchImpl(url, {
        headers: {
          Authorization: params.langfuse.authHeader,
          'Accept-Encoding': 'gzip, deflate, br',
        },
        signal: AbortSignal.timeout(params.timeoutMs || 60_000),
      });
    } catch (err) {
      complete = false;
      incomplete.push({ bucket, start: params.startTime.toISOString(), end: params.endTime.toISOString(), error: err instanceof Error ? err.message : String(err) });
      break;
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '<body read failed>');
      complete = false;
      incomplete.push({ bucket, start: params.startTime.toISOString(), end: params.endTime.toISOString(), error: `HTTP ${response.status}: ${body.slice(0, 300)}` });
      break;
    }

    let listJson: LangfuseTraceListResponse;
    try {
      listJson = await response.json() as LangfuseTraceListResponse;
    } catch (err) {
      complete = false;
      incomplete.push({ bucket, start: params.startTime.toISOString(), end: params.endTime.toISOString(), error: `non-JSON response: ${err instanceof Error ? err.message : String(err)}` });
      break;
    }

    const traceIds = (Array.isArray(listJson.data) ? listJson.data : [])
      .map((trace) => trace.id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0);
    totalPages = Math.max(1, Number(listJson.meta?.totalPages || 1));
    if (totalPages > MAX_LANGFUSE_PAGES) {
      complete = false;
      totalPages = MAX_LANGFUSE_PAGES;
    }
    const traces: LangfuseTraceDetail[] = [];

    for (let offset = 0; offset < traceIds.length; offset += LANGFUSE_DETAIL_BATCH_SIZE) {
      const batch = traceIds.slice(offset, offset + LANGFUSE_DETAIL_BATCH_SIZE);
      const results = await Promise.all(batch.map(async (traceId): Promise<LangfuseTraceDetailResult> => {
        for (let attempt = 0; attempt <= 1; attempt++) {
          try {
            if (attempt > 0) await new Promise((r) => setTimeout(r, 2000));
            const detailResponse = await fetchImpl(`${endpoint}/api/public/traces/${encodeURIComponent(traceId)}`, {
              headers: {
                Authorization: params.langfuse.authHeader,
                'Accept-Encoding': 'gzip, deflate, br',
              },
              signal: AbortSignal.timeout(params.timeoutMs || 60_000),
            });
            if (!detailResponse.ok) {
              const body = await detailResponse.text().catch(() => '<body read failed>');
              const msg = `trace detail ${traceId} HTTP ${detailResponse.status}: ${body.slice(0, 120)}`;
              // 5xx: transient — retry once. 4xx: permanent — return error immediately.
              if (detailResponse.status >= 500 && attempt === 0) continue;
              return { error: msg };
            }
            return { trace: await detailResponse.json() as LangfuseTraceDetail };
          } catch (err) {
            // Network/timeout error — retry once then give up
            if (attempt === 0) continue;
            return { error: err instanceof Error ? err.message : String(err) };
          }
        }
        return { error: `trace detail ${traceId}: unreachable` };
      }));
      for (const result of results) {
        if (result.trace) {
          traces.push(result.trace);
          continue;
        }
        if (!result.error) continue;
        complete = false;
        detailFailureCount += 1;
        if (detailFailureCount <= MAX_LANGFUSE_DETAIL_ERROR_SAMPLES) {
          incomplete.push({ bucket, start: params.startTime.toISOString(), end: params.endTime.toISOString(), error: result.error });
        }
      }
      if (detailFailureCount >= MAX_LANGFUSE_DETAIL_FAILURES) {
        incomplete.push({
          bucket,
          start: params.startTime.toISOString(),
          end: params.endTime.toISOString(),
          error: `too many Langfuse trace detail failures (${detailFailureCount}); stopping detail collection`,
        });
        stopCollection = true;
        break;
      }
    }

    rawPages.push({
      page: page - 1,
      bucket,
      start: params.startTime.toISOString(),
      end: params.endTime.toISOString(),
      logs: traces
        .sort((a, b) => new Date(a.timestamp || 0).getTime() - new Date(b.timestamp || 0).getTime())
        .map((trace) => normalizeLangfuseTrace(trace)),
    });

    if (stopCollection) break;
    if (page >= totalPages) {
      if (Number(listJson.meta?.totalPages || 1) > MAX_LANGFUSE_PAGES) {
        incomplete.push({
          bucket,
          start: params.startTime.toISOString(),
          end: params.endTime.toISOString(),
          error: `Langfuse page limit reached (${MAX_LANGFUSE_PAGES}); source may have more traces`,
        });
      }
      break;
    }
    page += 1;
  }

  return {
    complete,
    rawPages,
    incomplete,
    diagnostics: {
      elapsedMs: Date.now() - started,
      pageCount: rawPages.length,
      query,
      truncated: !complete,
      ...(incomplete[0]?.error ? { error: incomplete[0].error } : {}),
    },
  };
}

function langfuseSourceConfig(): EvidenceSourceConfig {
  return {
    id: 'langfuse',
    name: 'Langfuse',
    description: 'EB Langfuse traces filtered by metadata.business_data_appId',
    backendType: 'langfuse',
  };
}

function fullstorySourceConfig(): EvidenceSourceConfig {
  return {
    id: 'fullstory',
    name: 'FullStory',
    description: 'FullStory session replays discovered via hosted MCP server (build_segment + get_sessions + get_session_events)',
    backendType: 'fullstory',
  };
}

const FULLSTORY_MAX_SESSIONS = 3;
const FULLSTORY_LIST_LIMIT = 10;
const FULLSTORY_MAX_EVENT_LINES_PER_SESSION = 1000;
const FULLSTORY_PAIN_EVENT_PATTERN = /rage[-_ ]?click|dead[-_ ]?click|error[-_ ]?click|console-error|feedback|exception|uncaught|\berror\b/i;

interface FullstorySessionRef {
  device_id: string;
  session_id: string;
  session_url?: string;
  /** Epoch-ms anchor from the URL's third segment, when known. */
  anchor_epoch_ms?: number;
}

interface FullstoryGetSessionsResponse {
  sessions?: FullstorySessionRef[];
}

interface FullstoryBuildSegmentResponse {
  segment_id?: string;
  segment_name?: string;
  segment_url?: string;
}

interface FullstoryGetSessionEventsResponse {
  events?: string;
  session_url?: string;
  device_id?: string;
  session_id?: string;
}

/** Lines in the transcript look like `[MM:SS]`, `(+Xs)`, or bare continuations. */
function parseEventLineOffsetSec(line: string, previousOffsetSec: number): number {
  const abs = line.match(/^\s*\[(\d+):(\d{1,2})\]/);
  if (abs) return Number(abs[1]) * 60 + Number(abs[2]);
  const rel = line.match(/\(\+(\d+)s\)/);
  if (rel) return previousOffsetSec + Number(rel[1]);
  return previousOffsetSec;
}

function detectEventLevel(line: string): string {
  return FULLSTORY_PAIN_EVENT_PATTERN.test(line) ? 'error' : 'info';
}

function detectEventKind(line: string): string | undefined {
  const match = line.match(/\b(navigate|click|element-seen|rage-click|dead-click|error-click|console-error|feedback|page-view)\b/i);
  return match ? match[1].toLowerCase() : undefined;
}

function normalizeFullstorySessionEvents(
  session: FullstorySessionRef,
  eventsText: string,
): EvidenceLog[] {
  const lines = eventsText
    .split('\n')
    .map((line) => line.replace(/\s+$/g, ''))
    .filter((line) => line.trim().length > 0 && !line.startsWith('#') && !line.startsWith('<<<') && !line.startsWith('>>>'));

  // Timestamp strategy depends on whether the caller had a real epoch anchor
  // (typically from a numeric URL's `:TS` suffix captured at feedback-submit
  // time):
  //   - With an anchor: approximate session start as `anchor - maxOffsetSec`,
  //     then emit real UTC timestamps so they correlate directly with
  //     Loki/Langfuse events.
  //   - Without an anchor (discovery path): anchor to the Unix epoch so the
  //     `1970-01-01T00:MM:SS` prefix is an obvious "session-relative, not
  //     wall-clock" signal. `raw.offset_seconds` plus `session_url` are the
  //     correlation handles in that case.
  let maxOffsetSec = 0;
  {
    let cursor = 0;
    for (const line of lines) {
      cursor = parseEventLineOffsetSec(line, cursor);
      if (cursor > maxOffsetSec) maxOffsetSec = cursor;
    }
  }
  const sessionStartMs = session.anchor_epoch_ms
    ? session.anchor_epoch_ms - maxOffsetSec * 1000
    : 0;

  const logs: EvidenceLog[] = [];
  let offsetSec = 0;
  for (const line of lines) {
    offsetSec = parseEventLineOffsetSec(line, offsetSec);
    const level = detectEventLevel(line);
    // Keep all pain events; sample boring events to stay within budget.
    if (level !== 'error' && logs.length >= FULLSTORY_MAX_EVENT_LINES_PER_SESSION) continue;
    const timestamp = new Date(sessionStartMs + offsetSec * 1000).toISOString();
    logs.push({
      id: `${session.session_id}-${offsetSec}-${logs.length}`,
      timestamp,
      level,
      message: line.trim().slice(0, 500),
      event: detectEventKind(line),
      sourceId: 'fullstory',
      raw: {
        device_id: session.device_id,
        session_id: session.session_id,
        session_url: session.session_url,
        offset_seconds: offsetSec,
        line: line.trim(),
      },
    });
  }
  return logs;
}

export async function collectFullstoryEvidence(params: {
  appId: string;
  startTime: Date;
  endTime: Date;
  fullstory: FullstoryMcpConfig;
  fullstoryUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<{ complete: boolean; rawPages: EvidenceRawPage[]; diagnostics: EvidenceDiagnostics; incomplete: EvidenceIndex['coverage']['incomplete'] }> {
  const started = Date.now();
  const incomplete: EvidenceIndex['coverage']['incomplete'] = [];
  const notes: string[] = [];
  const rawPages: EvidenceRawPage[] = [];
  const windowStart = params.startTime.toISOString();
  const windowEnd = params.endTime.toISOString();
  const callOpts = { fetchImpl: params.fetchImpl, timeoutMs: params.timeoutMs };
  let complete = true;
  let query = '';

  const sessions: FullstorySessionRef[] = [];

  let fellBackToDiscovery = false;
  if (params.fullstoryUrl) {
    const parsed = parseFullstorySessionUrl(params.fullstoryUrl);
    if (!parsed) {
      incomplete.push({ bucket: 'url', start: windowStart, end: windowEnd, error: `unparseable FullStory URL: ${params.fullstoryUrl}` });
      complete = false;
    } else if (parsed.kind === 'uuid') {
      // Share-link URLs carry UUID-form IDs that FullStory does not expose a
      // public resolver for. Fall back to segment discovery scoped to appId.
      // This is a deliberate path choice, not missing coverage — recorded in
      // notes[] so the AI investigator does not treat it as a gap.
      notes.push(`FullStory URL uses UUID client-session IDs (not resolvable via API); fell back to segment discovery for appId ${params.appId}`);
      fellBackToDiscovery = true;
    } else {
      sessions.push({
        device_id: parsed.deviceId,
        session_id: parsed.sessionId,
        session_url: params.fullstoryUrl,
        ...(parsed.anchorEpochMs ? { anchor_epoch_ms: parsed.anchorEpochMs } : {}),
      });
      query = `fullstoryUrl=${params.fullstoryUrl}`;
      if (!parsed.anchorEpochMs) {
        notes.push('FullStory URL did not include an epoch-ms anchor; session timestamps are 1970-relative (use offset_seconds + session_url to correlate)');
      }
    }
  }

  if (!params.fullstoryUrl || fellBackToDiscovery) {
    // Derive lookback from the requested evidence window so a "Last 15 min"
    // investigation doesn't surface sessions from 7 days ago. Clamp to at
    // least 1 day since FullStory segments round to day boundaries and
    // sub-day lookbacks produce empty segments.
    const windowSpanMs = params.endTime.getTime() - params.startTime.getTime();
    const lookbackDays = Math.min(7, Math.max(1, Math.ceil(windowSpanMs / (24 * 3600 * 1000))));
    const segmentQuery = buildAiroSegmentQuery(params.appId, lookbackDays);
    query = segmentQuery;
    try {
      // `build_segment` is empirically ephemeral on FullStory's hosted MCP —
      // the returned segment_url carries `?create=true`, meaning the segment
      // is a draft compiled for this request and only persists to the
      // customer's Segments tab if a human clicks Save. Still, name it with a
      // timestamp suffix so IF the behavior ever changes, the leaked rows are
      // obviously machine-generated and cleanable by prefix.
      const segmentName = `airo-investigate-${params.appId}-${Date.now()}`;
      const segment = await callFullstoryMcpTool<FullstoryBuildSegmentResponse>(
        params.fullstory,
        'build_segment',
        { query: segmentQuery, name: segmentName },
        callOpts,
      );
      if (!segment.segment_id) {
        throw new FullstoryMcpError('build_segment returned no segment_id');
      }
      const sessionList = await callFullstoryMcpTool<FullstoryGetSessionsResponse>(
        params.fullstory,
        'get_sessions',
        { segment_id: segment.segment_id, limit: FULLSTORY_LIST_LIMIT },
        callOpts,
      );
      const found = Array.isArray(sessionList.sessions) ? sessionList.sessions : [];
      const picked = found.slice(0, FULLSTORY_MAX_SESSIONS);
      sessions.push(...picked);
      // Per-feedback investigation is scoped narrowly — 3 recent sessions is
      // enough to root-cause a single complaint. When the segment is larger,
      // note the trim so the AI investigator knows more data exists without
      // treating the result as incomplete.
      if (found.length > picked.length) {
        notes.push(`segment matched ${found.length} sessions in the last ${lookbackDays}d; fetched the ${picked.length} most recent for event analysis`);
      }
    } catch (err) {
      complete = false;
      incomplete.push({
        bucket: 'discovery',
        start: windowStart,
        end: windowEnd,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (sessions.length === 0 && complete) {
    incomplete.push({ bucket: 'discovery', start: windowStart, end: windowEnd, error: `no FullStory sessions found for appId ${params.appId}` });
    complete = false;
  }

  const sessionResults = await Promise.all(sessions.map(async (session): Promise<{ session: FullstorySessionRef; logs: EvidenceLog[]; error?: string }> => {
    try {
      const events = await callFullstoryMcpTool<FullstoryGetSessionEventsResponse>(
        params.fullstory,
        'get_session_events',
        { device_id: session.device_id, session_id: session.session_id },
        callOpts,
      );
      const eventsText = events.events || '';
      if (!eventsText) return { session, logs: [], error: 'empty events' };
      const session_url = session.session_url || events.session_url;
      return { session: { ...session, session_url }, logs: normalizeFullstorySessionEvents({ ...session, session_url }, eventsText) };
    } catch (err) {
      return { session, logs: [], error: err instanceof Error ? err.message : String(err) };
    }
  }));

  sessionResults.forEach((result, index) => {
    const bucket = `s${String(index + 1).padStart(2, '0')}-${result.session.session_id}`;
    if (result.error) {
      complete = false;
      incomplete.push({ bucket, start: windowStart, end: windowEnd, error: result.error });
      return;
    }
    rawPages.push({
      page: index,
      bucket,
      start: windowStart,
      end: windowEnd,
      logs: result.logs,
    });
  });

  return {
    complete,
    rawPages,
    incomplete,
    diagnostics: {
      elapsedMs: Date.now() - started,
      pageCount: rawPages.length,
      query,
      truncated: !complete,
      ...(incomplete[0]?.error ? { error: incomplete[0].error } : {}),
      ...(notes.length > 0 ? { notes } : {}),
    },
  };
}

export async function collectEvidenceForSource(params: {
  sourceId: string;
  appId: string;
  timeWindow: string;
  bucketHours?: number;
  fetchImpl?: FetchImpl;
  fullstoryUrl?: string;
}): Promise<EvidenceSourceResult> {
  const { startTime, endTime } = parseTimeRange(params.timeWindow);
  const window = { label: params.timeWindow, start: startTime.toISOString(), end: endTime.toISOString() };

  if (params.sourceId === 'fullstory') {
    const config = getFullstoryMcpConfig();
    if (!config) throw new Error('FullStory MCP config missing (FULLSTORY_API_KEY)');
    const collected = await collectFullstoryEvidence({
      appId: params.appId,
      startTime,
      endTime,
      fullstory: config,
      fullstoryUrl: params.fullstoryUrl,
      fetchImpl: params.fetchImpl,
    });
    const index = buildEvidenceIndex({
      source: fullstorySourceConfig(),
      appId: params.appId,
      window,
      rawPages: collected.rawPages,
      incomplete: collected.incomplete,
      diagnostics: collected.diagnostics,
    });
    return { sourceId: params.sourceId, complete: collected.complete && index.coverage.complete, rawPages: collected.rawPages, index };
  }

  if (params.sourceId === 'langfuse') {
    const config = getLangfuseEbConfig();
    if (!config) throw new Error('EB Langfuse config missing');
    const collected = await collectLangfuseEvidence({
      appId: params.appId,
      startTime,
      endTime,
      langfuse: config,
      fetchImpl: params.fetchImpl,
    });
    const index = buildEvidenceIndex({
      source: langfuseSourceConfig(),
      appId: params.appId,
      window,
      rawPages: collected.rawPages,
      incomplete: collected.incomplete,
      diagnostics: collected.diagnostics,
    });
    return { sourceId: params.sourceId, complete: collected.complete && index.coverage.complete, rawPages: collected.rawPages, index };
  }

  const sourceConfig = getLogSourceConfig(params.sourceId);
  if (!sourceConfig) throw new Error(`Unknown log source: ${params.sourceId}`);
  const buckets = buildEvidenceBuckets(startTime, endTime, params.bucketHours || DEFAULT_BUCKET_HOURS);
  const collectedParts = await Promise.all(buckets.map((bucket) => (
    sourceConfig.backendType === 'loki'
      ? collectLokiEvidence({
        sourceConfig,
        appId: params.appId,
        startTime: bucket.startTime,
        endTime: bucket.endTime,
        bucketLabel: bucket.label,
        fetchImpl: params.fetchImpl,
      })
      : collectElasticsearchEvidence({
        sourceConfig,
        appId: params.appId,
        startTime: bucket.startTime,
        endTime: bucket.endTime,
        bucketLabel: bucket.label,
        fetchImpl: params.fetchImpl,
      })
  )));
  const collected = mergeCollected(collectedParts);
  const index = buildEvidenceIndex({
    source: sourceConfig,
    appId: params.appId,
    window,
    rawPages: collected.rawPages,
    incomplete: collected.incomplete,
    diagnostics: collected.diagnostics,
  });
  return { sourceId: params.sourceId, complete: collected.complete && index.coverage.complete, rawPages: collected.rawPages, index };
}

function fallbackSourceConfig(sourceId: string): LogSourceConfig {
  return {
    id: sourceId,
    name: sourceId,
    description: sourceId,
    backendType: 'elasticsearch',
    fieldMapping: {
      appIdField: 'app_id',
      appIdQueryType: 'term',
      timestampField: '@timestamp',
      levelField: 'level',
      levelKeywordField: 'level',
      messageField: 'message',
      eventField: 'event',
      eventKeywordField: 'event',
      serviceField: 'service',
      serviceKeywordField: 'service',
      displayFields: [],
    },
  };
}

export async function collectInvestigateEvidence(
  request: NormalizedEvidenceRequest,
  opts?: {
    fetchImpl?: FetchImpl;
    resolveCluster?: (appId: string) => Promise<string | null>;
  },
): Promise<{ appId: string; timeWindow: string; complete: boolean; sources: EvidenceSourceResult[] }> {
  const fetchImpl = opts?.fetchImpl;
  const clusterResolver = opts?.resolveCluster ?? resolveAppCluster;

  const MERGED_LOKI_SOURCE_IDS = new Set(['airo-agents', 'airo-preview', 'airo-publish']);
  const requestedLokiCount = request.sources.filter((s) => MERGED_LOKI_SOURCE_IDS.has(s)).length;
  const allMergedRequested = requestedLokiCount === MERGED_LOKI_SOURCE_IDS.size;

  let mergedResultsBySourceId: Map<string, EvidenceSourceResult> | null = null;

  if (allMergedRequested) {
    try {
      const cluster = await clusterResolver(request.appId);
      const mergedResults = await collectMergedLokiSources({
        appId: request.appId,
        timeWindow: request.timeWindow,
        cluster,
        bucketHours: request.bucketHours,
        fetchImpl,
      });
      mergedResultsBySourceId = new Map(mergedResults.map((r) => [r.sourceId, r]));
    } catch (err) {
      logger.warn('investigate.evidence.merged_loki_failed', { appId: request.appId }, { error: err as Error });
      mergedResultsBySourceId = null;
    }
  }

  const sources = await Promise.all(
    request.sources.map(async (sourceId) => {
      if (mergedResultsBySourceId?.has(sourceId)) {
        return mergedResultsBySourceId.get(sourceId)!;
      }
      try {
        return await collectEvidenceForSource({
          sourceId,
          appId: request.appId,
          timeWindow: request.timeWindow,
          bucketHours: request.bucketHours,
          fullstoryUrl: request.fullstoryUrl,
          fetchImpl,
        });
      } catch (err) {
        let fallbackSource: EvidenceSourceConfig;
        try {
          fallbackSource = sourceId === 'fullstory'
            ? fullstorySourceConfig()
            : sourceId === 'langfuse'
              ? langfuseSourceConfig()
              : getLogSourceConfig(sourceId) || fallbackSourceConfig(sourceId);
        } catch {
          fallbackSource = fallbackSourceConfig(sourceId);
        }
        const fallbackWindow = parseTimeRange(request.timeWindow);
        const start = fallbackWindow.startTime.toISOString();
        const end = fallbackWindow.endTime.toISOString();
        const index = buildEvidenceIndex({
          source: fallbackSource,
          appId: request.appId,
          window: { label: request.timeWindow, start, end },
          rawPages: [],
          incomplete: [{ bucket: 'source', start, end, error: err instanceof Error ? err.message : String(err) }],
          diagnostics: { elapsedMs: 0, pageCount: 0, query: '', truncated: true, error: err instanceof Error ? err.message : String(err) },
        });
        return { sourceId, complete: false, rawPages: [], index };
      }
    }),
  );

  return {
    appId: request.appId,
    timeWindow: request.timeWindow,
    complete: sources.every((source) => source.complete),
    sources,
  };
}
