package main

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"time"
)

const (
	defaultTmpDir = "/tmp"
)

type CommandRequest struct {
	Command       string `json:"command"`
	Timeout       int    `json:"timeout,omitempty"`
	CaptureOutput bool   `json:"capture_output,omitempty"`
	WorkingDir    string `json:"working_dir,omitempty"`
}

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
	defaultTimeout int
	defaultWorkDir string
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

func (ce *CommandExecutor) Execute(req CommandRequest) (*CommandResult, error) {
	if req.Command == "" {
		return nil, fmt.Errorf("command is required")
	}

	// Set timeout
	timeout := ce.defaultTimeout
	if req.Timeout > 0 {
		timeout = req.Timeout
	}

	// Set working directory
	workDir := ce.defaultWorkDir
	if req.WorkingDir != "" {
		workDir = req.WorkingDir
	}

	// Create context with timeout
	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(timeout)*time.Second)
	defer cancel()

	// Create command
	//nolint:gosec // G204: Command execution is the intended functionality
	// nosemgrep: go.lang.security.audit.dangerous-exec-command.dangerous-exec-command
	cmd := exec.CommandContext(ctx, "sh", "-c", req.Command)
	cmd.Dir = workDir

	var stdout, stderr bytes.Buffer
	if req.CaptureOutput {
		cmd.Stdout = &stdout
		cmd.Stderr = &stderr
	}

	// Record start time
	startTime := time.Now()

	// Execute command
	err := cmd.Run()
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
		return result, nil
	}

	// Get exit code
	if err != nil {
		if exitError, ok := err.(*exec.ExitError); ok {
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

	return result, nil
}

// ExecuteAsync is not needed for LLM usage - removed for simplicity
