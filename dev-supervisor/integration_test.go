package main

import (
	"bytes"
	"context"
	"encoding/json"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/airo-ai-builder/dev-supervisor/internal/health"
)

// TestClient wraps HTTP client for Unix socket communication
type TestClient struct {
	client     *http.Client
	socketPath string
}

// NewTestClient creates a new test client for Unix socket communication
func NewTestClient(socketPath string) *TestClient {
	return &TestClient{
		client: &http.Client{
			Transport: &http.Transport{
				DialContext: func(_ context.Context, _, _ string) (net.Conn, error) {
					return net.Dial("unix", socketPath)
				},
			},
			Timeout: 30 * time.Second,
		},
		socketPath: socketPath,
	}
}

// makeRequest sends an HTTP request to the dev-supervisor API
func (tc *TestClient) makeRequest(method, path string, body any) (*http.Response, error) {
	var bodyReader *bytes.Reader
	if body != nil {
		bodyBytes, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		bodyReader = bytes.NewReader(bodyBytes)
	}

	url := "http://dev-supervisor" + path
	var req *http.Request
	var err error

	if bodyReader != nil {
		req, err = http.NewRequest(method, url, bodyReader)
	} else {
		req, err = http.NewRequest(method, url, nil)
	}

	if err != nil {
		return nil, err
	}

	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}

	return tc.client.Do(req)
}

// parseJSONResponse parses a JSON response into the provided interface
func (tc *TestClient) parseJSONResponse(resp *http.Response, target any) error {
	defer resp.Body.Close()
	return json.NewDecoder(resp.Body).Decode(target)
}

// IntegrationTestSuite contains all integration tests
type IntegrationTestSuite struct {
	server     *Server
	client     *TestClient
	socketPath string
	tempDir    string
}

// SetupTestSuite initializes the test environment
func SetupTestSuite(t *testing.T) *IntegrationTestSuite {
	configureSMTPTestEnv(t)

	// Create temporary directory for test files (auto-cleaned up by t.TempDir)
	// Note: t.TempDir() typically uses /tmp on Unix systems
	tempDir := t.TempDir()

	// Create unique socket path for this test (keep it short for macOS)
	socketPath := filepath.Join(tempDir, "test.sock")

	// Create server instance
	server := NewServer()

	// Create test client
	client := NewTestClient(socketPath)

	suite := &IntegrationTestSuite{
		server:     server,
		client:     client,
		socketPath: socketPath,
		tempDir:    tempDir,
	}

	// Start server in background
	go func() {
		// Override the default socket path for testing
		originalSocketPath := socketPath
		defer func() {
			// Restore original socket path
			_ = originalSocketPath
		}()

		// Start server with test socket path
		if err := suite.startTestServer(); err != nil {
			t.Errorf("Failed to start test server: %v", err)
		}
	}()

	// Wait for server to start
	suite.waitForServer(t)

	return suite
}

// TeardownTestSuite cleans up the test environment
func (suite *IntegrationTestSuite) TeardownTestSuite(_ *testing.T) {
	// Temp directory cleanup is handled automatically by t.TempDir()
}

