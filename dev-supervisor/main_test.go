package main

import (
	"os"
	"runtime"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/airo-ai-builder/dev-supervisor/internal/config"
)

func TestGetSocketPath(t *testing.T) {
	// Note: Cannot use t.Parallel() with t.Setenv() since env vars are process-global
	tests := []struct {
		name     string
		envValue string
		expected string
	}{
		{
			name:     "default path when env not set",
			envValue: "",
			expected: "/tmp/airo-supervisor.sock",
		},
		{
			name:     "custom path from environment",
			envValue: "/custom/path/supervisor.sock",
			expected: "/custom/path/supervisor.sock",
		},
		{
			name:     "relative path from environment",
			envValue: "./supervisor.sock",
			expected: "./supervisor.sock",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Note: Cannot use t.Parallel() with t.Setenv() since env vars are process-global
			// Set test value (t.Setenv auto-restores original value)
			if tt.envValue != "" {
				t.Setenv("AIRO_SUPERVISOR_SOCKET_PATH", tt.envValue)
			}

			// Test function
			result := config.GetSocketPath()
			if result != tt.expected {
				t.Errorf("config.GetSocketPath() = %s, expected %s", result, tt.expected)
			}
		})
	}
}

// TestParseAllowedOrigins tests that allowed origins are parsed using the same logic as vite.config.ts
func TestParseAllowedOrigins(t *testing.T) {
	// Note: Cannot use t.Parallel() since subtests manipulate env vars
	tests := []struct {
		name             string
		frontendDomain   string
		allowedOrigins   string
		viteParentOrigin string
		expectedCount    int
		shouldContain    []string
		shouldNotContain []string
	}{
		{
			name:           "FRONTEND_DOMAIN only",
			frontendDomain: "app.example.com",
			expectedCount:  3,
			shouldContain: []string{
				"app.example.com",
				"http://app.example.com",
				"https://app.example.com",
			},
		},
		{
			name:           "ALLOWED_ORIGINS only",
			allowedOrigins: "https://builder.com,http://localhost:3000",
			expectedCount:  2,
			shouldContain: []string{
				"https://builder.com",
				"http://localhost:3000",
			},
		},
		{
			name:             "VITE_PARENT_ORIGIN only",
			viteParentOrigin: "https://parent.com",
			expectedCount:    1,
			shouldContain: []string{
				"https://parent.com",
			},
		},
		{
			name:             "All three combined",
			frontendDomain:   "app.example.com",
			allowedOrigins:   "https://builder.com,http://localhost:3000",
			viteParentOrigin: "https://parent.com",
			expectedCount:    6,
			shouldContain: []string{
				"app.example.com",
				"http://app.example.com",
				"https://app.example.com",
				"https://builder.com",
				"http://localhost:3000",
				"https://parent.com",
			},
		},
		{
			name:             "Duplicates removed",
			frontendDomain:   "example.com",
			allowedOrigins:   "https://example.com,http://example.com",
			viteParentOrigin: "https://example.com",
			expectedCount:    3, // Only unique values
			shouldContain: []string{
				"example.com",
				"http://example.com",
				"https://example.com",
			},
		},
		{
			name:           "Whitespace trimmed",
			allowedOrigins: " https://builder.com , http://localhost:3000 ",
			expectedCount:  2,
			shouldContain: []string{
				"https://builder.com",
				"http://localhost:3000",
			},
			shouldNotContain: []string{
				" https://builder.com",
				"http://localhost:3000 ",
			},
		},
		{
			name:             "Production-like config",
			frontendDomain:   "cptjybkt1g.preview.c24.airoapp.ai",
			allowedOrigins:   "https://airo-builder.godaddy.com,http://airo-builder.godaddy.com",
			viteParentOrigin: "https://airo-builder.godaddy.com",
			expectedCount:    5, // FRONTEND_DOMAIN (3) + ALLOWED_ORIGINS (2), with 1 duplicate removed
			shouldContain: []string{
				"cptjybkt1g.preview.c24.airoapp.ai",
				"http://cptjybkt1g.preview.c24.airoapp.ai",
				"https://cptjybkt1g.preview.c24.airoapp.ai",
				"https://airo-builder.godaddy.com",
				"http://airo-builder.godaddy.com",
			},
		},
		{
			name:          "None set (empty)",
			expectedCount: 0,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Note: Cannot use t.Parallel() since env vars are process-global
			// Save and restore original env values
			origFrontend := os.Getenv("FRONTEND_DOMAIN")
			origAllowed := os.Getenv("ALLOWED_ORIGINS")
			origParent := os.Getenv("VITE_PARENT_ORIGIN")
			defer func() {
				setOrUnsetEnv("FRONTEND_DOMAIN", origFrontend)
				setOrUnsetEnv("ALLOWED_ORIGINS", origAllowed)
				setOrUnsetEnv("VITE_PARENT_ORIGIN", origParent)
			}()

			// Set test env values
			setOrUnsetEnv("FRONTEND_DOMAIN", tt.frontendDomain)
			setOrUnsetEnv("ALLOWED_ORIGINS", tt.allowedOrigins)
			setOrUnsetEnv("VITE_PARENT_ORIGIN", tt.viteParentOrigin)

			// Run the parsing logic (simulate what happens in main())
			var allowedOrigins []string
			frontendDomain := os.Getenv("FRONTEND_DOMAIN")
			if frontendDomain != "" {
				allowedOrigins = append(allowedOrigins,
					frontendDomain,
					"http://"+frontendDomain,
					"https://"+frontendDomain,
				)
			}
			allowedOriginsStr := os.Getenv("ALLOWED_ORIGINS")
			if allowedOriginsStr != "" {
				origins := strings.Split(allowedOriginsStr, ",")
				allowedOrigins = append(allowedOrigins, origins...)
			}
			viteParentOrigin := os.Getenv("VITE_PARENT_ORIGIN")
			if viteParentOrigin != "" {
				allowedOrigins = append(allowedOrigins, viteParentOrigin)
			}
			seenOrigins := make(map[string]bool)
			var result []string
			for _, origin := range allowedOrigins {
				trimmed := strings.TrimSpace(origin)
				if trimmed != "" && !seenOrigins[trimmed] {
					seenOrigins[trimmed] = true
					result = append(result, trimmed)
				}
			}

			// Verify count
			if len(result) != tt.expectedCount {
				t.Errorf("Expected %d origins, got %d: %v", tt.expectedCount, len(result), result)
			}

			// Verify expected values are present
			for _, expected := range tt.shouldContain {
				found := slices.Contains(result, expected)
				if !found {
					t.Errorf("Expected to find %q in result, but didn't. Result: %v", expected, result)
				}
			}

			// Verify unexpected values are NOT present
			for _, unexpected := range tt.shouldNotContain {
				for _, actual := range result {
					if actual == unexpected {
						t.Errorf("Did not expect to find %q in result, but did. Result: %v", unexpected, result)
					}
				}
			}
		})
	}
}

