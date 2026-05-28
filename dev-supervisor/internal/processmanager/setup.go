package processmanager

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/exec"
	"os/signal"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/airo-ai-builder/dev-supervisor/internal/process"
)

// stderrTailLines is the number of stderr lines retained for error reporting.
const stderrTailLines = 20

// RunSetupScriptInternal executes a setup script with structured logging, timeout, and signal cancellation.
// This is called by main.go for immediate setup and by ProcessManager.ExecuteDeferredSetup for deferred setup.
// When pid1Mgr is non-nil, the child process is registered with the PID1 manager so the orphan reaper
// skips it — preventing "waitid: no child processes" errors when running as PID 1.
func RunSetupScriptInternal(scriptPath string, timeout time.Duration, pid1Mgr *process.PID1Manager) error {
	if scriptPath == "" {
		slog.Info("startup.setup.not_configured", "behavior", "skip_setup")
		return nil
	}

	// Validate script path exists and is executable (defense in depth)
	// scriptPath comes from deployment-controlled environment variables (DEV_SUPERVISOR_*_SETUP_SCRIPT),
	// which are set by our deployment system (Nomad/Docker). This validation ensures misconfigurations
	// are caught early with clear error messages rather than cryptic exec failures.
	//
	// Note: We do NOT validate the path prefix (e.g., /app/scripts/) because:
	// - scriptPath is set by deployment config we control, not user input
	// - If an attacker could modify deployment config, they already have full control
	// - Path whitelisting adds complexity without meaningful security benefit
	fileInfo, err := os.Stat(scriptPath)
	if err != nil {
		if os.IsNotExist(err) {
			slog.Error("startup.setup.script_not_found", "script", scriptPath)
			return fmt.Errorf("setup script not found: %s", scriptPath)
		}
		return fmt.Errorf("failed to stat setup script: %w", err)
	}

	// Check if file is executable (Unix permission bit)
	if fileInfo.Mode()&0111 == 0 {
		slog.Error("startup.setup.script_not_executable", "script", scriptPath, "mode", fileInfo.Mode())
		return fmt.Errorf("setup script is not executable: %s (mode: %s)", scriptPath, fileInfo.Mode())
	}

	slog.Info("startup.setup.start", "script", scriptPath, "timeout", timeout)

	// Create context with timeout and signal cancellation
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	// Also cancel on SIGTERM/SIGINT
	ctx, stop := signal.NotifyContext(ctx, syscall.SIGTERM, syscall.SIGINT)
	defer stop()

	// Security note: scriptPath comes from deployment-controlled environment variable
	// (DEV_SUPERVISOR_*_SETUP_SCRIPT), not user input. This is set by the deployment
	// system (Nomad/Docker), making command injection impossible. Semgrep finding is
	// a false positive.
	// nosemgrep: go.lang.security.audit.dangerous-exec-command.dangerous-exec-command
	cmd := exec.CommandContext(ctx, scriptPath)
	cmd.Env = os.Environ()
	// Run from root directory - setup scripts use CUSTOMER_APP_DIR environment variable
	// to find the app directory, not the current working directory. This ensures
	// scripts work consistently regardless of where dev-supervisor was invoked from.
	cmd.Dir = "/"

	// Stream stdout and stderr to structured logs
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return fmt.Errorf("failed to create stdout pipe: %w", err)
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return fmt.Errorf("failed to create stderr pipe: %w", err)
	}

	// Start the command first, then start streaming goroutines
	// This prevents goroutine leaks if cmd.Start() fails
	if pid1Mgr != nil {
		// Register with PID1 manager so the orphan reaper skips this process.
		// nil managedProcess = tracked in map (reaper skips it) but no lifecycle watcher.

		// Defer starting to pid manager so any race conditions between start and register are prevented via mutex.
		err = pid1Mgr.StartAndRegister(cmd, nil)
	} else {
		err = cmd.Start()
	}
	if err != nil {
		return fmt.Errorf("failed to start setup script: %w", err)
	}

	// The process is already registered with the PID1 manager so the orphan reaper skips this process.
	// Now that it is registered, we need to ensure it is unregistered once we are done performing our operations.
	// We run the defer statement here because the process Pid should be known at this stage.
	// If we were to perform this afterthefact then the pid could be unknown due to the kernal cleaning it.
	// Go evaluates the arguments to a deferred call at the moment the defer statement runs, not when the
	// deferred call actually fires. So cmd.Process.Pid is read immediately after cmd.Start succeeded, the integer
	// value is captured, and that captured int is what gets passed to unregisterCommand later when the surrounding
	// function returns (after cmd.Wait() finishes).
	if pid1Mgr != nil {
		defer pid1Mgr.UnregisterChildProcess(cmd.Process.Pid)
	}

	var wg sync.WaitGroup
	wg.Add(2)

	stderrTail := newTailBuffer(stderrTailLines)

	go func() {
		defer wg.Done()
		streamScriptOutput(stdout, "setup", nil)
	}()

	go func() {
		defer wg.Done()
		streamScriptOutput(stderr, "setup", stderrTail)
	}()

	wg.Wait()

	err = cmd.Wait()

	if err == nil {
		slog.Info("startup.setup.complete", "script", scriptPath)
		return nil
	}

	tail := stderrTail.String()

	// Check if it was canceled due to timeout or signal
	if errors.Is(ctx.Err(), context.DeadlineExceeded) {
		slog.Error("startup.setup.timeout", "script", scriptPath, "timeout", timeout, "stderr_tail", tail)
		return appendStderr(fmt.Errorf("setup script timed out after %v: %s", timeout, scriptPath), tail)
	}
	if errors.Is(ctx.Err(), context.Canceled) {
		slog.Error("startup.setup.canceled", "script", scriptPath, "reason", "signal received", "stderr_tail", tail)
		return appendStderr(fmt.Errorf("setup script canceled due to signal: %s", scriptPath), tail)
	}

	slog.Error("startup.setup.failed", "script", scriptPath, "error", err, "stderr_tail", tail)
	return appendStderr(fmt.Errorf("setup script failed: %w", err), tail)
}

// appendStderr appends the stderr tail to an error message when non-empty.
func appendStderr(err error, tail string) error {
	if tail == "" {
		return err
	}
	return fmt.Errorf("%w\nstderr:\n%s", err, tail)
}

// tailBuffer is a fixed-size ring buffer that retains the last N lines written to it.
type tailBuffer struct {
	lines []string
	max   int
	mu    sync.Mutex
}

func newTailBuffer(n int) *tailBuffer {
	return &tailBuffer{max: n}
}

func (tb *tailBuffer) Add(line string) {
	tb.mu.Lock()
	defer tb.mu.Unlock()
	if len(tb.lines) >= tb.max {
		tb.lines = tb.lines[1:]
	}
	tb.lines = append(tb.lines, line)
}

func (tb *tailBuffer) String() string {
	tb.mu.Lock()
	defer tb.mu.Unlock()
	return strings.Join(tb.lines, "\n")
}

// streamScriptOutput reads lines from a reader and logs them with structured logging.
// If tail is non-nil, each line is also appended to the tail buffer for error reporting.
func streamScriptOutput(r io.Reader, source string, tail *tailBuffer) {
	scanner := bufio.NewScanner(r)
	for scanner.Scan() {
		line := scanner.Text()
		slog.Info(source, "message", line)
		if tail != nil {
			tail.Add(line)
		}
	}
	if err := scanner.Err(); err != nil {
		slog.Error("script.stream.error", "source", source, "error", err)
	}
}
