use std::env;
use std::os::unix::process::CommandExt;
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

fn verbose() -> bool {
    *VERBOSE.get_or_init(|| env::var("AIRO_WORKSPACE_VERBOSE").is_ok())
}

macro_rules! debug {
    ($($arg:tt)*) => {
        if verbose() {
            eprintln!("[airo-workspace] {}", format!($($arg)*));
        }
    };
}

fn main() {
    let args: Vec<String> = env::args().collect();
    if args.len() < 2 {
        eprintln!("usage: airo-workspace <command> [args...]");
        exit(1);
    }

    let all_signals = SigSet::all();
    if let Err(e) =
        signal::pthread_sigmask(signal::SigmaskHow::SIG_SETMASK, Some(&all_signals), None)
    {
        eprintln!("airo-workspace: failed to block signals: {e}");
        exit(1);
    }

    let child_pid = spawn_child(&args[1..]);
    debug!("spawned child pid={child_pid}");

    run_supervisor(child_pid);
}

fn spawn_child(args: &[String]) -> Pid {
    let mut cmd = Command::new(&args[0]);
    cmd.args(&args[1..]);

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

#[cfg(not(target_os = "linux"))]
fn wait_for_signal(_timeout: Option<Duration>) -> Option<Signal> {
    let all = SigSet::all();
    all.wait().ok()
}

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

fn run_supervisor(child_pid: Pid) -> ! {
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
