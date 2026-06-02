//! HTTP/1.1 reverse proxy from a public Unix socket to the Go dev-supervisor's
//! internal Unix socket.
//!
//! Strangler-fig contract: when enabled (`AIRO_WORKSPACE_PROXY=1`,
//! opt-in for now — see `main.rs`), airo-workspace owns the public socket
//! (`/tmp/supervisor/dev-supervisor.sock` by default) and the Go binary
//! binds a private socket (`/tmp/supervisor/internal.sock` by convention)
//! injected into its environment. Customer-facing traffic enters Rust,
//! then hops to Go transparently. As we migrate handlers Rust-side, this
//! proxy is what we progressively short-circuit; the Go binary never moves.
//!
//! Body forwarding streams via `hyper::body::Incoming` end-to-end (no
//! buffering). Scope: request/response HTTP/1.1 only. The dev-supervisor UDS
//! API has no Upgrade or SSE endpoints today (handleLogsStream returns 501;
//! WebSocket / Hijacker support lives only on the customer-app HTTPS reverse
//! proxy, which is a separate TCP listener that this proxy does not see).
//! If a future endpoint needs Upgrade, swap `serve_connection` for
//! `serve_connection_with_upgrades` and dispatch with
//! `hyper::upgrade::on(&mut req)` — see git history pre-removal for the
//! capture-order pattern.
//!
//! Hop-by-hop headers (RFC 7230 §6.1: Connection, Keep-Alive, TE, Trailer,
//! Transfer-Encoding, Proxy-Authenticate, Proxy-Authorization, Upgrade) are
//! NOT scrubbed — the public socket is single-hop UDS to the Go child in the
//! same container, never an internet-facing intermediary. If we ever proxy
//! across hosts, scrubbing must be added.
//!
//! Logging convention: `eprintln!` only for events the operator should see in
//! production (startup banner, accept errors, 502s). Normal-flow chatter
//! (per-connection close, debug failures) goes through the
//! `supervisor::debug!` macro and is gated by `AIRO_WORKSPACE_VERBOSE=1`.

use std::convert::Infallible;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};

