//! Validated run configuration derived from raw CLI arguments.

use std::path::PathBuf;
use std::time::Duration;

use anyhow::{Context, Result, bail};

use crate::cli::Cli;
use crate::model::TargetConfig;

/// How a worker waits between requests within a session.
#[derive(Debug, Clone, Copy)]
pub enum ThinkTime {
    /// Fire requests back-to-back (closed-loop, maximum stress).
    None,
    /// Sleep the recorded inter-request gap, capped at `cap_secs` when set.
    Preserve { cap_secs: Option<f64> },
}

/// One concurrency level held for a bounded (or open-ended) duration.
#[derive(Debug, Clone, Copy)]
pub struct Step {
    pub concurrency: usize,
    /// `None` means "until the stop condition fires" (fixed-count mode).
    pub duration_secs: Option<f64>,
}

/// The shape of the load: a sequence of steps. Fixed and duration modes are a
/// single step; ramp mode is many.
#[derive(Debug, Clone)]
pub struct LoadPlan {
    pub steps: Vec<Step>,
    /// Seconds skipped at the start of each step before metrics are recorded.
    pub step_warmup_secs: f64,
}

/// Fully resolved configuration for a run.
#[derive(Debug, Clone)]
pub struct RunConfig {
    pub plan: LoadPlan,
    pub target: TargetConfig,
    /// Times to cycle through the sessions; `None` is unlimited.
    pub repeat: Option<usize>,
    pub think_time: ThinkTime,
    pub unique_sessions: bool,
    pub max_duration_secs: Option<f64>,
    pub max_requests: Option<usize>,
    pub request_timeout: Duration,
    /// Cap on how long to wait for in-flight requests to finish after the run
    /// ends; `None` waits indefinitely.
    pub drain_timeout: Option<Duration>,
    pub output_json: Option<PathBuf>,
    pub output_csv: Option<PathBuf>,
    pub show_progress: bool,
    pub quiet: bool,
}

impl RunConfig {
    /// Peak concurrency across every step (used to size the connection pool).
    pub fn peak_concurrency(&self) -> usize {
        self.plan
            .steps
            .iter()
            .map(|s| s.concurrency)
            .max()
            .unwrap_or(1)
    }
}

/// Validates raw CLI args and resolves them into a [`RunConfig`].
pub fn resolve(args: Cli) -> Result<RunConfig> {
    if args.request_timeout <= 0.0 {
        bail!("--request-timeout must be positive");
    }
    if args.drain_timeout.is_some_and(|secs| secs <= 0.0) {
        bail!("--drain-timeout must be positive");
    }
    let plan = resolve_plan(&args)?;
    let target = resolve_target(&args)?;

    // Fixed mode without an explicit cap replays each session once; open-ended
    // modes default to cycling forever until a stop condition fires.
    let repeat = match (args.fixed, args.repeat, args.max_requests) {
        (_, Some(n), _) => Some(n),
        (true, None, None) => Some(1),
        _ => None,
    };

    let think_time = if args.preserve_think_time {
        ThinkTime::Preserve {
            cap_secs: args.max_think_time,
        }
    } else {
        ThinkTime::None
    };

    Ok(RunConfig {
        plan,
        target,
        repeat,
        think_time,
        unique_sessions: args.unique_sessions,
        max_duration_secs: args.max_duration,
        max_requests: args.max_requests,
        request_timeout: Duration::from_secs_f64(args.request_timeout),
        drain_timeout: args.drain_timeout.map(Duration::from_secs_f64),
        output_json: args.output_json,
        output_csv: args.output_csv,
        show_progress: !args.no_progress && !args.quiet,
        quiet: args.quiet,
    })
}

/// Builds the [`TargetConfig`] (endpoint, model override, auth) from raw args.
/// Shared by the load path and `--probe` so both re-point requests identically.
pub fn resolve_target(args: &Cli) -> Result<TargetConfig> {
    Ok(TargetConfig {
        base_url: args
            .target
            .clone()
            .context("--target <URL> is required to replay")?,
        model_override: args.model.clone(),
        api_key: args.api_key.clone(),
        forward_auth: args.forward_auth,
        bust_system_prompt: args.bust_system_prompt,
    })
}

/// Builds the [`LoadPlan`] for the selected mode.
fn resolve_plan(args: &Cli) -> Result<LoadPlan> {
    if args.concurrency == 0 {
        bail!("--concurrency must be at least 1");
    }

    let steps = if args.ramp {
        ramp_steps(args)?
    } else if let Some(duration) = args.duration {
        if duration <= 0.0 {
            bail!("--duration must be positive");
        }
        vec![Step {
            concurrency: args.concurrency,
            duration_secs: Some(duration),
        }]
    } else if args.fixed {
        // Runs until the stop condition (--max-requests, or session exhaustion
        // when --repeat / the default single cycle applies).
        vec![Step {
            concurrency: args.concurrency,
            duration_secs: None,
        }]
    } else {
        bail!("select a mode: --fixed, --duration <SECS>, or --ramp");
    };

    // Warmup trimming only makes sense for ramp steps; fixed/duration runs are
    // a single window and should count every request.
    let step_warmup_secs = if args.ramp {
        args.ramp_warmup.max(0.0)
    } else {
        0.0
    };
    Ok(LoadPlan {
        steps,
        step_warmup_secs,
    })
}

/// Expands `--ramp-*` options into one step per concurrency level.
fn ramp_steps(args: &Cli) -> Result<Vec<Step>> {
    let end = args.ramp_end.context("--ramp requires --ramp-end <C>")?;
    if args.ramp_start == 0 {
        bail!("--ramp-start must be at least 1");
    }
    if end < args.ramp_start {
        bail!(
            "--ramp-end ({end}) must be >= --ramp-start ({})",
            args.ramp_start
        );
    }
    if args.ramp_step == 0 {
        bail!("--ramp-step must be at least 1");
    }
    if args.ramp_step_duration <= 0.0 {
        bail!("--ramp-step-duration must be positive");
    }
    if args.ramp_warmup >= args.ramp_step_duration {
        eprintln!(
            "warning: --ramp-warmup ({:.0}s) is >= --ramp-step-duration ({:.0}s); every step's \
             metrics window will be empty. Lower the warmup or lengthen the step.",
            args.ramp_warmup, args.ramp_step_duration
        );
    }

    let mut steps: Vec<Step> = Vec::new();
    let mut concurrency = args.ramp_start;
    while concurrency <= end {
        steps.push(Step {
            concurrency,
            duration_secs: Some(args.ramp_step_duration),
        });
        concurrency += args.ramp_step;
    }
    // Always include the exact endpoint as the final step.
    if steps.last().map(|s| s.concurrency) != Some(end) {
        steps.push(Step {
            concurrency: end,
            duration_secs: Some(args.ramp_step_duration),
        });
    }
    Ok(steps)
}
