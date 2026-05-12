package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/airo-ai-builder/dev-supervisor/internal/validation"
)

func TestCommandExecutor_NewCommandExecutor(t *testing.T) {
	t.Parallel()
	executor := NewCommandExecutor()

	if executor == nil {
		t.Fatal("Expected non-nil CommandExecutor")
		return
	}

	if executor.defaultTimeout != 30 {
		t.Errorf("Expected default timeout 30, got %d", executor.defaultTimeout)
	}

	// Default work dir should be current directory or /tmp
	if executor.defaultWorkDir == "" {
		t.Error("Expected non-empty default work dir")
	}

	// Verify the directory exists
	if _, err := os.Stat(executor.defaultWorkDir); os.IsNotExist(err) {
		t.Errorf("Default work dir '%s' does not exist", executor.defaultWorkDir)
	}
}

func TestCommandExecutor_Execute(t *testing.T) {
	t.Parallel()
	executor := NewCommandExecutor()

	// Create temp directory for testing (auto-cleaned up by t.TempDir)
	tempDir := t.TempDir()

	tests := []struct {
		name           string
		request        validation.CommandRequest
		expectError    bool
		expectedExit   int
		expectStdout   bool
		expectStderr   bool
		validateOutput func(result *CommandResult) error
	}{
		{
			name: "successful echo command",
			request: validation.CommandRequest{
				Command:       "echo 'Hello World'",
				CaptureOutput: true,
				WorkingDir:    tempDir,
				Timeout:       5,
			},
			expectError:  false,
			expectedExit: 0,
			expectStdout: true,
			validateOutput: func(result *CommandResult) error {
				if !strings.Contains(result.Stdout, "Hello World") {
					t.Errorf("Expected stdout to contain 'Hello World', got: %s", result.Stdout)
				}
				return nil
			},
		},
		{
			name: "command with stderr",
			request: validation.CommandRequest{
				Command:       "echo 'error message' >&2",
				CaptureOutput: true,
				WorkingDir:    tempDir,
				Timeout:       5,
			},
			expectError:  false,
			expectedExit: 0,
			expectStderr: true,
			validateOutput: func(result *CommandResult) error {
				if !strings.Contains(result.Stderr, "error message") {
					t.Errorf("Expected stderr to contain 'error message', got: %s", result.Stderr)
				}
				return nil
			},
		},
		{
			name: "command with non-zero exit code",
			request: validation.CommandRequest{
				Command:       "exit 42",
				CaptureOutput: true,
				WorkingDir:    tempDir,
				Timeout:       5,
			},
			expectError:  false,
			expectedExit: 42,
		},
		{
			name: "empty command",
			request: validation.CommandRequest{
				Command: "",
			},
			expectError: true,
		},
		{
			name: "command that times out",
			request: validation.CommandRequest{
				Command:       "sleep 3",
				CaptureOutput: true,
				Timeout:       1, // 1 second timeout
			},
			expectError:  false,
			expectedExit: -1,
			validateOutput: func(result *CommandResult) error {
				if !result.TimedOut {
					t.Error("Expected command to time out")
				}
				if result.Error != "command timed out" {
					t.Errorf("Expected timeout error message, got: %s", result.Error)
				}
				return nil
			},
		},
		{
			// Regression: the timeout branch previously returned before
			// populating result.Stdout/Stderr, so the most diagnostic
			// failure mode (a timed-out pnpm install or build) produced
			// no output for callers or the /exec ring-buffer mirror.
			name: "timed-out command captures partial stdout/stderr",
			request: validation.CommandRequest{
				Command:       "echo partial-stdout; echo partial-stderr >&2; sleep 5",
				CaptureOutput: true,
				Timeout:       1,
			},
			expectError:  false,
			expectedExit: -1,
			validateOutput: func(result *CommandResult) error {
				if !result.TimedOut {
					t.Error("Expected command to time out")
				}
				if !strings.Contains(result.Stdout, "partial-stdout") {
					t.Errorf("Expected partial stdout to be captured, got: %q", result.Stdout)
				}
				if !strings.Contains(result.Stderr, "partial-stderr") {
					t.Errorf("Expected partial stderr to be captured, got: %q", result.Stderr)
				}
				return nil
			},
		},
		{
			name: "working directory test",
			request: validation.CommandRequest{
				Command:       "pwd",
				CaptureOutput: true,
				WorkingDir:    tempDir,
				Timeout:       5,
			},
			expectError:  false,
			expectedExit: 0,
			expectStdout: true,
			validateOutput: func(result *CommandResult) error {
				if !strings.Contains(result.Stdout, tempDir) {
					t.Errorf("Expected stdout to contain working dir %s, got: %s", tempDir, result.Stdout)
				}
				return nil
			},
		},
		{
			name: "file creation test",
			request: validation.CommandRequest{
				Command:       "echo 'test content' > testfile.txt && cat testfile.txt",
				CaptureOutput: true,
				WorkingDir:    tempDir,
				Timeout:       5,
			},
			expectError:  false,
			expectedExit: 0,
			expectStdout: true,
			validateOutput: func(result *CommandResult) error {
				if !strings.Contains(result.Stdout, "test content") {
					t.Errorf("Expected file content in stdout, got: %s", result.Stdout)
				}

				// Verify file was actually created
				testFilePath := filepath.Join(tempDir, "testfile.txt")
				if _, err := os.Stat(testFilePath); os.IsNotExist(err) {
					t.Error("Expected test file to be created")
				}
				return nil
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			result, err := executor.Execute(tt.request)

			// Check error expectation
			if tt.expectError && err == nil {
				t.Error("Expected error but got none")
				return
			}

			if !tt.expectError && err != nil {
				t.Errorf("Expected no error but got: %v", err)
				return
			}

			if tt.expectError {
				return // Skip further validation for error cases
			}

			// Validate result
			if result == nil {
				t.Fatal("Expected non-nil result")
				return
			}

			if result.Command != tt.request.Command {
				t.Errorf("Expected command '%s', got '%s'", tt.request.Command, result.Command)
			}

			if result.ExitCode != tt.expectedExit {
				t.Errorf("Expected exit code %d, got %d", tt.expectedExit, result.ExitCode)
			}

			if tt.expectStdout && result.Stdout == "" {
				t.Error("Expected stdout output but got none")
			}

			if tt.expectStderr && result.Stderr == "" {
				t.Error("Expected stderr output but got none")
			}

			if result.Duration <= 0 {
				t.Error("Expected positive duration in result")
			}

			// Skip duration comparison in environments with clock drift (WSL2)
			// The Duration should be positive, which is the main requirement

			// Run custom validation if provided
			if tt.validateOutput != nil {
				if err := tt.validateOutput(result); err != nil {
					t.Errorf("Custom validation failed: %v", err)
				}
			}
		})
	}
}

