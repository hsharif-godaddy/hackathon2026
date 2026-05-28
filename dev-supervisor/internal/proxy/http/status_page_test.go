//nolint:testpackage // Tests use unexported helpers.
package httpproxy

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// mustNewStatusPage wraps NewStatusPage for tests; surfacing the error in
// every test body adds noise without test value (template Execute against
// the constant struct can't fail in practice).
func mustNewStatusPage(t *testing.T, cfg StatusPageConfig) *StatusPage {
	t.Helper()
	sp, err := NewStatusPage(cfg)
	if err != nil {
		t.Fatalf("NewStatusPage: %v", err)
	}
	return sp
}

// renderBody drives sp.ServeHTTP through a recorder so tests inspect the
// same bytes a real client would receive.
func renderBody(t *testing.T, sp *StatusPage) string {
	t.Helper()
	rec := httptest.NewRecorder()
	sp.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))
	return rec.Body.String()
}

func TestStatusPage_Render(t *testing.T) {
	tests := []struct {
		name        string
		cfg         StatusPageConfig
		mustContain []string
		mustNot     []string
	}{
		{
			name: "default coming-soon",
			cfg:  StatusPageConfig{},
			mustContain: []string{
				"<title>Coming Soon!</title>",
				"<h1>Coming Soon!</h1>",
				defaultComingSoonMessage,
				`<meta name="robots" content="noindex, nofollow">`,
			},
		},
		{
			name: "default suspended",
			cfg:  StatusPageConfig{Suspended: true},
			mustContain: []string{
				"<title>Site Suspended</title>",
				defaultSuspendedMessage,
			},
		},
		{
			name: "overrides win",
			cfg:  StatusPageConfig{Title: "Maintenance Window", Message: "Back at noon."},
			mustContain: []string{
				"<title>Maintenance Window</title>",
				"<h1>Maintenance Window</h1>",
				"<p>Back at noon.</p>",
			},
			mustNot: []string{defaultComingSoonMessage},
		},
		{
			name: "escapes user input",
			cfg: StatusPageConfig{
				Title:   `<script>alert("xss")</script>`,
				Message: `4 < 5 & "true"`,
			},
			mustContain: []string{
				"&lt;script&gt;",
				"4 &lt; 5 &amp; &#34;true&#34;",
			},
			mustNot: []string{"<script>alert"},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			cfg := tc.cfg
			cfg.DistDir = t.TempDir()
			body := renderBody(t, mustNewStatusPage(t, cfg))
			for _, s := range tc.mustContain {
				if !strings.Contains(body, s) {
					t.Errorf("expected body to contain %q, got:\n%s", s, body)
				}
			}
			for _, s := range tc.mustNot {
				if strings.Contains(body, s) {
					t.Errorf("expected body to NOT contain %q, got:\n%s", s, body)
				}
			}
		})
	}
}

func TestStatusPage_Active_NoDistCurrent(t *testing.T) {
	sp := mustNewStatusPage(t, StatusPageConfig{DistDir: t.TempDir()})
	if !sp.Active() {
		t.Errorf("expected Active=true when /dist/current is missing")
	}
}

func TestStatusPage_Active_WithDistCurrent(t *testing.T) {
	dir := t.TempDir()
	mustCreateCurrent(t, dir)

	sp := mustNewStatusPage(t, StatusPageConfig{DistDir: dir})
	if sp.Active() {
		t.Errorf("expected Active=false when /dist/current exists")
	}
}

func TestStatusPage_Active_SuspendedAlwaysActive(t *testing.T) {
	dir := t.TempDir()
	mustCreateCurrent(t, dir)

	sp := mustNewStatusPage(t, StatusPageConfig{Suspended: true, DistDir: dir})
	if !sp.Active() {
		t.Errorf("expected Active=true when Suspended, even with /dist/current present")
	}
}

func TestStatusPage_MarkTransitions(t *testing.T) {
	tests := []struct {
		name              string
		suspended         bool
		afterMarkPub      bool
		afterMarkUnpub    bool
		initialActiveWant bool
	}{
		{
			name:              "normal site flips on publish/unpublish",
			suspended:         false,
			initialActiveWant: true, // no /dist/current at construction
			afterMarkPub:      false,
			afterMarkUnpub:    true,
		},
		{
			name:              "suspended site is sticky-active",
			suspended:         true,
			initialActiveWant: true,
			afterMarkPub:      true, // sticky: stays active
			afterMarkUnpub:    true,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			sp := mustNewStatusPage(t, StatusPageConfig{Suspended: tc.suspended, DistDir: t.TempDir()})
			if got := sp.Active(); got != tc.initialActiveWant {
				t.Fatalf("initial Active(): got %v, want %v", got, tc.initialActiveWant)
			}
			sp.MarkPublished()
			if got := sp.Active(); got != tc.afterMarkPub {
				t.Errorf("after MarkPublished: got %v, want %v", got, tc.afterMarkPub)
			}
			sp.MarkUnpublished()
			if got := sp.Active(); got != tc.afterMarkUnpub {
				t.Errorf("after MarkUnpublished: got %v, want %v", got, tc.afterMarkUnpub)
			}
		})
	}
}

