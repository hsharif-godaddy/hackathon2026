---
status: implemented
---

# POST /setup/execute Endpoint Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `POST /setup/execute` to dev-supervisor so the agents service can trigger deferred setup on demand before performing git operations.

**Architecture:** New HTTP handler calls existing `ExecuteDeferredSetup()` with pre-flight status checks to determine response. After successful setup, starts the process using the saved start request (mirroring the HTTP proxy autostart flow). TypeScript client gets a thin wrapper method.

**Tech Stack:** Go (dev-supervisor), TypeScript (agents DevSupervisorClient)

**Spec:** `docs/superpowers/specs/2026-03-17-setup-execute-endpoint-design.md`

---

## Chunk 1: Go handler and tests

### Task 1: Add SetupExecuteResponse type and handler

**Files:**
- Modify: `dev-supervisor/cmd/dev-supervisor/main.go:126` (response struct near other structs)
- Modify: `dev-supervisor/cmd/dev-supervisor/main.go:195` (route registration)
- Modify: `dev-supervisor/cmd/dev-supervisor/api.go` (new handler after `handleSetupStatus`)

- [ ] **Step 1: Add response struct to main.go**

Add after the `ErrorResponse` struct (~line 123):

```go
type SetupExecuteResponse struct {
	Status string  `json:"status"` // "executed", "already_executed", "not_configured", "error"
	Error  *string `json:"error,omitempty"`
}
```

- [ ] **Step 2: Add route registration in main.go**

Replace the standalone `/setup/status` route (line 195):

```go
// Before:
s.router.HandleFunc("/setup/status", s.handleSetupStatus).Methods("GET")

// After:
setupRouter := s.router.PathPrefix("/setup").Subrouter()
setupRouter.HandleFunc("/status", s.handleSetupStatus).Methods("GET")
setupRouter.HandleFunc("/execute", s.handleSetupExecute).Methods("POST")
```

- [ ] **Step 3: Add handleSetupExecute handler to api.go**

Add after `handleSetupStatus`:

```go
func (s *Server) handleSetupExecute(w http.ResponseWriter, _ *http.Request) {
	// Pre-flight: check current state to determine response status
	status := s.procMgr.GetSetupStatus()

	if !status.SetupConfigured {
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(SetupExecuteResponse{Status: "not_configured"}); err != nil {
			slog.Error("failed to encode setup execute response", "error", err)
		}
		return
	}

	if status.SetupExecuted {
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(SetupExecuteResponse{Status: "already_executed"}); err != nil {
			slog.Error("failed to encode setup execute response", "error", err)
		}
		return
	}

	if err := s.procMgr.ExecuteDeferredSetup(); err != nil {
		errMsg := err.Error()
		slog.Error("setup.execute.failed", "error", err)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		if err := json.NewEncoder(w).Encode(SetupExecuteResponse{Status: "error", Error: &errMsg}); err != nil {
			slog.Error("failed to encode setup execute response", "error", err)
		}
		return
	}

	// Start process from saved request if not already running
	// (mirrors HTTP proxy autostart behavior on first iframe request)
	processStatus := s.procMgr.GetStatus()
	if processStatus.State == processmanager.ProcessStateStopped {
		if startReq := s.procMgr.GetStartRequest(); startReq != nil {
			if err := s.procMgr.Start(*startReq); err != nil {
				// Benign races: another caller started the process between our check and Start()
				if !errors.Is(err, processmanager.ErrAlreadyStarting) && !errors.Is(err, processmanager.ErrAlreadyRunning) {
					slog.Warn("setup.execute.process_start_failed", "error", err)
				}
				// Non-fatal: setup succeeded, process start is best-effort
			}
		}
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(SetupExecuteResponse{Status: "executed"}); err != nil {
		slog.Error("failed to encode setup execute response", "error", err)
	}
}
```

- [ ] **Step 4: Verify it compiles**

