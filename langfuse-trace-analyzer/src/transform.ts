import crypto from 'node:crypto';

import type { MetricsResponse, MetricsRow } from './langfuse-client.js';

const MAX_ROWS_PER_QUERY = 200;

const EXCLUDED_NAME_PATTERNS = [
  /^Execute evaluator:/i,
  /^ChatOpenAI$/i,
  /:ai\.streamText$/,
  /:ai\.generateText$/,
];

export interface EsDocument {
  '@timestamp': string;
  observation_type: string;
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
  input_cost_usd?: number;
  output_cost_usd?: number;
  total_cost_usd?: number;
  tokens_per_second?: number;
  output_tokens_per_second?: number;
  ttft_avg_ms?: number;
  ttft_p50_ms?: number;
  ttft_p95_ms?: number;
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

  if (filtered.length <= MAX_ROWS_PER_QUERY) {
    return { ...response, data: filtered };
  }

  const countKey = response.meta?.find(
    function isCount(m) { return m.name.startsWith('count_'); }
  )?.name ?? 'count_count';

  const sorted = [...filtered].sort(function byCount(a, b) {
    return (Number(b[countKey]) || 0) - (Number(a[countKey]) || 0);
  });

  console.warn('    (truncated %d rows to top %d by %s)', filtered.length, MAX_ROWS_PER_QUERY, countKey);

  return { ...response, data: sorted.slice(0, MAX_ROWS_PER_QUERY) };
}

export function docId(doc: EsDocument): string {
  return crypto.createHash('sha256')
    .update(`${doc.observation_type}::${doc.name}::${doc.model ?? ''}::${doc['@timestamp']}`)
    .digest('hex')
    .slice(0, 20);
}

export function mergeAll(
  timestamp: string,
  responses: Map<string, MetricsResponse>
): EsDocument[] {
  const docs = new Map<string, EsDocument>();

  function getOrCreate(name: string, model: string | undefined, type: string): EsDocument {
    const key = model ? `${type}::${name}::${model}` : `${type}::${name}`;
    let doc = docs.get(key);
    if (!doc) {
      doc = { '@timestamp': timestamp, observation_type: type, name };
      if (model) doc.model = model;
      docs.set(key, doc);
    }
    return doc;
  }

  const generationNames = new Set<string>();

  const tokensCost = responses.get('observation_tokens_cost');
  if (tokensCost) {
    for (const row of tokensCost.data) {
      const name = str(row, 'name');
      if (!name) continue;
      generationNames.add(name);
      const doc = getOrCreate(name, str(row, 'providedModelName'), 'GENERATION');
      doc.count = num(row, 'count_count');
      doc.input_tokens = num(row, 'sum_inputTokens');
      doc.input_tokens_avg = num(row, 'avg_inputTokens');
      doc.input_tokens_p95 = num(row, 'p95_inputTokens');
      doc.output_tokens = num(row, 'sum_outputTokens');
      doc.output_tokens_avg = num(row, 'avg_outputTokens');
      doc.output_tokens_p95 = num(row, 'p95_outputTokens');
      doc.total_tokens = num(row, 'sum_totalTokens');
      doc.input_cost_usd = num(row, 'sum_inputCost');
      doc.output_cost_usd = num(row, 'sum_outputCost');
      doc.total_cost_usd = num(row, 'sum_totalCost');
      doc.tokens_per_second = num(row, 'avg_tokensPerSecond');
    }
  }

  const latencyByModel = responses.get('observation_latency_by_model');
  if (latencyByModel) {
    for (const row of latencyByModel.data) {
      const name = str(row, 'name');
      if (!name) continue;
      generationNames.add(name);
      const doc = getOrCreate(name, str(row, 'providedModelName'), 'GENERATION');
      doc.latency_avg_ms = num(row, 'avg_latency');
      doc.latency_p95_ms = num(row, 'p95_latency');
    }
  }

  const latency = responses.get('observation_latency');
  if (latency) {
    for (const row of latency.data) {
      const name = str(row, 'name');
      if (!name || generationNames.has(name)) continue;
      const doc = getOrCreate(name, undefined, 'SPAN');
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

  // Failures are keyed by name only (not observation_type) because the API query
  // dimensions are name+level. This means a SPAN and GENERATION with the same name
  // would share error stats. In practice names never overlap: GENERATIONs end in
  // :ai.streamText.doStream / :ai.generateText.doGenerate, SPANs are tool names.
  const failures = responses.get('observation_failures');
  if (failures) {
    const byName = new Map<string, { total: number; errors: number }>();
    for (const row of failures.data) {
      const name = str(row, 'name') ?? 'unknown';
      const level = str(row, 'level');
      const count = num(row, 'count_count') ?? 0;
      const entry = byName.get(name) ?? { total: 0, errors: 0 };
      entry.total += count;
      if (level === 'ERROR') entry.errors += count;
      byName.set(name, entry);
    }

    for (const doc of docs.values()) {
      const failure = byName.get(doc.name);
      if (failure) {
        doc.error_count = failure.errors;
        doc.error_rate = failure.total > 0 ? failure.errors / failure.total : 0;
      }
    }
  }

  const throughput = responses.get('observation_throughput');
  if (throughput) {
    const byModel = new Map<string, MetricsRow>();
    for (const row of throughput.data) {
      const model = str(row, 'providedModelName');
      if (model) byModel.set(model, row);
    }

    for (const doc of docs.values()) {
      if (doc.observation_type !== 'GENERATION' || !doc.model) continue;
      const row = byModel.get(doc.model);
      if (!row) continue;
      doc.output_tokens_per_second = num(row, 'avg_outputTokensPerSecond');
      doc.ttft_avg_ms = num(row, 'avg_timeToFirstToken');
      doc.ttft_p50_ms = num(row, 'p50_timeToFirstToken');
      doc.ttft_p95_ms = num(row, 'p95_timeToFirstToken');
    }
  }

  return Array.from(docs.values());
}
