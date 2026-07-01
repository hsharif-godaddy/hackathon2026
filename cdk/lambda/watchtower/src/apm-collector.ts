import type { Client } from '@elastic/elasticsearch';
import { APM_DURATION_HISTOGRAM, APM_SUCCESS_COUNT } from './fields.js';

export interface ApmStats {
  req_throughput: number;
  req_error_rate: number;
  latency_p50_ms: number;
  latency_p95_ms: number;
}

interface ApmAggResponse {
  aggregations?: {
    throughput?: { value?: number | null };
    success?: { value?: number | null };
    latency?: { values?: Record<string, number | null> };
  };
}

export function buildApmAggQuery(
  serviceName: string,
  startIso: string,
  endIso: string,
): Record<string, unknown> {
  return {
    size: 0,
    query: {
      bool: {
        filter: [
          { term: { 'service.name': serviceName } },
          { range: { '@timestamp': { gte: startIso, lt: endIso } } },
        ],
      },
    },
    aggs: {
      // value_count on the histogram field = total transaction count (correct for _doc_count pre-agg)
      throughput: { value_count: { field: APM_DURATION_HISTOGRAM } },
      // sum on the aggregate_metric_double parent field (NOT the .sum sub-path)
      success: { sum: { field: APM_SUCCESS_COUNT } },
      // Latency percentiles from the ES histogram field; values in microseconds
      latency: { percentiles: { field: APM_DURATION_HISTOGRAM, percents: [50, 95] } },
    },
  };
}

export function mapApmResponse(resp: ApmAggResponse): ApmStats {
  if (resp.aggregations === undefined) {
    console.warn('watchtower.apm_collector.aggregations_missing — emitting zeros');
  }
  const a = resp.aggregations ?? {};
  const throughput = a.throughput?.value ?? 0;
  const successCount = a.success?.value ?? 0;
  const req_error_rate = throughput > 0 ? Math.max(0, 1 - successCount / throughput) : 0;
  const latencyValues = a.latency?.values ?? {};
  // APM histogram values are in microseconds — convert to milliseconds
  const p50Raw = latencyValues['50.0'];
  const p95Raw = latencyValues['95.0'];
  const latency_p50_ms = typeof p50Raw === 'number' ? Math.round(p50Raw / 1000) : 0;
  const latency_p95_ms = typeof p95Raw === 'number' ? Math.round(p95Raw / 1000) : 0;
  return { req_throughput: throughput, req_error_rate, latency_p50_ms, latency_p95_ms };
}

export async function collectApm(
  client: Client,
  apmIndex: string,
  serviceName: string,
  startIso: string,
  endIso: string,
): Promise<ApmStats> {
  const body = buildApmAggQuery(serviceName, startIso, endIso);
  const resp = await client.search({ index: apmIndex, body });
  return mapApmResponse(resp as unknown as ApmAggResponse);
}
