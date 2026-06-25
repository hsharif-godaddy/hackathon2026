//! Per-request outcome produced by a worker.

use serde::Serialize;

use crate::model::Usage;

/// How a single replayed request ended.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "snake_case", tag = "status")]
pub enum RequestStatus {
    /// Stream completed normally.
    Ok,
    /// Server returned a non-2xx HTTP status.
    HttpError { code: u16 },
    /// The response began with a 200 but the stream carried an error frame
    /// (`data: {"error": ...}`) or an undecodable `data:` payload — a common
    /// under-load degradation signature (KV-cache exhaustion, preemption, OOM
    /// mid-generation) that closes cleanly and would otherwise look successful.
    Stream,
    /// Connection / send / read failure before or during the stream.
    Transport,
    /// The request exceeded the per-request timeout.
    Timeout,
}

impl RequestStatus {
    /// Whether this outcome counts as a successful generation.
    pub fn is_ok(&self) -> bool {
        matches!(self, RequestStatus::Ok)
    }
}

/// Metrics for one replayed request.
#[derive(Debug, Clone, Serialize)]
pub struct RequestOutcome {
    /// Source session name.
    pub session: String,
    /// Index of the request within its session.
    pub request_index: usize,
    /// Model named in the (possibly overridden) request body.
    pub model: Option<String>,
    /// Seconds from test start to when this request was sent (for step attribution).
    pub started_at_secs: f64,
    pub status: RequestStatus,
    /// Time-to-first-token (ms): send → first non-empty content delta. `None`
    /// when the request failed before any content arrived.
    pub ttft_ms: Option<f64>,
    /// Time-to-last-token (ms): send → last non-empty content delta — the
    /// user-perceived completion time, before the trailing usage/[DONE] frames.
    /// `None` when the request failed before any content arrived.
    pub ttlt_ms: Option<f64>,
    /// Total wall-clock time (ms): send → stream end (or failure).
    pub total_ms: f64,
    /// Server-reported usage, when a usage chunk was received.
    pub usage: Option<Usage>,
    /// Resolved completion tokens (from usage, else estimated from content).
    pub completion_tokens: u64,
    /// Decode-only throughput: completion_tokens / (total - first_token_time),
    /// where first_token_time is the first generated token of any kind
    /// (reasoning included). Excludes prefill only, so it is NOT comparable to
    /// the recorded baseline.
    pub output_tps: Option<f64>,
    /// End-to-end throughput: completion_tokens / total (prefill included).
    /// This is the apples-to-apples match for the recorded baseline.
    pub end_to_end_tps: Option<f64>,
    /// Recorded baseline end-to-end tokens/sec for this request, when captured.
    pub baseline_output_tps: Option<f64>,
    /// Recorded baseline total latency (ms) for this request, when captured.
    pub baseline_total_ms: Option<f64>,
    /// Set for failures.
    pub error: Option<String>,
}