Run: `cd dev-supervisor && go build ./...`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add dev-supervisor/cmd/dev-supervisor/main.go dev-supervisor/cmd/dev-supervisor/api.go
git commit -m "feat(dev-supervisor): add POST /setup/execute endpoint"
```

### Task 2: Add Go unit tests

**Files:**
- Modify: `dev-supervisor/cmd/dev-supervisor/api_test.go` (add 4 tests after existing setup tests)

- [ ] **Step 1: Write test for no setup configured**

Add after the last `TestHandleSetupStatus_*` test:

```go
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
```

- [ ] **Step 2: Write test for successful execution**

```go
func TestHandleSetupExecute_Success(t *testing.T) {
	t.Parallel()

	server := NewServer()

	tmpDir := t.TempDir()
	scriptPath := tmpDir + "/test-setup.sh"
	writeTestScript(t, scriptPath, "#!/bin/sh\necho 'Setup complete'\nexit 0\n")

	server.procMgr.SetDeferredSetup(scriptPath, 10*time.Second, validation.ProcessStartRequest{
		Command:    "echo hello",
		WorkingDir: tmpDir,
	})

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

	if response.Status != "executed" {
		t.Errorf("Expected status 'executed', got %q", response.Status)
	}

	// Verify setup is now marked as executed
	setupStatus := server.procMgr.GetSetupStatus()
	if !setupStatus.SetupExecuted {
		t.Error("Expected setup_executed to be true after execution")
	}

	// Verify process was auto-started after setup
	// (the command "echo hello" exits immediately, so process may already be stopped,
	// but GetStartRequest should return the saved request proving it was configured)
	if startReq := server.procMgr.GetStartRequest(); startReq == nil {
		t.Error("Expected start request to be saved after setup")
	}
}
```

- [ ] **Step 3: Write test for already executed**

```go
func TestHandleSetupExecute_AlreadyExecuted(t *testing.T) {
	t.Parallel()

	server := NewServer()

	tmpDir := t.TempDir()
	scriptPath := tmpDir + "/test-setup.sh"
	writeTestScript(t, scriptPath, "#!/bin/sh\necho 'Setup complete'\nexit 0\n")

	server.procMgr.SetDeferredSetup(scriptPath, 10*time.Second, validation.ProcessStartRequest{})
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
```

- [ ] **Step 4: Write test for setup failure**

```go
func TestHandleSetupExecute_Failure(t *testing.T) {
	t.Parallel()

	server := NewServer()

	tmpDir := t.TempDir()
	scriptPath := tmpDir + "/test-setup.sh"
	writeTestScript(t, scriptPath, "#!/bin/sh\necho 'Setup failed' >&2\nexit 1\n")

	server.procMgr.SetDeferredSetup(scriptPath, 10*time.Second, validation.ProcessStartRequest{})

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
```

- [ ] **Step 5: Run tests**

Run: `cd dev-supervisor && go test ./cmd/dev-supervisor/ -run TestHandleSetupExecute -v`
Expected: All 4 tests PASS

- [ ] **Step 6: Run full dev-supervisor test suite**

Run: `cd dev-supervisor && make check`
Expected: All tests pass, linting passes

- [ ] **Step 7: Commit**

```bash
git add dev-supervisor/cmd/dev-supervisor/api_test.go
git commit -m "test(dev-supervisor): add tests for POST /setup/execute"
```

## Chunk 2: TypeScript client

### Task 3: Add executeSetup to DevSupervisorClient

**Files:**
- Modify: `agents/src/services/DevSupervisorClient.ts` (add interface and method)

- [ ] **Step 1: Add SetupExecuteResponse interface**

Add after the existing `SetupStatus` interface:

```typescript
/**
 * Response from /setup/execute endpoint
 */
export interface SetupExecuteResponse {
  /** Status of the setup execution attempt */
  status: 'executed' | 'already_executed' | 'not_configured' | 'error';
  /** Error message if status is 'error' */
  error?: string;
}
```

- [ ] **Step 2: Add executeSetup method**

Add after the existing `getSetupStatus()` method:

```typescript
  /**
   * Trigger deferred setup execution (runs nomad_setup.sh).
   * Idempotent: returns 'already_executed' if setup already ran.
   * After setup, starts the preview process if not already running.
   */
  async executeSetup(): Promise<SetupExecuteResponse> {
    this.logger.info('dev_supervisor.setup_execute.begin');
    try {
      const response = await this.makeRequest('POST', '/setup/execute');
      return response;
    } catch (error) {
      this.logger.error('dev_supervisor.setup_execute.failure', {
        error: getErrorMessage(error)
      });
      throw error;
    }
  }
```

- [ ] **Step 3: Verify it compiles**

Run: `pnpm --filter @airo/agents typecheck`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add agents/src/services/DevSupervisorClient.ts
git commit -m "feat(agents): add executeSetup client method for POST /setup/execute"
```
