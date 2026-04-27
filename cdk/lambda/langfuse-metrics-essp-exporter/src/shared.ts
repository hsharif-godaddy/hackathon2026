import crypto from 'node:crypto';

import { Client } from '@elastic/elasticsearch';

export interface LangfuseConfig {
  baseUrl: string;
  publicKey: string;
  secretKey: string;
}

export interface MetricsQuery {
  view: 'observations' | 'traces';
  dimensions: Array<{ field: string }>;
  metrics: Array<{ measure: string; aggregation: string }>;
  filters?: Array<{ column: string; operator: string; value: unknown; type?: string }>;
  timeDimension?: { granularity: 'hour' | 'day' | 'week' | 'month' | 'auto' };
  fromTimestamp: string;
  toTimestamp: string;
  orderBy?: Array<{ field: string; direction: 'asc' | 'desc' }>;
}

export interface MetricsRow {
  [key: string]: string | number | null;
}

export interface MetricsResponse {
  data: MetricsRow[];
}

export interface DateRange {
  fromTimestamp: string;
  toTimestamp: string;
}

export interface QueryDefinition {
  name: string;
  metricType: string;
  build: (range: DateRange) => MetricsQuery;
}

export interface EsDocument {
  '@timestamp': string;
  observation_type: 'GENERATION' | 'SPAN';
  name: string;
  model?: string;
  count?: number;
  latency_avg_ms?: number;
  latency_p50_ms?: number;
  latency_p95_ms?: number;
  latency_p99_ms?: number;
  streaming_latency_avg_ms?: number;
  streaming_latency_p50_ms?: number;
  streaming_latency_p95_ms?: number;
  error_count?: number;
  error_rate?: number;
  input_tokens?: number;
  input_tokens_avg?: number;
  input_tokens_p95?: number;
  output_tokens?: number;
  output_tokens_avg?: number;
  output_tokens_p95?: number;
  total_tokens?: number;
  tokens_per_second?: number;
  output_tokens_per_second?: number;
  ttft_avg_ms?: number;
  ttft_p50_ms?: number;
  ttft_p95_ms?: number;
}

export const ES_INDEX = 'langfuse-metrics-hourly';

// Langfuse base URL / keys are read from the `langfuse_test` Secrets Manager
// JSON (same secret used by .github/workflows/langfuse-metrics-ingest.yml).
//
// NOTE on "test" in the URL: we are still using the test Langfuse cluster as
// our de facto prod. Do NOT just point this at the EventBridge-backed Langfuse
// "prod" cluster — it stores spans/traces in a different shape (different
// observation_type values, attribute layout, timestamp semantics). Migration
// is planned but is NOT a simple URL swap — it requires reworking the query
// definitions + derivation logic below, re-validating every Kibana panel
// runtime field / KQL filter, and a coordinated re-backfill into a fresh
// ES index. Treat that cutover as a project, not a config change.

export const INDEX_MAPPING = {
  mappings: {
    properties: {
      '@timestamp': { type: 'date' },
      observation_type: { type: 'keyword' },
      name: { type: 'keyword' },
      model: { type: 'keyword' },
      count: { type: 'long' },
      input_tokens: { type: 'long' },
      input_tokens_avg: { type: 'float' },
      input_tokens_p95: { type: 'float' },
      output_tokens: { type: 'long' },
      output_tokens_avg: { type: 'float' },
      output_tokens_p95: { type: 'float' },
      total_tokens: { type: 'long' },
      tokens_per_second: { type: 'float' },
      output_tokens_per_second: { type: 'float' },
      latency_avg_ms: { type: 'float' },
      latency_p50_ms: { type: 'float' },
      latency_p95_ms: { type: 'float' },
      latency_p99_ms: { type: 'float' },
      streaming_latency_avg_ms: { type: 'float' },
      streaming_latency_p50_ms: { type: 'float' },
      streaming_latency_p95_ms: { type: 'float' },
      ttft_avg_ms: { type: 'float' },
      ttft_p50_ms: { type: 'float' },
      ttft_p95_ms: { type: 'float' },
      error_count: { type: 'long' },
      error_rate: { type: 'float' },
    },
  },
} as const;

const HOUR_DIMENSION = { granularity: 'hour' as const };