// setOrUnsetEnv sets an environment variable if value is non-empty, otherwise unsets it
// Used for both setting test values and restoring original values
func setOrUnsetEnv(key, value string) {
	if value == "" {
		os.Unsetenv(key)
	} else {
		os.Setenv(key, value)
	}
}

// Tests for conditional startup helper functions

// TestShouldDeferStart_NoScript tests that when no script is configured,
// it returns false (start immediately) for backward compatibility
func TestShouldDeferStart_NoScript(t *testing.T) {
	shouldDefer, err := shouldDeferStart("", 30*time.Second)
	if err != nil {
		t.Fatalf("should not error when no script configured: %v", err)
	}
	if shouldDefer {
		t.Error("should return false (start immediately) when no script configured")
	}
}

// TestShouldDeferStart_Exit0 tests that exit code 0 means defer start
func TestShouldDeferStart_Exit0(t *testing.T) {
	// Create a temporary script that exits 0
	tmpDir := t.TempDir()
	scriptPath := tmpDir + "/test-script.sh"
	scriptContent := "#!/bin/sh\necho 'Restart detected'\nexit 0\n"
	err := os.WriteFile(scriptPath, []byte(scriptContent), 0755)
	if err != nil {
		t.Fatalf("should write test script: %v", err)
	}

	shouldDefer, err := shouldDeferStart(scriptPath, 30*time.Second)
	if err != nil {
		t.Fatalf("should not error on exit 0: %v", err)
	}
	if !shouldDefer {
		t.Error("exit 0 should mean defer start")
	}
}