func TestStatusPage_ServeHTTP_RendersBody(t *testing.T) {
	sp := mustNewStatusPage(t, StatusPageConfig{
		DistDir: t.TempDir(),
		Title:   "Hello",
	})

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()

	sp.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rec.Code)
	}
	if got := rec.Header().Get("Content-Type"); got != "text/html; charset=utf-8" {
		t.Errorf("expected text/html content type, got %q", got)
	}
	if got := rec.Header().Get("X-Content-Type-Options"); got != "nosniff" {
		t.Errorf("expected X-Content-Type-Options: nosniff, got %q", got)
	}
	if !strings.Contains(rec.Body.String(), "<title>Hello</title>") {
		t.Errorf("expected rendered title in body")
	}
}

func TestStatusPageMiddleware_NilStatusPage_PassesThrough(t *testing.T) {
	called := false
	next := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		called = true
		w.WriteHeader(http.StatusTeapot)
	})

	h := statusPageMiddleware(nil)(next)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))

	if !called {
		t.Errorf("expected next handler to be called when StatusPage is nil")
	}
	if rec.Code != http.StatusTeapot {
		t.Errorf("expected status from next, got %d", rec.Code)
	}
}

func TestStatusPageMiddleware_Inactive_PassesThrough(t *testing.T) {
	dir := t.TempDir()
	mustCreateCurrent(t, dir)
	sp := mustNewStatusPage(t, StatusPageConfig{DistDir: dir})

	called := false
	next := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(testProxyResponse))
	})

	h := statusPageMiddleware(sp)(next)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/anything", nil))

	if !called {
		t.Errorf("expected next handler to be called when StatusPage inactive")
	}
	if rec.Body.String() != testProxyResponse {
		t.Errorf("expected proxied body, got %q", rec.Body.String())
	}
}

func TestStatusPageMiddleware_Active_ServesFallback(t *testing.T) {
	sp := mustNewStatusPage(t, StatusPageConfig{DistDir: t.TempDir()})

	next := http.HandlerFunc(func(_ http.ResponseWriter, _ *http.Request) {
		t.Error("next handler should not be called when StatusPage active")
	})

	h := statusPageMiddleware(sp)(next)

	for _, path := range []string{"/", "/api/users", "/assets/x.png", "/airo-assets/foo", "/airo/auth-check"} {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))

		if rec.Code != http.StatusOK {
			t.Errorf("path %q: expected 200, got %d", path, rec.Code)
		}
		if !strings.Contains(rec.Body.String(), "<title>Coming Soon!</title>") {
			t.Errorf("path %q: expected status-page HTML, got %q", path, rec.Body.String())
		}
	}
}

func TestStatusPageMiddleware_HealthAndCanaryBypass(t *testing.T) {
	sp := mustNewStatusPage(t, StatusPageConfig{DistDir: t.TempDir()})
	if !sp.Active() {
		t.Fatal("expected fallback active for this test")
	}

	called := 0
	next := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		called++
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("upstream"))
	})

	h := statusPageMiddleware(sp)(next)

	for _, path := range []string{"/airo/health", "/airo/canary_checks"} {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))

		if rec.Body.String() != "upstream" {
			t.Errorf("path %q: expected bypass to next, got body %q", path, rec.Body.String())
		}
	}
	if called != 2 {
		t.Errorf("expected next called twice (once per bypass path), got %d", called)
	}
}

func TestStatusPageMiddleware_SetsHandlerNameForLogging(t *testing.T) {
	sp := mustNewStatusPage(t, StatusPageConfig{DistDir: t.TempDir()})
	h := statusPageMiddleware(sp)(http.HandlerFunc(func(_ http.ResponseWriter, _ *http.Request) {}))

	hn := &handlerName{name: "proxy"}
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req = req.WithContext(context.WithValue(req.Context(), handlerKey, hn))

	h.ServeHTTP(httptest.NewRecorder(), req)

	if hn.name != "status_page" {
		t.Errorf("expected handler name to be set to status_page, got %q", hn.name)
	}
}

func mustCreateCurrent(t *testing.T, distDir string) {
	t.Helper()
	target := filepath.Join(distDir, "abc123.tar.gz")
	if err := os.WriteFile(target, []byte("archive"), 0o600); err != nil {
		t.Fatalf("failed to create archive file: %v", err)
	}
	if err := os.Symlink("abc123.tar.gz", filepath.Join(distDir, "current")); err != nil {
		t.Fatalf("failed to create current symlink: %v", err)
	}
}
