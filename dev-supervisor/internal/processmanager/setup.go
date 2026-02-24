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
	"sync"
	"syscall"
	"time"
)

// RunSetupScriptInternal executes a setup script with structured logging, timeout, and signal cancellation.
// This is called by main.go for immediate setup and by ProcessManager.ExecuteDeferredSetup for deferred setup.
func RunSetupScriptInternal(scriptPath string, timeout time.Duration) error {
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
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("failed to start setup script: %w", err)
	}

	var wg sync.WaitGroup
	wg.Add(2)

	go func() {
		defer wg.Done()
		streamScriptOutput(stdout, "setup")
	}()

	go func() {
		defer wg.Done()
		streamScriptOutput(stderr, "setup")
	}()

	wg.Wait()

	if err := cmd.Wait(); err != nil {
		// Check if it was canceled due to timeout or signal
		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			slog.Error("startup.setup.timeout", "script", scriptPath, "timeout", timeout)
			return fmt.Errorf("setup script timed out after %v: %s", timeout, scriptPath)
		}
		if errors.Is(ctx.Err(), context.Canceled) {
			slog.Error("startup.setup.canceled", "script", scriptPath, "reason", "signal received")
			return fmt.Errorf("setup script canceled due to signal: %s", scriptPath)
		}

		slog.Error("startup.setup.failed", "script", scriptPath, "error", err)
		return fmt.Errorf("setup script failed: %w", err)
	}

	slog.Info("startup.setup.complete", "script", scriptPath)
	return nil
}

// streamScriptOutput reads lines from a reader and logs them with structured logging
func streamScriptOutput(r io.Reader, source string) {
	scanner := bufio.NewScanner(r)
	for scanner.Scan() {
		line := scanner.Text()
		slog.Info(source, "message", line)
	}
	if err := scanner.Err(); err != nil {
		slog.Error("script.stream.error", "source", source, "error", err)
	}
}
