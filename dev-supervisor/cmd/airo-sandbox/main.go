// airo-sandbox applies Landlock LSM restrictions before exec-ing a child command.
//
// It reads sandbox configuration from the AIRO_SANDBOX_CONFIG environment variable (JSON),
// removes that variable from the child environment, applies kernel-level filesystem and
// network restrictions (on Linux), and replaces itself with `sh -c <command>`.
//
// On non-Linux platforms, it logs a warning and execs the command without sandboxing.
package main

import (
	"fmt"
	"os"
	"syscall"

	"github.com/airo-ai-builder/dev-supervisor/internal/sandbox"
)

// exitCodeSandboxError is used for airo-sandbox's own failures (config parse,
// Landlock apply, exec failure). This distinguishes sandbox infrastructure errors
// from child process exit codes. Matches docker run's convention for daemon errors.
const exitCodeSandboxError = 125

// statusFd is fd 3 when dev-supervisor wires a status pipe (see internal/sandbox.StatusFd).
// On pre-exec failure, airo-sandbox writes a one-line reason here and exits 125;
// dev-supervisor reads it to report a supervisor-level error distinct from child
// command output. FD_CLOEXEC is set immediately so a successful syscall.Exec
// closes the fd before `sh -c <command>` starts — the child never inherits it.
//
// When run manually (no fd 3 wired), statusFd stays nil and fatalf falls back to stderr.
var statusFd *os.File

func initStatusFd() {
	const fd = int(sandbox.StatusFd)
	// Probe fd 3 via fstat; if not open, bail out (manual invocation).
	var st syscall.Stat_t
	if err := syscall.Fstat(fd, &st); err != nil {
		return
	}
	syscall.CloseOnExec(fd)
	statusFd = os.NewFile(uintptr(fd), "sandbox-status")
}

// fatalf reports a wrapper-level failure and exits with exitCodeSandboxError.
// Writes to the status pipe (fd 3) if connected, otherwise falls back to stderr
// with a visible marker so manual invocations still produce a readable message.
func fatalf(format string, args ...any) {
	msg := fmt.Sprintf(format, args...)
	if statusFd != nil {
		fmt.Fprintln(statusFd, msg)
		_ = statusFd.Close()
	} else {
		fmt.Fprintf(os.Stderr, "airo-sandbox: %s\n", msg)
	}
	os.Exit(exitCodeSandboxError)
}

func main() {
	initStatusFd()

	configJSON := os.Getenv("AIRO_SANDBOX_CONFIG")
	if configJSON == "" {
		fatalf("AIRO_SANDBOX_CONFIG environment variable is required")
	}

	cfg, err := ParseConfig([]byte(configJSON))
	if err != nil {
		fatalf("invalid config: %v", err)
	}

	// Build child environment without AIRO_SANDBOX_CONFIG
	env := sandbox.FilterEnv(os.Environ(), "AIRO_SANDBOX_CONFIG")

	// Apply sandbox and exec (platform-specific)
	// On success, syscall.Exec replaces this process — we never return.
	// If we get here, exec failed (binary not found, Landlock error, etc.)
	if err := applySandboxAndExec(cfg, env); err != nil {
		fatalf("%v", err)
	}
	// Defensive: applySandboxAndExec either exec-replaces this process or
	// returns a non-nil error. A nil return would indicate a refactoring
	// regression that accidentally introduced an early-return path.
	fatalf("internal error: applySandboxAndExec returned without replacing process")
}

// findBinary locates a binary by checking common paths.
func findBinary(name string) (string, error) {
	paths := []string{
		"/bin/" + name,
		"/usr/bin/" + name,
	}
	for _, p := range paths {
		if _, err := os.Stat(p); err == nil {
			return p, nil
		}
	}
	return "", fmt.Errorf("binary %q not found in /bin or /usr/bin", name)
}
