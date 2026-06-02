//! PID1 supervisor logic: spawn the Go dev-supervisor child, mask signals on
//! the main thread, and forward / reap via signalfd. Untouched by the
//! strangler-fig migration except for one change: when the proxy is enabled
//! we override the child's socket-path env so Go binds the internal socket
//! instead of the public one (which the proxy in `proxy.rs` now owns).

use std::env;
use std::os::unix::process::CommandExt;
use std::path::Path;
use std::process::{Command, exit};
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use nix::sys::signal::{self, SigSet, Signal};
use nix::sys::wait::{self, WaitPidFlag, WaitStatus};
use nix::unistd::Pid;

#[cfg(target_os = "linux")]
use nix::poll::{PollFd, PollFlags, PollTimeout, poll};
#[cfg(target_os = "linux")]
use nix::sys::signalfd::SignalFd;
#[cfg(target_os = "linux")]
use std::os::fd::AsFd;

const SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(30);

static VERBOSE: OnceLock<bool> = OnceLock::new();

pub fn verbose() -> bool {
    *VERBOSE.get_or_init(|| env::var("AIRO_WORKSPACE_VERBOSE").is_ok())
}

macro_rules! debug {
    ($($arg:tt)*) => {
        if $crate::supervisor::verbose() {
            eprintln!("[airo-workspace] {}", format!($($arg)*));
        }
    };
}
pub(crate) use debug;

pub fn block_all_signals() {
    let all = SigSet::all();
    if let Err(e) = signal::pthread_sigmask(signal::SigmaskHow::SIG_SETMASK, Some(&all), None) {
        eprintln!("airo-workspace: failed to block signals: {e}");
        exit(1);
    }
}

/// Spawn the Go child. When `internal_socket_path` is `Some`, override the
/// child's socket env so Go binds the internal socket; the proxy will then own
/// the public path. When `None`, behave like the pre-strangler binary.
pub fn spawn_child(args: &[String], internal_socket_path: Option<&Path>) -> Pid {
    let mut cmd = Command::new(&args[0]);
    cmd.args(&args[1..]);

    if let Some(internal) = internal_socket_path {
        let s = internal.to_string_lossy().into_owned();
        // Override BOTH names: the Go binary prefers AIRO_SUPERVISOR_SOCKET_PATH
        // (v4) and falls back to DEV_SUPERVISOR_SOCKET_PATH (v3 compat). If
        // either is set in the parent env it wins over our intent unless we
        // also override it here.
        cmd.env("AIRO_SUPERVISOR_SOCKET_PATH", &s);
        cmd.env("DEV_SUPERVISOR_SOCKET_PATH", &s);
    }

    // SAFETY: runs post-fork, only calls async-signal-safe sigprocmask.
    #[allow(unsafe_code)]
    unsafe {
        cmd.pre_exec(|| {
            let empty = SigSet::empty();
            signal::pthread_sigmask(signal::SigmaskHow::SIG_SETMASK, Some(&empty), None)
                .map_err(|e| std::io::Error::from_raw_os_error(e as i32))?;
            Ok(())
        });
    }

    match cmd.spawn() {
        Ok(child) => Pid::from_raw(child.id() as i32),
        Err(e) => {
            eprintln!("airo-workspace: failed to spawn child: {e}");
            exit(1);
        }
    }
}

#[cfg(target_os = "linux")]
fn wait_for_signal(sfd: &SignalFd, timeout: Option<Duration>) -> Option<Signal> {
    let poll_timeout = match timeout {
        Some(d) => {
            let millis: u16 = d.as_millis().try_into().unwrap_or(u16::MAX);
            PollTimeout::from(millis.max(100))
        }
        None => PollTimeout::NONE,
    };

    let poll_fd = PollFd::new(sfd.as_fd(), PollFlags::POLLIN);
    match poll(&mut [poll_fd], poll_timeout) {
        Ok(0) => return None,
        Ok(_) => {}
        Err(nix::errno::Errno::EINTR) => return None,
        Err(e) => {
            eprintln!("airo-workspace: poll failed: {e}");
            exit(1);
        }
    }

    match sfd.read_signal() {
        Ok(Some(info)) => Signal::try_from(info.ssi_signo as i32).ok(),
        Ok(None) => None,
        Err(e) => {
            eprintln!("airo-workspace: read_signal failed: {e}");
            exit(1);
        }
    }
}

// macOS doesn't have signalfd, so we can't share the Linux path. POSIX
// sigwait has been observed not to return on subsequent signals after the
// first one is consumed (e.g. SIGTERM picked up, but a later SIGCHLD never
// wakes the next sigwait), even when both are blocked-and-pending. The
// reliable approach on Darwin is to install real signal handlers and use
// sigsuspend to atomically unmask + wait — the kernel runs the handler, the
// handler stamps a bit, sigsuspend returns EINTR.
#[cfg(not(target_os = "linux"))]
mod posix_signal_wait {
    use super::Signal;
    use nix::sys::signal::{SaFlags, SigAction, SigHandler, SigSet, sigaction};
    use std::sync::Once;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::Duration;

    // Bit `signo` is set when signal `signo` is pending. POSIX signal numbers
    // are 1..31 on macOS, comfortably under 64 — one signal per bit means
    // SIGTERM and SIGCHLD landing in the same syscall window both stick
    // around for separate wait_for_signal calls instead of clobbering.
    static PENDING: AtomicU64 = AtomicU64::new(0);
    static INSTALL: Once = Once::new();