use bytes::Bytes;
use http_body_util::{BodyExt, Full, combinators::BoxBody};
use hyper::body::Incoming;
use hyper::client::conn::http1 as client_http1;
use hyper::server::conn::http1 as server_http1;
use hyper::service::service_fn;
use hyper::{Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use tokio::net::{UnixListener, UnixStream};

use crate::supervisor;

type BoxError = Box<dyn std::error::Error + Send + Sync + 'static>;
type ProxyBody = BoxBody<Bytes, BoxError>;

const INTERNAL_READY_TIMEOUT: Duration = Duration::from_secs(15);
const INTERNAL_POLL_INTERVAL: Duration = Duration::from_millis(50);

/// Spawn the proxy on a dedicated OS thread that owns its own tokio runtime.
///
/// Kept off the main thread so the existing PID1 signal loop (signalfd +
/// blocking poll) stays exactly as it was. Uses a current-thread runtime —
/// the proxy moves UDS bytes between two file descriptors per request,
/// scheduler overhead from worker threads buys nothing here.
pub fn run_in_background(public_socket: PathBuf, internal_socket: PathBuf) {
    std::thread::Builder::new()
        .name("airo-proxy".into())
        .spawn(move || {
            let rt = tokio::runtime::Builder::new_current_thread()
                .enable_io()
                .enable_time()
                .build()
                .unwrap_or_else(|e| {
                    eprintln!("airo-workspace: proxy runtime build failed: {e}");
                    std::process::exit(1);
                });
            rt.block_on(async move {
                if let Err(e) = run(public_socket, Arc::from(internal_socket)).await {
                    eprintln!("airo-workspace: proxy exited: {e}");
                    std::process::exit(1);
                }
            });
        })
        .expect("spawn airo-proxy thread");
}

async fn run(public_socket: PathBuf, internal_socket: Arc<Path>) -> Result<(), BoxError> {
    wait_for_internal(&internal_socket).await?;

    // Stale public socket from a prior crash would block bind(); replace it.
    // Ignore NotFound (the normal case); surface anything else so a path
    // owned by something else gives a clear error instead of an opaque bind
    // failure two lines down.
    if let Err(e) = std::fs::remove_file(&public_socket)
        && e.kind() != std::io::ErrorKind::NotFound
    {
        return Err(format!(
            "remove stale public socket {}: {e}",
            public_socket.display()
        )
        .into());
    }
    let listener = UnixListener::bind(&public_socket)
        .map_err(|e| format!("bind public socket {}: {e}", public_socket.display()))?;
    set_socket_perms(&public_socket)?;

    eprintln!(
        "airo-workspace: proxy listening on {} -> {}",
        public_socket.display(),
        internal_socket.display(),
    );

    loop {
        let (stream, _addr) = match listener.accept().await {
            Ok(p) => p,
            Err(e) => {
                eprintln!("airo-workspace: proxy accept error: {e}");
                continue;
            }
        };
        let upstream = Arc::clone(&internal_socket);
        tokio::spawn(async move {
            let io = TokioIo::new(stream);
            let svc = service_fn(move |req: Request<Incoming>| {
                let upstream = Arc::clone(&upstream);
                async move {
                    Ok::<_, Infallible>(match handle(req, &upstream).await {
                        Ok(resp) => resp,
                        Err(e) => bad_gateway(e.to_string()),
                    })
                }
            });
            if let Err(e) = server_http1::Builder::new().serve_connection(io, svc).await {
                // Connection-level errors (early hangup, malformed request,
                // mid-stream close) are normal in production traffic; gate on
                // AIRO_WORKSPACE_VERBOSE so a real protocol violation or
                // panic loop is still observable when needed.
                supervisor::debug!("proxy serve_connection: {e}");
            }
        });
    }
}

async fn handle(req: Request<Incoming>, upstream: &Path) -> Result<Response<ProxyBody>, BoxError> {
    let stream = match UnixStream::connect(upstream).await {
        Ok(s) => s,
        Err(e) => return Ok(bad_gateway(format!("upstream connect: {e}"))),
    };
    let io = TokioIo::new(stream);
    let (mut sender, conn) = client_http1::handshake(io).await?;
    tokio::spawn(async move {
        if let Err(e) = conn.await {
            supervisor::debug!("upstream conn driver: {e}");
        }
    });
    // Stream body through; hyper handles chunked encoding, content-length,
    // and trailers transparently.
    let resp = sender.send_request(req).await?;
    Ok(resp.map(|b| b.map_err(Into::into).boxed()))
}

fn bad_gateway(msg: String) -> Response<ProxyBody> {
    eprintln!("airo-workspace: 502 {msg}");
    let body = Full::new(Bytes::from(format!("airo-workspace: {msg}\n")))
        .map_err(|never| match never {})
        .boxed();
    Response::builder()
        .status(StatusCode::BAD_GATEWAY)
        .header("content-type", "text/plain; charset=utf-8")
        .body(body)
        .expect("build 502 response")
}

async fn wait_for_internal(path: &std::path::Path) -> Result<(), BoxError> {
    let deadline = Instant::now() + INTERNAL_READY_TIMEOUT;
    let mut last_err = None;
    while Instant::now() < deadline {
        match UnixStream::connect(path).await {
            Ok(_) => return Ok(()),
            Err(e) => last_err = Some(e),
        }
        tokio::time::sleep(INTERNAL_POLL_INTERVAL).await;
    }
    Err(format!(
        "internal socket {} not ready within {:?}: {}",
        path.display(),
        INTERNAL_READY_TIMEOUT,
        last_err
            .map(|e| e.to_string())
            .unwrap_or_else(|| "no error".into()),
    )
    .into())
}

fn set_socket_perms(path: &std::path::Path) -> Result<(), BoxError> {
    use std::os::unix::fs::PermissionsExt;
    // 0666 matches the existing Go behavior so callers (mounted clients,
    // healthcheck) keep working with the same expectations.
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o666))
        .map_err(|e| format!("chmod public socket: {e}").into())
}