const GENERATION_ONLY = [
  { column: 'type', operator: '=', value: 'GENERATION', type: 'string' },
];

const EXCLUDED_NAME_PATTERNS = [
  /^Execute evaluator:/i,
  /^ChatOpenAI$/i,
  /:ai\.streamText$/,
  /:ai\.generateText$/,
];

const MAX_ROWS_PER_BUCKET = 200;
const ES_BATCH_SIZE = 500;

const FETCH_MAX_RETRIES = 3;
const FETCH_RETRY_DELAY_MS = 2000;

export const definitions: QueryDefinition[] = [
  {
    name: 'observation_latency',
    metricType: 'observation_latency',
    build({ fromTimestamp, toTimestamp }) {
      return {
        view: 'observations',
        dimensions: [{ field: 'name' }],
        metrics: [
          { measure: 'latency', aggregation: 'avg' },
          { measure: 'latency', aggregation: 'p50' },
          { measure: 'latency', aggregation: 'p95' },
          { measure: 'latency', aggregation: 'p99' },
          { measure: 'streamingLatency', aggregation: 'avg' },
          { measure: 'streamingLatency', aggregation: 'p50' },
          { measure: 'streamingLatency', aggregation: 'p95' },
          { measure: 'count', aggregation: 'count' },
        ],
        timeDimension: HOUR_DIMENSION,
        fromTimestamp,
        toTimestamp,
      };
    },
  },
  {
    name: 'observation_failures',
    metricType: 'observation_failures',
    build({ fromTimestamp, toTimestamp }) {
      return {
        view: 'observations',
        dimensions: [{ field: 'name' }, { field: 'level' }],
        metrics: [
          { measure: 'count', aggregation: 'count' },
        ],
        timeDimension: HOUR_DIMENSION,
        fromTimestamp,
        toTimestamp,
      };
    },
  },
  {
    name: 'observation_tokens',
    metricType: 'observation_tokens',
    build({ fromTimestamp, toTimestamp }) {
      return {
        view: 'observations',
        dimensions: [{ field: 'name' }, { field: 'providedModelName' }],
        metrics: [
          { measure: 'inputTokens', aggregation: 'sum' },
          { measure: 'inputTokens', aggregation: 'avg' },
          { measure: 'inputTokens', aggregation: 'p95' },
          { measure: 'outputTokens', aggregation: 'sum' },
          { measure: 'outputTokens', aggregation: 'avg' },
          { measure: 'outputTokens', aggregation: 'p95' },
          { measure: 'totalTokens', aggregation: 'sum' },
          { measure: 'tokensPerSecond', aggregation: 'avg' },
          { measure: 'count', aggregation: 'count' },
        ],
        filters: GENERATION_ONLY,
        timeDimension: HOUR_DIMENSION,
        fromTimestamp,
        toTimestamp,
      };
    },
  },
  {
    name: 'observation_throughput',
    metricType: 'observation_throughput',
    build({ fromTimestamp, toTimestamp }) {
      return {
        view: 'observations',
        dimensions: [{ field: 'name' }, { field: 'providedModelName' }],
        metrics: [
          { measure: 'outputTokensPerSecond', aggregation: 'avg' },
          { measure: 'tokensPerSecond', aggregation: 'avg' },
          { measure: 'timeToFirstToken', aggregation: 'avg' },
          { measure: 'timeToFirstToken', aggregation: 'p50' },
          { measure: 'timeToFirstToken', aggregation: 'p95' },
          { measure: 'count', aggregation: 'count' },
        ],
        filters: GENERATION_ONLY,
        timeDimension: HOUR_DIMENSION,
        fromTimestamp,
        toTimestamp,
      };
    },
  },
  {
    name: 'observation_latency_by_model',
    metricType: 'observation_latency_by_model',
    build({ fromTimestamp, toTimestamp }) {
      return {
        view: 'observations',
        dimensions: [{ field: 'name' }, { field: 'providedModelName' }],
        metrics: [
          { measure: 'latency', aggregation: 'avg' },
          { measure: 'latency', aggregation: 'p95' },
          { measure: 'count', aggregation: 'count' },
        ],
        filters: GENERATION_ONLY,
        timeDimension: HOUR_DIMENSION,
        fromTimestamp,
        toTimestamp,
      };
    },
  },
];

