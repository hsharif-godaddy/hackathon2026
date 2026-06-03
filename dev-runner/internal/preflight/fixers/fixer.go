package fixers

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"
)

// EnsurePnpmInstall runs `pnpm install` when node_modules is absent. Preflight
// fixers run before the preStart `pnpm install` hook, so on a fresh clone the
// store (and workspace-local binaries like turbo or playwright) won't exist
// yet; fixers that shell out to those binaries call this first. A later
// redundant install by the preStart hook is cheap (pnpm no-ops when the store
// is current).
//
// Stat errors other than NotExist (permission denied, transient filesystem
// failures) surface to the caller — silently treating them as "installed"
// would leave downstream fixers blaming a missing binary on the wrong cause.
func EnsurePnpmInstall(ctx context.Context, projectRoot string) error {
	_, err := os.Stat(filepath.Join(projectRoot, "node_modules"))
	if err == nil {
		return nil
	}
	if !os.IsNotExist(err) {
		return fmt.Errorf("stat node_modules: %w", err)
	}
	out, err := RunCommand(ctx, projectRoot, "pnpm", "install")
	if err != nil {
		if out != "" {
			return fmt.Errorf("pnpm install: %w\n%s", err, out)
		}
		return fmt.Errorf("pnpm install: %w", err)
	}
	return nil
}

// RunCommand executes a command with explicit args and returns its combined output.
// Callers must only pass trusted, hardcoded command names — never user input.
func RunCommand(ctx context.Context, dir string, name string, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, name, args...) //nolint:gosec // nosemgrep: go.lang.security.audit.dangerous-exec-command.dangerous-exec-command
	cmd.Dir = dir
	cmd.Env = os.Environ()

	out, err := cmd.CombinedOutput()
	return strings.TrimSpace(string(out)), err
}

// RunCommandStdout executes a command and returns only its stdout output.
// Use this instead of RunCommand when the command writes non-output text
// (prompts, browser-opening messages) to stderr that should not be captured.
func RunCommandStdout(ctx context.Context, dir string, name string, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, name, args...) //nolint:gosec // nosemgrep: go.lang.security.audit.dangerous-exec-command.dangerous-exec-command
	cmd.Dir = dir
	cmd.Env = os.Environ()

	out, err := cmd.Output()
	return strings.TrimSpace(string(out)), err
}

// RunCommandPassthrough runs a command with stdin/stdout/stderr connected to
// the real terminal. Use this for commands that need interactive input (e.g., sudo).
// Only works correctly when the TUI is suspended via tea.Exec.
func RunCommandPassthrough(ctx context.Context, dir string, name string, args ...string) error {
	cmd := exec.CommandContext(ctx, name, args...) //nolint:gosec // nosemgrep: go.lang.security.audit.dangerous-exec-command.dangerous-exec-command
	cmd.Dir = dir
	cmd.Env = os.Environ()
	cmd.Stdin = os.Stdin
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	return cmd.Run()
}

// RunCommandInteractive runs a command that may need user interaction
// (e.g., aws sso login opens a browser). It streams output and waits
// for completion or context cancellation.
// Callers must only pass trusted, hardcoded command names — never user input.
func RunCommandInteractive(ctx context.Context, dir string, onOutput func(string), name string, args ...string) error {
	cmd := exec.CommandContext(ctx, name, args...) //nolint:gosec // nosemgrep: go.lang.security.audit.dangerous-exec-command.dangerous-exec-command
	cmd.Dir = dir
	cmd.Env = os.Environ()
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return fmt.Errorf("stdout pipe: %w", err)
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return fmt.Errorf("stderr pipe: %w", err)
	}

	if err := cmd.Start(); err != nil {
		return fmt.Errorf("start: %w", err)
	}

	doneCh := make(chan struct{})
	go func() {
		select {
		case <-ctx.Done():
			if cmd.Process != nil {
				_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGTERM)
				select {
				case <-doneCh:
				case <-time.After(3 * time.Second):
					_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
				}
			}
		case <-doneCh:
		}
	}()

	// Drain stdout and stderr concurrently to avoid deadlock when
	// a pipe buffer fills while the other pipe is still open.
	var wg sync.WaitGroup
	drainPipe := func(r io.Reader) {
		defer wg.Done()
		sc := bufio.NewScanner(r)
		for sc.Scan() {
			if onOutput != nil {
				onOutput(sc.Text())
			}
		}
	}
	wg.Add(2)
	go drainPipe(stdout)
	go drainPipe(stderr)
	wg.Wait()

	waitErr := cmd.Wait()
	close(doneCh)

	if ctx.Err() != nil {
		return ctx.Err()
	}
	return waitErr
}
