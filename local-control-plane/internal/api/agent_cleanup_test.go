package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"sort"
	"strings"
	"sync"
	"testing"
)

// --- deleteAppFromAgent ---

func TestDeleteAppFromAgentSuccess(t *testing.T) {
	var gotMethod, gotPath string
	agent := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotMethod, gotPath = r.Method, r.URL.Path
		w.WriteHeader(http.StatusNoContent)
	}))
	defer agent.Close()
	t.Setenv("AGENTS_BASE_URL", agent.URL)

	if err := deleteAppFromAgent(context.Background(), nil, "abcdef1234"); err != nil {
		t.Fatalf("expected success, got %v", err)
	}
	if gotMethod != http.MethodDelete {
		t.Errorf("expected DELETE, got %s", gotMethod)
	}
	if gotPath != "/apps/abcdef1234" {
		t.Errorf("expected /apps/abcdef1234, got %s", gotPath)
	}
}

// A 404 means the record is already gone — the desired end state, not an error.
func TestDeleteAppFromAgent404IsSuccess(t *testing.T) {
	agent := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer agent.Close()
	t.Setenv("AGENTS_BASE_URL", agent.URL)

	if err := deleteAppFromAgent(context.Background(), nil, "abcdef1234"); err != nil {
		t.Fatalf("expected 404 treated as success, got %v", err)
	}
}

func TestDeleteAppFromAgentNon2xx(t *testing.T) {
	agent := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(`{"error":"boom"}`))
	}))
	defer agent.Close()
	t.Setenv("AGENTS_BASE_URL", agent.URL)

	err := deleteAppFromAgent(context.Background(), nil, "abcdef1234")
	if err == nil {
		t.Fatal("expected error for 500")
	}
	if !strings.Contains(err.Error(), "500") {
		t.Errorf("expected status 500 in error, got %v", err)
	}
	if !strings.Contains(err.Error(), "boom") {
		t.Errorf("expected response body prefix in error, got %v", err)
	}
}

// A malformed app id must be rejected before any request is built, so it can
// never reach the agents URL path.
func TestDeleteAppFromAgentRejectsInvalidID(t *testing.T) {
	var called bool
	agent := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusNoContent)
	}))
	defer agent.Close()
	t.Setenv("AGENTS_BASE_URL", agent.URL)

	for _, bad := range []string{"", "short", "UPPERCASE1", "../../etc", "toolongappid"} {
		if err := deleteAppFromAgent(context.Background(), nil, bad); err == nil {
			t.Errorf("expected error for invalid id %q", bad)
		}
	}
	if called {
		t.Error("no HTTP request should be made for an invalid id")
	}
}

// --- listAgentAppIDs pagination ---

// The pager must follow totalPages and accumulate ids across every page.
func TestListAgentAppIDsPaginates(t *testing.T) {
	agent := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		page := r.URL.Query().Get("page")
		ids := map[string][]string{
			"1": {"aaaaaaaaa1", "aaaaaaaaa2"},
			"2": {"bbbbbbbbb1"},
		}[page]

		apps := make([]map[string]string, 0, len(ids))
		for _, id := range ids {
			apps = append(apps, map[string]string{"id": id})
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"apps":       apps,
			"pagination": map[string]any{"totalPages": 2},
		})
	}))
	defer agent.Close()
	t.Setenv("AGENTS_BASE_URL", agent.URL)

	got, err := listAgentAppIDs(context.Background(), nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	want := []string{"aaaaaaaaa1", "aaaaaaaaa2", "bbbbbbbbb1"}
	if len(got) != len(want) {
		t.Fatalf("expected %v, got %v", want, got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("expected %v, got %v", want, got)
			break
		}
	}
}

// --- isAgentUnreachable ---