function sleep(ms: number): Promise<void> {
  return new Promise(function delay(resolve) { setTimeout(resolve, ms); });
}

// 30s × 3 attempts × 5 queries = ~7.5min raw fetch, plus ~30s of linear
// backoff sleeps (FETCH_RETRY_DELAY_MS=2s × attempt → 2s+4s per query × 5 queries
// ≈ 30s) → ~8min worst-case. The Lambda budget is 3min, so the timeout
// primarily protects against a single hung connection eating the whole window
// before EventBridge re-fires; full retry exhaustion will still be cut short
// by the Lambda timeout.
const FETCH_TIMEOUT_MS = 30_000;

function isTransientError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err.name === 'AbortError' || err.name === 'TimeoutError') return true;
  return /ECONNRESET|ETIMEDOUT|ENOTFOUND|UND_ERR_CONNECT_TIMEOUT|fetch failed/i.test(err.message);
}

export async function fetchMetrics(lf: LangfuseConfig, query: MetricsQuery): Promise<MetricsResponse> {
  const auth = Buffer.from(`${lf.publicKey}:${lf.secretKey}`).toString('base64');
  const url = `${lf.baseUrl.replace(/\/+$/, '')}/api/public/metrics?query=${encodeURIComponent(JSON.stringify(query))}`;

  for (let attempt = 1; attempt <= FETCH_MAX_RETRIES; attempt++) {
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'GET',
        headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
    } catch (err) {
      if (isTransientError(err) && attempt < FETCH_MAX_RETRIES) {
        console.warn('Langfuse fetch failed (attempt %d/%d): %s', attempt, FETCH_MAX_RETRIES,
          err instanceof Error ? err.message : err);
        await sleep(FETCH_RETRY_DELAY_MS * attempt);
        continue;
      }
      // Either non-transient or retries exhausted — log loudly so the failure
      // shows at error severity in CloudWatch (the previous warns were only
      // intermediate breadcrumbs).
      console.error(
        'Langfuse fetch %s on attempt %d/%d, aborting:',
        isTransientError(err) ? 'retries exhausted' : 'non-transient error',
        attempt, FETCH_MAX_RETRIES,
        err
      );
      throw err;
    }

    if (response.ok) {
      let result: MetricsResponse;
      try {
        result = await response.json() as MetricsResponse;
      } catch (err) {
        // 200 with non-JSON body — typically a CDN/maintenance HTML page or an
        // intercepting reverse proxy. response.text() consumes the body, so
        // clone first to keep .json()'s already-consumed body untouched in
        // case anything else inspects `response`.
        const preview = await response.clone().text().catch(function unreadable() {
          return '<unreadable>';
        });
        throw new Error(
          `Langfuse API returned 200 but non-JSON body: ${preview.slice(0, 200)}`,
          { cause: err }
        );
      }
      if (!Array.isArray(result.data)) {
        throw new Error(`Langfuse API response missing 'data' field`);
      }
      return result;
    }

    const body = await response.text();
    if (response.status >= 500 && attempt < FETCH_MAX_RETRIES) {
      console.warn('Langfuse API returned %d, retrying (%d/%d)...', response.status, attempt, FETCH_MAX_RETRIES);
      await sleep(FETCH_RETRY_DELAY_MS * attempt);
      continue;
    }
    // Final attempt for a 5xx (or any non-ok status on the last try) — escalate
    // to error severity so it stands out in CloudWatch alongside non-5xx
    // failures, which already throw at error level via downstream logging.
    console.error(
      'Langfuse API returned %d on final attempt %d/%d, aborting: %s',
      response.status, attempt, FETCH_MAX_RETRIES, body
    );
    throw new Error(`Langfuse Metrics API error ${response.status}: ${body}`);
  }
  throw new Error('Exhausted retries for Langfuse Metrics API');
}

function num(row: MetricsRow, key: string): number | undefined {
  const v = row[key];
  return typeof v === 'number' ? v : undefined;
}

function str(row: MetricsRow, key: string): string | undefined {
  const v = row[key];
  return typeof v === 'string' && v !== '' ? v : undefined;
}

