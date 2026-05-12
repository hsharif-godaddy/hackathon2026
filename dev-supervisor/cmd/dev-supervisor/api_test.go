package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/airo-ai-builder/dev-supervisor/internal/health"
	"github.com/airo-ai-builder/dev-supervisor/internal/logs"
	"github.com/airo-ai-builder/dev-supervisor/internal/processmanager"
	"github.com/airo-ai-builder/dev-supervisor/internal/validation"
)

const (
	contentTypeJSON   = "application/json"
	invalidRequestErr = "invalid_request"
)

// testScriptDir is the absolute path to pre-created executable test scripts in testdata.
// Using checked-in scripts avoids the ETXTBSY race (https://go.dev/issue/22315) where
// writing a script at test time can leak a write FD into a concurrent fork+exec's child.
// Resolved to absolute because RunSetupScriptInternal sets cmd.Dir = "/".
var testScriptDir string

func TestMain(m *testing.M) {
	abs, err := filepath.Abs("testdata/scripts")
	if err != nil {
		panic("failed to resolve testdata/scripts: " + err.Error())
	}
	testScriptDir = abs
	os.Exit(m.Run())
}

// Test helper function to marshal JSON with error handling
func mustMarshalJSON(t *testing.T, v any) []byte {
	t.Helper()
	data, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("Failed to marshal JSON: %v", err)
	}
	return data
}

func TestHandleHealth(t *testing.T) {
	t.Parallel()

	server := NewServer()
	server.startTime = time.Now().Add(-5 * time.Minute) // Set server as running for 5 minutes

	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	w := httptest.NewRecorder()

	server.handleHealth(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status code 200, got %d", w.Code)
	}

	var response HealthResponse
	if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}

	if response.Status != "healthy" {
		t.Errorf("Expected status 'healthy', got '%s'", response.Status)
	}

	if response.Version != Version {
		t.Errorf("Expected version '%s', got '%s'", Version, response.Version)
	}

	if response.Uptime == "" {
		t.Error("Expected uptime to be set")
	}

	// Check content type
	expectedContentType := contentTypeJSON
	contentType := w.Header().Get("Content-Type")
	if contentType != expectedContentType {
		t.Errorf("Expected Content-Type '%s', got '%s'", expectedContentType, contentType)
	}
}

func TestHandleInfo(t *testing.T) {
	t.Parallel()

	server := NewServer()
	server.startTime = time.Now().Add(-10 * time.Minute)

	req := httptest.NewRequest(http.MethodGet, "/info", nil)
	w := httptest.NewRecorder()

	server.handleInfo(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status code 200, got %d", w.Code)
	}

	var response map[string]any
	if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}

	// Check required fields
	expectedFields := []string{
		"name",
		"version",
		"pid",
		"is_pid1",
		"socket_path",
		"uptime",
		"process",
		"health",
		"restarts",
		"logs",
		"child_count",
		"shutting_down",
	}
	for _, field := range expectedFields {
		if _, exists := response[field]; !exists {
			t.Errorf("Expected field '%s' in info response", field)
		}
	}

	if response["name"] != AppName {
		t.Errorf("Expected name '%s', got '%v'", AppName, response["name"])
	}

	if response["version"] != Version {
		t.Errorf("Expected version '%s', got '%v'", Version, response["version"])
	}
}

func TestHandleProcessStart(t *testing.T) {
	t.Parallel()

	server := NewServer()

	// Test valid request
	startReq := validation.ProcessStartRequest{
		Command:    "echo 'test process'",
		WorkingDir: "/tmp",
	}

	reqBody := mustMarshalJSON(t, startReq)
	req := httptest.NewRequest(http.MethodPost, "/process/start", bytes.NewBuffer(reqBody))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	server.handleProcessStart(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status code 200, got %d", w.Code)
	}

	var response map[string]string
	if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}

	if response["status"] != "started" {
		t.Errorf("Expected status 'started', got '%s'", response["status"])
	}

	// Clean up - stop the process
	stopReq := processmanager.ProcessStopRequest{
		Signal:  "SIGKILL",
		Timeout: 1,
	}
	if err := server.procMgr.Stop(stopReq); err != nil {
		t.Logf("Failed to stop test process: %v", err)
	}
}

func TestHandleProcessStartInvalidJSON(t *testing.T) {
	t.Parallel()

	server := NewServer()

	// Test invalid JSON
	req := httptest.NewRequest(http.MethodPost, "/process/start", strings.NewReader("invalid json"))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	server.handleProcessStart(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("Expected status code 400, got %d", w.Code)
	}

	var response ErrorResponse
	if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
		t.Fatalf("Failed to decode error response: %v", err)
	}

	if response.Error != invalidRequestErr {
		t.Errorf("Expected error 'invalid_request', got '%s'", response.Error)
	}
}

func TestHandleProcessStartEmptyCommand(t *testing.T) {
	t.Parallel()

	server := NewServer()

	// Test empty command
	startReq := validation.ProcessStartRequest{
		Command: "",
	}

	reqBody := mustMarshalJSON(t, startReq)
	req := httptest.NewRequest(http.MethodPost, "/process/start", bytes.NewBuffer(reqBody))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	server.handleProcessStart(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("Expected status code 400, got %d", w.Code)
	}
}

func TestHandleProcessStatus(t *testing.T) {
	t.Parallel()

	server := NewServer()

	req := httptest.NewRequest(http.MethodGet, "/process/status", nil)
	w := httptest.NewRecorder()

	server.handleProcessStatus(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status code 200, got %d", w.Code)
	}

	var response processmanager.ProcessInfo
	if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}

	// Should be stopped initially
	if response.State != processmanager.ProcessStateStopped {
		t.Errorf("Expected state '%s', got '%s'", processmanager.ProcessStateStopped, response.State)
	}
}

