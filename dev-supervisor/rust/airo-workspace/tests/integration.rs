//! Integration tests for airo-workspace.
//! These tests spawn the binary as a subprocess and verify behavior.
//! Only run on Linux — the binary is designed for Linux PID1 and uses
//! POSIX signal semantics that macOS doesn't fully support.
#![cfg(target_os = "linux")]

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use nix::sys::signal::{self, Signal};
use nix::unistd::Pid;

fn build_binary() -> String {
    let output = Command::new("cargo")
        .args(["build", "--bin", "airo-workspace"])
        .output()
        .expect("failed to build");
    assert!(
        output.status.success(),
        "build failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );

    let meta = Command::new("cargo")
        .args(["metadata", "--format-version=1", "--no-deps"])
        .output()
        .expect("failed to get metadata");
    let meta: serde_json::Value =
        serde_json::from_slice(&meta.stdout).expect("invalid metadata json");
    let target_dir = meta["target_directory"].as_str().unwrap();
    format!("{target_dir}/debug/airo-workspace")
}

#[test]
fn child_exit_code_propagated() {
    let bin = build_binary();
    let status = Command::new(&bin)
        .args(["sh", "-c", "exit 42"])
        .status()
        .expect("failed to run");
    assert_eq!(status.code(), Some(42));
}

#[test]
fn child_zero_exit() {
    let bin = build_binary();
    let status = Command::new(&bin)
        .args(["true"])
        .status()
        .expect("failed to run");
    assert!(status.success());
}

#[test]
fn missing_command_fails() {
    let bin = build_binary();
    let status = Command::new(&bin)
        .args(["/nonexistent/binary"])
        .status()
        .expect("failed to run");
    assert!(!status.success());
}

#[test]
fn no_args_prints_usage() {
    let bin = build_binary();
    let output = Command::new(&bin).output().expect("failed to run");
    assert_eq!(output.status.code(), Some(1));
    assert!(String::from_utf8_lossy(&output.stderr).contains("usage:"));
}

#[test]
fn signal_forwarding() {
    let bin = build_binary();
    let ready_file = ready_path("signal_forwarding");
    let _ = std::fs::remove_file(&ready_file);

    let script = format!(
        "trap 'echo got_signal; exit 0' USR1; touch {}; sleep 60",
        ready_file.display()
    );
    let child = Command::new(&bin)
        .args(["sh", "-c", &script])
        .stdout(Stdio::piped())
        .spawn()
        .expect("failed to spawn");

    wait_for_file(&ready_file);
    let _ = signal::kill(Pid::from_raw(child.id() as i32), Signal::SIGUSR1);

    let output = child.wait_with_output().expect("failed to wait");
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(
        stdout.contains("got_signal"),
        "child didn't receive forwarded signal, stdout: {stdout}"
    );
    let _ = std::fs::remove_file(&ready_file);
}

#[test]
fn sigterm_causes_shutdown() {
    let bin = build_binary();
    let ready_file = ready_path("sigterm_shutdown");
    let _ = std::fs::remove_file(&ready_file);

    let script = format!("touch {}; sleep 60", ready_file.display());
    let mut child = Command::new(&bin)
        .args(["sh", "-c", &script])
        .spawn()
        .expect("failed to spawn");

    wait_for_file(&ready_file);
    let _ = signal::kill(Pid::from_raw(child.id() as i32), Signal::SIGTERM);

    let start = Instant::now();
    loop {
        match child.try_wait().expect("try_wait failed") {
            Some(_status) => break,
            None if start.elapsed() < Duration::from_secs(10) => {
                thread::sleep(Duration::from_millis(100));
            }
            None => panic!("process didn't exit within 10s of SIGTERM"),
        }
    }
    let _ = std::fs::remove_file(&ready_file);
}

fn ready_path(test_name: &str) -> PathBuf {
    PathBuf::from(format!("/tmp/airo-workspace-test-{}", test_name))
}

fn wait_for_file(path: &Path) {
    let start = Instant::now();
    while start.elapsed() < Duration::from_secs(10) {
        if path.exists() {
            return;
        }
        thread::sleep(Duration::from_millis(50));
    }
    panic!("timed out waiting for ready file: {}", path.display());
}