// TestShouldDeferStart_Exit1 tests that exit code 1 means start immediately
func TestShouldDeferStart_Exit1(t *testing.T) {
	// Create a temporary script that exits 1
	tmpDir := t.TempDir()
	scriptPath := tmpDir + "/test-script.sh"
	scriptContent := "#!/bin/sh\necho 'Fresh creation'\nexit 1\n"
	err := os.WriteFile(scriptPath, []byte(scriptContent), 0755)
	if err != nil {
		t.Fatalf("should write test script: %v", err)
	}

	shouldDefer, err := shouldDeferStart(scriptPath, 30*time.Second)
	if err != nil {
		t.Fatalf("should not error on exit 1: %v", err)
	}
	if shouldDefer {
		t.Error("exit 1 should mean start immediately")
	}
}

// TestShouldDeferStart_NonZeroExit tests that any non-zero exit means start immediately
func TestShouldDeferStart_NonZeroExit(t *testing.T) {
	// Create a temporary script that exits 2
	tmpDir := t.TempDir()
	scriptPath := tmpDir + "/test-script.sh"
	scriptContent := "#!/bin/sh\nexit 2\n"
	err := os.WriteFile(scriptPath, []byte(scriptContent), 0755)
	if err != nil {
		t.Fatalf("should write test script: %v", err)
	}

	shouldDefer, err := shouldDeferStart(scriptPath, 30*time.Second)
	if err != nil {
		t.Fatalf("should not error on non-zero exit: %v", err)
	}
	if shouldDefer {
		t.Error("non-zero exit should mean start immediately")
	}
}

// TestShouldDeferStart_ScriptNotFound tests handling of missing script
func TestShouldDeferStart_ScriptNotFound(t *testing.T) {
	shouldDefer, err := shouldDeferStart("/nonexistent/script.sh", 30*time.Second)
	if err == nil {
		t.Fatal("should error on missing script")
	}
	if shouldDefer {
		t.Error("missing script should default to start immediately")
	}
}

// TestShouldDeferStart_Timeout tests that script timeout is treated as fatal error
func TestShouldDeferStart_Timeout(t *testing.T) {
	// Create a script that sleeps longer than the timeout
	tmpDir := t.TempDir()
	scriptPath := tmpDir + "/test-script.sh"
	scriptContent := "#!/bin/sh\nsleep 10\nexit 0\n"
	err := os.WriteFile(scriptPath, []byte(scriptContent), 0755)
	if err != nil {
		t.Fatalf("should write test script: %v", err)
	}

	// Use a very short timeout (500ms)
	shouldDefer, err := shouldDeferStart(scriptPath, 500*time.Millisecond)
	if err == nil {
		t.Fatal("should error on timeout")
	}
	if !strings.Contains(err.Error(), "timed out") {
		t.Errorf("error should mention timeout, got: %v", err)
	}
	if shouldDefer {
		t.Error("timeout should not result in defer")
	}
}

// TestShouldDeferStart_Exit126 tests that exit 126 (permission denied) is fatal
// This test only works reliably on Linux where execute permissions are strictly enforced
func TestShouldDeferStart_Exit126(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Skipping: permission denied (exit 126) is only reliably testable on Linux")
	}

	t.Skip("Skipping: No longer using /bin/sh wrapper, scripts must have execute bit set before calling")

	// Note: After removing the /bin/sh wrapper (scripts now execute directly),
	// Go's exec.Command returns "permission denied" error instead of exit code 126.
	// Exit code 126 is a shell convention that only applies when using a shell wrapper.
	// The executable bit requirement is now enforced at the deployment/setup level,
	// not at runtime. This test is kept for historical reference but skipped.
}