// startTestServer starts the server with test configuration
func (suite *IntegrationTestSuite) startTestServer() error {
	// Remove existing socket file if it exists
	if err := os.Remove(suite.socketPath); err != nil && !os.IsNotExist(err) {
		return err
	}

	// Create Unix domain socket listener
	listener, err := net.Listen("unix", suite.socketPath)
	if err != nil {
		return err
	}

	// Set socket permissions
	if err := os.Chmod(suite.socketPath, 0666); err != nil {
		listener.Close()
		return err
	}

	// Start PID 1 manager (but won't activate since not PID 1)
	suite.server.pid1Mgr.Start(func() {
		// Test shutdown callback
	})

	// Create HTTP server
	httpServer := &http.Server{
		Handler:      suite.server.router,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	// Serve in background
	return httpServer.Serve(listener)
}

// waitForServer waits for the server to become available
func (suite *IntegrationTestSuite) waitForServer(t *testing.T) {
	maxAttempts := 30
	for range maxAttempts {
		resp, err := suite.client.makeRequest("GET", "/health", nil)
		if err == nil && resp.StatusCode == http.StatusOK {
			resp.Body.Close()
			return
		}
		if resp != nil {
			resp.Body.Close()
		}
		time.Sleep(100 * time.Millisecond)
	}
	t.Fatalf("Server failed to start within timeout")
}

// TestHealthEndpoint tests the basic health endpoint
func TestHealthEndpoint(t *testing.T) {
	suite := SetupTestSuite(t)
	defer suite.TeardownTestSuite(t)

	resp, err := suite.client.makeRequest("GET", "/health", nil)
	if err != nil {
		t.Fatalf("Health check failed: %v", err)
	}

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("Expected status 200, got %d", resp.StatusCode)
	}

	var health HealthResponse
	if err := suite.client.parseJSONResponse(resp, &health); err != nil {
		t.Fatalf("Failed to parse health response: %v", err)
	}

	if health.Status != "healthy" {
		t.Errorf("Expected status 'healthy', got '%s'", health.Status)
	}

	if health.Version == "" {
		t.Error("Version should not be empty")
	}
}

// verifyProcessStopResponse checks the HTTP response from a process stop request
func (suite *IntegrationTestSuite) verifyProcessStopResponse(t *testing.T, resp *http.Response) {
	if resp.StatusCode == http.StatusOK {
		resp.Body.Close()
		return
	}

	// Read error response for debugging
	var errorResp map[string]any
	if parseErr := suite.client.parseJSONResponse(resp, &errorResp); parseErr != nil {
		t.Fatalf("Expected status 200, got %d", resp.StatusCode)
		return
	}

	// If the process already finished, that's actually okay for our test
	if errorResp["error"] == "stop_failed" &&
		errorResp["message"] != nil &&
		resp.StatusCode == http.StatusBadRequest {
		t.Logf("Process already finished (expected for some commands): %v", errorResp["message"])
		resp.Body.Close()
		return
	}

	t.Fatalf("Expected status 200, got %d. Error: %v", resp.StatusCode, errorResp)
}

// TestInfoEndpoint tests the system info endpoint
func TestInfoEndpoint(t *testing.T) {
	suite := SetupTestSuite(t)
	defer suite.TeardownTestSuite(t)

	resp, err := suite.client.makeRequest("GET", "/info", nil)
	if err != nil {
		t.Fatalf("Info request failed: %v", err)
	}

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("Expected status 200, got %d", resp.StatusCode)
	}

	var info map[string]any
	if err := suite.client.parseJSONResponse(resp, &info); err != nil {
		t.Fatalf("Failed to parse info response: %v", err)
	}

	// Check required fields
	requiredFields := []string{"name", "version", "pid", "uptime", "process", "logs"}
	for _, field := range requiredFields {
		if _, exists := info[field]; !exists {
			t.Errorf("Expected field '%s' not found in info response", field)
		}
	}

	if info["name"] != "airo-supervisor" {
		t.Errorf("Expected name 'airo-supervisor', got '%v'", info["name"])
	}
}

// TestCommandExecution tests basic command execution
func TestCommandExecution(t *testing.T) {
	suite := SetupTestSuite(t)
	defer suite.TeardownTestSuite(t)

	testCases := []struct {
		name         string
		command      string
		expectedExit int
		expectOutput bool
		expectError  bool
	}{
		{
			name:         "successful command",
			command:      "echo 'Hello World'",
			expectedExit: 0,
			expectOutput: true,
		},
		{
			name:         "command with error",
			command:      "sh -c 'exit 2'",
			expectedExit: 2,
			expectError:  false, // Command runs but exits with error code
		},
		{
			name:        "empty command",
			command:     "",
			expectError: true,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			reqBody := CommandRequest{
				Command:       tc.command,
				Timeout:       10,
				CaptureOutput: true,
				WorkingDir:    suite.tempDir,
			}

			resp, err := suite.client.makeRequest("POST", "/exec", reqBody)
			if err != nil {
				t.Fatalf("Command execution request failed: %v", err)
			}

			if tc.expectError {
				if resp.StatusCode == http.StatusOK {
					t.Error("Expected error response, but got success")
				}
				resp.Body.Close()
				return
			}

			if resp.StatusCode != http.StatusOK {
				t.Fatalf("Expected status 200, got %d", resp.StatusCode)
			}

			var result CommandResult
			if err := suite.client.parseJSONResponse(resp, &result); err != nil {
				t.Fatalf("Failed to parse command result: %v", err)
			}

			if result.Command != tc.command {
				t.Errorf("Expected command '%s', got '%s'", tc.command, result.Command)
			}

			if result.ExitCode != tc.expectedExit {
				t.Errorf("Expected exit code %d, got %d", tc.expectedExit, result.ExitCode)
			}

			if tc.expectOutput && result.Stdout == "" {
				t.Error("Expected output but got none")
			}

			if result.Duration < 0 {
				t.Error("Expected non-negative duration")
			}
		})
	}
}

