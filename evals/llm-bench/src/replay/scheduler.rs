//! Concurrency scheduler: drives the configured load plan by spawning a pool of
//! virtual-user workers, collecting their outcomes, and recording per-step
//! windows.

use std::sync::Arc;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::time::{Duration, Instant};

use anyhow::Result;
use async_channel::{Receiver, Sender};
use tokio::task::JoinHandle;
use tokio_util::sync::CancellationToken;

use crate::config::{RunConfig, Step, ThinkTime};
use crate::metrics::record::RequestOutcome;
use crate::model::{CapturedRequest, Session, TargetConfig};
use crate::replay::build_client;
use crate::replay::worker::execute_request;

/// Wall-clock window during which a given concurrency level was held.
#[derive(Debug, Clone, Copy)]
pub struct StepWindow {
    pub concurrency: usize,
    /// Seconds since test start when the step began.
    pub start_secs: f64,
    /// Seconds since test start when the step ended.
    pub end_secs: f64,
}

/// Everything a run produced.
pub struct LoadResult {
    pub outcomes: Vec<RequestOutcome>,
    pub windows: Vec<StepWindow>,
    pub wall_secs: f64,
}

/// Live counters shared between workers and the progress reporter.
struct Shared {
    cancel: CancellationToken,
    requests_started: AtomicUsize,
    completed: AtomicUsize,
    inflight: AtomicUsize,
    completion_tokens: AtomicU64,
    max_requests: Option<usize>,
    /// Monotonic id assigned to each session pickup, for unique-session markers.
    instance_seq: AtomicU64,
}

/// Immutable context handed to every worker.
struct WorkerCtx {
    client: reqwest::Client,
    target: TargetConfig,
    think_time: ThinkTime,
    request_timeout: Duration,
    test_start: Instant,
    /// When set, each session-replay instance gets a unique cache-busting marker.
    unique_sessions: bool,
}

/// Runs the configured load plan to completion (or cancellation) and returns
/// the collected outcomes and step windows.
pub async fn run_load(
    config: &RunConfig,
    sessions: Vec<Session>,
    cancel: CancellationToken,
) -> Result<LoadResult> {
    let test_start = Instant::now();
    let shared = Arc::new(Shared {
        cancel: cancel.clone(),
        requests_started: AtomicUsize::new(0),
        completed: AtomicUsize::new(0),
        inflight: AtomicUsize::new(0),
        completion_tokens: AtomicU64::new(0),
        max_requests: config.max_requests,
        instance_seq: AtomicU64::new(0),
    });

    let ctx = Arc::new(WorkerCtx {
        client: build_client(config.peak_concurrency())?,
        target: config.target.clone(),
        think_time: config.think_time,
        request_timeout: config.request_timeout,
        test_start,
        unique_sessions: config.unique_sessions,
    });

    let (outcome_tx, outcome_rx) = async_channel::unbounded::<RequestOutcome>();
    let aggregator: JoinHandle<Vec<RequestOutcome>> = tokio::spawn(async move {
        let mut collected: Vec<RequestOutcome> = Vec::new();
        while let Ok(outcome) = outcome_rx.recv().await {
            collected.push(outcome);
        }
        collected
    });

    let sessions: Vec<Arc<Session>> = sessions.into_iter().map(Arc::new).collect();
    let capacity = config.peak_concurrency().max(sessions.len()).max(1);
    let (session_tx, session_rx) = async_channel::bounded::<Arc<Session>>(capacity);
    let producer = tokio::spawn(produce_sessions(
        sessions,
        config.repeat,
        session_tx,
        cancel.clone(),
    ));

    spawn_global_stops(config, cancel.clone());
    // The progress reporter stops on its own token, not the worker `cancel`, so
    // it keeps reporting through the post-run drain instead of going silent the
    // instant cancellation fires.
    let progress_stop = CancellationToken::new();
    let progress = config
        .show_progress
        .then(|| spawn_progress(shared.clone(), progress_stop.clone(), test_start));

    let windows = drive_steps(config, &ctx, &shared, &session_rx, &outcome_tx, test_start).await;

    cancel.cancel();
    let _ = producer.await;
    drop(outcome_tx);
    progress_stop.cancel();
    if let Some(handle) = progress {
        let _ = handle.await;
    }
    let outcomes = aggregator.await.unwrap_or_default();

    Ok(LoadResult {
        outcomes,
        windows,
        wall_secs: test_start.elapsed().as_secs_f64(),
    })
}

/// Feeds sessions into the worker channel, cycling through them `repeat` times
/// (or forever when `repeat` is `None`). Returns — dropping its sender, which
/// closes the channel — when the cycles are exhausted or the run is cancelled.
async fn produce_sessions(
    sessions: Vec<Arc<Session>>,
    repeat: Option<usize>,
    session_tx: Sender<Arc<Session>>,
    cancel: CancellationToken,
) {
    let mut cycle: usize = 0;
    loop {
        if repeat.is_some_and(|limit| cycle >= limit) {
            break;
        }
        for session in &sessions {
            tokio::select! {
                _ = cancel.cancelled() => return,
                sent = session_tx.send(session.clone()) => {
                    if sent.is_err() {
                        return;
                    }
                }
            }
        }
        cycle += 1;
    }
}