    extern "C" fn handler(signo: i32) {
        if signo > 0 && signo < 64 {
            PENDING.fetch_or(1u64 << signo, Ordering::SeqCst);
        }
    }

    fn install() {
        INSTALL.call_once(|| {
            let action = SigAction::new(
                SigHandler::Handler(handler),
                SaFlags::empty(),
                SigSet::empty(),
            );
            for sig in [
                Signal::SIGTERM,
                Signal::SIGINT,
                Signal::SIGCHLD,
                Signal::SIGHUP,
                Signal::SIGUSR1,
                Signal::SIGUSR2,
                Signal::SIGWINCH,
                Signal::SIGCONT,
                Signal::SIGALRM,
            ] {
                // SAFETY: handler is async-signal-safe (single atomic
                // fetch_or) and is registered at startup before any signals
                // are expected to arrive.
                #[allow(unsafe_code)]
                unsafe {
                    let _ = sigaction(sig, &action);
                }
            }
        });
    }

    pub fn wait_for_signal(_timeout: Option<Duration>) -> Option<Signal> {
        install();
        loop {
            // Drain one pending signal per call — Lowest-numbered first so
            // ordering across calls is deterministic.
            let bits = PENDING.load(Ordering::SeqCst);
            if bits != 0 {
                let signo = bits.trailing_zeros() as i32;
                PENDING.fetch_and(!(1u64 << signo), Ordering::SeqCst);
                return Signal::try_from(signo).ok();
            }
            // No signal pending: atomically unmask and wait. If a signal
            // arrived between the load above and here it stays pending in
            // the process mask; sigsuspend with empty mask delivers it
            // immediately. Returns EINTR after the handler runs.
            let _ = SigSet::empty().suspend();
        }
    }
}

#[cfg(not(target_os = "linux"))]
use posix_signal_wait::wait_for_signal;

/// Signals to forward to the child — matches the Go setupSignalForwarding allowlist.
fn should_forward(sig: Signal) -> bool {
    matches!(
        sig,
        Signal::SIGHUP
            | Signal::SIGUSR1
            | Signal::SIGUSR2
            | Signal::SIGWINCH
            | Signal::SIGCONT
            | Signal::SIGALRM
    )
}

pub fn run(child_pid: Pid) -> ! {
    #[cfg(target_os = "linux")]
    let sfd = SignalFd::new(&SigSet::all()).unwrap_or_else(|e| {
        eprintln!("airo-workspace: failed to create signalfd: {e}");
        exit(1);
    });

    let mut shutdown_deadline: Option<Instant> = None;
    let mut child_exit_status: Option<i32> = None;
    let mut kill_sent: bool = false;

    loop {
        if !kill_sent
            && let Some(deadline) = shutdown_deadline
            && deadline.elapsed() >= SHUTDOWN_TIMEOUT
        {
            debug!("shutdown timeout, sending SIGKILL to child");
            let _ = signal::kill(child_pid, Signal::SIGKILL);
            kill_sent = true;
        }

        if let Some(code) = child_exit_status {
            reap_zombies(child_pid, &mut child_exit_status);
            debug!("exiting with code={code}");
            exit(code);
        }

        let timeout = shutdown_deadline.map(|d| SHUTDOWN_TIMEOUT.saturating_sub(d.elapsed()));

        #[cfg(target_os = "linux")]
        let sig = wait_for_signal(&sfd, timeout);
        #[cfg(not(target_os = "linux"))]
        let sig = wait_for_signal(timeout);

        let sig = match sig {
            Some(s) => s,
            None => continue,
        };

        debug!("received signal {sig}");

        match sig {
            Signal::SIGCHLD => {
                reap_zombies(child_pid, &mut child_exit_status);
            }
            Signal::SIGTERM | Signal::SIGINT if shutdown_deadline.is_none() => {
                debug!("initiating shutdown, forwarding {sig} to child");
                let _ = signal::kill(child_pid, sig);
                shutdown_deadline = Some(Instant::now());
            }
            _ if should_forward(sig) => {
                debug!("forwarding {sig} to child");
                let _ = signal::kill(child_pid, sig);
            }
            _ => {}
        }
    }
}

fn reap_zombies(child_pid: Pid, child_exit_status: &mut Option<i32>) {
    loop {
        match wait::waitpid(Pid::from_raw(-1), Some(WaitPidFlag::WNOHANG)) {
            Ok(WaitStatus::Exited(pid, code)) => {
                if pid == child_pid {
                    debug!("child exited with code={code}");
                    *child_exit_status = Some(code);
                } else {
                    debug!("reaped orphan pid={pid} code={code}");
                }
            }
            Ok(WaitStatus::Signaled(pid, sig, _)) => {
                let code = 128 + sig as i32;
                if pid == child_pid {
                    debug!("child killed by signal {sig}");
                    *child_exit_status = Some(code);
                } else {
                    debug!("reaped orphan pid={pid} signal={sig}");
                }
            }
            Ok(WaitStatus::StillAlive) => break,
            Ok(_) => continue,
            Err(nix::errno::Errno::ECHILD) => break,
            Err(_) => break,
        }
    }
}