export function filterResponse(response: MetricsResponse): MetricsResponse {
  const filtered = response.data.filter(function keep(row) {
    const name = row['name'];
    if (typeof name !== 'string') return true;
    return !EXCLUDED_NAME_PATTERNS.some(function match(p) { return p.test(name); });
  });

  const byBucket = new Map<string, MetricsRow[]>();
  for (const row of filtered) {
    const bucket = (typeof row['time_dimension'] === 'string' ? row['time_dimension'] : '__no_bucket__');
    const list = byBucket.get(bucket) ?? [];
    list.push(row);
    byBucket.set(bucket, list);
  }

  const truncated: MetricsRow[] = [];
  for (const [bucket, rows] of byBucket) {
    if (rows.length <= MAX_ROWS_PER_BUCKET) {
      truncated.push(...rows);
      continue;
    }
    const sorted = [...rows].sort(function byCount(a, b) {
      return (Number(b['count_count']) || 0) - (Number(a['count_count']) || 0);
    });
    console.warn('    bucket %s: truncated %d rows to top %d by count', bucket, rows.length, MAX_ROWS_PER_BUCKET);
    truncated.push(...sorted.slice(0, MAX_ROWS_PER_BUCKET));
  }

  return { data: truncated };
}

export function docId(doc: EsDocument): string {
  return crypto.createHash('sha256')
    .update(`${doc.observation_type}::${doc.name}::${doc.model ?? ''}::${doc['@timestamp']}`)
    .digest('hex')
    .slice(0, 20);
}

function bucketTs(row: MetricsRow): string | undefined {
  const v = row['time_dimension'];
  if (typeof v !== 'string' || v === '') return undefined;
  return v.endsWith('Z') ? v : `${v}Z`;
}