/// Walks the plan's steps, spawning workers to reach each step's concurrency and
/// holding that level for the step's duration. Workers are never killed
/// mid-request; the final step joins them (fixed mode) or cancellation does.
async fn drive_steps(
    config: &RunConfig,
    ctx: &Arc<WorkerCtx>,
    shared: &Arc<Shared>,
    session_rx: &Receiver<Arc<Session>>,
    outcome_tx: &Sender<RequestOutcome>,
    test_start: Instant,
) -> Vec<StepWindow> {
    let mut workers: Vec<JoinHandle<()>> = Vec::new();
    let mut windows: Vec<StepWindow> = Vec::new();

    for step in &config.plan.steps {
        while workers.len() < step.concurrency {
            workers.push(spawn_worker(
                ctx.clone(),
                shared.clone(),
                session_rx.clone(),
                outcome_tx.clone(),
            ));
        }

        let start_secs = test_start.elapsed().as_secs_f64();
        hold_step(step, &mut workers, &shared.cancel).await;
        let end_secs = test_start.elapsed().as_secs_f64();
        windows.push(StepWindow {
            concurrency: step.concurrency,
            start_secs,
            end_secs,
        });

        if shared.cancel.is_cancelled() {
            break;
        }
    }

    shared.cancel.cancel();
    let aborted = drain_workers(workers, config.drain_timeout).await;
    if aborted > 0 && !config.quiet {
        eprintln!(
            "\ndrain-timeout reached — aborted {aborted} in-flight request(s); \
             they are excluded from the report"
        );
    }
    windows
}

/// Joins all workers after cancellation. Workers honor cancellation only between
/// requests, so an in-flight request runs to completion (the post-run "drain").
/// With `drain_timeout` set, waits at most that long for stragglers to finish,
/// then aborts the rest — their outcomes are simply dropped from the report.
/// Returns the number aborted.
async fn drain_workers(mut workers: Vec<JoinHandle<()>>, drain_timeout: Option<Duration>) -> usize {
    let Some(timeout) = drain_timeout else {
        for worker in workers {
            let _ = worker.await;
        }
        return 0;
    };

    let joined = tokio::time::timeout(timeout, async {
        for worker in &mut workers {
            let _ = worker.await;
        }
    })
    .await;
    if joined.is_ok() {
        return 0;
    }

    let mut aborted: usize = 0;
    for worker in &workers {
        if !worker.is_finished() {
            worker.abort();
            aborted += 1;
        }
    }
    for worker in workers {
        let _ = worker.await;
    }
    aborted
}

/// Holds a step for its duration. A bounded step sleeps (interruptible by
/// cancellation); an open-ended step (fixed mode) joins the workers, which ends
/// when the session source drains or cancellation fires.
async fn hold_step(step: &Step, workers: &mut Vec<JoinHandle<()>>, cancel: &CancellationToken) {
    match step.duration_secs {
        Some(secs) => {
            tokio::select! {
                _ = tokio::time::sleep(Duration::from_secs_f64(secs)) => {}
                _ = cancel.cancelled() => {}
            }
        }
        None => {
            for worker in workers.drain(..) {
                let _ = worker.await;
            }
        }
    }
}

/// Spawns one virtual-user worker that pulls sessions and replays them in order.
fn spawn_worker(
    ctx: Arc<WorkerCtx>,
    shared: Arc<Shared>,
    session_rx: Receiver<Arc<Session>>,
    outcome_tx: Sender<RequestOutcome>,
) -> JoinHandle<()> {
    tokio::spawn(async move {
        loop {
            let session = tokio::select! {
                _ = shared.cancel.cancelled() => break,
                received = session_rx.recv() => match received {
                    Ok(session) => session,
                    Err(_) => break,
                },
            };
            // Per-pickup marker so each concurrent replay of the same session is
            // a distinct cache lineage, while requests within this instance keep
            // a shared (cacheable) prefix.
            let cache_buster = ctx.unique_sessions.then(|| {
                let id = shared.instance_seq.fetch_add(1, Ordering::Relaxed);
                format!("[llm-bench s{id}] ")
            });
            if replay_session(
                &ctx,
                &shared,
                &outcome_tx,
                &session,
                cache_buster.as_deref(),
            )
            .await
            .is_break()
            {
                break;
            }
        }
    })
}

