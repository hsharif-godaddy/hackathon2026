//! Aggregation of per-request outcomes into windowed summaries.

use serde::Serialize;

use crate::metrics::record::{RequestOutcome, RequestStatus};

/// Distribution stats over a set of samples. All fields are `0.0` when empty.
#[derive(Debug, Clone, Default, Serialize)]
pub struct Stats {
    pub count: usize,
    pub mean: f64,
    pub p50: f64,
    pub p90: f64,
    pub p99: f64,
    pub min: f64,
    pub max: f64,
}

impl Stats {
    /// Computes stats from unsorted samples (exact percentiles via sorting).
    pub fn from_samples(samples: &[f64]) -> Self {
        if samples.is_empty() {
            return Self::default();
        }
        let mut sorted: Vec<f64> = samples.to_vec();
        sorted.sort_by(|a, b| a.total_cmp(b));
        let sum: f64 = sorted.iter().sum();
        Self {
            count: sorted.len(),
            mean: sum / sorted.len() as f64,
            p50: percentile(&sorted, 0.50),
            p90: percentile(&sorted, 0.90),
            p99: percentile(&sorted, 0.99),
            min: sorted[0],
            max: sorted[sorted.len() - 1],
        }
    }
}

/// Nearest-rank percentile of an already-sorted, non-empty slice.
fn percentile(sorted: &[f64], q: f64) -> f64 {
    let rank = (q * sorted.len() as f64).ceil() as usize;
    sorted[rank.saturating_sub(1).min(sorted.len() - 1)]
}

/// Aggregated metrics for a single concurrency level (or a whole run).
#[derive(Debug, Clone, Serialize)]
pub struct WindowSummary {
    pub concurrency: usize,
    pub window_secs: f64,
    pub requests: usize,
    pub ok: usize,
    pub errors: usize,
    pub error_rate: f64,
    /// Time-to-first-token (ms) across successful requests.
    pub ttft_ms: Stats,
    /// Time-to-last-token (ms) across successful requests.
    pub ttlt_ms: Stats,
    /// Per-request output tokens/sec across successful requests.
    pub output_tps_per_req: Stats,
    /// Total output tokens/sec sustained in the window (the saturation signal).
    pub aggregate_output_tps: f64,
    pub requests_per_sec: f64,
    pub completion_tokens: u64,
    /// Mean live vs recorded baseline END-TO-END tokens/sec (prefill included
    /// on both sides — this is the only apples-to-apples baseline comparison).
    pub mean_live_e2e_tps: Option<f64>,
    pub mean_baseline_e2e_tps: Option<f64>,
}

/// Summarizes a set of outcomes attributed to a window of `window_secs` held at
/// `concurrency`.
pub fn summarize(
    outcomes: &[&RequestOutcome],
    concurrency: usize,
    window_secs: f64,
) -> WindowSummary {
    let requests = outcomes.len();
    let ok: Vec<&&RequestOutcome> = outcomes.iter().filter(|o| o.status.is_ok()).collect();
    let errors = requests - ok.len();

    let ttft_samples: Vec<f64> = ok.iter().filter_map(|o| o.ttft_ms).collect();
    let ttlt_samples: Vec<f64> = ok.iter().filter_map(|o| o.ttlt_ms).collect();
    let tps_samples: Vec<f64> = ok.iter().filter_map(|o| o.output_tps).collect();
    let live_e2e_samples: Vec<f64> = ok.iter().filter_map(|o| o.end_to_end_tps).collect();
    let baseline_samples: Vec<f64> = ok.iter().filter_map(|o| o.baseline_output_tps).collect();
    let completion_tokens: u64 = ok.iter().map(|o| o.completion_tokens).sum();

    let safe_window = if window_secs > 0.0 { window_secs } else { 1.0 };

    WindowSummary {
        concurrency,
        window_secs,
        requests,
        ok: ok.len(),
        errors,
        error_rate: if requests > 0 {
            errors as f64 / requests as f64
        } else {
            0.0
        },
        ttft_ms: Stats::from_samples(&ttft_samples),
        ttlt_ms: Stats::from_samples(&ttlt_samples),
        output_tps_per_req: Stats::from_samples(&tps_samples),
        aggregate_output_tps: completion_tokens as f64 / safe_window,
        requests_per_sec: ok.len() as f64 / safe_window,
        completion_tokens,
        mean_live_e2e_tps: mean(&live_e2e_samples),
        mean_baseline_e2e_tps: mean(&baseline_samples),
    }
}

/// Counts of non-success outcomes by status label.
#[derive(Debug, Clone, Default, Serialize)]
pub struct ErrorBreakdown {
    pub http_error: usize,
    pub stream: usize,
    pub transport: usize,
    pub timeout: usize,
}

/// Tallies error outcomes by class.
pub fn error_breakdown(outcomes: &[RequestOutcome]) -> ErrorBreakdown {
    let mut breakdown = ErrorBreakdown::default();
    for outcome in outcomes {
        match outcome.status {
            RequestStatus::Ok => {}
            RequestStatus::HttpError { .. } => breakdown.http_error += 1,
            RequestStatus::Stream => breakdown.stream += 1,
            RequestStatus::Transport => breakdown.transport += 1,
            RequestStatus::Timeout => breakdown.timeout += 1,
        }
    }
    breakdown
}

/// Arithmetic mean of samples, or `None` when empty.
fn mean(samples: &[f64]) -> Option<f64> {
    if samples.is_empty() {
        None
    } else {
        Some(samples.iter().sum::<f64>() / samples.len() as f64)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn percentiles_are_nearest_rank() {
        let sorted: Vec<f64> = (1..=100).map(|n| n as f64).collect();
        assert_eq!(percentile(&sorted, 0.50), 50.0);
        assert_eq!(percentile(&sorted, 0.90), 90.0);
        assert_eq!(percentile(&sorted, 0.99), 99.0);
    }

    #[test]
    fn stats_handle_empty() {
        let stats = Stats::from_samples(&[]);
        assert_eq!(stats.count, 0);
        assert_eq!(stats.p99, 0.0);
    }
}