export function mergeAll(responses: Map<string, MetricsResponse>): EsDocument[] {
  const docs = new Map<string, EsDocument>();

  function getOrCreate(name: string, model: string | undefined, type: 'GENERATION' | 'SPAN', ts: string): EsDocument {
    const key = `${type}::${name}::${model ?? ''}::${ts}`;
    let doc = docs.get(key);
    if (!doc) {
      doc = { '@timestamp': ts, observation_type: type, name };
      if (model) doc.model = model;
      docs.set(key, doc);
    }
    return doc;
  }

  const generationKeys = new Set<string>();

  const tokens = responses.get('observation_tokens');
  if (tokens) {
    for (const row of tokens.data) {
      const ts = bucketTs(row);
      const name = str(row, 'name');
      if (!ts || !name) continue;
      generationKeys.add(`${name}::${ts}`);
      const doc = getOrCreate(name, str(row, 'providedModelName'), 'GENERATION', ts);
      doc.count = num(row, 'count_count');
      doc.input_tokens = num(row, 'sum_inputTokens');
      doc.input_tokens_avg = num(row, 'avg_inputTokens');
      doc.input_tokens_p95 = num(row, 'p95_inputTokens');
      doc.output_tokens = num(row, 'sum_outputTokens');
      doc.output_tokens_avg = num(row, 'avg_outputTokens');
      doc.output_tokens_p95 = num(row, 'p95_outputTokens');
      doc.total_tokens = num(row, 'sum_totalTokens');
      doc.tokens_per_second = num(row, 'avg_tokensPerSecond');
    }
  }

  const latencyByModel = responses.get('observation_latency_by_model');
  if (latencyByModel) {
    for (const row of latencyByModel.data) {
      const ts = bucketTs(row);
      const name = str(row, 'name');
      if (!ts || !name) continue;
      generationKeys.add(`${name}::${ts}`);
      const doc = getOrCreate(name, str(row, 'providedModelName'), 'GENERATION', ts);
      // Fallback when observation_tokens (above) didn't populate this (name, ts):
      // e.g. a non-LLM GENERATION row, or the tokens query failed upstream while
      // latency_by_model succeeded. Without a `count` field the Kibana runtime
      // field guards (doc['count'].size() == 0) drop the doc from the dashboard.
      doc.count = doc.count ?? num(row, 'count_count');
      doc.latency_avg_ms = num(row, 'avg_latency');
      doc.latency_p95_ms = num(row, 'p95_latency');
    }
  }

  const latency = responses.get('observation_latency');
  if (latency) {
    for (const row of latency.data) {
      const ts = bucketTs(row);
      const name = str(row, 'name');
      if (!ts || !name) continue;
      if (generationKeys.has(`${name}::${ts}`)) continue;
      const doc = getOrCreate(name, undefined, 'SPAN', ts);
      doc.count = num(row, 'count_count');
      doc.latency_avg_ms = num(row, 'avg_latency');
      doc.latency_p50_ms = num(row, 'p50_latency');
      doc.latency_p95_ms = num(row, 'p95_latency');
      doc.latency_p99_ms = num(row, 'p99_latency');
      doc.streaming_latency_avg_ms = num(row, 'avg_streamingLatency');
      doc.streaming_latency_p50_ms = num(row, 'p50_streamingLatency');
      doc.streaming_latency_p95_ms = num(row, 'p95_streamingLatency');
    }
  }

  const failures = responses.get('observation_failures');
  if (failures) {
    // Failures are aggregated by (name, hour) across all levels because the API
    // dimension is name+level. The attach loop below resolves the case where
    // multiple docs share (name, hour) by attributing the failure to the first
    // doc only — see comment there.
    const byNameHour = new Map<string, { total: number; errors: number }>();
    for (const row of failures.data) {
      const ts = bucketTs(row);
      const name = str(row, 'name') ?? 'unknown';
      if (!ts) continue;
      const level = str(row, 'level');
      const count = num(row, 'count_count') ?? 0;
      const k = `${name}::${ts}`;
      const entry = byNameHour.get(k) ?? { total: 0, errors: 0 };
      entry.total += count;
      if (level === 'ERROR') entry.errors += count;
      byNameHour.set(k, entry);
    }

    // The failures map is keyed by (name, hour); docs are keyed by
    // (name, model, type, hour). When the same `name` shows up under multiple
    // models in the same hour (e.g. a fallback model kicks in) — or, more
    // rarely, a SPAN and a GENERATION share the name — multiple docs match
    // the same failure entry. The Langfuse failures aggregate has no model
    // dimension to split it across, so we attribute the error_count to the
    // first doc only; subsequent docs leave error_count/error_rate undefined.
    // This avoids silently double-counting on the dashboard sum at the cost
    // of (acceptable) loss of per-model error attribution we never had.
    const attached = new Set<string>();
    for (const doc of docs.values()) {
      const key = `${doc.name}::${doc['@timestamp']}`;
      const failure = byNameHour.get(key);
      if (!failure) continue;
      if (attached.has(key)) {
        console.warn(
          'failures-attach: skipping duplicate doc for name=%s ts=%s ' +
          '(model=%s type=%s) — failure already attributed to first match',
          doc.name, doc['@timestamp'], doc.model, doc.observation_type
        );
        continue;
      }
      attached.add(key);
      doc.error_count = failure.errors;
      doc.error_rate = failure.total > 0 ? failure.errors / failure.total : 0;
    }
  }

  const throughput = responses.get('observation_throughput');
  if (throughput) {
    // Keyed by (name, model, ts) so TTFT shows per-agent values rather than a
    // model-wide aggregate sprayed across every name. Mirrors the granularity
    // of observation_latency_by_model.
    const byNameModelHour = new Map<string, MetricsRow>();
    for (const row of throughput.data) {
      const ts = bucketTs(row);
      const name = str(row, 'name');
      const model = str(row, 'providedModelName');
      if (!ts || !name || !model) continue;
      byNameModelHour.set(`${name}::${model}::${ts}`, row);
    }

    for (const doc of docs.values()) {
      if (doc.observation_type !== 'GENERATION' || !doc.model) continue;
      const row = byNameModelHour.get(`${doc.name}::${doc.model}::${doc['@timestamp']}`);
      if (!row) continue;
      doc.output_tokens_per_second = num(row, 'avg_outputTokensPerSecond');
      doc.ttft_avg_ms = num(row, 'avg_timeToFirstToken');
      doc.ttft_p50_ms = num(row, 'p50_timeToFirstToken');
      doc.ttft_p95_ms = num(row, 'p95_timeToFirstToken');
    }
  }

  return Array.from(docs.values());
}