func TestCommandExecutor_ExecuteDefaults(t *testing.T) {
	t.Parallel()
	executor := NewCommandExecutor()

	// Test with minimal request (should use defaults)
	request := validation.CommandRequest{
		Command: "echo 'test'",
	}

	result, err := executor.Execute(request)
	if err != nil {
		t.Fatalf("Expected no error, got: %v", err)
	}

	// Should use default timeout (30s) - command should complete quickly
	if result.TimedOut {
		t.Error("Command should not have timed out with default timeout")
	}

	// Should use default working directory - we can't easily test this
	// without making assumptions about the environment
}

func TestCommandExecutor_ExecuteComplexCommands(t *testing.T) {
	t.Parallel()
	executor := NewCommandExecutor()

	// Create temp directory for testing (auto-cleaned up by t.TempDir)
	tempDir := t.TempDir()

	tests := []struct {
		name    string
		command string
	}{
		{
			name:    "pipeline command",
			command: "echo 'line1\nline2\nline3' | grep 'line2'",
		},
		{
			name:    "multiple commands",
			command: "echo 'first' && echo 'second'",
		},
		{
			name:    "conditional execution",
			command: "true && echo 'success' || echo 'failure'",
		},
		{
			name:    "variable usage",
			command: "VAR='hello world'; echo $VAR",
		},
		{
			name:    "subshell command",
			command: "echo \"Current date: $(date +%Y-%m-%d)\"",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			request := validation.CommandRequest{
				Command:       tt.command,
				CaptureOutput: true,
				WorkingDir:    tempDir,
				Timeout:       10,
			}

			result, err := executor.Execute(request)
			if err != nil {
				t.Errorf("Command failed: %v", err)
				return
			}

			// Complex commands should generally succeed
			if result.ExitCode != 0 {
				t.Errorf("Expected exit code 0, got %d. Stderr: %s", result.ExitCode, result.Stderr)
			}

			// Should have some output
			if result.Stdout == "" && result.Stderr == "" {
				t.Error("Expected some output from complex command")
			}
		})
	}
}