func TestHandleProcessStop(t *testing.T) {
	t.Parallel()

	server := NewServer()

	// First start a process
	startReq := validation.ProcessStartRequest{
		Command:    "sleep 10",
		WorkingDir: "/tmp",
	}
	if err := server.procMgr.Start(startReq); err != nil {
		t.Fatalf("Failed to start test process: %v", err)
	}

	// Wait for process to start
	time.Sleep(100 * time.Millisecond)

	// Now test stopping it
	stopReq := processmanager.ProcessStopRequest{
		Signal:  "SIGTERM",
		Timeout: 5,
	}

	reqBody := mustMarshalJSON(t, stopReq)
	req := httptest.NewRequest(http.MethodPost, "/process/stop", bytes.NewBuffer(reqBody))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	server.handleProcessStop(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status code 200, got %d", w.Code)
	}

	var response map[string]string
	if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}

	if response["status"] != "stopped" {
		t.Errorf("Expected status 'stopped', got '%s'", response["status"])
	}
}

func TestHandleProcessRestart(t *testing.T) {
	t.Parallel()

	server := NewServer()

	// First start a process
	startReq := validation.ProcessStartRequest{
		Command:    "sleep 30",
		WorkingDir: "/tmp",
	}
	if err := server.procMgr.Start(startReq); err != nil {
		t.Fatalf("Failed to start test process: %v", err)
	}

	// Wait for process to start
	time.Sleep(100 * time.Millisecond)

	// Test restart
	restartReq := processmanager.ProcessRestartRequest{
		Graceful: true,
	}

	reqBody := mustMarshalJSON(t, restartReq)
	req := httptest.NewRequest(http.MethodPost, "/process/restart", bytes.NewBuffer(reqBody))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	server.handleProcessRestart(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status code 200, got %d", w.Code)
	}

	var response map[string]string
	if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}

	if response["status"] != "restarted" {
		t.Errorf("Expected status 'restarted', got '%s'", response["status"])
	}

	// Clean up
	stopReq := processmanager.ProcessStopRequest{Signal: "SIGKILL", Timeout: 1}
	if err := server.procMgr.Stop(stopReq); err != nil {
		t.Logf("Failed to stop test process: %v", err)
	}
}

func TestHandleExec(t *testing.T) {
	t.Parallel()

	server := NewServer()

	// Test successful command execution
	execReq := validation.CommandRequest{
		Command:       "echo 'hello world'",
		Timeout:       5,
		CaptureOutput: true,
	}

	reqBody := mustMarshalJSON(t, execReq)
	req := httptest.NewRequest(http.MethodPost, "/exec", bytes.NewBuffer(reqBody))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	server.handleExec(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status code 200, got %d", w.Code)
	}

	var response CommandResult
	if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}

	if response.Command != execReq.Command {
		t.Errorf("Expected command '%s', got '%s'", execReq.Command, response.Command)
	}

	if response.ExitCode != 0 {
		t.Errorf("Expected exit code 0, got %d", response.ExitCode)
	}

	if !strings.Contains(response.Stdout, "hello world") {
		t.Errorf("Expected stdout to contain 'hello world', got '%s'", response.Stdout)
	}
}

func TestHandleExecInvalidCommand(t *testing.T) {
	t.Parallel()

	server := NewServer()

	// Test empty command
	execReq := validation.CommandRequest{
		Command: "",
	}

	reqBody := mustMarshalJSON(t, execReq)
	req := httptest.NewRequest(http.MethodPost, "/exec", bytes.NewBuffer(reqBody))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	server.handleExec(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("Expected status code 400, got %d", w.Code)
	}
}

