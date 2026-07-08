package main

import (
	"net"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/airo-ai-builder/dev-supervisor/internal/config"
	"github.com/airo-ai-builder/dev-supervisor/internal/email"
	emailhttp "github.com/airo-ai-builder/dev-supervisor/internal/proxy/emailhttp"
	httpproxy "github.com/airo-ai-builder/dev-supervisor/internal/proxy/http"
	smtpproxy "github.com/airo-ai-builder/dev-supervisor/internal/proxy/smtp"
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

// TestDetectStartupMode_NoAppDir tests that when no app dir is configured,
// it returns "first-start" (default mode)
func TestDetectStartupMode_NoAppDir(t *testing.T) {
	mode, err := detectStartupMode("")
	if err != nil {
		t.Fatalf("should not error when no app dir configured: %v", err)
	}
	if mode != startupModeFirstStart {
		t.Errorf("expected mode %q when no app dir configured, got: %s", startupModeFirstStart, mode)
	}
}

// TestDetectStartupMode_FirstStart tests detecting first-start mode (.git/config missing)
func TestDetectStartupMode_FirstStart(t *testing.T) {
	// Create a temporary directory without .git/config
	tmpDir := t.TempDir()

	mode, err := detectStartupMode(tmpDir)
	if err != nil {
		t.Fatalf("should not error when .git/config missing: %v", err)
	}
	if mode != startupModeFirstStart {
		t.Errorf("expected mode %q, got: %s", startupModeFirstStart, mode)
	}
}

// TestDetectStartupMode_Restart tests detecting restart mode (.git/config exists)
func TestDetectStartupMode_Restart(t *testing.T) {
	// Create a temporary directory with .git/config
	tmpDir := t.TempDir()
	gitDir := filepath.Join(tmpDir, ".git")
	if err := os.Mkdir(gitDir, 0755); err != nil {
		t.Fatalf("should create .git directory: %v", err)
	}
	gitConfigPath := filepath.Join(gitDir, "config")
	if err := os.WriteFile(gitConfigPath, []byte("[core]\n"), 0644); err != nil {
		t.Fatalf("should create .git/config: %v", err)
	}

	mode, err := detectStartupMode(tmpDir)
	if err != nil {
		t.Fatalf("should not error when .git/config exists: %v", err)
	}
	if mode != startupModeRestart {
		t.Errorf("expected mode %q, got: %s", startupModeRestart, mode)
	}
}

// TestDetectStartupMode_ErrorAccess tests handling of I/O errors
func TestDetectStartupMode_ErrorAccess(t *testing.T) {
	// Test with a path that's guaranteed not to exist and can't be created
	// This tests the error handling path when os.Stat fails
	mode, err := detectStartupMode("/nonexistent/path/that/does/not/exist")
	if err != nil {
		// Error is expected when the app dir doesn't exist
		// In practice, CUSTOMER_APP_DIR will always exist in the container
		// but we test error handling for robustness
		if mode != "" {
			t.Errorf("mode should be empty on error, got: %s", mode)
		}
		// This is the expected behavior - error when app dir doesn't exist
		return
	}
	// If no error, the function should still return a valid mode
	// (This can happen on some filesystems where stat succeeds even for non-existent paths)
	if mode != startupModeFirstStart {
		t.Errorf("expected %q mode when .git/config can't be found, got: %s", startupModeFirstStart, mode)
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

func TestStopProxyListeners_FreesPortsImmediately(t *testing.T) {
	t.Parallel()

	identity := email.Identity{AppID: "test-app"}

	smtp := smtpproxy.NewForTesting("127.0.0.1:0", "127.0.0.1:9925", nil, identity)
	smtp.SetListenRetry(1, time.Millisecond)
	if err := smtp.Start(); err != nil {
		t.Fatalf("smtp start: %v", err)
	}

	gateway := emailhttp.NewForTesting(
		"127.0.0.1:0", "127.0.0.1:9925",
		func() (email.Identity, error) { return identity, nil },
		nil, nil, true,
	)
	gateway.SetListenRetry(1, time.Millisecond)
	if err := gateway.Start(); err != nil {
		t.Fatalf("gateway start: %v", err)
	}

	// HTTPProxy rejects port 0 in validateConfig, so grab an ephemeral port
	// and immediately start the proxy. Retry the grab→start sequence because
	// another parallel test can steal the port between Close and Start.
	var hp *httpproxy.HTTPProxy
	for attempt := range 5 {
		tmp, listenErr := net.Listen("tcp", ":0")
		if listenErr != nil {
			t.Fatalf("grab ephemeral port: %v", listenErr)
		}
		httpPort := tmp.Addr().(*net.TCPAddr).Port
		tmp.Close()

		hp = httpproxy.NewHTTPProxy(httpproxy.Config{
			Enabled:    true,
			ListenPort: httpPort,
			TargetHost: "127.0.0.1",
			TargetPort: 9999,
		})
		hp.SetListenRetry(1, time.Millisecond)
		if startErr := hp.Start(); startErr == nil {
			break
		} else if attempt == 4 {
			t.Fatalf("http proxy start (5 attempts): %v", startErr)
		}
	}

	smtpAddr := smtp.Addr()
	gatewayAddr := gateway.Addr()
	httpAddr := hp.Addr()

	s := &Server{
		smtpProxy:    smtp,
		emailGateway: gateway,
		httpProxy:    hp,
	}

	s.stopProxyListeners()

	// Ports must be re-bindable after stop. The HTTP proxy binds on [::]
	// (dual-stack wildcard); on Linux the kernel may take a brief moment to
	// fully release such ports after the listener FD is closed.
	deadline := time.Now().Add(500 * time.Millisecond)
	for _, addr := range []string{smtpAddr, gatewayAddr, httpAddr} {
		var bindErr error
		for time.Now().Before(deadline) {
			ln, err := net.Listen("tcp", addr)
			if err == nil {
				ln.Close()
				bindErr = nil
				break
			}
			bindErr = err
			time.Sleep(10 * time.Millisecond)
		}
		if bindErr != nil {
			t.Errorf("port %s not free after stopProxyListeners: %v", addr, bindErr)
		}
	}

	// Idempotent: second call must not error.
	s.stopProxyListeners()
}
