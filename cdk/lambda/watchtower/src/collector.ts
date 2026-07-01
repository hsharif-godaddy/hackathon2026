import type { Client } from '@elastic/elasticsearch';
import { emptyStatData, type StatData } from './types.js';
import {
  FIELD,
  ERROR_LEVELS,
  WARN_LEVELS,
  ERROR_EVENT_REGEXP,
  ERROR_EVENT_NAMES_MAX,
  SSE_CONNECTED_EVENT,
  SSE_FIRST_RESPONSE_EVENT,
  SSE_CONNECT_MS_FIELD,
  SSE_FIRST_RESPONSE_MS_FIELD,
  PUBLISH_SUCCESS_EVENT,
  PUBLISH_FAILURE_EVENT,
  CREATE_SUCCESS_EVENT,
  CREATE_FAILURE_EVENT,
  PREVIEW_TIMEOUT_EVENT,
} from './fields.js';

export interface CollectResult {
  data: StatData;
  /** Distinct error-event names seen this hour — stored for novel-fingerprint set-diff. */
  errorEventNames: string[];
}

interface FilterAgg { doc_count?: number }
interface P95Agg { values?: Record<string, number | null> }
interface TermsBucket { key: string; doc_count: number }
export interface AggResponse {
  hits?: { total?: { value?: number } };
  aggregations?: {
    error_count?: FilterAgg;
    warn_count?: FilterAgg;
    error_events?: FilterAgg & { distinct?: { value?: number }; names?: { buckets?: TermsBucket[] } };
    sse_connected?: FilterAgg & { p95?: P95Agg };
    sse_first_response?: FilterAgg & { p95?: P95Agg };
    publish_success?: FilterAgg;
    publish_failure?: FilterAgg;
    create_success?: FilterAgg;
    create_failure?: FilterAgg;
    preview_timeouts?: FilterAgg;
  };
}

export function buildHourlyAggQuery(startIso: string, endIso: string): Record<string, unknown> {
  return {
    size: 0,
    track_total_hits: true,
    query: { bool: { filter: [{ range: { '@timestamp': { gte: startIso, lt: endIso } } }] } },
    aggs: {
      error_count: { filter: { terms: { [FIELD.level]: ERROR_LEVELS } } },
      warn_count: { filter: { terms: { [FIELD.level]: WARN_LEVELS } } },
      error_events: {
        filter: { regexp: { [FIELD.event]: ERROR_EVENT_REGEXP } },
        aggs: {
          distinct: { cardinality: { field: FIELD.event } },
          names: { terms: { field: FIELD.event, size: ERROR_EVENT_NAMES_MAX } },
        },
      },
      sse_connected: {
        filter: { term: { [FIELD.event]: SSE_CONNECTED_EVENT } },
        aggs: { p95: { percentiles: { field: SSE_CONNECT_MS_FIELD, percents: [95] } } },
      },
      sse_first_response: {
        filter: { term: { [FIELD.event]: SSE_FIRST_RESPONSE_EVENT } },
        aggs: { p95: { percentiles: { field: SSE_FIRST_RESPONSE_MS_FIELD, percents: [95] } } },
      },
      // ── Golden-flow aggs ────────────────────────────────────────────────────
      publish_success: { filter: { term: { [FIELD.event]: PUBLISH_SUCCESS_EVENT } } },
      publish_failure: { filter: { term: { [FIELD.event]: PUBLISH_FAILURE_EVENT } } },
      create_success:  { filter: { term: { [FIELD.event]: CREATE_SUCCESS_EVENT } } },
      create_failure:  { filter: { term: { [FIELD.event]: CREATE_FAILURE_EVENT } } },
      preview_timeouts: { filter: { term: { [FIELD.event]: PREVIEW_TIMEOUT_EVENT } } },
    },
  };
}

function p95(agg: { p95?: P95Agg } | undefined): number {
  const v = agg?.p95?.values?.['95.0'];
  return typeof v === 'number' ? v : 0;
}

export function mapAggResponse(resp: AggResponse): CollectResult {
  // A response with NO aggregations block is malformed (a dropped/renamed agg
  // or an ES contract change) — warn rather than silently emitting all-zero
  // stats that would poison the baseline. (An empty hour legitimately has
  // hits.total 0 WITH an aggregations block, which is not warned.)
  if (resp.aggregations === undefined) {
    console.warn('watchtower.collector.aggregations_missing — emitting zeros; check the ES query/response shape');
  }
  const a = resp.aggregations ?? {};
  const data = emptyStatData();
  data.log_count = resp.hits?.total?.value ?? 0;
  data.error_count = a.error_count?.doc_count ?? 0;
  data.warn_count = a.warn_count?.doc_count ?? 0;
  data.error_rate = data.log_count > 0 ? data.error_count / data.log_count : 0;
  data.error_event_count = a.error_events?.doc_count ?? 0;
  data.distinct_error_events = a.error_events?.distinct?.value ?? 0;
  data.sse_connected_count = a.sse_connected?.doc_count ?? 0;
  data.sse_first_response_count = a.sse_first_response?.doc_count ?? 0;
  data.sse_connect_p95_ms = p95(a.sse_connected);
  data.sse_first_response_p95_ms = p95(a.sse_first_response);
  // Golden-flow stats
  data.publish_success = a.publish_success?.doc_count ?? 0;
  data.publish_failure = a.publish_failure?.doc_count ?? 0;
  const pubTotal = data.publish_success + data.publish_failure;
  data.publish_success_rate = pubTotal > 0 ? data.publish_success / pubTotal : 0;
  data.create_success = a.create_success?.doc_count ?? 0;
  data.create_failure = a.create_failure?.doc_count ?? 0;
  const createTotal = data.create_success + data.create_failure;
  data.create_success_rate = createTotal > 0 ? data.create_success / createTotal : 0;
  data.preview_timeouts = a.preview_timeouts?.doc_count ?? 0;
  // new_error_fingerprints is computed by the caller after baseline lookup
  const errorEventNames: string[] =
    (a.error_events?.names?.buckets ?? []).map((b: TermsBucket) => b.key);
  return { data, errorEventNames };
}

export async function collectHour(
  client: Client,
  appLogIndex: string,
  startIso: string,
  endIso: string,
): Promise<CollectResult> {
  const body = buildHourlyAggQuery(startIso, endIso);
  const resp = await client.search({ index: appLogIndex, body });
  return mapAggResponse(resp as unknown as AggResponse);
}