// TestHandleExec_TeesOutputToLogManager verifies that /exec output lines are
// mirrored into the ring buffer under a distinct Source="exec" with a
// non-zero CommandID. Using a distinct source prevents leaking orchestration
// output into customer-facing log surfaces (which filter to stdout/stderr),
// and the CommandID lets consumers scope queries to a single /exec call.
func TestHandleExec_TeesOutputToLogManager(t *testing.T) {
	t.Parallel()

	server := NewServer()

	execReq := validation.CommandRequest{
		Command:       "echo tee-stdout-line; echo tee-stderr-line >&2; exit 1",
		Timeout:       5,
		CaptureOutput: true,
	}

	reqBody := mustMarshalJSON(t, execReq)
	req := httptest.NewRequest(http.MethodPost, "/exec", bytes.NewBuffer(reqBody))
	req.Header.Set("Content-Type", contentTypeJSON)
	w := httptest.NewRecorder()

	server.handleExec(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf(
			"Expected status 200 (exec succeeded despite non-zero exit code), got %d: %s",
			w.Code, w.Body.String(),
		)
	}

	// /exec response must include command_id so callers can correlate.
	var resp struct {
		CommandResult

		CommandID uint64 `json:"command_id"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode exec response: %v", err)
	}
	if resp.CommandID == 0 {
		t.Fatal("expected non-zero command_id in /exec response")
	}

	execLogs, err := server.logMgr.GetLogs(logs.GetRequest{Source: "exec"})
	if err != nil {
		t.Fatalf("GetLogs Source=exec: %v", err)
	}
	// Both stdout and stderr lines land under Source="exec" — a single call
	// retrieves all of a command's output.
	if !containsLogMessage(execLogs.Logs, "tee-stdout-line") {
		t.Errorf("expected Source=exec to contain 'tee-stdout-line'; got %v", logMessages(execLogs.Logs))
	}
	if !containsLogMessage(execLogs.Logs, "tee-stderr-line") {
		t.Errorf("expected Source=exec to contain 'tee-stderr-line'; got %v", logMessages(execLogs.Logs))
	}
	// Every exec entry carries the same CommandID as the response.
	for _, e := range execLogs.Logs {
		if e.CommandID != resp.CommandID {
			t.Errorf("expected CommandID=%d on every exec entry; got %d for message %q",
				resp.CommandID, e.CommandID, e.Message)
		}
	}

	// Customer-log channel (source=stdout) must not contain exec output —
	// this is the leak guard. Managed-process entries would appear here; in
	// this test the managed process never ran, so stdout/stderr must be empty.
	stdoutLogs, err := server.logMgr.GetLogs(logs.GetRequest{Source: "stdout"})
	if err != nil {
		t.Fatalf("GetLogs Source=stdout: %v", err)
	}
	if containsLogMessage(stdoutLogs.Logs, "tee-stdout-line") {
		t.Error(
			"exec output leaked into Source=stdout — consumers filtering to stdout " +
				"will see orchestration logs",
		)
	}
}

// TestHandleExec_TruncatesOutputKeepingTail verifies that a chatty command
// does not unboundedly flood the ring buffer, and that the *tail* of the
// output is preserved — failure signals (error summaries, stack traces,
// non-zero exit messages) cluster at the end, so losing the tail would
// defeat the whole purpose.
func TestHandleExec_TruncatesOutputKeepingTail(t *testing.T) {
	t.Parallel()

	server := NewServer()

	// Emit twice the cap plus one final marker line, so we can assert
	// only the last maxExecLogLines landed and the final marker is
	// preserved.
	total := maxExecLogLines*2 + 1
	cmd := "for i in $(seq 1 " + strconv.Itoa(total-1) + "); do echo line-$i; done; echo FINAL-MARKER-LINE"
	execReq := validation.CommandRequest{
		Command:       cmd,
		Timeout:       30,
		CaptureOutput: true,
	}
	reqBody := mustMarshalJSON(t, execReq)
	req := httptest.NewRequest(http.MethodPost, "/exec", bytes.NewBuffer(reqBody))
	req.Header.Set("Content-Type", contentTypeJSON)
	w := httptest.NewRecorder()

	server.handleExec(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("Expected status 200, got %d: %s", w.Code, w.Body.String())
	}

	execLogs, err := server.logMgr.GetLogs(logs.GetRequest{Source: "exec"})
	if err != nil {
		t.Fatalf("GetLogs: %v", err)
	}

	if len(execLogs.Logs) > maxExecLogLines {
		t.Errorf("expected at most %d lines tee'd to ring buffer, got %d", maxExecLogLines, len(execLogs.Logs))
	}
	if !hasExactMessage(execLogs.Logs, "FINAL-MARKER-LINE") {
		t.Error("expected final output line to be preserved when truncating from the head")
	}
	// And the very first line must be gone — we're keeping the tail. Use
	// exact match here (not Contains) because "line-1" is a substring of
	// "line-1002", "line-1500", etc., which *are* retained.
	if hasExactMessage(execLogs.Logs, "line-1") {
		t.Error("expected earliest output line to be truncated, but it's still in the ring buffer")
	}
}

// TestHandleExec_CommandIDIncrementsAcrossCalls verifies that successive
// /exec calls receive distinct monotonic command_id values, so consumers
// can unambiguously scope GET /logs?command_id=N to a specific invocation.
func TestHandleExec_CommandIDIncrementsAcrossCalls(t *testing.T) {
	t.Parallel()

	server := NewServer()

	id1 := runExecForID(t, server, "echo first-call")
	id2 := runExecForID(t, server, "echo second-call")

	if id1 == 0 || id2 == 0 {
		t.Fatalf("expected non-zero command_ids, got id1=%d id2=%d", id1, id2)
	}
	if id2 <= id1 {
		t.Fatalf("expected monotonic increasing command_id (id1=%d < id2=%d)", id1, id2)
	}
}

// TestHandleLogs_FilterByCommandID verifies end-to-end that
// GET /logs?command_id=N restricts results to that invocation's entries.
func TestHandleLogs_FilterByCommandID(t *testing.T) {
	t.Parallel()

	server := NewServer()

	id1 := runExecForID(t, server, "echo alpha-line")
	id2 := runExecForID(t, server, "echo beta-line")

	// Filter to command 1 only.
	req := httptest.NewRequest(http.MethodGet,
		"/logs?source=exec&command_id="+strconv.FormatUint(id1, 10), nil)
	w := httptest.NewRecorder()
	server.handleLogs(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("handleLogs status=%d body=%s", w.Code, w.Body.String())
	}
	var resp logs.GetResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode logs response: %v", err)
	}
	if !containsLogMessage(resp.Logs, "alpha-line") {
		t.Errorf("expected command %d entries to include 'alpha-line'; got %v", id1, logMessages(resp.Logs))
	}
	if containsLogMessage(resp.Logs, "beta-line") {
		t.Errorf(
			"expected command_id=%d filter to exclude command %d's output; got %v",
			id1, id2, logMessages(resp.Logs),
		)
	}
}

// runExecForID is a small helper: run one /exec call against the server,
// assert it succeeded, and return the response's command_id.
func runExecForID(t *testing.T, server *Server, command string) uint64 {
	t.Helper()
	execReq := validation.CommandRequest{
		Command:       command,
		Timeout:       5,
		CaptureOutput: true,
	}
	req := httptest.NewRequest(http.MethodPost, "/exec",
		bytes.NewBuffer(mustMarshalJSON(t, execReq)))
	req.Header.Set("Content-Type", contentTypeJSON)
	w := httptest.NewRecorder()
	server.handleExec(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("handleExec(%q) status=%d body=%s", command, w.Code, w.Body.String())
	}
	var resp struct {
		CommandResult

		CommandID uint64 `json:"command_id"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode exec response: %v", err)
	}
	return resp.CommandID
}

