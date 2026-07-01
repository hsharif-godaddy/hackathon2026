import type { Client } from '@elastic/elasticsearch';
import {
  CW_NAMESPACE_ALB,
  CW_DIM_LOAD_BALANCER,
  CW_ALB_5XX,
  CW_ALB_REQ,
  CW_ALB_P95_SEC,
} from './fields.js';

export interface CloudwatchStats {
  alb_5xx_count: number;
  alb_req_count: number;
  alb_p95_ms: number;
}

interface CwAggResponse {
  aggregations?: {
    alb_5xx?: { value?: number | null };
    alb_req?: { value?: number | null };
    alb_p95?: { value?: number | null };
  };
}

export function buildAlbAggQuery(
  albLoadBalancerName: string,
  startIso: string,
  endIso: string,
): Record<string, unknown> {
  return {
    size: 0,
    query: {
      bool: {
        filter: [
          { term: { 'aws.cloudwatch.namespace': CW_NAMESPACE_ALB } },
          { term: { [CW_DIM_LOAD_BALANCER]: albLoadBalancerName } },
          { range: { '@timestamp': { gte: startIso, lt: endIso } } },
        ],
      },
    },
    aggs: {
      alb_5xx: { sum: { field: CW_ALB_5XX } },
      alb_req: { sum: { field: CW_ALB_REQ } },
      // TargetResponseTime p95.00 is a per-minute pre-computed p95 (in seconds).
      // We take the max over the hour to represent worst-case request latency.
      alb_p95: { max: { field: CW_ALB_P95_SEC } },
    },
  };
}

export function mapAlbResponse(resp: CwAggResponse): CloudwatchStats {
  if (resp.aggregations === undefined) {
    console.warn('watchtower.cloudwatch_collector.aggregations_missing — emitting zeros');
  }
  const a = resp.aggregations ?? {};
  const alb_5xx_count = a.alb_5xx?.value ?? 0;
  const alb_req_count = a.alb_req?.value ?? 0;
  const p95SecRaw = a.alb_p95?.value ?? null;
  // Convert seconds → ms; null means no ALB traffic in the window (legitimate)
  const alb_p95_ms = typeof p95SecRaw === 'number' ? Math.round(p95SecRaw * 1000) : 0;
  return { alb_5xx_count, alb_req_count, alb_p95_ms };
}

export async function collectCloudwatch(
  client: Client,
  cwIndex: string,
  albLoadBalancerName: string,
  startIso: string,
  endIso: string,
): Promise<CloudwatchStats> {
  const body = buildAlbAggQuery(albLoadBalancerName, startIso, endIso);
  const resp = await client.search({ index: cwIndex, body });
  return mapAlbResponse(resp as unknown as CwAggResponse);
}
