import { emptyStatData, type StatData } from './types.js';

export function aggregateDay(rows: StatData[]): StatData {
  const agg = emptyStatData();
  if (rows.length === 0) return agg;
  let weightedReqErrorSum = 0;
  let weightedAgentsErrorSum = 0;
  for (const r of rows) {
    // ── Counts: sum ──────────────────────────────────────────────────────────
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
    // Source B: app/ BFF APM
    agg.req_throughput += r.req_throughput;
    // Source C: ALB
    agg.alb_5xx_count += r.alb_5xx_count;
    agg.alb_req_count += r.alb_req_count;
    // Source D: agents APM service transactions
    agg.agents_http_throughput += r.agents_http_throughput;
    agg.agents_chat_throughput += r.agents_chat_throughput;
    agg.agents_publish_count += r.agents_publish_count;
    // Source E: agents APM traces
    agg.agents_invocation_count += r.agents_invocation_count;
    agg.agents_invocation_failure_count += r.agents_invocation_failure_count;
    agg.agents_invocation_abort_count += r.agents_invocation_abort_count;
    agg.agents_invocation_fetch_fail_count += r.agents_invocation_fetch_fail_count;
    agg.agents_toolcall_count += r.agents_toolcall_count;
    agg.agents_outbound_timeout_count += r.agents_outbound_timeout_count;
    // Source F: agents ESSP logs
    agg.agents_ai_call_count += r.agents_ai_call_count;
    agg.agents_http_error_count += r.agents_http_error_count;
    agg.agents_auth_failure_count += r.agents_auth_failure_count;
    agg.agents_embedding_error_count += r.agents_embedding_error_count;
    // Source G: Loki (Nomad containers)
    agg.agent_run_count += r.agent_run_count;
    agg.tool_failure_count += r.tool_failure_count;
    agg.skill_activation_failure_count += r.skill_activation_failure_count;
    agg.typecheck_failure_count += r.typecheck_failure_count;
    agg.budget_exhaustion_count += r.budget_exhaustion_count;
    agg.sse_error_count += r.sse_error_count;
    agg.agent_publish_failure_count += r.agent_publish_failure_count;
    agg.preview_http_5xx_count += r.preview_http_5xx_count;
    agg.preview_http_502_count += r.preview_http_502_count;
    agg.preview_http_401_count += r.preview_http_401_count;
    agg.publish_http_5xx_count += r.publish_http_5xx_count;
    // ── Worst-case: max for cardinality and p95/latency stats ────────────────
    agg.distinct_error_events = Math.max(agg.distinct_error_events, r.distinct_error_events);
    agg.sse_connect_p95_ms = Math.max(agg.sse_connect_p95_ms, r.sse_connect_p95_ms);
    agg.sse_first_response_p95_ms = Math.max(agg.sse_first_response_p95_ms, r.sse_first_response_p95_ms);
    agg.latency_p50_ms = Math.max(agg.latency_p50_ms, r.latency_p50_ms);
    agg.latency_p95_ms = Math.max(agg.latency_p95_ms, r.latency_p95_ms);
    agg.alb_p95_ms = Math.max(agg.alb_p95_ms, r.alb_p95_ms);
    agg.agents_http_p95_ms = Math.max(agg.agents_http_p95_ms, r.agents_http_p95_ms);
    agg.agents_chat_p95_ms = Math.max(agg.agents_chat_p95_ms, r.agents_chat_p95_ms);
    // Weighted error rate accumulators: Σ(rate × volume) — divided by total
    // volume after the loop to give traffic-weighted daily error rate.
    // Unweighted average would let a quiet hour at 50% error rate dominate
    // over a peak hour at 1% error rate, producing a misleading daily figure.
    weightedReqErrorSum += r.req_error_rate * r.req_throughput;
    weightedAgentsErrorSum += r.agents_http_error_rate * r.agents_http_throughput;
  }
  // ── Recompute derived rates from accumulated totals ───────────────────────
  agg.error_rate = agg.log_count > 0 ? agg.error_count / agg.log_count : 0;
  const pubTotal = agg.publish_success + agg.publish_failure;
  agg.publish_success_rate = pubTotal > 0 ? agg.publish_success / pubTotal : 0;
  const createTotal = agg.create_success + agg.create_failure;
  agg.create_success_rate = createTotal > 0 ? agg.create_success / createTotal : 0;
  agg.req_error_rate = agg.req_throughput > 0 ? weightedReqErrorSum / agg.req_throughput : 0;
  agg.agents_http_error_rate = agg.agents_http_throughput > 0 ? weightedAgentsErrorSum / agg.agents_http_throughput : 0;
  return agg;
}