func containsLogMessage(entries []logs.LogEntry, needle string) bool {
	for _, e := range entries {
		if strings.Contains(e.Message, needle) {
			return true
		}
	}
	return false
}

func hasExactMessage(entries []logs.LogEntry, want string) bool {
	for _, e := range entries {
		if e.Message == want {
			return true
		}
	}
	return false
}

func logMessages(entries []logs.LogEntry) []string {
	out := make([]string, len(entries))
	for i, e := range entries {
		out[i] = e.Message
	}
	return out
}

func TestHandleEnvironmentGet(t *testing.T) {
	t.Parallel()

	server := NewServer()

	req := httptest.NewRequest(http.MethodGet, "/environment", nil)
	w := httptest.NewRecorder()

	server.handleEnvironmentGet(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status code 200, got %d", w.Code)
	}

	var response EnvironmentGetResponse
	if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}

	// Should have at least some environment variables
	if len(response.Variables) == 0 {
		t.Error("Expected some environment variables to be returned")
	}
}

func TestHandleEnvironmentSet(t *testing.T) {
	t.Parallel()

	server := NewServer()

	// Test setting environment variables
	setReq := validation.EnvironmentSetRequest{
		Variables: map[string]string{
			"TEST_VAR": "test_value",
		},
		RestartProcess: false,
	}

	reqBody := mustMarshalJSON(t, setReq)
	req := httptest.NewRequest(http.MethodPut, "/environment", bytes.NewBuffer(reqBody))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	server.handleEnvironmentSet(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status code 200, got %d", w.Code)
	}

	var response map[string]string
	if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}

	if response["status"] != "updated" {
		t.Errorf("Expected status 'updated', got '%s'", response["status"])
	}
}

func TestHandleEnvironmentReset(t *testing.T) {
	t.Parallel()

	server := NewServer()

	req := httptest.NewRequest(http.MethodDelete, "/environment", nil)
	w := httptest.NewRecorder()

	server.handleEnvironmentReset(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status code 200, got %d", w.Code)
	}

	var response map[string]string
	if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}

	if response["status"] != "reset" {
		t.Errorf("Expected status 'reset', got '%s'", response["status"])
	}
}

func TestHandleLogs(t *testing.T) {
	t.Parallel()

	server := NewServer()

	// Add some test logs first
	server.logMgr.AddLog(logs.LogEntry{
		Timestamp: time.Now(),
		Source:    "test",
		Message:   "test log message",
		Level:     "info",
	})

	req := httptest.NewRequest(http.MethodGet, "/logs?lines=10", nil)
	w := httptest.NewRecorder()

	server.handleLogs(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status code 200, got %d", w.Code)
	}

	var response logs.GetResponse
	if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}

	if len(response.Logs) == 0 {
		t.Error("Expected some log entries to be returned")
	}

	if response.Logs[0].Message != "test log message" {
		t.Errorf("Expected message 'test log message', got '%s'", response.Logs[0].Message)
	}
}

func TestHandleLogsStream(t *testing.T) {
	t.Parallel()

	server := NewServer()

	req := httptest.NewRequest(http.MethodGet, "/logs/stream", nil)
	w := httptest.NewRecorder()

	server.handleLogsStream(w, req)

	// Should return not implemented
	if w.Code != http.StatusNotImplemented {
		t.Errorf("Expected status code 501, got %d", w.Code)
	}

	var response ErrorResponse
	if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
		t.Fatalf("Failed to decode error response: %v", err)
	}

	if response.Error != "not_implemented" {
		t.Errorf("Expected error 'not_implemented', got '%s'", response.Error)
	}
}

func TestHandleHealthConfigGet(t *testing.T) {
	t.Parallel()

	server := NewServer()

	req := httptest.NewRequest(http.MethodGet, "/health-config", nil)
	w := httptest.NewRecorder()

	server.handleHealthConfigGet(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status code 200, got %d", w.Code)
	}

	var response map[string]any
	if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}

	// Check expected fields
	expectedFields := []string{"health_status", "restart_stats"}
	for _, field := range expectedFields {
		if _, exists := response[field]; !exists {
			t.Errorf("Expected field '%s' in health config response", field)
		}
	}
}

func TestHandleHealthConfigSet(t *testing.T) {
	t.Parallel()

	server := NewServer()

	configReq := struct {
		HealthCheck   *health.HealthCheck   `json:"health_check,omitempty"`
		RestartPolicy *health.RestartPolicy `json:"restart_policy,omitempty"`
	}{
		HealthCheck: &health.HealthCheck{
			Type:     health.HealthCheckTypeCommand,
			Command:  "echo 'healthy'",
			Interval: health.Duration(30 * time.Second),
		},
		RestartPolicy: &health.RestartPolicy{
			Enabled:     true,
			MaxRestarts: 3,
		},
	}

	reqBody := mustMarshalJSON(t, configReq)
	req := httptest.NewRequest(http.MethodPut, "/health-config", bytes.NewBuffer(reqBody))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	server.handleHealthConfigSet(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status code 200, got %d", w.Code)
	}

	var response map[string]string
	if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}

	if response["status"] != "configured" {
		t.Errorf("Expected status 'configured', got '%s'", response["status"])
	}
}