/// Replays one session's requests in capture order. Returns `Break` when the
/// worker should stop entirely (cancellation or request cap reached).
async fn replay_session(
    ctx: &WorkerCtx,
    shared: &Shared,
    outcome_tx: &Sender<RequestOutcome>,
    session: &Session,
    cache_buster: Option<&str>,
) -> std::ops::ControlFlow<()> {
    let mut prev_end: Option<f64> = None;
    for (index, request) in session.requests.iter().enumerate() {
        if shared.cancel.is_cancelled() {
            return std::ops::ControlFlow::Break(());
        }
        if !claim_request_slot(shared) {
            return std::ops::ControlFlow::Break(());
        }
        if let ThinkTime::Preserve { cap_secs } = ctx.think_time
            && think(request, prev_end, cap_secs, &shared.cancel)
                .await
                .is_break()
        {
            return std::ops::ControlFlow::Break(());
        }

        shared.inflight.fetch_add(1, Ordering::Relaxed);
        let outcome = execute_request(
            &ctx.client,
            &ctx.target,
            request,
            &session.name,
            index,
            ctx.test_start,
            ctx.request_timeout,
            cache_buster,
        )
        .await;
        shared.inflight.fetch_sub(1, Ordering::Relaxed);

        shared.completed.fetch_add(1, Ordering::Relaxed);
        shared
            .completion_tokens
            .fetch_add(outcome.completion_tokens, Ordering::Relaxed);
        prev_end = Some(request.ts_end);
        if outcome_tx.send(outcome).await.is_err() {
            return std::ops::ControlFlow::Break(());
        }
    }
    std::ops::ControlFlow::Continue(())
}

/// Reserves one request against `--max-requests`. Returns `false` (and cancels
/// the run) once the cap is reached.
fn claim_request_slot(shared: &Shared) -> bool {
    let Some(max) = shared.max_requests else {
        return true;
    };
    if shared.requests_started.fetch_add(1, Ordering::SeqCst) >= max {
        shared.cancel.cancel();
        false
    } else {
        true
    }
}

/// Sleeps the recorded inter-request gap (capped), interruptible by cancellation.
async fn think(
    request: &CapturedRequest,
    prev_end: Option<f64>,
    cap_secs: Option<f64>,
    cancel: &CancellationToken,
) -> std::ops::ControlFlow<()> {
    let Some(prev) = prev_end else {
        return std::ops::ControlFlow::Continue(());
    };
    let mut gap = (request.ts_start - prev).max(0.0);
    if let Some(cap) = cap_secs {
        gap = gap.min(cap);
    }
    if gap <= 0.0 {
        return std::ops::ControlFlow::Continue(());
    }
    tokio::select! {
        _ = tokio::time::sleep(Duration::from_secs_f64(gap)) => std::ops::ControlFlow::Continue(()),
        _ = cancel.cancelled() => std::ops::ControlFlow::Break(()),
    }
}

/// Cancels the run when the global wall-clock cap elapses or Ctrl-C is received.
fn spawn_global_stops(config: &RunConfig, cancel: CancellationToken) {
    if let Some(secs) = config.max_duration_secs {
        let cancel = cancel.clone();
        tokio::spawn(async move {
            tokio::select! {
                _ = tokio::time::sleep(Duration::from_secs_f64(secs)) => cancel.cancel(),
                _ = cancel.cancelled() => {}
            }
        });
    }
    tokio::spawn(async move {
        tokio::select! {
            result = tokio::signal::ctrl_c() => {
                if result.is_ok() {
                    eprintln!("\ninterrupted — stopping and reporting partial results…");
                    cancel.cancel();
                }
            }
            _ = cancel.cancelled() => {}
        }
    });
}

/// Prints a one-line live progress summary to stderr until `stop` fires. Once
/// the worker `cancel` token is set (the run has ended and in-flight requests
/// are draining), the line switches to a "draining" state so the wait for
/// stragglers to finish is visible rather than looking like a hang.
fn spawn_progress(
    shared: Arc<Shared>,
    stop: CancellationToken,
    test_start: Instant,
) -> JoinHandle<()> {
    tokio::spawn(async move {
        loop {
            tokio::select! {
                _ = stop.cancelled() => break,
                _ = tokio::time::sleep(Duration::from_secs(1)) => {}
            }
            let elapsed = test_start.elapsed().as_secs_f64();
            let completed = shared.completed.load(Ordering::Relaxed);
            let inflight = shared.inflight.load(Ordering::Relaxed);
            let tokens = shared.completion_tokens.load(Ordering::Relaxed);
            let tps = if elapsed > 0.0 {
                tokens as f64 / elapsed
            } else {
                0.0
            };
            if shared.cancel.is_cancelled() {
                eprint!(
                    "\r[{elapsed:6.1}s] draining {inflight:<4} in-flight request(s)… completed={completed:<6} {tps:8.1} tok/s   "
                );
            } else {
                eprint!(
                    "\r[{elapsed:6.1}s] completed={completed:<6} in-flight={inflight:<4} {tps:8.1} tok/s   "
                );
            }
        }
        eprintln!();
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn drain_without_timeout_waits_for_completion() {
        let worker: JoinHandle<()> = tokio::spawn(async {
            tokio::time::sleep(Duration::from_millis(20)).await;
        });
        let aborted: usize = drain_workers(vec![worker], None).await;
        assert_eq!(aborted, 0);
    }

    #[tokio::test]
    async fn drain_timeout_aborts_stragglers() {
        let slow: JoinHandle<()> = tokio::spawn(async {
            tokio::time::sleep(Duration::from_secs(30)).await;
        });
        let fast: JoinHandle<()> = tokio::spawn(async {});
        let aborted: usize = drain_workers(vec![slow, fast], Some(Duration::from_millis(50))).await;
        assert_eq!(aborted, 1, "only the 30s straggler should be aborted");
    }
}
