package pipeline

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/airo-ai-builder/release-manager/internal/config"
)

var zeroDelays = []time.Duration{0, 0, 0, 0}

func newHealthCheckPipeline(url, expectVersion string) *Pipeline {
	cfg := &config.Config{
		Pipeline: config.PipelineConfig{
			Environments: map[string]*config.EnvironmentConfig{
				"test": {Stages: []config.Stage{{
					ID:            "hc",
					Name:          "Health Check",
					Type:          "health-check",
					URL:           url,
					ExpectVersion: expectVersion,
				}}},
			},
		},
	}
	p := New(cfg, &mockRunner{}, false, "main", nil)
	p.HealthCheckDelays = zeroDelays
	_ = p.BuildStages("test")
	return p
}

func TestDoHealthCheck_Success(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(healthResponse{Status: "healthy", Version: "abc1234"})
	}))
	defer srv.Close()

	p := newHealthCheckPipeline(srv.URL, "abc1234def5678")
	client := &http.Client{}
	err := p.doHealthCheck(context.Background(), client, 0, srv.URL, "abc1234def5678")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	stages := p.Stages()
	if stages[0].StatusText != "healthy, version=abc1234" {
		t.Fatalf("unexpected StatusText: %q", stages[0].StatusText)
	}
}

func TestDoHealthCheck_NonOKStatus(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer srv.Close()

	p := newHealthCheckPipeline(srv.URL, "")
	client := &http.Client{}
	err := p.doHealthCheck(context.Background(), client, 0, srv.URL, "")
	if err == nil {
		t.Fatal("expected error for non-200 status")
	}
}

func TestDoHealthCheck_BadJSON(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("not json"))
	}))
	defer srv.Close()

	p := newHealthCheckPipeline(srv.URL, "")
	client := &http.Client{}
	err := p.doHealthCheck(context.Background(), client, 0, srv.URL, "")
	if err == nil {
		t.Fatal("expected error for bad JSON")
	}
}

func TestDoHealthCheck_UnhealthyStatus(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(healthResponse{Status: "degraded", Version: "abc1234"})
	}))
	defer srv.Close()

	p := newHealthCheckPipeline(srv.URL, "")
	client := &http.Client{}
	err := p.doHealthCheck(context.Background(), client, 0, srv.URL, "")
	if err == nil {
		t.Fatal("expected error for unhealthy status")
	}
}

func TestDoHealthCheck_VersionMismatch(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(healthResponse{Status: "healthy", Version: "abc1234"})
	}))
	defer srv.Close()

	p := newHealthCheckPipeline(srv.URL, "zzz9999")
	client := &http.Client{}
	err := p.doHealthCheck(context.Background(), client, 0, srv.URL, "zzz9999")
	if err == nil {
		t.Fatal("expected error for version mismatch")
	}
}

func TestDoHealthCheck_EmptyVersionWithExpect(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(healthResponse{Status: "healthy", Version: ""})
	}))
	defer srv.Close()

	p := newHealthCheckPipeline(srv.URL, "abc1234")
	client := &http.Client{}
	err := p.doHealthCheck(context.Background(), client, 0, srv.URL, "abc1234")
	if err == nil {
		t.Fatal("expected error when expect_version set but response has no version")
	}
}

func TestDoHealthCheck_NoExpectVersion(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(healthResponse{Status: "healthy", Version: "abc1234"})
	}))
	defer srv.Close()

	p := newHealthCheckPipeline(srv.URL, "")
	client := &http.Client{}
	err := p.doHealthCheck(context.Background(), client, 0, srv.URL, "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestRunHealthCheck_RetriesOnFailure(t *testing.T) {
	attempts := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		attempts++
		if attempts < 3 {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		json.NewEncoder(w).Encode(healthResponse{Status: "healthy", Version: "abc1234"})
	}))
	defer srv.Close()

	p := newHealthCheckPipeline(srv.URL, "abc1234")
	err := p.runHealthCheck(context.Background(), 0)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if attempts < 3 {
		t.Fatalf("expected at least 3 attempts, got %d", attempts)
	}
}

func TestRunHealthCheck_ContextCancellationDuringDelay(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer srv.Close()

	p := newHealthCheckPipeline(srv.URL, "")
	// Use a real delay so the select branch is entered, then cancel during it.
	p.HealthCheckDelays = []time.Duration{0, 5 * time.Second}
	ctx, cancel := context.WithCancel(context.Background())
	go func() {
		time.Sleep(50 * time.Millisecond)
		cancel()
	}()
	err := p.runHealthCheck(ctx, 0)
	if err == nil {
		t.Fatal("expected error for cancelled context")
	}
	if err != context.Canceled {
		t.Fatalf("expected context.Canceled, got: %v", err)
	}
}