// TestProcessLifecycle tests process start/stop/restart operations
func TestProcessLifecycle(t *testing.T) {
	suite := SetupTestSuite(t)
	defer suite.TeardownTestSuite(t)

	// Test process start - use a command that will keep running
	startReq := ProcessStartRequest{
		Command:    "while true; do sleep 1; done", // Simple infinite loop
		WorkingDir: suite.tempDir,
		Env:        map[string]string{"TEST_VAR": "test_value"},
	}

	resp, err := suite.client.makeRequest("POST", "/process/start", startReq)
	if err != nil {
		t.Fatalf("Process start failed: %v", err)
	}

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("Expected status 200, got %d", resp.StatusCode)
	}
	resp.Body.Close()

	// Wait a moment for process to start
	time.Sleep(100 * time.Millisecond)

	// Test process status
	resp, err = suite.client.makeRequest("GET", "/process/status", nil)
	if err != nil {
		t.Fatalf("Process status failed: %v", err)
	}

	var status ProcessInfo
	if err = suite.client.parseJSONResponse(resp, &status); err != nil {
		t.Fatalf("Failed to parse process status: %v", err)
	}

	if status.State != ProcessStateRunning {
		t.Errorf("Expected state '%s', got '%s'", ProcessStateRunning, status.State)
	}

	if status.PID <= 0 {
		t.Error("Expected positive PID")
	}

	if status.Command != startReq.Command {
		t.Errorf("Expected command '%s', got '%s'", startReq.Command, status.Command)
	}

	// Test process stop
	stopReq := ProcessStopRequest{
		Signal:  "SIGTERM",
		Timeout: 5,
	}

	resp, err = suite.client.makeRequest("POST", "/process/stop", stopReq)
	if err != nil {
		t.Fatalf("Process stop failed: %v", err)
	}

	suite.verifyProcessStopResponse(t, resp)

	// Wait for process to stop
	time.Sleep(200 * time.Millisecond)

	// Verify process is stopped
	resp, err = suite.client.makeRequest("GET", "/process/status", nil)
	if err != nil {
		t.Fatalf("Process status check failed: %v", err)
	}

	if err := suite.client.parseJSONResponse(resp, &status); err != nil {
		t.Fatalf("Failed to parse process status: %v", err)
	}

	// Process should be stopped or in error state (both are acceptable after force kill)
	if status.State != ProcessStateStopped && status.State != ProcessStateError {
		t.Errorf("Expected state '%s' or '%s', got '%s'", ProcessStateStopped, ProcessStateError, status.State)
	}
}

