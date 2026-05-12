package main

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"os"
	"os/exec"
	"time"

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
}

func NewCommandExecutor() *CommandExecutor {
	// Use current working directory as default, fallback to /tmp
	defaultDir, err := os.Getwd()
	if err != nil {
		defaultDir = defaultTmpDir
	}

	return &CommandExecutor{
		defaultTimeout: 30, // 30 seconds default
		defaultWorkDir: defaultDir,
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

	// Create command (sandboxed or direct)
	spec := sandbox.BuildExecProfile(ce.sharedStorageDir, req.Command, workDir)
	sandboxCmd, sandboxErr := sandbox.WrapCommand(ctx, ce.sandboxEnabled, spec, os.Environ())
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

	// Execute command (with status-pipe handling when sandboxed)
	var err error
	var sandboxFatal string
	if statusRead != nil {
		if startErr := cmd.Start(); startErr != nil {
			_ = statusRead.Close()
			sandbox.ReleaseStatusWrite(cmd)
			err = startErr
		} else {
			sandbox.ReleaseStatusWrite(cmd)
			fatalCh := make(chan string, 1)
			go func() {
				fatalCh <- sandbox.ReadFatal(statusRead)
				_ = statusRead.Close()
			}()
			err = cmd.Wait()
			sandboxFatal = <-fatalCh
		}
	} else {
		err = cmd.Run()
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

// ExecuteAsync is not needed for LLM usage - removed for simplicity
