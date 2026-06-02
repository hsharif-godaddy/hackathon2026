//! airo-workspace: PID1 + reverse proxy for the dev-supervisor container.
//!
//! Runs as PID 1, exec's the Go dev-supervisor as a child, forwards signals,
//! and reaps zombies. Optionally also owns the public Unix socket and proxies
//! to the Go binary on a private internal socket — the strangler-fig
//! topology that future PRs will progressively migrate handlers into.
//!
//! Proxy is **off by default**. When enabled, dev-supervisor sees the
//! proxy's SELinux context (`airo_app_container.process`) on accepted
//! connections instead of the actual caller's, which would break Go's
//! `PeerSec` auth in production. The fix lives in PR #4 (peer-sec moves
//! into Rust at the listener); until then production stays on the
//! exec-only path and only test/staging environments opt in.
//!
//! Configuration (env):
//!   AIRO_WORKSPACE_PROXY        Set to enable the proxy. Default: off
//!                               (Go binds the public socket directly,
//!                               pre-strangler behavior — required for
//!                               production until PR #4 lands).
//!   AIRO_PUBLIC_SOCKET_PATH     Public socket Rust binds when the proxy
//!                               is enabled. Falls back to
//!                               DEV_SUPERVISOR_SOCKET_PATH then the default.
//!   AIRO_INTERNAL_SOCKET_PATH   Private socket Go binds via injected env
//!                               when the proxy is enabled.
//!                               Default: /tmp/supervisor/internal.sock.
//!   AIRO_WORKSPACE_VERBOSE      Stderr debug logging.

mod proxy;
mod supervisor;

use std::env;
use std::path::{Path, PathBuf};
use std::process::exit;

const DEFAULT_PUBLIC_SOCKET: &str = "/tmp/supervisor/dev-supervisor.sock";
const DEFAULT_INTERNAL_SOCKET: &str = "/tmp/supervisor/internal.sock";

fn main() {
    let args: Vec<String> = env::args().collect();
    if args.len() < 2 {
        eprintln!("usage: airo-workspace <command> [args...]");
        exit(1);
    }

    // Mask signals BEFORE spawning anything; tokio worker threads spawned by
    // the proxy inherit the mask, which is exactly what we want — only the
    // main thread's signalfd loop sees signals.
    supervisor::block_all_signals();

    let proxy_enabled = env::var("AIRO_WORKSPACE_PROXY").is_ok();
    let internal_socket = resolve_internal_socket();
    let public_socket = resolve_public_socket();

    if proxy_enabled {
        // Production Dockerfiles mkdir /tmp/supervisor at image-build time,
        // but bind-mounted /tmp (e.g. test/Dockerfile.integration via -v)
        // hides that. Doing it here once at startup makes the binary safe
        // to drop into any /tmp layout — both our bind() and the child's
        // bind() need this dir.
        ensure_parent_dir(&public_socket);
        ensure_parent_dir(&internal_socket);
    }

    let child_internal_path = if proxy_enabled {
        Some(internal_socket.as_path())
    } else {
        None
    };
    let child_pid = supervisor::spawn_child(&args[1..], child_internal_path);
    supervisor::debug!("spawned child pid={child_pid}");

    if proxy_enabled {
        proxy::run_in_background(public_socket, internal_socket);
    }

    supervisor::run(child_pid);
}

fn ensure_parent_dir(path: &Path) {
    let Some(parent) = path.parent() else {
        return;
    };
    if parent.as_os_str().is_empty() {
        return;
    }
    if let Err(e) = std::fs::create_dir_all(parent) {
        eprintln!(
            "airo-workspace: create parent dir {} for socket {}: {e}",
            parent.display(),
            path.display(),
        );
        exit(1);
    }
}

fn resolve_public_socket() -> PathBuf {
    env::var_os("AIRO_PUBLIC_SOCKET_PATH")
        .or_else(|| env::var_os("DEV_SUPERVISOR_SOCKET_PATH"))
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(DEFAULT_PUBLIC_SOCKET))
}

fn resolve_internal_socket() -> PathBuf {
    env::var_os("AIRO_INTERNAL_SOCKET_PATH")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(DEFAULT_INTERNAL_SOCKET))
}
