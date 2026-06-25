//! Live replay: HTTP client construction, per-request execution, and the
//! concurrency scheduler.

pub mod scheduler;
pub mod worker;

use std::time::Duration;

/// Builds the shared `reqwest::Client` used by every worker.
///
/// The pool is sized above the peak concurrency so high-concurrency steps do
/// not silently serialize behind the default 10-idle-connection cap. No
/// whole-response timeout is set (it would abort long streams); callers apply a
/// per-stream timeout instead.
pub fn build_client(max_concurrency: usize) -> reqwest::Result<reqwest::Client> {
    reqwest::Client::builder()
        .pool_max_idle_per_host(max_concurrency + 16)
        .tcp_keepalive(Duration::from_secs(60))
        .connect_timeout(Duration::from_secs(10))
        .build()
}
