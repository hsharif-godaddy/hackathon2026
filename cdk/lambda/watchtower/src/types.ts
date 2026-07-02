export interface StatData {
  // ── Source A: app event-log (existing Phase-1 stats) ──────────────────────
  log_count: number;
  error_count: number;
  warn_count: number;
  error_rate: number;
  error_event_count: number;
  distinct_error_events: number;
  sse_connected_count: number;
  sse_first_response_count: number;
  sse_connect_p95_ms: number;
  sse_first_response_p95_ms: number;
  // ── Source A: golden-flow outcomes (coverage expansion) ───────────────────
  publish_success: number;
  publish_failure: number;
  publish_success_rate: number;  // flagged; lower-is-bad
  create_success: number;
  create_failure: number;
  create_success_rate: number;   // flagged; lower-is-bad
  preview_timeouts: number;      // flagged; higher-is-bad
  // ── Source A: novel-error fingerprint ─────────────────────────────────────
  new_error_fingerprints: number; // threshold ≥ 1; count of error event names not seen in 7-day baseline
  // ── Source B: APM RED (metrics-apm.service_transaction.1m) ───────────────
  req_throughput: number;        // flagged; lower-is-bad (traffic collapse)
  req_error_rate: number;        // flagged; higher-is-bad
  latency_p50_ms: number;        // context-only
  latency_p95_ms: number;        // flagged; higher-is-bad
  // ── Source C: CloudWatch ALB ───────────────────────────────────────────────
  alb_5xx_count: number;         // flagged; higher-is-bad
  alb_req_count: number;         // context-only
  alb_p95_ms: number;            // flagged; higher-is-bad
  // ── Source D: Agents APM service transactions (metrics-apm.service_transaction.1m) ──
  agents_http_throughput: number;       // flagged; lower-is-bad (traffic collapse)
  agents_http_error_rate: number;       // flagged; higher-is-bad
  agents_http_p95_ms: number;           // context-only (hourly APM p95 too noisy; daily uses fresh 24h query)
  agents_chat_throughput: number;       // flagged; lower-is-bad (AI chat sessions/hr)
  agents_chat_p95_ms: number;           // context-only (hourly APM p95 too noisy; daily uses fresh 24h query) (AI generation time)
  agents_publish_count: number;         // context-only (sparse)
  // ── Source E: Agents APM traces (traces-apm) ──────────────────────────────
  agents_invocation_count: number;           // context-only (volume)
  agents_invocation_failure_count: number;   // flagged; higher-is-bad
  agents_invocation_abort_count: number;     // flagged; higher-is-bad (user cancel/timeout)
  agents_invocation_fetch_fail_count: number; // flagged; higher-is-bad
  agents_toolcall_count: number;             // context-only
  agents_outbound_timeout_count: number;     // flagged; higher-is-bad (GoCode/BMS timeouts)
  // ── Source F: Agents ESSP logs (logs-gdelastic.katana.agents-*) ──────────
  agents_ai_call_count: number;         // flagged; lower-is-bad (AI call collapse)
  agents_http_error_count: number;      // flagged; higher-is-bad
  agents_auth_failure_count: number;    // flagged; higher-is-bad
  agents_embedding_error_count: number; // threshold ≥ 1 → P3
  // ── Source G: Loki (per-customer Nomad containers — agents/preview/publish) ─
  agent_run_count: number;               // flagged; lower-is-bad
  tool_failure_count: number;            // flagged; higher-is-bad
  skill_activation_failure_count: number; // flagged; higher-is-bad
  typecheck_failure_count: number;       // flagged; higher-is-bad
  budget_exhaustion_count: number;       // flagged; higher-is-bad (users hitting limits)
  sse_error_count: number;               // flagged; higher-is-bad
  agent_publish_failure_count: number;   // flagged; higher-is-bad
  preview_http_5xx_count: number;        // flagged; higher-is-bad
  preview_http_502_count: number;        // flagged; higher-is-bad (container unreachable)
  preview_http_401_count: number;        // context-only (noisy — mostly bots)
  publish_http_5xx_count: number;        // flagged; higher-is-bad
}

export type WindowKind = '1h' | '24h';