func TestHandleHealthStatus(t *testing.T) {
	t.Parallel()

	server := NewServer()

	req := httptest.NewRequest(http.MethodGet, "/health-config/status", nil)
	w := httptest.NewRecorder()

	server.handleHealthStatus(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status code 200, got %d", w.Code)
	}

	var response health.HealthResult
	if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}

	// Should be disabled initially
	if response.Status != health.HealthStatusDisabled {
		t.Errorf("Expected status '%s', got '%s'", health.HealthStatusDisabled, response.Status)
	}
}

func TestHandleRestartStats(t *testing.T) {
	t.Parallel()

	server := NewServer()

	req := httptest.NewRequest(http.MethodGet, "/health-config/restart-stats", nil)
	w := httptest.NewRecorder()

	server.handleRestartStats(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status code 200, got %d", w.Code)
	}

	var response map[string]any
	if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}

	// Check expected fields
	expectedFields := []string{"total_restarts", "recent_restarts", "restart_window", "max_restarts"}
	for _, field := range expectedFields {
		if _, exists := response[field]; !exists {
			t.Errorf("Expected field '%s' in restart stats response", field)
		}
	}
}

func TestSendError(t *testing.T) {
	t.Parallel()

	server := NewServer()

	w := httptest.NewRecorder()

	server.sendError(w, http.StatusBadRequest, "test_error", "Test error message")

	if w.Code != http.StatusBadRequest {
		t.Errorf("Expected status code 400, got %d", w.Code)
	}

	var response ErrorResponse
	if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
		t.Fatalf("Failed to decode error response: %v", err)
	}

	if response.Error != "test_error" {
		t.Errorf("Expected error 'test_error', got '%s'", response.Error)
	}

	if response.Message != "Test error message" {
		t.Errorf("Expected message 'Test error message', got '%s'", response.Message)
	}

	// Check content type
	expectedContentType := contentTypeJSON
	contentType := w.Header().Get("Content-Type")
	if contentType != expectedContentType {
		t.Errorf("Expected Content-Type '%s', got '%s'", expectedContentType, contentType)
	}
}

func TestAPIContentTypeHeaders(t *testing.T) {
	t.Parallel()

	server := NewServer()

	// Test that all endpoints set proper Content-Type headers
	endpoints := []struct {
		method   string
		path     string
		body     string
		expected int
	}{
		{"GET", "/health", "", http.StatusOK},
		{"GET", "/info", "", http.StatusOK},
		{"GET", "/process/status", "", http.StatusOK},
		{"GET", "/environment", "", http.StatusOK},
		{"GET", "/logs", "", http.StatusOK},
		{"GET", "/health-config", "", http.StatusOK},
		{"GET", "/health-config/status", "", http.StatusOK},
		{"GET", "/health-config/restart-stats", "", http.StatusOK},
	}

	for _, endpoint := range endpoints {
		t.Run(endpoint.method+"_"+strings.ReplaceAll(endpoint.path, "/", "_"), func(t *testing.T) {
			t.Parallel()
			var req *http.Request
			if endpoint.body != "" {
				req = httptest.NewRequest(endpoint.method, endpoint.path, strings.NewReader(endpoint.body))
				req.Header.Set("Content-Type", "application/json")
			} else {
				req = httptest.NewRequest(endpoint.method, endpoint.path, nil)
			}

			w := httptest.NewRecorder()

			// Route to appropriate handler
			switch endpoint.path {
			case "/health":
				server.handleHealth(w, req)
			case "/info":
				server.handleInfo(w, req)
			case "/process/status":
				server.handleProcessStatus(w, req)
			case "/environment":
				server.handleEnvironmentGet(w, req)
			case "/logs":
				server.handleLogs(w, req)
			case "/health-config":
				server.handleHealthConfigGet(w, req)
			case "/health-config/status":
				server.handleHealthStatus(w, req)
			case "/health-config/restart-stats":
				server.handleRestartStats(w, req)
			}

			if w.Code != endpoint.expected {
				t.Errorf("Expected status code %d, got %d", endpoint.expected, w.Code)
			}

			expectedContentType := contentTypeJSON
			contentType := w.Header().Get("Content-Type")
			if contentType != expectedContentType {
				t.Errorf("Expected Content-Type '%s', got '%s'", expectedContentType, contentType)
			}
		})
	}
}

// Additional comprehensive test coverage for edge cases and error scenarios

func TestHandleProcessStartValidationErrors(t *testing.T) {
	t.Parallel()

	server := NewServer()

	tests := []struct {
		name     string
		request  validation.ProcessStartRequest
		expected string
	}{
		{
			name:     "invalid working directory",
			request:  validation.ProcessStartRequest{Command: "echo test", WorkingDir: "../invalid"},
			expected: "validation_failed",
		},
		{
			name: "invalid env var name",
			request: validation.ProcessStartRequest{
				Command: "echo test",
				Env:     map[string]string{"123invalid": "value"},
			},
			expected: "validation_failed",
		},
		{
			name: "env var value too large",
			request: validation.ProcessStartRequest{
				Command: "echo test",
				Env:     map[string]string{"TEST": strings.Repeat("x", 40000)},
			},
			expected: "validation_failed",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			reqBody := mustMarshalJSON(t, tt.request)
			req := httptest.NewRequest(http.MethodPost, "/process/start", bytes.NewBuffer(reqBody))
			req.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()

			server.handleProcessStart(w, req)

			if w.Code != http.StatusBadRequest {
				t.Errorf("Expected status code 400, got %d", w.Code)
			}

			var response ErrorResponse
			if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
				t.Fatalf("Failed to decode error response: %v", err)
			}

			if response.Error != tt.expected {
				t.Errorf("Expected error '%s', got '%s'", tt.expected, response.Error)
			}
		})
	}
}

