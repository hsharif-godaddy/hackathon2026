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
}

export type WindowKind = '1h' | '24h';

export interface StatsDoc {
  '@timestamp': string;
  window: WindowKind;
  data: StatData;
  /** Error-event names seen this hour — stored for novel-fingerprint set-diff. Not a numeric metric. */
  error_event_names: string[];
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
  };
}