// TestRunSetupScript_NoScript tests that when no script is configured, it returns success
func TestRunSetupScript_NoScript(t *testing.T) {
	err := runSetupScript("", 10*time.Minute)
	if err != nil {
		t.Fatalf("should not error when no script configured: %v", err)
	}
}

// TestRunSetupScript_Success tests successful script execution
func TestRunSetupScript_Success(t *testing.T) {
	// Create a temporary script that succeeds
	tmpDir := t.TempDir()
	scriptPath := tmpDir + "/test-setup.sh"
	scriptContent := "#!/bin/sh\necho 'Setup complete'\nexit 0\n"
	err := os.WriteFile(scriptPath, []byte(scriptContent), 0755)
	if err != nil {
		t.Fatalf("should write test script: %v", err)
	}

	err = runSetupScript(scriptPath, 10*time.Minute)
	if err != nil {
		t.Fatalf("should not error on successful script: %v", err)
	}
}

// TestRunSetupScript_Failure tests handling of failing script
func TestRunSetupScript_Failure(t *testing.T) {
	// Create a temporary script that fails
	tmpDir := t.TempDir()
	scriptPath := tmpDir + "/test-setup.sh"
	scriptContent := "#!/bin/sh\necho 'Setup failed'\nexit 1\n"
	err := os.WriteFile(scriptPath, []byte(scriptContent), 0755)
	if err != nil {
		t.Fatalf("should write test script: %v", err)
	}

	err = runSetupScript(scriptPath, 10*time.Minute)
	if err == nil {
		t.Fatal("should error on failing script")
	}
	if !strings.Contains(err.Error(), "setup script failed") {
		t.Errorf("error should mention setup script failure, got: %v", err)
	}
}

// TestRunSetupScript_OutputStreaming tests that script output is captured
func TestRunSetupScript_OutputStreaming(t *testing.T) {
	// Create a temporary script that outputs to stdout and stderr
	tmpDir := t.TempDir()
	scriptPath := tmpDir + "/test-setup.sh"
	scriptContent := `#!/bin/sh
echo 'stdout message'
echo 'stderr message' >&2
exit 0
`
	err := os.WriteFile(scriptPath, []byte(scriptContent), 0755)
	if err != nil {
		t.Fatalf("should write test script: %v", err)
	}

	// Run the script - output will be logged via slog
	err = runSetupScript(scriptPath, 10*time.Minute)
	if err != nil {
		t.Fatalf("should not error on successful script with output: %v", err)
	}

	// Note: We can't easily capture slog output in tests, but we verify the script runs
	// In practice, the streamScriptOutput function logs each line with slog.Info()
}

// TestRunSetupScript_ScriptNotFound tests handling of missing script
func TestRunSetupScript_ScriptNotFound(t *testing.T) {
	err := runSetupScript("/nonexistent/setup.sh", 10*time.Minute)
	if err == nil {
		t.Fatal("should error on missing script")
	}
}

// TestRunSetupScript_Timeout tests that setup script timeout is handled correctly
func TestRunSetupScript_Timeout(t *testing.T) {
	// Create a script that sleeps longer than the timeout
	tmpDir := t.TempDir()
	scriptPath := tmpDir + "/test-setup.sh"
	scriptContent := "#!/bin/sh\necho 'Starting setup'\nsleep 10\necho 'Done'\nexit 0\n"
	err := os.WriteFile(scriptPath, []byte(scriptContent), 0755)
	if err != nil {
		t.Fatalf("should write test script: %v", err)
	}

	// Use a very short timeout (500ms)
	err = runSetupScript(scriptPath, 500*time.Millisecond)
	if err == nil {
		t.Fatal("should error on timeout")
	}
	if !strings.Contains(err.Error(), "timed out") {
		t.Errorf("error should mention timeout, got: %v", err)
	}
}