func TestHandleProcessStopInvalidJSON(t *testing.T) {
	t.Parallel()

	server := NewServer()

	req := httptest.NewRequest(http.MethodPost, "/process/stop", strings.NewReader("invalid json"))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	server.handleProcessStop(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("Expected status code 400, got %d", w.Code)
	}

	var response ErrorResponse
	if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
		t.Fatalf("Failed to decode error response: %v", err)
	}

	if response.Error != invalidRequestErr {
		t.Errorf("Expected error 'invalid_request', got '%s'", response.Error)
	}
}

func TestHandleProcessRestartInvalidJSON(t *testing.T) {
	t.Parallel()

	server := NewServer()

	req := httptest.NewRequest(http.MethodPost, "/process/restart", strings.NewReader("invalid json"))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	server.handleProcessRestart(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("Expected status code 400, got %d", w.Code)
	}

	var response ErrorResponse
	if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
		t.Fatalf("Failed to decode error response: %v", err)
	}

	if response.Error != invalidRequestErr {
		t.Errorf("Expected error 'invalid_request', got '%s'", response.Error)
	}
}

func TestHandleExecValidationErrors(t *testing.T) {
	t.Parallel()

	server := NewServer()

	tests := []struct {
		name     string
		request  validation.CommandRequest
		expected string
	}{
		{
			name:     "negative timeout",
			request:  validation.CommandRequest{Command: "echo test", Timeout: -1},
			expected: "validation_failed",
		},
		{
			name:     "timeout too large",
			request:  validation.CommandRequest{Command: "echo test", Timeout: 5000},
			expected: "validation_failed",
		},
		{
			name:     "invalid working directory",
			request:  validation.CommandRequest{Command: "echo test", WorkingDir: "../invalid"},
			expected: "validation_failed",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			reqBody := mustMarshalJSON(t, tt.request)
			req := httptest.NewRequest(http.MethodPost, "/exec", bytes.NewBuffer(reqBody))
			req.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()

			server.handleExec(w, req)

			if w.Code != http.StatusBadRequest {
				t.Errorf("Expected status code 400, got %d", w.Code)
			}

			var response ErrorResponse
			if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
				t.Fatalf("Failed to decode error response: %v", err)
			}

			if response.Error != tt.expected {
				t.Errorf("Expected error '%s', got '%s'", tt.expected, response.Error)
			}
		})
	}
}

func TestHandleEnvironmentSetInvalidJSON(t *testing.T) {
	t.Parallel()

	server := NewServer()

	req := httptest.NewRequest(http.MethodPut, "/environment", strings.NewReader("invalid json"))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	server.handleEnvironmentSet(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("Expected status code 400, got %d", w.Code)
	}

	var response ErrorResponse
	if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
		t.Fatalf("Failed to decode error response: %v", err)
	}

	if response.Error != invalidRequestErr {
		t.Errorf("Expected error 'invalid_request', got '%s'", response.Error)
	}
}

func TestHandleEnvironmentSetValidationErrors(t *testing.T) {
	t.Parallel()

	server := NewServer()

	tests := []struct {
		name     string
		request  validation.EnvironmentSetRequest
		expected string
	}{
		{
			name:     "no variables",
			request:  validation.EnvironmentSetRequest{Variables: map[string]string{}},
			expected: "validation_failed",
		},
		{
			name:     "invalid env var name",
			request:  validation.EnvironmentSetRequest{Variables: map[string]string{"123invalid": "value"}},
			expected: "validation_failed",
		},
		{
			name: "env var value too large",
			request: validation.EnvironmentSetRequest{
				Variables: map[string]string{"TEST": strings.Repeat("x", 40000)},
			},
			expected: "validation_failed",
		},
		{
			name:     "protected env var",
			request:  validation.EnvironmentSetRequest{Variables: map[string]string{"PATH": "/usr/bin"}},
			expected: "validation_failed",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			reqBody := mustMarshalJSON(t, tt.request)
			req := httptest.NewRequest(http.MethodPut, "/environment", bytes.NewBuffer(reqBody))
			req.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()

			server.handleEnvironmentSet(w, req)

			if w.Code != http.StatusBadRequest {
				t.Errorf("Expected status code 400, got %d", w.Code)
			}

			var response ErrorResponse
			if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
				t.Fatalf("Failed to decode error response: %v", err)
			}

			if response.Error != tt.expected {
				t.Errorf("Expected error '%s', got '%s'", tt.expected, response.Error)
			}
		})
	}
}