export interface StatsDoc {
  '@timestamp': string;
  window: WindowKind;
  data: StatData;
  /** Error-event names seen this hour — stored for novel-fingerprint set-diff. Not a numeric metric. */
  error_event_names: string[];
  /** Top agent tool names invoked this hour — context for LLM reasoner. Not a numeric metric. */
  agent_tool_names: string[];
  /** "skill:count" — skills that failed activation this hour. Not a numeric metric. */
  failed_skill_names: string[];
  /** "tool:count" — top tools by execution volume this hour. Not a numeric metric. */
  top_tool_names: string[];
  notes: string;
}

export const STAT_KEYS: (keyof StatData)[] = [
  'log_count',
  'error_count',
  'warn_count',
  'error_rate',
  'error_event_count',
  'distinct_error_events',
  'sse_connected_count',
  'sse_first_response_count',
  'sse_connect_p95_ms',
  'sse_first_response_p95_ms',
  'publish_success',
  'publish_failure',
  'publish_success_rate',
  'create_success',
  'create_failure',
  'create_success_rate',
  'preview_timeouts',
  'new_error_fingerprints',
  'req_throughput',
  'req_error_rate',
  'latency_p50_ms',
  'latency_p95_ms',
  'alb_5xx_count',
  'alb_req_count',
  'alb_p95_ms',
  // Source D: Agents APM service transactions
  'agents_http_throughput',
  'agents_http_error_rate',
  'agents_http_p95_ms',
  'agents_chat_throughput',
  'agents_chat_p95_ms',
  'agents_publish_count',
  // Source E: Agents APM traces
  'agents_invocation_count',
  'agents_invocation_failure_count',
  'agents_invocation_abort_count',
  'agents_invocation_fetch_fail_count',
  'agents_toolcall_count',
  'agents_outbound_timeout_count',
  // Source F: Agents ESSP logs
  'agents_ai_call_count',
  'agents_http_error_count',
  'agents_auth_failure_count',
  'agents_embedding_error_count',
  // Source G: Loki (Nomad containers)
  'agent_run_count',
  'tool_failure_count',
  'skill_activation_failure_count',
  'typecheck_failure_count',
  'budget_exhaustion_count',
  'sse_error_count',
  'agent_publish_failure_count',
  'preview_http_5xx_count',
  'preview_http_502_count',
  'preview_http_401_count',
  'publish_http_5xx_count',
];

export function emptyStatData(): StatData {
  return {
    log_count: 0,
    error_count: 0,
    warn_count: 0,
    error_rate: 0,
    error_event_count: 0,
    distinct_error_events: 0,
    sse_connected_count: 0,
    sse_first_response_count: 0,
    sse_connect_p95_ms: 0,
    sse_first_response_p95_ms: 0,
    publish_success: 0,
    publish_failure: 0,
    publish_success_rate: 0,
    create_success: 0,
    create_failure: 0,
    create_success_rate: 0,
    preview_timeouts: 0,
    new_error_fingerprints: 0,
    req_throughput: 0,
    req_error_rate: 0,
    latency_p50_ms: 0,
    latency_p95_ms: 0,
    alb_5xx_count: 0,
    alb_req_count: 0,
    alb_p95_ms: 0,
    agents_http_throughput: 0,
    agents_http_error_rate: 0,
    agents_http_p95_ms: 0,
    agents_chat_throughput: 0,
    agents_chat_p95_ms: 0,
    agents_publish_count: 0,
    agents_invocation_count: 0,
    agents_invocation_failure_count: 0,
    agents_invocation_abort_count: 0,
    agents_invocation_fetch_fail_count: 0,
    agents_toolcall_count: 0,
    agents_outbound_timeout_count: 0,
    agents_ai_call_count: 0,
    agents_http_error_count: 0,
    agents_auth_failure_count: 0,
    agents_embedding_error_count: 0,
    agent_run_count: 0,
    tool_failure_count: 0,
    skill_activation_failure_count: 0,
    typecheck_failure_count: 0,
    budget_exhaustion_count: 0,
    sse_error_count: 0,
    agent_publish_failure_count: 0,
    preview_http_5xx_count: 0,
    preview_http_502_count: 0,
    preview_http_401_count: 0,
    publish_http_5xx_count: 0,
  };
}
