package main

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestHandleTaskSubmit_SyncWait(t *testing.T) {
	t.Parallel()
	server := NewServer()
	defer server.taskMgr.Shutdown(context.Background())

	body := `{"command":"echo sync-result","timeout":5,"wait_seconds":5}`
	req := httptest.NewRequest(http.MethodPost, "/tasks", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	server.router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp TaskCompletedResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if resp.Kind != "completed" {
		t.Errorf("expected kind=completed, got %s", resp.Kind)
	}
	if resp.ExitCode != 0 {
		t.Errorf("expected exit_code=0, got %d", resp.ExitCode)
	}
	if resp.TaskID == "" {
		t.Error("expected non-empty task_id")
	}
}

func TestHandleTaskSubmit_AsyncNoWait(t *testing.T) {
	t.Parallel()
	server := NewServer()
	defer server.taskMgr.Shutdown(context.Background())

	body := `{"command":"sleep 10","timeout":30}`
	req := httptest.NewRequest(http.MethodPost, "/tasks", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	server.router.ServeHTTP(w, req)

	if w.Code != http.StatusAccepted {
		t.Fatalf("expected 202, got %d: %s", w.Code, w.Body.String())
	}

	var resp TaskAcceptedResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if resp.Kind != "accepted" {
		t.Errorf("expected kind=accepted, got %s", resp.Kind)
	}
	if resp.TaskID == "" {
		t.Error("expected non-empty task_id")
	}
}

func TestHandleTaskSubmit_WaitDeadlinePromotion(t *testing.T) {
	t.Parallel()
	server := NewServer()
	defer server.taskMgr.Shutdown(context.Background())

	body := `{"command":"sleep 30","timeout":60,"wait_seconds":1}`
	req := httptest.NewRequest(http.MethodPost, "/tasks", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	server.router.ServeHTTP(w, req)

	if w.Code != http.StatusAccepted {
		t.Fatalf("expected 202, got %d: %s", w.Code, w.Body.String())
	}

	var resp TaskAcceptedResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if resp.Kind != "accepted" {
		t.Errorf("expected kind=accepted after deadline promotion, got %s", resp.Kind)
	}
	if resp.State != TaskStateRunning {
		t.Errorf("expected state=running, got %s", resp.State)
	}
}

func TestHandleTaskSubmit_ValidationError(t *testing.T) {
	t.Parallel()
	server := NewServer()
	defer server.taskMgr.Shutdown(context.Background())

	body := `{"command":""}`
	req := httptest.NewRequest(http.MethodPost, "/tasks", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	server.router.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
}

func TestHandleTaskSubmit_InvalidJSON(t *testing.T) {
	t.Parallel()
	server := NewServer()
	defer server.taskMgr.Shutdown(context.Background())

	req := httptest.NewRequest(http.MethodPost, "/tasks", bytes.NewBufferString("not json"))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	server.router.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
}

func TestHandleTaskGet(t *testing.T) {
	t.Parallel()
	server := NewServer()
	defer server.taskMgr.Shutdown(context.Background())

	// Submit and wait for completion
	submitBody := `{"command":"echo get-task","timeout":5,"wait_seconds":5}`
	submitReq := httptest.NewRequest(http.MethodPost, "/tasks", bytes.NewBufferString(submitBody))
	submitReq.Header.Set("Content-Type", "application/json")
	sw := httptest.NewRecorder()
	server.router.ServeHTTP(sw, submitReq)

	var submitResp TaskCompletedResponse
	_ = json.Unmarshal(sw.Body.Bytes(), &submitResp)

	// Get task status
	getReq := httptest.NewRequest(http.MethodGet, "/tasks/"+submitResp.TaskID, nil)
	gw := httptest.NewRecorder()
	server.router.ServeHTTP(gw, getReq)

	if gw.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", gw.Code, gw.Body.String())
	}

	var resp TaskStatusResponse
	if err := json.Unmarshal(gw.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to decode: %v", err)
	}
	if resp.TaskID != submitResp.TaskID {
		t.Errorf("expected task_id=%s, got %s", submitResp.TaskID, resp.TaskID)
	}
	if resp.State != TaskStateSucceeded {
		t.Errorf("expected state=succeeded, got %s", resp.State)
	}
}

func TestHandleTaskGet_NotFound(t *testing.T) {
	t.Parallel()
	server := NewServer()
	defer server.taskMgr.Shutdown(context.Background())

	req := httptest.NewRequest(http.MethodGet, "/tasks/task-nonexistent", nil)
	w := httptest.NewRecorder()
	server.router.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d", w.Code)
	}
}

func TestHandleTaskOutput(t *testing.T) {
	t.Parallel()
	server := NewServer()
	defer server.taskMgr.Shutdown(context.Background())

	submitBody := `{"command":"echo output-test","timeout":5,"wait_seconds":5}`
	submitReq := httptest.NewRequest(http.MethodPost, "/tasks", bytes.NewBufferString(submitBody))
	submitReq.Header.Set("Content-Type", "application/json")
	sw := httptest.NewRecorder()
	server.router.ServeHTTP(sw, submitReq)

	var submitResp TaskCompletedResponse
	_ = json.Unmarshal(sw.Body.Bytes(), &submitResp)

	outReq := httptest.NewRequest(http.MethodGet, "/tasks/"+submitResp.TaskID+"/output", nil)
	ow := httptest.NewRecorder()
	server.router.ServeHTTP(ow, outReq)

	if ow.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", ow.Code, ow.Body.String())
	}

	var resp TaskOutputResponse
	if err := json.Unmarshal(ow.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to decode: %v", err)
	}
	if !resp.Complete {
		t.Error("expected complete=true")
	}
}

func TestHandleTaskOutput_NotFound(t *testing.T) {
	t.Parallel()
	server := NewServer()
	defer server.taskMgr.Shutdown(context.Background())

	req := httptest.NewRequest(http.MethodGet, "/tasks/task-missing/output", nil)
	w := httptest.NewRecorder()
	server.router.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d", w.Code)
	}
}