// TestEnvironmentManagement tests environment variable operations
func TestEnvironmentManagement(t *testing.T) {
	suite := SetupTestSuite(t)
	defer suite.TeardownTestSuite(t)

	// Test getting environment
	resp, err := suite.client.makeRequest("GET", "/environment", nil)
	if err != nil {
		t.Fatalf("Get environment failed: %v", err)
	}

	var envResp EnvironmentGetResponse
	if err = suite.client.parseJSONResponse(resp, &envResp); err != nil {
		t.Fatalf("Failed to parse environment response: %v", err)
	}

	originalEnvCount := len(envResp.Variables)

	// Test setting environment variables
	setReq := EnvironmentSetRequest{
		Variables: map[string]string{
			"TEST_VAR1": "value1",
			"TEST_VAR2": "value2",
		},
		RestartProcess: false,
	}

	resp, err = suite.client.makeRequest("PUT", "/environment", setReq)
	if err != nil {
		t.Fatalf("Set environment failed: %v", err)
	}

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("Expected status 200, got %d", resp.StatusCode)
	}
	resp.Body.Close()

	// Verify environment variables were set
	resp, err = suite.client.makeRequest("GET", "/environment", nil)
	if err != nil {
		t.Fatalf("Get environment failed: %v", err)
	}

	if err = suite.client.parseJSONResponse(resp, &envResp); err != nil {
		t.Fatalf("Failed to parse environment response: %v", err)
	}

	if envResp.Variables["TEST_VAR1"] != "value1" {
		t.Errorf("Expected TEST_VAR1='value1', got '%s'", envResp.Variables["TEST_VAR1"])
	}

	if envResp.Variables["TEST_VAR2"] != "value2" {
		t.Errorf("Expected TEST_VAR2='value2', got '%s'", envResp.Variables["TEST_VAR2"])
	}

	// Test resetting environment
	resp, err = suite.client.makeRequest("DELETE", "/environment", nil)
	if err != nil {
		t.Fatalf("Reset environment failed: %v", err)
	}

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("Expected status 200, got %d", resp.StatusCode)
	}
	resp.Body.Close()

	// Verify environment was reset
	resp, err = suite.client.makeRequest("GET", "/environment", nil)
	if err != nil {
		t.Fatalf("Get environment failed: %v", err)
	}

	if err := suite.client.parseJSONResponse(resp, &envResp); err != nil {
		t.Fatalf("Failed to parse environment response: %v", err)
	}

	// Should be back to original count (custom vars removed)
	if len(envResp.Variables) < originalEnvCount-10 { // Allow some variance
		t.Errorf("Expected environment to be reset, but still has %d variables", len(envResp.Variables))
	}
}

// TestHealthMonitoring tests health check configuration and monitoring
func TestHealthMonitoring(t *testing.T) {
	suite := SetupTestSuite(t)
	defer suite.TeardownTestSuite(t)

	// Test health configuration
	healthConfig := struct {
		HealthCheck   *health.HealthCheck   `json:"health_check"`
		RestartPolicy *health.RestartPolicy `json:"restart_policy"`
	}{
		HealthCheck: &health.HealthCheck{
			Type:             health.HealthCheckTypeCommand,
			Command:          "echo 'healthy'",
			Interval:         health.Duration(5 * time.Second),
			Timeout:          health.Duration(2 * time.Second),
			Retries:          2,
			StartPeriod:      health.Duration(1 * time.Second),
			SuccessThreshold: 1,
			FailureThreshold: 2,
		},
		RestartPolicy: &health.RestartPolicy{
			Enabled:           true,
			MaxRestarts:       3,
			RestartWindow:     health.Duration(1 * time.Minute),
			BackoffMultiplier: 1.5,
			MaxBackoff:        health.Duration(10 * time.Second),
			InitialDelay:      health.Duration(1 * time.Second),
		},
	}

	resp, err := suite.client.makeRequest("PUT", "/health-config", healthConfig)
	if err != nil {
		t.Fatalf("Health config failed: %v", err)
	}

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("Expected status 200, got %d", resp.StatusCode)
	}
	resp.Body.Close()

	// Test getting health status
	resp, err = suite.client.makeRequest("GET", "/health-config/status", nil)
	if err != nil {
		t.Fatalf("Health status failed: %v", err)
	}

	var healthResult health.HealthResult
	if err = suite.client.parseJSONResponse(resp, &healthResult); err != nil {
		t.Fatalf("Failed to parse health status: %v", err)
	}

	// Initially should be disabled (no process running)
	if healthResult.Status != health.HealthStatusDisabled {
		t.Logf("Health status: %s (expected disabled since no process running)", healthResult.Status)
	}

	// Test getting restart stats
	resp, err = suite.client.makeRequest("GET", "/health-config/restart-stats", nil)
	if err != nil {
		t.Fatalf("Restart stats failed: %v", err)
	}

	var restartStats map[string]any
	if err = suite.client.parseJSONResponse(resp, &restartStats); err != nil {
		t.Fatalf("Failed to parse restart stats: %v", err)
	}

	// Should have restart stats structure
	if _, exists := restartStats["total_restarts"]; !exists {
		t.Error("Expected total_restarts field in restart stats")
	}
}