// Transport failures (connection refused, timeouts) must be retryable, while
// application errors (non-2xx, decode) must not — even when wrapped the way
// listAgentAppIDs wraps them.
func TestIsAgentUnreachable(t *testing.T) {
	timeout := &url.Error{Op: "Get", URL: "https://agent/apps", Err: context.DeadlineExceeded}
	tests := []struct {
		name string
		err  error
		want bool
	}{
		{"connection refused", &net.OpError{Op: "dial", Err: errors.New("connection refused")}, true},
		{"client timeout", timeout, true},
		{"wrapped timeout", fmt.Errorf("http request: %w", timeout), true},
		{"http status error", errors.New("unexpected status 500"), false},
		{"decode error", fmt.Errorf("decode: %w", errors.New("bad json")), false},
	}
	for _, tt := range tests {
		if got := isAgentUnreachable(tt.err); got != tt.want {
			t.Errorf("%s: isAgentUnreachable = %v, want %v", tt.name, got, tt.want)
		}
	}
}

// --- listAgentAppIDsAwaitReady ---

// A real HTTP error (non-2xx) is permanent — it must not be retried, so the
// call returns promptly rather than spinning until agentReadyTimeout.
func TestListAgentAppIDsAwaitReadyDoesNotRetryHTTPError(t *testing.T) {
	var calls int
	agent := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer agent.Close()
	t.Setenv("AGENTS_BASE_URL", agent.URL)

	if _, err := listAgentAppIDsAwaitReady(context.Background(), nil); err == nil {
		t.Fatal("expected error for 500")
	}
	if calls != 1 {
		t.Errorf("expected exactly 1 attempt (no retry on HTTP error), got %d", calls)
	}
}

// When the agents service is unreachable (connection refused), the wait retries
// but honours context cancellation instead of blocking for agentReadyTimeout.
func TestListAgentAppIDsAwaitReadyBailsOnContextCancel(t *testing.T) {
	agent := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	deadURL := agent.URL
	agent.Close() // port is now refusing connections
	t.Setenv("AGENTS_BASE_URL", deadURL)

	ctx, cancel := context.WithCancel(context.Background())
	cancel() // already cancelled: the first retry wait returns immediately

	if _, err := listAgentAppIDsAwaitReady(ctx, nil); err == nil {
		t.Fatal("expected error when agents unreachable and context cancelled")
	}
}

// --- SweepOrphanAgentApps ---

// The sweep must delete exactly the agents apps that have no control-plane row,
// and leave the known ones untouched.
func TestSweepOrphanAgentAppsDeletesOnlyOrphans(t *testing.T) {
	srv := newTestServer(t)
	known1, _ := srv.DB.CreateApp("sub-1", "sys-1", nil, nil)
	known2, _ := srv.DB.CreateApp("sub-1", "sys-1", nil, nil)

	orphans := []string{"orphan0001", "orphan0002"}
	agentApps := []string{known1.ID, known2.ID, orphans[0], orphans[1]}

	var mu sync.Mutex
	var deleted []string

	agent := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/apps":
			apps := make([]map[string]string, 0, len(agentApps))
			for _, id := range agentApps {
				apps = append(apps, map[string]string{"id": id})
			}
			resp := map[string]any{
				"apps":       apps,
				"pagination": map[string]any{"totalPages": 1},
			}
			_ = json.NewEncoder(w).Encode(resp)
		case r.Method == http.MethodDelete && strings.HasPrefix(r.URL.Path, "/apps/"):
			mu.Lock()
			deleted = append(deleted, strings.TrimPrefix(r.URL.Path, "/apps/"))
			mu.Unlock()
			w.WriteHeader(http.StatusNoContent)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer agent.Close()
	t.Setenv("AGENTS_BASE_URL", agent.URL)

	SweepOrphanAgentApps(context.Background(), srv.DB, nil)

	sort.Strings(deleted)
	sort.Strings(orphans)
	if len(deleted) != len(orphans) {
		t.Fatalf("expected %d deletes, got %d (%v)", len(orphans), len(deleted), deleted)
	}
	for i := range orphans {
		if deleted[i] != orphans[i] {
			t.Errorf("deleted mismatch: got %v, want %v", deleted, orphans)
			break
		}
	}
}
