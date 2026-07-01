//! `llm-bench` entry point.

mod cli;
mod config;
mod flow;
mod metrics;
mod model;
mod probe;
mod replay;
mod report;
mod sse;
mod wire;

use std::time::Duration;

use anyhow::{Context, Result, bail};
use clap::Parser;
use tokio_util::sync::CancellationToken;

use crate::cli::Cli;
use crate::config::{RunConfig, resolve, resolve_target};
use crate::flow::parser::parse_flow_file;
use crate::model::Session;
use crate::probe::run_probe;
use crate::replay::scheduler::run_load;

fn main() -> Result<()> {
    let args = Cli::parse();

    let sessions: Vec<Session> = args
        .dump_files
        .iter()
        .map(|path| parse_flow_file(path).with_context(|| format!("parsing {}", path.display())))
        .collect::<Result<Vec<_>>>()?;

    let total_requests: usize = sessions.iter().map(Session::len).sum();
    if total_requests == 0 {
        anyhow::bail!("no chat-completion requests found in the provided dump files");
    }

    if args.dump_only {
        print_dump_summary(&sessions);
        return Ok(());
    }

    if args.probe {
        if args.request_timeout <= 0.0 {
            bail!("--request-timeout must be positive");
        }
        let target = resolve_target(&args)?;
        let request_timeout = Duration::from_secs_f64(args.request_timeout);
        return tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()?
            .block_on(run_probe(
                target,
                &sessions,
                args.unique_sessions,
                request_timeout,
            ));
    }

    let config = resolve(args)?;
    tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()?
        .block_on(run(config, sessions))
}

/// Drives a full load run and emits the report.
async fn run(config: RunConfig, sessions: Vec<Session>) -> Result<()> {
    if !config.quiet {
        eprintln!(
            "replaying {} session(s) against {} …",
            sessions.len(),
            config.target.base_url,
        );
    }

    let dump_has_auth = sessions
        .iter()
        .flat_map(|s| &s.requests)
        .any(|r| r.has_captured_auth());

    let result = run_load(&config, sessions, CancellationToken::new()).await?;
    let report = report::build_report(&config, &result);

    if !config.quiet {
        report::render(&report);
    }
    maybe_hint_auth(&config, &report, dump_has_auth);
    if let Some(path) = &config.output_json {
        report::write_json(&report, path)?;
        eprintln!("wrote JSON report to {}", path.display());
    }
    if let Some(path) = &config.output_csv {
        report::write_csv(&result.outcomes, path)?;
        eprintln!("wrote CSV records to {}", path.display());
    }
    Ok(())
}

/// Prints an actionable hint when every-or-most requests failed auth and the
/// dump carried a credential the run did not forward.
fn maybe_hint_auth(config: &RunConfig, report: &report::Report, dump_has_auth: bool) {
    let auth_errors = report.errors.http_error > 0
        && report
            .sample_errors
            .iter()
            .any(|m| m.contains("401") || m.contains("403"));
    let no_credential = config.target.api_key.is_none() && !config.target.forward_auth;
    if auth_errors && no_credential && dump_has_auth {
        eprintln!(
            "\nhint: requests were rejected with 401/403. The dump contains a credential \
             header (Authorization or x-api-key) — re-run with --forward-auth to replay the \
             captured token, or pass --api-key <KEY> (or set LLMBENCH_API_KEY) to authenticate \
             against the target."
        );
    }
}

/// Prints a human-readable summary of the parsed sessions and their recorded
/// baselines (the `--dump-only` path).
fn print_dump_summary(sessions: &[Session]) {
    for session in sessions {
        println!("session {} — {} request(s)", session.name, session.len());
        for (index, request) in session.requests.iter().enumerate() {
            let model = request.model.as_deref().unwrap_or("<unknown>");
            let body_bytes = serde_json::to_vec(&request.body)
                .map(|b| b.len())
                .unwrap_or(0);
            print!("  [{index:>3}] model={model} body={body_bytes}B");
            if let Some(baseline) = &request.baseline {
                print!(
                    " | recorded status={} {:.2}s",
                    baseline.status_code, baseline.latency_secs
                );
                if let Some(usage) = baseline.usage {
                    print!(
                        " prompt={} completion={}",
                        usage.prompt_tokens, usage.completion_tokens
                    );
                    if let Some(cached) = usage.cached_tokens {
                        print!(" cached={cached}");
                    }
                }
                if let Some(tps) = baseline.output_tps {
                    print!(" {tps:.1}tok/s");
                }
                if baseline.malformed_chunks > 0 {
                    print!(" ⚠ {} malformed chunk(s)", baseline.malformed_chunks);
                }
            }
            println!();
        }
    }

    let total: usize = sessions.iter().map(Session::len).sum();
    println!(
        "\n{} session(s), {} chat-completion request(s) total",
        sessions.len(),
        total
    );
}