func TestHandleEnvironmentSetWithRestart(t *testing.T) {
	t.Parallel()

	server := NewServer()

	// First start a process
	startReq := validation.ProcessStartRequest{
		Command:    "sleep 30",
		WorkingDir: "/tmp",
	}
	if err := server.procMgr.Start(startReq); err != nil {
		t.Fatalf("Failed to start test process: %v", err)
	}

	// Wait for process to start
	time.Sleep(100 * time.Millisecond)

	// Test setting environment variables with restart
	setReq := validation.EnvironmentSetRequest{
		Variables: map[string]string{
			"TEST_VAR": "test_value",
		},
		RestartProcess: true,
	}

	reqBody := mustMarshalJSON(t, setReq)
	req := httptest.NewRequest(http.MethodPut, "/environment", bytes.NewBuffer(reqBody))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	server.handleEnvironmentSet(w, req)

	// Clean up
	defer func() {
		stopReq := processmanager.ProcessStopRequest{Signal: "SIGKILL", Timeout: 1}
		if err := server.procMgr.Stop(stopReq); err != nil {
			t.Logf("Failed to stop test process: %v", err)
		}
	}()

	if w.Code != http.StatusOK {
		t.Errorf("Expected status code 200, got %d", w.Code)
	}

	var response map[string]string
	if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}

	if response["status"] != "updated" {
		t.Errorf("Expected status 'updated', got '%s'", response["status"])
	}
}

func TestHandleHealthConfigSetInvalidJSON(t *testing.T) {
	t.Parallel()

	server := NewServer()

	req := httptest.NewRequest(http.MethodPut, "/health-config", strings.NewReader("invalid json"))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	server.handleHealthConfigSet(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("Expected status code 400, got %d", w.Code)
	}

	var response ErrorResponse
	if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
		t.Fatalf("Failed to decode error response: %v", err)
	}

	if response.Error != invalidRequestErr {
		t.Errorf("Expected error 'invalid_request', got '%s'", response.Error)
	}
}

func TestHandleHealthConfigSetPartialConfig(t *testing.T) {
	t.Parallel()

	server := NewServer()

	// Test setting only health check
	configReq := struct {
		HealthCheck   *health.HealthCheck   `json:"health_check,omitempty"`
		RestartPolicy *health.RestartPolicy `json:"restart_policy,omitempty"`
	}{
		HealthCheck: &health.HealthCheck{
			Type:     health.HealthCheckTypeCommand,
			Command:  "echo 'healthy'",
			Interval: health.Duration(30 * time.Second),
		},
	}

	reqBody := mustMarshalJSON(t, configReq)
	req := httptest.NewRequest(http.MethodPut, "/health-config", bytes.NewBuffer(reqBody))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	server.handleHealthConfigSet(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status code 200, got %d", w.Code)
	}
}

func TestHandleSetupStatus_NoSetup(t *testing.T) {
	t.Parallel()

	server := NewServer()

	req := httptest.NewRequest(http.MethodGet, "/setup/status", nil)
	w := httptest.NewRecorder()

	server.handleSetupStatus(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status code 200, got %d", w.Code)
	}

	var response processmanager.SetupStatus
	if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}

	if response.SetupConfigured {
		t.Error("Expected setup_configured to be false")
	}
	if response.SetupDeferred {
		t.Error("Expected setup_deferred to be false")
	}
	if response.SetupExecuted {
		t.Error("Expected setup_executed to be false")
	}
	if response.SetupRunning {
		t.Error("Expected setup_running to be false")
	}
	if response.SetupError != nil {
		t.Errorf("Expected setup_error to be nil, got %v", response.SetupError)
	}
}

func TestHandleSetupStatus_DeferredPending(t *testing.T) {
	t.Parallel()

	server := NewServer()

	// Configure deferred setup
	server.procMgr.SetDeferredSetup("/nonexistent/setup.sh", 10*time.Minute, validation.ProcessStartRequest{
		Command:    "npm start",
		WorkingDir: "/app",
	})

	req := httptest.NewRequest(http.MethodGet, "/setup/status", nil)
	w := httptest.NewRecorder()

	server.handleSetupStatus(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status code 200, got %d", w.Code)
	}

	var response processmanager.SetupStatus
	if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}

	if !response.SetupConfigured {
		t.Error("Expected setup_configured to be true")
	}
	if !response.SetupDeferred {
		t.Error("Expected setup_deferred to be true")
	}
	if response.SetupExecuted {
		t.Error("Expected setup_executed to be false")
	}
	if response.SetupRunning {
		t.Error("Expected setup_running to be false")
	}
}

func TestHandleSetupStatus_DeferredExecuted(t *testing.T) {
	t.Parallel()

	server := NewServer()

	// Use pre-created script from TestMain to avoid ETXTBSY race.
	server.procMgr.SetDeferredSetup(
		filepath.Join(testScriptDir, "success.sh"), 10*time.Second, validation.ProcessStartRequest{},
	)
	if err := server.procMgr.ExecuteDeferredSetup(); err != nil {
		t.Fatalf("Failed to execute deferred setup: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/setup/status", nil)
	w := httptest.NewRecorder()

	server.handleSetupStatus(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status code 200, got %d", w.Code)
	}

	var response processmanager.SetupStatus
	if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}

	if !response.SetupConfigured {
		t.Error("Expected setup_configured to be true")
	}
	if response.SetupDeferred {
		t.Error("Expected setup_deferred to be false after execution")
	}
	if !response.SetupExecuted {
		t.Error("Expected setup_executed to be true")
	}
	if response.SetupRunning {
		t.Error("Expected setup_running to be false after completion")
	}
	if response.SetupError != nil {
		t.Errorf("Expected setup_error to be nil, got %v", response.SetupError)
	}
}

func TestHandleProcessStart_DeferredSetupFailure(t *testing.T) {
	t.Parallel()

	server := NewServer()

	// Use pre-created script from TestMain to avoid ETXTBSY race.
	server.procMgr.SetDeferredSetup(
		filepath.Join(testScriptDir, "fail.sh"), 10*time.Second, validation.ProcessStartRequest{},
	)

	body := `{"command":"npm start","working_dir":"/app"}`
	req := httptest.NewRequest(http.MethodPost, "/process/start", strings.NewReader(body))
	w := httptest.NewRecorder()

	server.handleProcessStart(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Errorf("Expected status code 500, got %d", w.Code)
	}

	var response ErrorResponse
	if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}

	if response.Error != "setup_failed" {
		t.Errorf("Expected error code 'setup_failed', got %q", response.Error)
	}
}

