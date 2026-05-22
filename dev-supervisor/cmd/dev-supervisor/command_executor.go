package main

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"maps"
	"os"
	"os/exec"
	"strings"
	"syscall"
	"time"

	"github.com/airo-ai-builder/dev-supervisor/internal/process"
	"github.com/airo-ai-builder/dev-supervisor/internal/sandbox"
	"github.com/airo-ai-builder/dev-supervisor/internal/validation"
)

const (
	defaultTmpDir = "/tmp"
)

type CommandResult struct {
	Command  string `json:"command"`
	ExitCode int    `json:"exit_code"`
	Stdout   string `json:"stdout"`
	Stderr   string `json:"stderr"`
	Duration int64  `json:"duration_ms"`
	TimedOut bool   `json:"timed_out"`
	Error    string `json:"error,omitempty"`
}

type CommandExecutor struct {
	defaultTimeout   int
	defaultWorkDir   string
	sandboxEnabled   bool
	sharedStorageDir string
	// pid1Mgr, when non-nil, is used to atomically Start+Register every
	// spawned child so the PID1 orphan reaper cannot waitid(2) a short-lived
	// command before we reach cmd.Wait(). See PID1Manager.StartAndRegister.
	pid1Mgr *process.PID1Manager
}

// NewCommandExecutor constructs a CommandExecutor.
//
// pid1Mgr may be nil (used by unit tests and non-PID1 callers). When it is
// set, every child spawned by Execute is registered with the PID1 manager
// before it can exit so the orphan reaper does not steal its exit status.
func NewCommandExecutor(pid1Mgr *process.PID1Manager) *CommandExecutor {
	// Use current working directory as default, fallback to /tmp
	defaultDir, err := os.Getwd()
	if err != nil {
		defaultDir = defaultTmpDir
	}

	return &CommandExecutor{
		defaultTimeout: 30, // 30 seconds default
		defaultWorkDir: defaultDir,
		pid1Mgr:        pid1Mgr,
	}
}

// SetSandboxEnabled configures whether command execution uses Landlock sandboxing.
func (ce *CommandExecutor) SetSandboxEnabled(enabled bool) {
	ce.sandboxEnabled = enabled
}

// SetSharedStorageDir sets the shared storage directory for sandbox path resolution.
func (ce *CommandExecutor) SetSharedStorageDir(dir string) {
	ce.sharedStorageDir = dir
}

