//! Builds and renders the final report (human table, JSON, CSV).

use std::path::Path;

use anyhow::{Context, Result};
use comfy_table::{Cell, Table, presets::UTF8_FULL};
use serde::Serialize;

use crate::config::RunConfig;
use crate::metrics::aggregate::{ErrorBreakdown, WindowSummary, error_breakdown, summarize};
use crate::metrics::record::RequestOutcome;
use crate::replay::scheduler::LoadResult;

/// The structured report, serialized verbatim to `--output-json`.
#[derive(Debug, Clone, Serialize)]
pub struct Report {
    pub target: String,
    pub model: Option<String>,
    pub wall_secs: f64,
    pub total_requests: usize,
    pub overall: WindowSummary,
    pub errors: ErrorBreakdown,
    /// A few distinct failure messages (status + body snippet), for diagnosis.
    pub sample_errors: Vec<String>,
    pub steps: Vec<WindowSummary>,
}

/// Assembles the report from the run config and collected results, attributing
/// each request to the step its send-time fell in (after the per-step warmup).
pub fn build_report(config: &RunConfig, result: &LoadResult) -> Report {
    let all: Vec<&RequestOutcome> = result.outcomes.iter().collect();
    let overall = summarize(&all, config.peak_concurrency(), result.wall_secs);
    let warmup = config.plan.step_warmup_secs;

    let steps: Vec<WindowSummary> = result
        .windows
        .iter()
        .map(|window| {
            let record_from = window.start_secs + warmup;
            // Attribution is by send time: a request started inside the window
            // counts here even if it finishes after `end_secs`. This keeps a slow
            // request from a lighter step out of a heavier step, at the cost of
            // slightly overstating per-step aggregate tok/s near boundaries (its
            // full token count divides a window that ends before it completed).
            // The `overall` summary (÷ wall_secs) is unaffected.
            let in_window: Vec<&RequestOutcome> = result
                .outcomes
                .iter()
                .filter(|o| o.started_at_secs >= record_from && o.started_at_secs < window.end_secs)
                .collect();
            summarize(
                &in_window,
                window.concurrency,
                (window.end_secs - record_from).max(0.0),
            )
        })
        .collect();

    Report {
        target: config.target.base_url.clone(),
        model: config.target.model_override.clone(),
        wall_secs: result.wall_secs,
        total_requests: result.outcomes.len(),
        overall,
        errors: error_breakdown(&result.outcomes),
        sample_errors: sample_errors(&result.outcomes),
        steps,
    }
}

/// Collects up to five distinct failure messages from the outcomes.
fn sample_errors(outcomes: &[RequestOutcome]) -> Vec<String> {
    let mut seen: Vec<String> = Vec::new();
    for outcome in outcomes {
        if let Some(message) = &outcome.error
            && !seen.contains(message)
        {
            seen.push(message.clone());
            if seen.len() == 5 {
                break;
            }
        }
    }
    seen
}

/// Prints the human-readable report to stdout.
pub fn render(report: &Report) {
    println!("\nTarget: {}", report.target);
    if let Some(model) = &report.model {
        println!("Model override: {model}");
    }
    println!(
        "Wall time: {:.1}s | requests: {} | ok: {} | errors: {} ({:.1}%)",
        report.wall_secs,
        report.total_requests,
        report.overall.ok,
        report.overall.errors,
        report.overall.error_rate * 100.0,
    );
    if report.errors.http_error
        + report.errors.stream
        + report.errors.transport
        + report.errors.timeout
        > 0
    {
        println!(
            "Error breakdown: http={} stream={} transport={} timeout={}",
            report.errors.http_error,
            report.errors.stream,
            report.errors.transport,
            report.errors.timeout,
        );
        if !report.sample_errors.is_empty() {
            println!("Sample errors:");
            for message in &report.sample_errors {
                println!("  - {message}");
            }
        }
    }

    println!("\nPer-concurrency breakdown:");
    println!("{}", step_table(report));
}

