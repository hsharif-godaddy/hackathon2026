//! Command-line surface.

use std::path::PathBuf;

use clap::Parser;

/// Replay captured mitmproxy LLM workloads (OpenAI Chat Completions or Anthropic
/// Messages) against a target endpoint and report load/latency metrics.
#[derive(Debug, Parser)]
#[command(name = "llm-bench", version, about)]
pub struct Cli {
    /// One or more mitmproxy flow dump files to replay (each file is one session).
    #[arg(required = true, value_name = "DUMP_FILES")]
    pub dump_files: Vec<PathBuf>,

    /// Run a fixed number of requests (see --max-requests) at --concurrency.
    #[arg(long, group = "mode")]
    pub fixed: bool,

    /// Run for this many seconds at --concurrency.
    #[arg(long, group = "mode", value_name = "SECS")]
    pub duration: Option<f64>,

    /// Ramp concurrency in steps (see --ramp-* options).
    #[arg(long, group = "mode")]
    pub ramp: bool,

    /// Concurrent virtual users (sessions in flight) for --fixed / --duration.
    #[arg(long, default_value_t = 1, value_name = "C")]
    pub concurrency: usize,

    /// Ramp: starting concurrency.
    #[arg(long, default_value_t = 1, value_name = "C")]
    pub ramp_start: usize,

    /// Ramp: maximum concurrency (last step).
    #[arg(long, value_name = "C")]
    pub ramp_end: Option<usize>,

    /// Ramp: concurrency added per step.
    #[arg(long, default_value_t = 1, value_name = "DELTA")]
    pub ramp_step: usize,

    /// Ramp: wall-clock duration of each step in seconds.
    #[arg(long, default_value_t = 60.0, value_name = "SECS")]
    pub ramp_step_duration: f64,

    /// Ramp: seconds skipped at the start of each step before recording metrics.
    #[arg(long, default_value_t = 5.0, value_name = "SECS")]
    pub ramp_warmup: f64,

    /// Target base URL, e.g. http://localhost:8000 (required unless --dump-only).
    #[arg(long, value_name = "URL")]
    pub target: Option<String>,

    /// Override the `model` field in every request body.
    #[arg(long, value_name = "NAME")]
    pub model: Option<String>,

    /// Bearer token sent as `Authorization: Bearer <KEY>` (overrides --forward-auth).
    #[arg(long, env = "LLMBENCH_API_KEY", value_name = "KEY")]
    pub api_key: Option<String>,

    /// Forward the captured credential header(s) — `Authorization` and/or
    /// Anthropic's `x-api-key` (replay against the endpoint the workload was
    /// captured from). The captured token may be expired.
    #[arg(long)]
    pub forward_auth: bool,

    /// How many times to cycle through the sessions (default: until stop condition).
    #[arg(long, value_name = "N")]
    pub repeat: Option<usize>,

    /// Make each concurrent session replay unique by injecting a per-instance
    /// marker into the prompt — defeats server-side prefix caching across virtual
    /// users, so prefill load reflects diverse real traffic. By default the
    /// marker is placed after the leading system prompt, leaving that shared
    /// prefix cacheable as it would be in production.
    #[arg(long)]
    pub unique_sessions: bool,

    /// With --unique-sessions, place the marker ahead of the system prompt too,
    /// defeating its shared cache (a conservative worst-case prefill estimate).
    #[arg(long)]
    pub bust_system_prompt: bool,

    /// Sleep the recorded inter-request gap between requests in a session.
    #[arg(long)]
    pub preserve_think_time: bool,

    /// Cap any preserved think-time at this many seconds.
    #[arg(long, value_name = "SECS")]
    pub max_think_time: Option<f64>,

    /// Hard cap on total test wall-clock time, across all ramp steps.
    #[arg(long, value_name = "SECS")]
    pub max_duration: Option<f64>,

    /// Hard cap on total requests fired.
    #[arg(long, value_name = "N")]
    pub max_requests: Option<usize>,

    /// Abort and record a timeout if a single request runs longer than this.
    #[arg(long, default_value_t = 600.0, value_name = "SECS")]
    pub request_timeout: f64,

    /// After the run ends, wait at most this long for in-flight requests to
    /// finish before aborting them (default: wait indefinitely). Aborted
    /// requests are excluded from the report. Bounds the post-run drain when a
    /// saturated target leaves slow requests in flight.
    #[arg(long, value_name = "SECS")]
    pub drain_timeout: Option<f64>,

    /// Write the full structured report to this JSON file.
    #[arg(long, value_name = "FILE")]
    pub output_json: Option<PathBuf>,

    /// Write one row per request to this CSV file.
    #[arg(long, value_name = "FILE")]
    pub output_csv: Option<PathBuf>,

    /// Disable the live progress line.
    #[arg(long)]
    pub no_progress: bool,

    /// Print only the final summary.
    #[arg(long)]
    pub quiet: bool,

    /// Parse the dump files, print a summary, and exit without replaying.
    #[arg(long)]
    pub dump_only: bool,

    /// Replay the whole first captured session in order, exactly as a real run
    /// would — streaming each response (content, reasoning, tool calls) plus
    /// per-request and session metrics, then exit. Use it to confirm the target
    /// returns what you expect before committing to a load run. Requires
    /// --target; honors --model, --api-key, --forward-auth, --unique-sessions,
    /// and --request-timeout.
    #[arg(long)]
    pub probe: bool,
}