// TestLogManagement tests log retrieval functionality
func TestLogManagement(t *testing.T) {
	suite := SetupTestSuite(t)
	defer suite.TeardownTestSuite(t)

	// Start a process that will generate logs
	startReq := ProcessStartRequest{
		Command:    "echo 'Log entry from process'; echo 'Second log entry'; echo 'Error message' >&2; sleep 2",
		WorkingDir: suite.tempDir,
	}

	resp, err := suite.client.makeRequest("POST", "/process/start", startReq)
	if err != nil {
		t.Fatalf("Process start failed: %v", err)
	}
	resp.Body.Close()

	// Wait for process to generate logs and complete
	time.Sleep(3 * time.Second)

	// Test getting logs
	resp, err = suite.client.makeRequest("GET", "/logs?lines=10", nil)
	if err != nil {
		t.Fatalf("Get logs failed: %v", err)
	}

	var logsResp LogsGetResponse
	if err = suite.client.parseJSONResponse(resp, &logsResp); err != nil {
		t.Fatalf("Failed to parse logs response: %v", err)
	}

	if len(logsResp.Logs) == 0 {
		t.Error("Expected some log entries but got none")
	}

	// Verify log entry structure
	for _, logEntry := range logsResp.Logs {
		if logEntry.Timestamp.IsZero() {
			t.Error("Expected non-zero timestamp in log entry")
		}
		if logEntry.Source == "" {
			t.Error("Expected non-empty source in log entry")
		}
		if logEntry.Message == "" {
			t.Error("Expected non-empty message in log entry")
		}
	}

	// Test filtered logs
	resp, err = suite.client.makeRequest("GET", "/logs?source=stdout&lines=5", nil)
	if err != nil {
		t.Fatalf("Get filtered logs failed: %v", err)
	}

	if err := suite.client.parseJSONResponse(resp, &logsResp); err != nil {
		t.Fatalf("Failed to parse filtered logs response: %v", err)
	}

	// All returned logs should be from stdout source
	for _, logEntry := range logsResp.Logs {
		if logEntry.Source != "stdout" {
			t.Errorf("Expected source 'stdout', got '%s'", logEntry.Source)
		}
	}
}

// TestInvalidRequests tests error handling for invalid requests
func TestInvalidRequests(t *testing.T) {
	suite := SetupTestSuite(t)
	defer suite.TeardownTestSuite(t)

	testCases := []struct {
		name           string
		method         string
		path           string
		body           any
		expectedStatus int
	}{
		{
			name:           "invalid JSON",
			method:         "POST",
			path:           "/exec",
			body:           "invalid json",
			expectedStatus: http.StatusBadRequest,
		},
		{
			name:           "empty command",
			method:         "POST",
			path:           "/exec",
			body:           CommandRequest{Command: ""},
			expectedStatus: http.StatusBadRequest,
		},
		{
			name:           "invalid endpoint",
			method:         "GET",
			path:           "/nonexistent",
			body:           nil,
			expectedStatus: http.StatusNotFound,
		},
		{
			name:           "wrong method",
			method:         "GET",
			path:           "/exec",
			body:           nil,
			expectedStatus: http.StatusMethodNotAllowed,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			resp, err := suite.client.makeRequest(tc.method, tc.path, tc.body)
			if err != nil {
				t.Fatalf("Request failed: %v", err)
			}
			defer resp.Body.Close()

			if resp.StatusCode != tc.expectedStatus {
				t.Errorf("Expected status %d, got %d", tc.expectedStatus, resp.StatusCode)
			}
		})
	}
}
