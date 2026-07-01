import { emptyStatData, type StatData } from './types.js';

export function aggregateDay(rows: StatData[]): StatData {
  const agg = emptyStatData();
  if (rows.length === 0) return agg;
  for (const r of rows) {
    // Counts: sum
    agg.log_count += r.log_count;
    agg.error_count += r.error_count;
    agg.warn_count += r.warn_count;
    agg.error_event_count += r.error_event_count;
    agg.sse_connected_count += r.sse_connected_count;
    agg.sse_first_response_count += r.sse_first_response_count;
    agg.publish_success += r.publish_success;
    agg.publish_failure += r.publish_failure;
    agg.create_success += r.create_success;
    agg.create_failure += r.create_failure;
    agg.preview_timeouts += r.preview_timeouts;
    agg.new_error_fingerprints += r.new_error_fingerprints;
    agg.req_throughput += r.req_throughput;
    agg.alb_5xx_count += r.alb_5xx_count;
    agg.alb_req_count += r.alb_req_count;
    // Worst-case: use max for cardinality and latency/p95 stats
    agg.distinct_error_events = Math.max(agg.distinct_error_events, r.distinct_error_events);
    agg.sse_connect_p95_ms = Math.max(agg.sse_connect_p95_ms, r.sse_connect_p95_ms);
    agg.sse_first_response_p95_ms = Math.max(agg.sse_first_response_p95_ms, r.sse_first_response_p95_ms);
    agg.latency_p50_ms = Math.max(agg.latency_p50_ms, r.latency_p50_ms);
    agg.latency_p95_ms = Math.max(agg.latency_p95_ms, r.latency_p95_ms);
    agg.alb_p95_ms = Math.max(agg.alb_p95_ms, r.alb_p95_ms);
    // Rates are accumulated as running sums; recomputed after the loop
    agg.req_error_rate += r.req_error_rate;
  }
  // Recompute derived rates from accumulated totals
  agg.error_rate = agg.log_count > 0 ? agg.error_count / agg.log_count : 0;
  const pubTotal = agg.publish_success + agg.publish_failure;
  agg.publish_success_rate = pubTotal > 0 ? agg.publish_success / pubTotal : 0;
  const createTotal = agg.create_success + agg.create_failure;
  agg.create_success_rate = createTotal > 0 ? agg.create_success / createTotal : 0;
  // APM error rate: average over populated hours (hours with APM traffic)
  const apmHours = rows.filter((r) => r.req_throughput > 0).length;
  agg.req_error_rate = apmHours > 0 ? agg.req_error_rate / apmHours : 0;
  return agg;
}