func (ce *CommandExecutor) Execute(req validation.CommandRequest) (*CommandResult, error) {
	if req.Command == "" {
		return nil, errors.New("command is required")
	}

	commandPreview := commandLogPreview(req.Command)

	// Set timeout
	timeout := ce.defaultTimeout
	if req.Timeout > 0 {
		timeout = req.Timeout
	}
	timeoutDuration := time.Duration(timeout) * time.Second

	// Set working directory
	workDir := ce.defaultWorkDir
	if req.WorkingDir != "" {
		workDir = req.WorkingDir
	}

	// Create context with timeout
	ctx, cancel := context.WithTimeout(context.Background(), timeoutDuration)
	defer cancel()

	// Build env for the child process: base (supervisor env) + per-command overrides.
	// mergeEnv returns baseEnv unmodified when overrides is empty.
	childEnv := mergeEnv(os.Environ(), req.Env)

	// Create command (sandboxed or direct)
	spec := sandbox.BuildExecProfile(ce.sharedStorageDir, req.Command, workDir)
	sandboxCmd, sandboxErr := sandbox.WrapCommand(ctx, ce.sandboxEnabled, spec, childEnv)
	if sandboxErr != nil {
		return nil, sandboxErr
	}

	var cmd *exec.Cmd
	if sandboxCmd != nil {
		cmd = sandboxCmd
	} else {
		//nolint:gosec // G204: Command execution is the intended functionality
		// nosemgrep: go.lang.security.audit.dangerous-exec-command.dangerous-exec-command
		cmd = exec.CommandContext(ctx, "sh", "-c", req.Command)
		cmd.Dir = workDir
		cmd.Env = childEnv
	}

	// Attach a status pipe for wrapper-level failures (only meaningful when sandboxed).
	var statusRead *os.File
	if sandboxCmd != nil {
		var pipeErr error
		statusRead, pipeErr = sandbox.AttachStatusPipe(cmd)
		if pipeErr != nil {
			return nil, pipeErr
		}
	}

	var stdout, stderr bytes.Buffer
	if req.CaptureOutput {
		cmd.Stdout = &stdout
		cmd.Stderr = &stderr
	}

	// Record start time
	startTime := time.Now()

	slog.Debug("command_executor.execute.start",
		"command_preview", commandPreview,
		"timeout_seconds", timeout,
		"working_dir", workDir,
		"capture_output", req.CaptureOutput,
	)

	// Execute command (with status-pipe handling when sandboxed).
	//
	// Every path must use startCommand() (rather than cmd.Start() / cmd.Run()
	// directly) so the PID1 orphan reaper does not race this exec and steal
	// the child's exit status before cmd.Wait() runs. See PID1Manager.StartAndRegister.
	var err error
	var sandboxFatal string

	if err = ce.startCommand(cmd); err == nil {
		// Defer unregistering the command with the PID1 manager until after Wait returns,
		// to ensure the reaper doesn't steal the exit status if the command is short-lived. See PID1Manager.StartAndRegister.
		defer ce.unregisterCommand(cmd.Process.Pid)
	}

	// If we errored at command start, and we have an open status pipe,
	// close it and release the write end so the sandbox doesn't leak resources or block on writes.
	if err != nil && statusRead != nil {
		_ = statusRead.Close()
		sandbox.ReleaseStatusWrite(cmd)
	}

	// If we did not error out, and we are not sandboxed, then we can simply wait for command completion.
	if err == nil && statusRead == nil {
		err = cmd.Wait()
	}

	// If we did not error out, and we are sand boxed, then we to release the status write.
	if err == nil && statusRead != nil {
		sandbox.ReleaseStatusWrite(cmd)
		fatalCh := make(chan string, 1)
		go func() {
			fatalCh <- sandbox.ReadFatal(statusRead)
			_ = statusRead.Close()
		}()
		err = cmd.Wait()
		sandboxFatal = <-fatalCh
	}

	duration := time.Since(startTime)

	// Ensure duration is at least 1ms to avoid 0 values for very fast commands
	durationMs := duration.Milliseconds()
	if durationMs == 0 && duration > 0 {
		durationMs = 1
	}

	result := &CommandResult{
		Command:  req.Command,
		Duration: durationMs,
	}

	// Check if command timed out
	if ctx.Err() == context.DeadlineExceeded {
		result.TimedOut = true
		result.Error = "command timed out"
		result.ExitCode = -1
		// Capture bytes already written before the kill. The non-timeout
		// branch below is the only other site that populates these fields,
		// so without this a timed-out `pnpm install`/build — the most
		// diagnostically valuable failure mode — would surface no output
		// to callers or to the ring-buffer mirror in recordExecOutput.
		if req.CaptureOutput {
			result.Stdout = stdout.String()
			result.Stderr = stderr.String()
		}
		slog.Warn("command_executor.execute.timeout",
			"command_preview", commandPreview,
			"timeout_seconds", timeout,
			"duration_ms", result.Duration,
			"stdout_length", len(result.Stdout),
			"stderr_length", len(result.Stderr),
		)
		return result, nil
	}

	// Get exit code
	if err != nil {
		var exitError *exec.ExitError
		if errors.As(err, &exitError) {
			result.ExitCode = exitError.ExitCode()
		} else {
			result.Error = err.Error()
			result.ExitCode = -1
		}
	} else {
		result.ExitCode = 0
	}

	// Get output if captured
	if req.CaptureOutput {
		result.Stdout = stdout.String()
		result.Stderr = stderr.String()
	}

	// Surface airo-sandbox wrapper failures reported via the status pipe (fd 3).
	if sandboxFatal != "" {
		result.Error = "sandbox wrapper failed: " + sandboxFatal
		slog.Error("command_executor.execute.sandbox_error",
			"command_preview", commandPreview,
			"exit_code", result.ExitCode,
			"duration_ms", result.Duration,
			"reason", sandboxFatal,
		)
		return result, nil
	}

	switch {
	case result.ExitCode == -1:
		// ECHILD ("no child processes") is the PID1 reaper-race signature —
		// log it distinctly so a regression in any unconverted exec path is
		// visibly different from a generic Start failure. See
		// PID1Manager.StartAndRegister.
		if err != nil && (errors.Is(err, syscall.ECHILD) || strings.Contains(err.Error(), "no child processes")) {
			slog.Error("command_executor.execute.reaper_race",
				"command_preview", commandPreview,
				"duration_ms", result.Duration,
				"stdout_length", len(result.Stdout),
				"error", err,
			)
			break
		}
		slog.Error("command_executor.execute.failed",
			"command_preview", commandPreview,
			"exit_code", result.ExitCode,
			"duration_ms", result.Duration,
			"stderr_length", len(result.Stderr),
			"stdout_length", len(result.Stdout),
			"error", err,
		)
	case err != nil:
		// Command ran but returned non-zero exit code.
		slog.Debug("command_executor.execute.non_zero_exit",
			"command_preview", commandPreview,
			"exit_code", result.ExitCode,
			"duration_ms", result.Duration,
			"stderr_preview", truncate(result.Stderr, 256),
			"stdout_length", len(result.Stdout),
		)
	default:
		slog.Debug("command_executor.execute.success",
			"command_preview", commandPreview,
			"exit_code", result.ExitCode,
			"duration_ms", result.Duration,
			"stderr_length", len(result.Stderr),
			"stdout_length", len(result.Stdout),
		)
	}

	return result, nil
}

