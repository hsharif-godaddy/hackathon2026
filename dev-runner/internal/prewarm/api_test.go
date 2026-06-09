package prewarm

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestWarmAPIHitsEveryRoute(t *testing.T) {
	var hits int64
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt64(&hits, 1)
		// Mixed responses: some 200, some 405/redirect — all are fine.
		switch {
		case r.URL.Path == "/api/health":
			w.WriteHeader(http.StatusOK)
		case strings.HasPrefix(r.URL.Path, "/apps"):
			http.Redirect(w, r, "/login", http.StatusFound)
		default:
			w.WriteHeader(http.StatusMethodNotAllowed)
		}
	}))
	defer srv.Close()

	var out strings.Builder
	if err := WarmAPI(context.Background(), srv.URL, &out); err != nil {
		t.Fatalf("WarmAPI returned error: %v", err)
	}
	// Ready probe (GET /) + one GET per route.
	if got := atomic.LoadInt64(&hits); got < int64(len(Routes)) {
		t.Errorf("hits = %d, want >= %d", got, len(Routes))
	}
	if !strings.Contains(out.String(), "/api/health") {
		t.Errorf("output missing per-route lines:\n%s", out.String())
	}
}

func TestWarmAPIServerNeverReady(t *testing.T) {
	// Closed server: connection refused. Use a tiny ready timeout via context.
	srv := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	url := srv.URL
	srv.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()
	if err := WarmAPI(ctx, url, &strings.Builder{}); err == nil {
		t.Error("WarmAPI = nil error, want timeout/ready error when server is down")
	}
}
