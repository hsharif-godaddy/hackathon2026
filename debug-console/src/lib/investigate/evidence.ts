import { buildAppIdQuery, getLogSourceConfig, getNestedValue, type LogSourceConfig } from '@/lib/log-sources';
import { buildAppIdFilter, getLangfuseEbConfig } from '@/lib/langfuse-eb-client';
import { parseTimeRange } from '@/lib/time-range';

export const DEFAULT_EVIDENCE_SOURCE_IDS = [
  'airo-app',
  'control_plane',
  'airo-agents',
  'airo-preview',
  'airo-publish',
  'langfuse',
] as const;

export type EvidenceSourceId = typeof DEFAULT_EVIDENCE_SOURCE_IDS[number];

const KNOWN_EVIDENCE_SOURCE_IDS = new Set<string>(DEFAULT_EVIDENCE_SOURCE_IDS);
const MAX_WINDOW_HOURS = 24 * 7;
const DEFAULT_BUCKET_HOURS = 6;
const LOKI_LIMIT = 5000;
const ES_PAGE_SIZE = 1000;
const LANGFUSE_PAGE_SIZE = 100;
const LANGFUSE_DETAIL_BATCH_SIZE = 20;
const MAX_LANGFUSE_PAGES = 200;
const MAX_LANGFUSE_DETAIL_FAILURES = 20;
const MAX_LANGFUSE_DETAIL_ERROR_SAMPLES = 5;

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
}

export interface EvidenceIndex {
  appId: string;
  source: {
    id: string;
    name: string;
    consoleSource: string;
    backendType: LogSourceConfig['backendType'] | 'langfuse';
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

  return {
    appId,
    timeWindow: clampWindow(typeof input.timeWindow === 'string' ? input.timeWindow : undefined),
    sources: sources.length > 0 ? sources : [...DEFAULT_EVIDENCE_SOURCE_IDS],
    bucketHours,
  };
}

export function buildLokiEvidenceQuery(sourceConfig: LogSourceConfig, appId: string): string {
  const labels = Object.entries(sourceConfig.lokiLabels || {})
    .filter(([, value]) => value)
    .map(([key, value]) => `${key}="${escapeLogQLString(value)}"`);
  const selector = `{${labels.join(',')}}`;
  return `${selector} |= "\\"app_id\\":\\"${escapeLogQLString(appId)}\\""`;
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
}): Promise<{ complete: boolean; logs: EvidenceLog[]; rawPages: EvidenceRawPage[]; diagnostics: EvidenceDiagnostics; incomplete: EvidenceIndex['coverage']['incomplete'] }> {
  const started = Date.now();
  const fetchImpl = params.fetchImpl || fetch;
  const limit = params.limit || LOKI_LIMIT;
  const endpoint = (params.sourceConfig.lokiEndpoint || '').replace(/\/+$/, '');
  if (!endpoint) throw new Error(`Loki endpoint not configured for ${params.sourceConfig.id}`);

  const query = buildLokiEvidenceQuery(params.sourceConfig, params.appId);
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

function normalizeLangfuseTrace(trace: LangfuseTraceDetail, sourceId = 'langfuse'): EvidenceLog {
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
    sourceId,
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
  let detailFailureCount = 0;
  let stopCollection = false;

  while (page <= totalPages) {
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
        try {
          const detailResponse = await fetchImpl(`${endpoint}/api/public/traces/${encodeURIComponent(traceId)}`, {
            headers: {
              Authorization: params.langfuse.authHeader,
              'Accept-Encoding': 'gzip, deflate, br',
            },
            signal: AbortSignal.timeout(params.timeoutMs || 60_000),
          });
          if (!detailResponse.ok) {
            const body = await detailResponse.text().catch(() => '<body read failed>');
            throw new Error(`trace detail ${traceId} HTTP ${detailResponse.status}: ${body.slice(0, 120)}`);
          }
          return { trace: await detailResponse.json() as LangfuseTraceDetail };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
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

export async function collectEvidenceForSource(params: {
  sourceId: string;
  appId: string;
  timeWindow: string;
  bucketHours?: number;
  fetchImpl?: FetchImpl;
}): Promise<EvidenceSourceResult> {
  const { startTime, endTime } = parseTimeRange(params.timeWindow);
  const window = { label: params.timeWindow, start: startTime.toISOString(), end: endTime.toISOString() };

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

export async function collectInvestigateEvidence(request: NormalizedEvidenceRequest): Promise<{ appId: string; timeWindow: string; complete: boolean; sources: EvidenceSourceResult[] }> {
  const sources = await Promise.all(request.sources.map(async (sourceId) => {
    try {
      return await collectEvidenceForSource({ sourceId, appId: request.appId, timeWindow: request.timeWindow, bucketHours: request.bucketHours });
    } catch (err) {
      let fallbackSource: EvidenceSourceConfig;
      try {
        fallbackSource = sourceId === 'langfuse' ? langfuseSourceConfig() : getLogSourceConfig(sourceId) || fallbackSourceConfig(sourceId);
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
  }));
  return {
    appId: request.appId,
    timeWindow: request.timeWindow,
    complete: sources.every((source) => source.complete),
    sources,
  };
}
