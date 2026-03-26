import type { Config } from './config.js';
import { docId } from './transform.js';
import type { EsDocument } from './transform.js';

const INDEX = 'langfuse-metrics-daily';

const INDEX_MAPPING = {
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
      input_cost_usd: { type: 'float' },
      output_cost_usd: { type: 'float' },
      total_cost_usd: { type: 'float' },
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
};

export function create(config: Config) {
  const authHeader = config.elasticsearch.apiKey
    ? `ApiKey ${config.elasticsearch.apiKey}`
    : `Basic ${Buffer.from(`${config.elasticsearch.user}:${config.elasticsearch.password}`).toString('base64')}`;

  async function request(
    path: string,
    method: string,
    body?: unknown
  ): Promise<{ status: number; data: Record<string, unknown> }> {
    const response = await fetch(`${config.elasticsearch.endpoint}/${path}`, {
      method,
      headers: {
        Authorization: authHeader,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const text = await response.text();
    let data: Record<string, unknown> = {};
    if (text) {
      try {
        data = JSON.parse(text) as Record<string, unknown>;
      } catch {
        if (!response.ok) {
          throw new Error(`ES ${method} ${path} returned ${response.status}: ${text.slice(0, 500)}`);
        }
        console.warn('ES %s %s returned 200 with non-JSON body (%d bytes)', method, path, text.length);
      }
    }

    return { status: response.status, data };
  }

  async function ensureIndex(): Promise<void> {
    const { status } = await request(INDEX, 'HEAD');
    if (status === 200) {
      return;
    }

    const { status: createStatus, data } = await request(INDEX, 'PUT', INDEX_MAPPING);
    if (createStatus !== 200) {
      throw new Error(`Failed to create index ${INDEX}: ${JSON.stringify(data)}`);
    }
    console.log('Created index %s', INDEX);
  }

  async function bulk(documents: EsDocument[]): Promise<number> {
    if (documents.length === 0) return 0;

    const lines: string[] = [];
    for (const doc of documents) {
      lines.push(JSON.stringify({ index: { _index: INDEX, _id: docId(doc) } }));
      lines.push(JSON.stringify(doc));
    }
    const body = lines.join('\n') + '\n';

    const response = await fetch(
      `${config.elasticsearch.endpoint}/_bulk`,
      {
        method: 'POST',
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/x-ndjson',
        },
        body,
      }
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`ES bulk request failed with ${response.status}: ${text.slice(0, 500)}`);
    }

    const result = (await response.json()) as {
      errors: boolean;
      items: Array<{ index: { status: number; error?: unknown } }>;
    };

    if (result.errors) {
      const failures = result.items.filter(
        function failed(item) { return item.index.status >= 400; }
      );
      console.error('Bulk index had %d failures out of %d documents', failures.length, documents.length);
      for (const f of failures.slice(0, 5)) {
        console.error('  -', JSON.stringify(f.index.error));
      }
      return documents.length - failures.length;
    }

    return documents.length;
  }

  return { ensureIndex, bulk };
}