// TestRunSetupScript_PermissionDenied tests handling of non-executable script
// This test only works reliably on Linux where execute permissions are strictly enforced
func TestRunSetupScript_PermissionDenied(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Skipping: permission denied is only reliably testable on Linux")
	}

	// Create a script that's not executable
	tmpDir := t.TempDir()
	scriptPath := tmpDir + "/test-setup.sh"
	scriptContent := "#!/bin/sh\necho 'Setup'\nexit 0\n"
	err := os.WriteFile(scriptPath, []byte(scriptContent), 0644) // Not executable
	if err != nil {
		t.Fatalf("should write test script: %v", err)
	}

	err = runSetupScript(scriptPath, 10*time.Minute)
	if err == nil {
		t.Fatal("should error on permission denied")
	}
}

// TestBuildStartRequestFromArgs_BasicCommand tests building request from simple command
func TestBuildStartRequestFromArgs_BasicCommand(t *testing.T) {
	args := []string{"npm", "run", "dev"}

	req := buildStartRequestFromArgs(args)

	if req.Command != "npm run dev" {
		t.Errorf("command should be 'npm run dev', got %q", req.Command)
	}
	if len(req.Env) == 0 {
		t.Error("should have environment variables")
	}
	if req.WorkingDir == "" {
		t.Error("should have working directory")
	}
}

// TestBuildStartRequestFromArgs_EnvironmentVariables tests that environment is copied
func TestBuildStartRequestFromArgs_EnvironmentVariables(t *testing.T) {
	// Set a test environment variable
	testKey := "TEST_VAR_FOR_BUILD_REQUEST"
	testValue := "test-value-123"
	t.Setenv(testKey, testValue)

	args := []string{"echo", "test"}
	req := buildStartRequestFromArgs(args)

	// Verify the test env var is in the request
	if req.Env[testKey] != testValue {
		t.Errorf("should include test environment variable, got %q", req.Env[testKey])
	}

	// Verify common env vars are present
	if path, ok := req.Env["PATH"]; ok {
		if path == "" {
			t.Error("PATH should not be empty if present")
		}
	}
}

// TestBuildStartRequestFromArgs_WorkingDirectory tests working directory logic
func TestBuildStartRequestFromArgs_WorkingDirectory(t *testing.T) {
	args := []string{"test"}

	req := buildStartRequestFromArgs(args)

	// Working directory should be /app if it exists, otherwise current directory
	// We can't easily control whether /app exists in the test environment,
	// but we can verify it's set to something reasonable
	if req.WorkingDir == "" {
		t.Error("working directory should be set")
	}
	if !strings.HasPrefix(req.WorkingDir, "/") && !strings.Contains(req.WorkingDir, ":") {
		t.Errorf("working directory should be an absolute path, got %q", req.WorkingDir)
	}
}

// TestBuildStartRequestFromArgs_ComplexCommand tests command with special characters
func TestBuildStartRequestFromArgs_ComplexCommand(t *testing.T) {
	args := []string{"sh", "-c", "echo 'hello world' && npm run dev"}

	req := buildStartRequestFromArgs(args)

	expectedCommand := "sh -c echo 'hello world' && npm run dev"
	if req.Command != expectedCommand {
		t.Errorf("should preserve complex command structure, got %q", req.Command)
	}
}

// TestBuildStartRequestFromArgs_EmptyArgs tests handling of empty arguments
func TestBuildStartRequestFromArgs_EmptyArgs(t *testing.T) {
	args := []string{}

	req := buildStartRequestFromArgs(args)

	if req.Command != "" {
		t.Errorf("empty args should result in empty command, got %q", req.Command)
	}
	if req.Env == nil {
		t.Error("should still have environment map")
	}
	if req.WorkingDir == "" {
		t.Error("should still have working directory")
	}
}

// TestBuildStartRequestFromArgs_SingleArg tests single argument command
func TestBuildStartRequestFromArgs_SingleArg(t *testing.T) {
	args := []string{"sleep", "10"}

	req := buildStartRequestFromArgs(args)

	if req.Command != "sleep 10" {
		t.Errorf("should join multiple args with spaces, got %q", req.Command)
	}
}