func TestHandleLogsWithFilters(t *testing.T) {
	t.Parallel()

	server := NewServer()

	// Add test logs with different sources
	testLogs := []logs.LogEntry{
		{Timestamp: time.Now(), Source: "test1", Message: "info message", Level: "info"},
		{Timestamp: time.Now(), Source: "test2", Message: "error message", Level: "error"},
		{Timestamp: time.Now(), Source: "test1", Message: "debug message", Level: "debug"},
	}

	for _, log := range testLogs {
		server.logMgr.AddLog(log)
	}

	// Test with source filter (this is what the log manager actually supports)
	req := httptest.NewRequest(http.MethodGet, "/logs?source=test1", nil)
	w := httptest.NewRecorder()

	server.handleLogs(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status code 200, got %d", w.Code)
	}

	var response logs.GetResponse
	if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}

	// Should only return logs from test1 source
	for _, log := range response.Logs {
		if log.Source != "test1" {
			t.Errorf("Expected only test1 source logs, got source '%s'", log.Source)
		}
	}

	// Should have 2 logs from test1
	if len(response.Logs) != 2 {
		t.Errorf("Expected 2 logs from test1, got %d", len(response.Logs))
	}
}

func TestHandleSetupExecute_NotConfigured(t *testing.T) {
	t.Parallel()

	server := NewServer()

	req := httptest.NewRequest(http.MethodPost, "/setup/execute", nil)
	w := httptest.NewRecorder()

	server.handleSetupExecute(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status code 200, got %d", w.Code)
	}

	var response SetupExecuteResponse
	if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}

	if response.Status != "not_configured" {
		t.Errorf("Expected status 'not_configured', got %q", response.Status)
	}
}

func TestHandleSetupExecute_Success(t *testing.T) {
	t.Parallel()

	server := NewServer()

	tmpDir := t.TempDir()

	server.procMgr.SetDeferredSetup(
		filepath.Join(testScriptDir, "success.sh"), 10*time.Second, validation.ProcessStartRequest{
			Command:    "sleep 30",
			WorkingDir: tmpDir,
		})

	req := httptest.NewRequest(http.MethodPost, "/setup/execute", nil)
	w := httptest.NewRecorder()

	server.handleSetupExecute(w, req)

	// Ensure the sleep process is killed even if the test fails early
	t.Cleanup(func() {
		_ = server.procMgr.Stop(processmanager.ProcessStopRequest{Signal: "SIGKILL", Timeout: 1})
	})

	if w.Code != http.StatusOK {
		t.Errorf("Expected status code 200, got %d", w.Code)
	}

	var response SetupExecuteResponse
	if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}

	if response.Status != "executed" {
		t.Errorf("Expected status 'executed', got %q", response.Status)
	}

	// Verify setup is now marked as executed
	setupStatus := server.procMgr.GetSetupStatus()
	if !setupStatus.SetupExecuted {
		t.Error("Expected setup_executed to be true after execution")
	}

	// Verify process was auto-started after setup (sleep 30 keeps it alive)
	// Poll briefly — Start() is synchronous but the state transition to
	// running happens asynchronously in the managed process goroutine.
	var processState processmanager.ProcessState
	for range 20 {
		processState = server.procMgr.GetStatus().State
		if processState == processmanager.ProcessStateRunning {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}
	if processState != processmanager.ProcessStateRunning && processState != processmanager.ProcessStateStarting {
		t.Errorf("Expected process state 'running' or 'starting' after auto-start, got %q", processState)
	}
}

func TestHandleSetupExecute_AlreadyExecuted(t *testing.T) {
	t.Parallel()

	server := NewServer()

	server.procMgr.SetDeferredSetup(
		filepath.Join(testScriptDir, "success.sh"), 10*time.Second, validation.ProcessStartRequest{})
	if err := server.procMgr.ExecuteDeferredSetup(); err != nil {
		t.Fatalf("Failed to execute deferred setup: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/setup/execute", nil)
	w := httptest.NewRecorder()

	server.handleSetupExecute(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status code 200, got %d", w.Code)
	}

	var response SetupExecuteResponse
	if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}

	if response.Status != "already_executed" {
		t.Errorf("Expected status 'already_executed', got %q", response.Status)
	}
}

func TestHandleSetupExecute_Failure(t *testing.T) {
	t.Parallel()

	server := NewServer()

	server.procMgr.SetDeferredSetup(
		filepath.Join(testScriptDir, "fail.sh"), 10*time.Second, validation.ProcessStartRequest{})

	req := httptest.NewRequest(http.MethodPost, "/setup/execute", nil)
	w := httptest.NewRecorder()

	server.handleSetupExecute(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Errorf("Expected status code 500, got %d", w.Code)
	}

	var response SetupExecuteResponse
	if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}

	if response.Status != "error" {
		t.Errorf("Expected status 'error', got %q", response.Status)
	}
	if response.Error == nil {
		t.Error("Expected error message to be present")
	}

	// Verify setup is NOT marked as executed after failure
	setupStatus := server.procMgr.GetSetupStatus()
	if setupStatus.SetupExecuted {
		t.Error("Expected setup_executed to remain false after failure")
	}
}
