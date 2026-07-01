// Real field names in `logs-gdelastic.katana.app-prod-ecs` (structured event log).
export const FIELD = {
  level: 'level',
  event: 'event',
} as const;

export const SSE_CONNECTED_EVENT = 'client.funnel.sse.connected';
export const SSE_FIRST_RESPONSE_EVENT = 'client.funnel.sse.first_response';
export const SSE_CONNECT_MS_FIELD = 'data.totalMs';
export const SSE_FIRST_RESPONSE_MS_FIELD = 'data.firstResponseMs';

// Failure events carry an .error / .failed / .failure suffix.
export const ERROR_EVENT_REGEXP = '.*\\.(error|failed|failure)';
// Maximum distinct error-event names to retrieve per hour (enough to cover
// all known distinct events/24h with headroom).
export const ERROR_EVENT_NAMES_MAX = 500;

export const ERROR_LEVELS = ['error', 'ERROR'];
export const WARN_LEVELS = ['warn', 'WARN', 'Warn'];

// ── Golden-flow events (verified in prod 2026-06-23) ─────────────────────────
// Publish flow
export const PUBLISH_SUCCESS_EVENT = 'client.publish.success';
export const PUBLISH_FAILURE_EVENT = 'client.publish.error';
// Create flow
export const CREATE_SUCCESS_EVENT = 'deployments.api.create.success';
export const CREATE_FAILURE_EVENT = 'mgmt-airo.create-app.error';
// Preview flow
export const PREVIEW_TIMEOUT_EVENT = 'client.preview-pane.iframe.timeout';

// ── APM (metrics-apm.service_transaction.1m) field names ─────────────────────
// Latency histogram field — ES histogram type; supports percentiles agg natively.
// Values are in microseconds; divide by 1000 to get milliseconds.
export const APM_DURATION_HISTOGRAM = 'transaction.duration.histogram';
// Successful-transaction counter — aggregate_metric_double; use sum agg at the
// PARENT field (not `.sum` sub-path) to get the correct total.
export const APM_SUCCESS_COUNT = 'event.success_count';

// ── CloudWatch ALB field names ────────────────────────────────────────────────
export const CW_ALB_5XX = 'aws.applicationelb.metrics.HTTPCode_Target_5XX_Count.sum';
export const CW_ALB_REQ = 'aws.applicationelb.metrics.RequestCount.sum';
// TargetResponseTime is in seconds (CloudWatch native). Multiply by 1000 for ms.
export const CW_ALB_P95_SEC = 'aws.applicationelb.metrics.TargetResponseTime.p95.00';
export const CW_NAMESPACE_ALB = 'AWS/ApplicationELB';
export const CW_DIM_LOAD_BALANCER = 'aws.dimensions.LoadBalancer';