/// Renders the per-step comparison table (one row per concurrency level).
fn step_table(report: &Report) -> Table {
    let mut table = Table::new();
    table.load_preset(UTF8_FULL);
    table.set_header(vec![
        "Concurrency",
        "Reqs",
        "Err%",
        "TTFT p50 (ms)",
        "TTFT p99 (ms)",
        "TTLT p50 (ms)",
        "TTLT p99 (ms)",
        "decode tok/s/req p50",
        "Aggregate tok/s",
        "Req/s",
        "e2e tok/s vs baseline",
    ]);

    for step in &report.steps {
        table.add_row(vec![
            Cell::new(step.concurrency),
            Cell::new(step.requests),
            Cell::new(format!("{:.1}", step.error_rate * 100.0)),
            Cell::new(format!("{:.0}", step.ttft_ms.p50)),
            Cell::new(format!("{:.0}", step.ttft_ms.p99)),
            Cell::new(format!("{:.0}", step.ttlt_ms.p50)),
            Cell::new(format!("{:.0}", step.ttlt_ms.p99)),
            Cell::new(format!("{:.1}", step.output_tps_per_req.p50)),
            Cell::new(format!("{:.1}", step.aggregate_output_tps)),
            Cell::new(format!("{:.2}", step.requests_per_sec)),
            Cell::new(baseline_delta(step)),
        ]);
    }
    table
}

/// Formats the live-vs-recorded end-to-end throughput delta for a step.
fn baseline_delta(step: &WindowSummary) -> String {
    match (step.mean_live_e2e_tps, step.mean_baseline_e2e_tps) {
        (Some(live), Some(base)) => {
            format!("{:+.1} ({live:.1} vs {base:.1})", live - base)
        }
        _ => "—".to_string(),
    }
}

/// Writes the structured report to a JSON file.
pub fn write_json(report: &Report, path: &Path) -> Result<()> {
    let json = serde_json::to_string_pretty(report).context("serializing report")?;
    std::fs::write(path, json).with_context(|| format!("writing {}", path.display()))?;
    Ok(())
}

/// Writes one CSV row per request to `path`.
pub fn write_csv(outcomes: &[RequestOutcome], path: &Path) -> Result<()> {
    let mut writer =
        csv::Writer::from_path(path).with_context(|| format!("creating {}", path.display()))?;
    writer.write_record([
        "session",
        "request_index",
        "model",
        "started_at_secs",
        "status",
        "ttft_ms",
        "ttlt_ms",
        "total_ms",
        "completion_tokens",
        "prompt_tokens",
        "decode_tps",
        "end_to_end_tps",
        "baseline_e2e_tps",
        "baseline_total_ms",
        "error",
    ])?;
    for outcome in outcomes {
        writer.write_record([
            outcome.session.clone(),
            outcome.request_index.to_string(),
            outcome.model.clone().unwrap_or_default(),
            format!("{:.3}", outcome.started_at_secs),
            status_label(&outcome.status).to_string(),
            opt_f64(outcome.ttft_ms),
            opt_f64(outcome.ttlt_ms),
            format!("{:.1}", outcome.total_ms),
            outcome.completion_tokens.to_string(),
            outcome
                .usage
                .map(|u| u.prompt_tokens.to_string())
                .unwrap_or_default(),
            opt_f64(outcome.output_tps),
            opt_f64(outcome.end_to_end_tps),
            opt_f64(outcome.baseline_output_tps),
            opt_f64(outcome.baseline_total_ms),
            outcome.error.clone().unwrap_or_default(),
        ])?;
    }
    writer
        .flush()
        .with_context(|| format!("flushing {}", path.display()))?;
    Ok(())
}

/// Short label for a request status, used in CSV rows.
fn status_label(status: &crate::metrics::record::RequestStatus) -> &'static str {
    use crate::metrics::record::RequestStatus;
    match status {
        RequestStatus::Ok => "ok",
        RequestStatus::HttpError { .. } => "http_error",
        RequestStatus::Stream => "stream_error",
        RequestStatus::Transport => "transport",
        RequestStatus::Timeout => "timeout",
    }
}

/// Formats an optional float for CSV (empty string when absent).
fn opt_f64(value: Option<f64>) -> String {
    value.map(|v| format!("{v:.3}")).unwrap_or_default()
}
