import type { Client } from '@elastic/elasticsearch';
import { APM_DURATION_HISTOGRAM, APM_SUCCESS_COUNT } from './fields.js';

export interface AgentsApmStats {
  agents_http_throughput: number;
  agents_http_error_rate: number;
  agents_http_p95_ms: number;
  agents_chat_throughput: number;
  agents_chat_p95_ms: number;
  agents_publish_count: number;
}

interface TypeAgg {
  doc_count?: number;
  throughput?: { value?: number | null };
  success?: { value?: number | null };
  latency?: { values?: Record<string, number | null> };
}

export interface AgentsApmAggResponse {
  aggregations?: {
    request?: TypeAgg;
    messaging?: TypeAgg;
    publish?: TypeAgg;
  };
}

export function buildAgentsApmAggQuery(startIso: string, endIso: string): Record<string, unknown> {
  return {
    size: 0,
    query: {
      bool: {
        filter: [
          { term: { 'service.name': 'airo-agents' } },
          { range: { '@timestamp': { gte: startIso, lt: endIso } } },
        ],
      },
    },
    aggs: {
      request: {
        filter: { term: { 'transaction.type': 'request' } },
        aggs: {
          throughput: { value_count: { field: APM_DURATION_HISTOGRAM } },
          success: { sum: { field: APM_SUCCESS_COUNT } },
          latency: { percentiles: { field: APM_DURATION_HISTOGRAM, percents: [95] } },
        },
      },
      messaging: {
        filter: { term: { 'transaction.type': 'messaging' } },
        aggs: {
          throughput: { value_count: { field: APM_DURATION_HISTOGRAM } },
          latency: { percentiles: { field: APM_DURATION_HISTOGRAM, percents: [95] } },
        },
      },
      publish: {
        filter: { term: { 'transaction.type': 'publish' } },
        aggs: {
          throughput: { value_count: { field: APM_DURATION_HISTOGRAM } },
        },
      },
    },
  };
}

export function mapAgentsApmResponse(resp: AgentsApmAggResponse): AgentsApmStats {
  if (resp.aggregations === undefined) {
    console.warn('watchtower.agents_apm_collector.aggregations_missing — emitting zeros');
  }
  const a = resp.aggregations ?? {};
  const reqThroughput = a.request?.throughput?.value ?? 0;
  const reqSuccess = a.request?.success?.value ?? 0;
  const reqP95Raw = a.request?.latency?.values?.['95.0'];
  const chatThroughput = a.messaging?.throughput?.value ?? 0;
  const chatP95Raw = a.messaging?.latency?.values?.['95.0'];
  return {
    agents_http_throughput: reqThroughput,
    agents_http_error_rate: reqThroughput > 0 ? Math.max(0, 1 - reqSuccess / reqThroughput) : 0,
    agents_http_p95_ms: typeof reqP95Raw === 'number' ? Math.round(reqP95Raw / 1000) : 0,
    agents_chat_throughput: chatThroughput,
    agents_chat_p95_ms: typeof chatP95Raw === 'number' ? Math.round(chatP95Raw / 1000) : 0,
    agents_publish_count: a.publish?.throughput?.value ?? 0,
  };
}

export async function collectAgentsApm(
  client: Client,
  apmIndex: string,
  startIso: string,
  endIso: string,
): Promise<AgentsApmStats> {
  const body = buildAgentsApmAggQuery(startIso, endIso);
  const resp = await client.search({ index: apmIndex, body });
  return mapAgentsApmResponse(resp as unknown as AgentsApmAggResponse);
}
