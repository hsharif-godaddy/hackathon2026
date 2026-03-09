package processmanager_test

import (
	"os"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/airo-ai-builder/dev-supervisor/internal/processmanager"
)

// TestRunSetupScriptInternal_NoScript tests that when no script is configured, it returns success
func TestRunSetupScriptInternal_NoScript(t *testing.T) {
	err := processmanager.RunSetupScriptInternal("", 10*time.Minute, nil)
	if err != nil {
		t.Fatalf("should not error when no script configured: %v", err)
	}
}

// TestRunSetupScriptInternal_Success tests successful script execution
func TestRunSetupScriptInternal_Success(t *testing.T) {
	tmpDir := t.TempDir()
	scriptPath := tmpDir + "/test-setup.sh"
	scriptContent := "#!/bin/sh\necho 'Setup complete'\nexit 0\n"
	err := os.WriteFile(scriptPath, []byte(scriptContent), 0755)
	if err != nil {
		t.Fatalf("should write test script: %v", err)
	}

	err = processmanager.RunSetupScriptInternal(scriptPath, 10*time.Minute, nil)
	if err != nil {
		t.Fatalf("should not error on successful script: %v", err)
	}
}

// TestRunSetupScriptInternal_Failure tests handling of failing script
func TestRunSetupScriptInternal_Failure(t *testing.T) {
	tmpDir := t.TempDir()
	scriptPath := tmpDir + "/test-setup.sh"
	scriptContent := "#!/bin/sh\necho 'Setup failed'\nexit 1\n"
	err := os.WriteFile(scriptPath, []byte(scriptContent), 0755)
	if err != nil {
		t.Fatalf("should write test script: %v", err)
	}

	err = processmanager.RunSetupScriptInternal(scriptPath, 10*time.Minute, nil)
	if err == nil {
		t.Fatal("should error on failing script")
	}
	if !strings.Contains(err.Error(), "setup script failed") {
		t.Errorf("error should mention setup script failure, got: %v", err)
	}
}

// TestRunSetupScriptInternal_OutputStreaming tests that script output is captured
func TestRunSetupScriptInternal_OutputStreaming(t *testing.T) {
	tmpDir := t.TempDir()
	scriptPath := tmpDir + "/test-setup.sh"
	scriptContent := "#!/bin/sh\necho 'stdout message'\necho 'stderr message' >&2\nexit 0\n"
	err := os.WriteFile(scriptPath, []byte(scriptContent), 0755)
	if err != nil {
		t.Fatalf("should write test script: %v", err)
	}

	err = processmanager.RunSetupScriptInternal(scriptPath, 10*time.Minute, nil)
	if err != nil {
		t.Fatalf("should not error on successful script with output: %v", err)
	}
}

// TestRunSetupScriptInternal_ScriptNotFound tests handling of missing script
func TestRunSetupScriptInternal_ScriptNotFound(t *testing.T) {
	err := processmanager.RunSetupScriptInternal("/nonexistent/setup.sh", 10*time.Minute, nil)
	if err == nil {
		t.Fatal("should error on missing script")
	}
}

// TestRunSetupScriptInternal_Timeout tests that setup script timeout is handled correctly
func TestRunSetupScriptInternal_Timeout(t *testing.T) {
	tmpDir := t.TempDir()
	scriptPath := tmpDir + "/test-setup.sh"
	scriptContent := "#!/bin/sh\necho 'Starting setup'\nsleep 10\necho 'Done'\nexit 0\n"
	err := os.WriteFile(scriptPath, []byte(scriptContent), 0755)
	if err != nil {
		t.Fatalf("should write test script: %v", err)
	}

	err = processmanager.RunSetupScriptInternal(scriptPath, 500*time.Millisecond, nil)
	if err == nil {
		t.Fatal("should error on timeout")
	}
	if !strings.Contains(err.Error(), "timed out") {
		t.Errorf("error should mention timeout, got: %v", err)
	}
}

// TestRunSetupScriptInternal_PermissionDenied tests handling of non-executable script.
// This test only works reliably on Linux where execute permissions are strictly enforced.
func TestRunSetupScriptInternal_PermissionDenied(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Skipping: permission denied is only reliably testable on Linux")
	}

	tmpDir := t.TempDir()
	scriptPath := tmpDir + "/test-setup.sh"
	scriptContent := "#!/bin/sh\necho 'Setup'\nexit 0\n"
	err := os.WriteFile(scriptPath, []byte(scriptContent), 0644) // Not executable
	if err != nil {
		t.Fatalf("should write test script: %v", err)
	}

	err = processmanager.RunSetupScriptInternal(scriptPath, 10*time.Minute, nil)
	if err == nil {
		t.Fatal("should error on permission denied")
	}
}
