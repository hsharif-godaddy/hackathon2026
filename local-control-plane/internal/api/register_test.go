package api

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/airo-ai-builder/local-control-plane/internal/store"
)

// --- attemptRegister ---

func TestAttemptRegisterSuccess(t *testing.T) {
	srv := newTestServer(t)
	var received map[string]any

	agent := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		json.Unmarshal(body, &received)
		w.WriteHeader(http.StatusOK)
	}))
	defer agent.Close()

	payload, _ := json.Marshal(map[string]any{"siteId": "app-1"})
	err := srv.attemptRegister(context.Background(), agent.Client(), agent.URL+"/apps/register", payload, "app-1")
	if err != nil {
		t.Fatalf("expected success, got %v", err)
	}
	if received["siteId"] != "app-1" {
		t.Errorf("expected siteId app-1, got %v", received["siteId"])
	}
}

func TestAttemptRegister401(t *testing.T) {
	srv := newTestServer(t)

	agent := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer agent.Close()

	err := srv.attemptRegister(context.Background(), agent.Client(), agent.URL+"/apps/register", []byte(`{}`), "app-1")
	if err == nil {
		t.Fatal("expected error for 401")
	}
	if !strings.Contains(err.Error(), "401") {
		t.Errorf("expected 401 in error, got %v", err)
	}
}

func TestAttemptRegisterNon2xx(t *testing.T) {
	srv := newTestServer(t)

	agent := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer agent.Close()

	err := srv.attemptRegister(context.Background(), agent.Client(), agent.URL+"/apps/register", []byte(`{}`), "app-1")
	if err == nil {
		t.Fatal("expected error for 503")
	}
	if !strings.Contains(err.Error(), "503") {
		t.Errorf("expected 503 in error, got %v", err)
	}
}

func TestAttemptRegisterConnectionRefused(t *testing.T) {
	srv := newTestServer(t)

	err := srv.attemptRegister(context.Background(), http.DefaultClient, "http://127.0.0.1:1/apps/register", []byte(`{}`), "app-1")
	if err == nil {
		t.Fatal("expected error for connection refused")
	}
	var connErr *connectionError
	if !errors.As(err, &connErr) {
		t.Errorf("expected connectionError, got %T: %v", err, err)
	}
}

func TestAttemptRegisterContextCanceled(t *testing.T) {
	srv := newTestServer(t)

	agent := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(5 * time.Second)
		w.WriteHeader(http.StatusOK)
	}))
	defer agent.Close()

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	err := srv.attemptRegister(ctx, agent.Client(), agent.URL+"/apps/register", []byte(`{}`), "app-1")
	if err == nil {
		t.Fatal("expected error for canceled context")
	}
}

// --- registerWithAgent retry logic ---

func noDelay(int) time.Duration { return 0 }

func newTestApp() *store.App {
	return &store.App{ID: "app-1", PreviewPort: 5001}
}

func TestRegisterWithAgentSuccessOnFirstAttempt(t *testing.T) {
	var calls atomic.Int32
	agent := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		w.WriteHeader(http.StatusOK)
	}))
	defer agent.Close()

	srv, _ := newTestServerWithFS(t)
	srv.retryDelay = noDelay
	t.Setenv("AGENTS_BASE_URL", agent.URL)

	err := srv.registerWithAgent(newTestApp())
	if err != nil {
		t.Fatalf("expected success, got %v", err)
	}
	if calls.Load() != 1 {
		t.Errorf("expected 1 call, got %d", calls.Load())
	}
}

func TestRegisterWithAgentRetriesOn401(t *testing.T) {
	var calls atomic.Int32
	agent := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n := calls.Add(1)
		if n < 3 {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer agent.Close()

	srv, _ := newTestServerWithFS(t)
	srv.retryDelay = noDelay
	t.Setenv("AGENTS_BASE_URL", agent.URL)

	err := srv.registerWithAgent(newTestApp())
	if err != nil {
		t.Fatalf("expected success after retries, got %v", err)
	}
	if calls.Load() != 3 {
		t.Errorf("expected 3 calls, got %d", calls.Load())
	}
}

func TestRegisterWithAgentConnectionErrorNoRetry(t *testing.T) {
	srv, _ := newTestServerWithFS(t)
	srv.retryDelay = noDelay
	t.Setenv("AGENTS_BASE_URL", "http://127.0.0.1:1")

	err := srv.registerWithAgent(newTestApp())
	if err == nil {
		t.Fatal("expected error for connection refused")
	}

	var connErr *connectionError
	if !errors.As(err, &connErr) {
		t.Errorf("expected connectionError, got %T: %v", err, err)
	}
}

func TestRegisterWithAgentExhaustsRetries(t *testing.T) {
	var calls atomic.Int32
	agent := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer agent.Close()

	srv, _ := newTestServerWithFS(t)
	srv.retryDelay = noDelay
	t.Setenv("AGENTS_BASE_URL", agent.URL)

	err := srv.registerWithAgent(newTestApp())
	if err == nil {
		t.Fatal("expected error after exhausting retries")
	}
	if !strings.Contains(err.Error(), "failed after") {
		t.Errorf("expected 'failed after' in error, got %v", err)
	}
	if calls.Load() != int32(registerMaxAttempts) {
		t.Errorf("expected %d calls, got %d", registerMaxAttempts, calls.Load())
	}
}