func TestHandleTaskCancel(t *testing.T) {
	t.Parallel()
	server := NewServer()
	defer server.taskMgr.Shutdown(context.Background())

	// Submit a long-running task
	submitBody := `{"command":"sleep 60","timeout":120}`
	submitReq := httptest.NewRequest(http.MethodPost, "/tasks", bytes.NewBufferString(submitBody))
	submitReq.Header.Set("Content-Type", "application/json")
	sw := httptest.NewRecorder()
	server.router.ServeHTTP(sw, submitReq)

	var submitResp TaskAcceptedResponse
	_ = json.Unmarshal(sw.Body.Bytes(), &submitResp)

	// Cancel it
	cancelReq := httptest.NewRequest(http.MethodPost, "/tasks/"+submitResp.TaskID+"/cancel", nil)
	cw := httptest.NewRecorder()
	server.router.ServeHTTP(cw, cancelReq)

	if cw.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", cw.Code, cw.Body.String())
	}

	var resp TaskCancelResponse
	if err := json.Unmarshal(cw.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to decode: %v", err)
	}
	if resp.State != cancelResultCanceled {
		t.Errorf("expected state=canceled, got %s", resp.State)
	}
}

func TestHandleTaskCancel_NotFound(t *testing.T) {
	t.Parallel()
	server := NewServer()
	defer server.taskMgr.Shutdown(context.Background())

	req := httptest.NewRequest(http.MethodPost, "/tasks/task-missing/cancel", nil)
	w := httptest.NewRecorder()
	server.router.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d", w.Code)
	}
}

func TestHandleTaskSubmit_EnvForwarding(t *testing.T) {
	t.Parallel()
	server := NewServer()
	defer server.taskMgr.Shutdown(context.Background())

	body := `{"command":"echo $TASK_API_VAR","timeout":5,"wait_seconds":5,"env":{"TASK_API_VAR":"api-env-value"}}`
	req := httptest.NewRequest(http.MethodPost, "/tasks", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	server.router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp TaskCompletedResponse
	_ = json.Unmarshal(w.Body.Bytes(), &resp)

	if !strings.Contains(resp.Stdout, "api-env-value") {
		t.Errorf("expected stdout to contain 'api-env-value', got %q", resp.Stdout)
	}

	// Also verify via output endpoint
	outReq := httptest.NewRequest(http.MethodGet, "/tasks/"+resp.TaskID+"/output", nil)
	ow := httptest.NewRecorder()
	server.router.ServeHTTP(ow, outReq)

	var outResp TaskOutputResponse
	_ = json.Unmarshal(ow.Body.Bytes(), &outResp)
	if !strings.Contains(outResp.Stdout, "api-env-value") {
		t.Errorf("expected output stdout to contain 'api-env-value', got %q", outResp.Stdout)
	}
}