// startCommand starts cmd using the PID1 manager (when available) so the
// orphan reaper cannot consume the child's exit status before cmd.Wait()
// runs. Falls back to plain cmd.Start() only when pid1Mgr is nil — production
// always wires it up in main.go; the fallback exists for unit tests.
func (ce *CommandExecutor) startCommand(cmd *exec.Cmd) error {
	if ce.pid1Mgr != nil {
		return ce.pid1Mgr.StartAndRegister(cmd, nil)
	}
	return cmd.Start()
}

// unregisterCommand drops the PID from the PID1 manager's tracking map after
// cmd.Wait() returns (zero-exit, non-zero-exit, or error — all reap the
// process). Safe to call when pid1Mgr is nil or pid is zero.
func (ce *CommandExecutor) unregisterCommand(pid int) {
	if ce.pid1Mgr == nil || pid == 0 {
		return
	}
	ce.pid1Mgr.UnregisterChildProcess(pid)
}

// runShortLivedCommand runs cmd to completion using the PID1 manager (when
// wired up) so the orphan reaper cannot consume the child's exit status before
// cmd.Wait() runs. Equivalent to cmd.Run() but reaper-safe; intended for
// one-shot exec sites (file/grep, health checks). Falls back to cmd.Run() only
// when pid1Mgr is nil (tests).
func (s *Server) runShortLivedCommand(cmd *exec.Cmd) error {
	if s.pid1Mgr == nil {
		return cmd.Run()
	}
	if err := s.pid1Mgr.StartAndRegister(cmd, nil); err != nil {
		return err
	}
	defer s.pid1Mgr.UnregisterChildProcess(cmd.Process.Pid)
	return cmd.Wait()
}

// mergeEnv returns baseEnv with overrides applied. Duplicate keys in baseEnv
// are replaced; new keys are appended. Does not mutate baseEnv.
func mergeEnv(baseEnv []string, overrides map[string]string) []string {
	if len(overrides) == 0 {
		return baseEnv
	}
	envMap := make(map[string]string, len(baseEnv)+len(overrides))
	for _, entry := range baseEnv {
		k, v, found := strings.Cut(entry, "=")
		if !found {
			continue
		}
		envMap[k] = v
	}
	maps.Copy(envMap, overrides)
	result := make([]string, 0, len(envMap))
	for k, v := range envMap {
		result = append(result, k+"="+v)
	}
	return result
}