export async function ensureIndex(client: Client, index: string, mapping: object): Promise<void> {
  const exists = await client.indices.exists({ index });
  if (exists) return;
  try {
    await client.indices.create({ index, body: mapping });
    console.log('Created index %s', index);
  } catch (err: unknown) {
    // EventBridge can fire two concurrent invocations during retries; both may
    // race past `exists === false` and try to create. The loser sees
    // resource_already_exists_exception, which is benign here.
    const errType = (err as { meta?: { body?: { error?: { type?: string } } } })
      ?.meta?.body?.error?.type;
    if (errType !== 'resource_already_exists_exception') throw err;
    console.log('Index %s already exists (concurrent create raced)', index);
  }
}

export async function bulkIndex(client: Client, index: string, docs: EsDocument[]): Promise<number> {
  if (docs.length === 0) return 0;

  let totalIndexed = 0;
  let totalFailed = 0;
  for (let i = 0; i < docs.length; i += ES_BATCH_SIZE) {
    const batch = docs.slice(i, i + ES_BATCH_SIZE);
    const operations = batch.flatMap(function build(doc) {
      return [{ index: { _index: index, _id: docId(doc) } }, doc];
    });

    const response = await client.bulk({ operations, refresh: false });

    if (response.errors) {
      const failed = response.items.filter(function isFailed(item) {
        return Boolean(item.index?.error);
      });
      // Belt-and-suspenders for the silent-success bug: response.errors=true
      // but no item surfaces an error under .index (e.g. proxy rewrites the op
      // key, ES client major-version drift, or ESSP's bulk API extension uses
      // a different key). Without this guard, totalFailed stays 0 and the
      // CloudWatch-alarm throw below never fires.
      if (failed.length === 0) {
        throw new Error(
          `Bulk response.errors=true but no item.index.error found (index=${index}, batch=${batch.length})`
        );
      }
      console.error('Bulk index had %d failures out of %d docs', failed.length, batch.length);
      for (const f of failed.slice(0, 3)) {
        console.error('  _id=%s type=%s reason=%s',
          f.index?._id, f.index?.error?.type, f.index?.error?.reason);
      }
      totalIndexed += batch.length - failed.length;
      totalFailed += failed.length;
    } else {
      totalIndexed += batch.length;
    }
  }

  // Throw on partial failure so EventBridge sees a failed invocation and the
  // CloudWatch Lambda Errors metric fires. Otherwise the handler would log
  // indexed=N silently and any future alarm bound to Errors would be blind.
  if (totalFailed > 0) {
    throw new Error(`Bulk index had ${totalFailed} failures out of ${docs.length} docs (index=${index})`);
  }

  return totalIndexed;
}

export interface EsCredentials {
  url?: string;
  ingestion_url?: string;
  api_key?: string;
  ingestion_user?: string;
  ingestion_user_password?: string;
}

export function createEsClient(creds: EsCredentials): Client {
  const node = creds.url ?? creds.ingestion_url;
  if (!node) throw new Error('ES credentials missing url/ingestion_url');

  if (creds.api_key) {
    return new Client({ node, auth: { apiKey: creds.api_key } });
  }

  if (creds.ingestion_user && creds.ingestion_user_password) {
    return new Client({
      node,
      auth: { username: creds.ingestion_user, password: creds.ingestion_user_password },
    });
  }

  throw new Error('ES credentials missing api_key or ingestion_user/ingestion_user_password');
}

export function trailingHourWindow(now: Date = new Date()): DateRange {
  const hourStart = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    now.getUTCHours(),
    0, 0, 0
  ));
  const from = new Date(hourStart);
  from.setUTCHours(from.getUTCHours() - 1);
  return {
    fromTimestamp: from.toISOString(),
    toTimestamp: now.toISOString(),
  };
}

export async function ingest(
  lf: LangfuseConfig,
  esClient: Client,
  index: string,
  range: DateRange,
): Promise<{ rowsByQuery: Record<string, number>; docs: number; indexed: number }> {
  const responses = new Map<string, MetricsResponse>();
  const rowsByQuery: Record<string, number> = {};

  for (const def of definitions) {
    const raw = await fetchMetrics(lf, def.build(range));
    const filtered = filterResponse(raw);
    responses.set(def.metricType, filtered);
    rowsByQuery[def.name] = filtered.data.length;
    console.log('  %s: %d rows', def.name, filtered.data.length);
  }

  const docs = mergeAll(responses);
  const indexed = await bulkIndex(esClient, index, docs);
  return { rowsByQuery, docs: docs.length, indexed };
}
