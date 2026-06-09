# dev-runner prewarm Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an on-demand "prewarm" feature to dev-runner that (a) compiles Next.js routes by GETting them and (b) warms the Docker layer cache for the two app-container images, so creating a new local app is fast.

**Architecture:** A new pure Go package `dev-runner/internal/prewarm` holds the warming logic (route GET-loop + an HTTP call to local-control-plane). local-control-plane exposes a loopback-guarded `POST /api/_debug/prewarm-images` that reuses its existing `ensureImages()` verbatim (cache-key parity). The dev-runner TUI gets a `w` keybinding opening a multi-select picker (both tasks default-on), and a `dev-runner prewarm` startup subcommand that boots the dev env and auto-fires prewarm once all services are healthy.

**Tech Stack:** Go 1.25, Bubble Tea v2 (`charm.land/bubbletea/v2`), huh v2 (`charm.land/huh/v2`), `charm.land/bubbles/v2/key`, stdlib `net/http`/`crypto/tls`/`httptest`. local-control-plane uses gorilla/mux + `log/slog`.

**Spec:** `docs/superpowers/specs/2026-06-04-dev-runner-prewarm-design.md`

**Constraints:**
- dev-runner MUST NOT import GoDaddy-internal Go modules (stdlib + charm only; docker work delegated over HTTP).
- The Docker prewarm MUST reuse `ensureImages()` unchanged — do not duplicate any `docker buildx` command.

**Commands (run from repo root):**
- dev-runner build/test: `cd dev-runner && make check` (fmt, vet, lint, test). Quick test: `cd dev-runner && go test ./internal/...`
- LCP build/test: `cd local-control-plane && make test` ; lint: `make lint`
- A full monorepo `pnpm install` is NOT required — all code here is Go.

---

## Phase A — `dev-runner/internal/prewarm` package (pure Go)

### Task A1: Task/Selection types

**Files:**
- Create: `dev-runner/internal/prewarm/task.go`
- Test: `dev-runner/internal/prewarm/task_test.go`

- [ ] **Step 1: Write the failing test**

```go
package prewarm

import "testing"

func TestSelectionEmpty(t *testing.T) {
	cases := []struct {
		name string
		sel  Selection
		want bool
	}{
		{"both", Selection{API: true, Docker: true}, false},
		{"api only", Selection{API: true}, false},
		{"docker only", Selection{Docker: true}, false},
		{"none", Selection{}, true},
	}
	for _, c := range cases {
		if got := c.sel.Empty(); got != c.want {
			t.Errorf("%s: Empty() = %v, want %v", c.name, got, c.want)
		}
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd dev-runner && go test ./internal/prewarm/ -run TestSelectionEmpty -v`
Expected: FAIL — `undefined: Selection` (package doesn't compile).

- [ ] **Step 3: Write minimal implementation**

```go
// Package prewarm warms the slow paths of local app creation: Next.js route
// compilation (via HTTP GET) and the Docker layer cache for the app-container
// images (via a local-control-plane endpoint). It is UI-agnostic so the
// dev-runner TUI picker and the `dev-runner prewarm` CLI share one code path.
package prewarm

// Selection is the set of prewarm tasks to run. The zero value runs nothing.
type Selection struct {
	API    bool // warm Next.js route compilation
	Docker bool // warm the Docker image layer cache
}

// Empty reports whether no task is selected.
func (s Selection) Empty() bool {
	return !s.API && !s.Docker
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd dev-runner && go test ./internal/prewarm/ -run TestSelectionEmpty -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add dev-runner/internal/prewarm/task.go dev-runner/internal/prewarm/task_test.go
git commit -m "feat(dev-runner): add prewarm.Selection task model"
```

---

### Task A2: Route list

**Files:**
- Create: `dev-runner/internal/prewarm/routes.go`
- Test: `dev-runner/internal/prewarm/routes_test.go`

- [ ] **Step 1: Write the failing test**

```go
package prewarm

import (
	"strings"
	"testing"
)

func TestRoutesWellFormed(t *testing.T) {
	if len(Routes) == 0 {
		t.Fatal("Routes is empty")
	}
	seen := map[string]bool{}
	for _, r := range Routes {
		if !strings.HasPrefix(r, "/") {
			t.Errorf("route %q is not an absolute path", r)
		}
		if strings.Contains(r, " ") {
			t.Errorf("route %q contains a space", r)
		}
		if seen[r] {
			t.Errorf("duplicate route %q", r)
		}
		seen[r] = true
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd dev-runner && go test ./internal/prewarm/ -run TestRoutesWellFormed -v`
Expected: FAIL — `undefined: Routes`.

- [ ] **Step 3: Write minimal implementation**

Port the route list verbatim from the (to-be-deleted) `app/scripts/prewarm.mjs`. `_warmup` stands in for any dynamic segment (`[id]`/`[appId]`/`[name]`) — the Next.js compiler keys on the route shape, not the value.

```go
package prewarm

// Routes is the list of app paths to GET to force Next.js dev compilation.
// Ported from app/scripts/prewarm.mjs. Page paths use the bare (no-market)
// form; middleware rewrites `/foo` to `/<market>/foo`, compiling the same
// chunk. `_warmup` stands in for any dynamic segment. GETting a POST-only
// route returns 405, but Next.js compiles the handler either way.
var Routes = []string{
	// Pages
	"/apps",
	"/create",
	"/develop/_warmup",
	"/develop/_warmup/context",
	"/explore",
	"/explore/_warmup",
	"/manage-plan",
	"/share/_warmup",

	// Auth, config, well-known
	"/.well-known/jwks.json",
	"/api/auth/agent-token",
	"/api/auth/logout",
	"/api/auth/token",
	"/api/auth/validate",
	"/api/config",
	"/api/health",
	"/api/i18n/package",

	// Apps
	"/api/apps/_warmup/deployments",
	"/api/apps/_warmup/dkim/offboard",
	"/api/apps/_warmup/dkim/onboard",
	"/api/apps/_warmup/dkim/status",
	"/api/apps/_warmup/dns-check-conflict",
	"/api/apps/_warmup/domain/check",
	"/api/apps/_warmup/download",
	"/api/apps/_warmup/email-signing/debug",
	"/api/apps/_warmup/events",
	"/api/apps/_warmup/exports",
	"/api/apps/_warmup/git/return",
	"/api/apps/_warmup/project-domain",
	"/api/apps/_warmup/publish-snapshots",
	"/api/apps/_warmup/purge-cache",
	"/api/apps/_warmup/share",
	"/api/apps/_warmup/subscription",
	"/api/apps/_warmup/transfer",
	"/api/apps/_warmup/transfer/cancel",
	"/api/apps/_warmup/transfer/validate",
	"/api/apps/_warmup/unpublish",

	// Sites
	"/api/sites",
	"/api/sites/_warmup",
	"/api/sites/_warmup/archive-restore",
	"/api/sites/_warmup/archive-status",
	"/api/sites/_warmup/deploy",
	"/api/sites/_warmup/domain-dns-ownership",
	"/api/sites/_warmup/domain-errors",
	"/api/sites/_warmup/domains",
	"/api/sites/_warmup/domains/job",
	"/api/sites/_warmup/image-status",
	"/api/sites/_warmup/reload-images",
	"/api/sites/_warmup/resume",
	"/api/sites/_warmup/variables",
	"/api/sites/quick-create",

	// Servers
	"/api/servers",
	"/api/servers/_warmup",

	// Subscriptions, entitlements, pricing, grants, token budget
	"/api/credits/grants",
	"/api/ecomm-subscription/auto-renew",
	"/api/ecomm-subscription/status",
	"/api/entitlements",
	"/api/entitlements/_warmup/update",
	"/api/pricing/offers",
	"/api/subscription-cache",
	"/api/subscription/exports/status",
	"/api/subscriptions",
	"/api/subscriptions/_warmup",
	"/api/subscriptions/_warmup/acknowledge",
	"/api/subscriptions/renew",
	"/api/token-budget/_warmup",

	// Database
	"/api/database/_warmup/tables",
	"/api/database/_warmup/tables/_warmup/data",
	"/api/database/_warmup/tables/_warmup/export",
	"/api/database/_warmup/tables/_warmup/rows",
	"/api/database/_warmup/tables/_warmup/schema",

	// Domains
	"/api/domains",
	"/api/domains/config",
	"/api/domains/isc-session",
	"/api/domains/search",

	// Develop, conversations, jobs, projects, venture, transfer
	"/api/conversations",
	"/api/develop/_warmup/context",
	"/api/jobs/_warmup",
	"/api/projects",
	"/api/transfer",
	"/api/venture",

	// Secrets, security
	"/api/secrets/_warmup/diff",
	"/api/secrets/_warmup/sync",
	"/api/secrets/_warmup/variants/_warmup",
	"/api/security-report/_warmup",

	// Analytics, logs, feedback, referrals, misc
	"/api/analytics/graphql",
	"/api/analytics/insights-feedback",
	"/api/cds-log",
	"/api/client-logs",
	"/api/crm/case",
	"/api/es-logs",
	"/api/eval-snapshots",
	"/api/feedback/s3-store",
	"/api/marketing/calendar",
	"/api/mcp/proxy",
	"/api/referral-link",
	"/api/referral/track",
	"/api/slack-webhook/feedback",
	"/api/testpilot",
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd dev-runner && go test ./internal/prewarm/ -run TestRoutesWellFormed -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add dev-runner/internal/prewarm/routes.go dev-runner/internal/prewarm/routes_test.go
git commit -m "feat(dev-runner): port prewarm route list to Go"
```

---

### Task A3: WarmAPI (route GET-loop)

**Files:**
- Create: `dev-runner/internal/prewarm/api.go`
- Test: `dev-runner/internal/prewarm/api_test.go`

- [ ] **Step 1: Write the failing test**

```go
package prewarm

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
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
```

Add `"time"` to the test imports.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd dev-runner && go test ./internal/prewarm/ -run TestWarmAPI -v`
Expected: FAIL — `undefined: WarmAPI`.

- [ ] **Step 3: Write minimal implementation**

```go
package prewarm

import (
	"context"
	"crypto/tls"
	"fmt"
	"io"
	"net/http"
	"sync"
	"time"
)

const (
	readyPollInterval = 1 * time.Second
	readyProbeTimeout = 5 * time.Second
	routeTimeout      = 120 * time.Second
	// maxConcurrency bounds simultaneous in-flight route GETs so we don't
	// open ~140 sockets at once (the script's unbounded Promise.all).
	maxConcurrency = 12
)

// insecureClient trusts the dev proxy's mkcert cert (Go's bundle rejects it
// with UNABLE_TO_VERIFY_LEAF_SIGNATURE). Scoped to this package; never used
// for anything but localhost dev warming. redirect:manual mirrors the script.
func insecureClient() *http.Client {
	return &http.Client{
		Transport: &http.Transport{
			TLSClientConfig: &tls.Config{InsecureSkipVerify: true}, //nolint:gosec // localhost dev cert only
		},
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
}

// WarmAPI waits for baseURL to accept connections, then GETs every route in
// Routes (bounded concurrency) to force Next.js dev compilation. Per-route
// failures are written to out and ignored — the goal is compilation, not a
// successful response. It returns an error only if the server never becomes
// ready before ctx is done.
func WarmAPI(ctx context.Context, baseURL string, out io.Writer) error {
	client := insecureClient()

	if err := waitForReady(ctx, client, baseURL, out); err != nil {
		return err
	}
	fmt.Fprintf(out, "[prewarm] up; warming %d routes\n", len(Routes))

	sem := make(chan struct{}, maxConcurrency)
	var wg sync.WaitGroup
	for _, path := range Routes {
		wg.Add(1)
		sem <- struct{}{}
		go func(path string) {
			defer wg.Done()
			defer func() { <-sem }()
			warmRoute(ctx, client, baseURL, path, out)
		}(path)
	}
	wg.Wait()
	fmt.Fprintln(out, "[prewarm] done")
	return nil
}

func waitForReady(ctx context.Context, client *http.Client, baseURL string, out io.Writer) error {
	fmt.Fprintf(out, "[prewarm] waiting for %s ...\n", baseURL)
	for {
		if ctx.Err() != nil {
			return fmt.Errorf("timed out waiting for %s: %w", baseURL, ctx.Err())
		}
		probeCtx, cancel := context.WithTimeout(ctx, readyProbeTimeout)
		req, _ := http.NewRequestWithContext(probeCtx, http.MethodGet, baseURL+"/", nil)
		resp, err := client.Do(req)
		cancel()
		if err == nil {
			_ = resp.Body.Close()
			return nil
		}
		select {
		case <-ctx.Done():
			return fmt.Errorf("timed out waiting for %s: %w", baseURL, ctx.Err())
		case <-time.After(readyPollInterval):
		}
	}
}

func warmRoute(ctx context.Context, client *http.Client, baseURL, path string, out io.Writer) {
	start := time.Now()
	reqCtx, cancel := context.WithTimeout(ctx, routeTimeout)
	defer cancel()
	req, _ := http.NewRequestWithContext(reqCtx, http.MethodGet, baseURL+path, nil)
	resp, err := client.Do(req)
	ms := time.Since(start).Milliseconds()
	if err != nil {
		fmt.Fprintf(out, "  ERR  %6dms  %s  (%v)\n", ms, path, err)
		return
	}
	_ = resp.Body.Close()
	fmt.Fprintf(out, "  %3d  %6dms  %s\n", resp.StatusCode, ms, path)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd dev-runner && go test ./internal/prewarm/ -run TestWarmAPI -v`
Expected: PASS (both subtests).

- [ ] **Step 5: Commit**

```bash
git add dev-runner/internal/prewarm/api.go dev-runner/internal/prewarm/api_test.go
git commit -m "feat(dev-runner): WarmAPI route compilation warmer"
```

---

### Task A4: WarmImages (HTTP call to LCP)

**Files:**
- Create: `dev-runner/internal/prewarm/images.go`
- Test: `dev-runner/internal/prewarm/images_test.go`

- [ ] **Step 1: Write the failing test**

```go
package prewarm

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestWarmImagesSuccess(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/api/_debug/prewarm-images" {
			t.Errorf("unexpected request %s %s", r.Method, r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"images":["aab-template-v8:latest","aab-publish:latest"],"durationMs":1234}`))
	}))
	defer srv.Close()

	var out strings.Builder
	if err := WarmImages(context.Background(), srv.URL, &out); err != nil {
		t.Fatalf("WarmImages error: %v", err)
	}
	if !strings.Contains(out.String(), "aab-template-v8:latest") {
		t.Errorf("output missing image names:\n%s", out.String())
	}
}

func TestWarmImagesBuildError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(`{"error":"build image aab-template-v8: exit status 1"}`))
	}))
	defer srv.Close()

	err := WarmImages(context.Background(), srv.URL, &strings.Builder{})
	if err == nil || !strings.Contains(err.Error(), "build image") {
		t.Errorf("WarmImages err = %v, want build error", err)
	}
}

func TestWarmImagesControlPlaneDown(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	url := srv.URL
	srv.Close()
	if err := WarmImages(context.Background(), url, &strings.Builder{}); err == nil {
		t.Error("WarmImages = nil, want connection error when control plane is down")
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd dev-runner && go test ./internal/prewarm/ -run TestWarmImages -v`
Expected: FAIL — `undefined: WarmImages`.

- [ ] **Step 3: Write minimal implementation**

```go
package prewarm

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
)

// imagesResponse is the JSON shape returned by the LCP prewarm endpoint.
type imagesResponse struct {
	Images     []string `json:"images"`
	DurationMs int64    `json:"durationMs"`
	Error      string   `json:"error"`
}

// WarmImages asks local-control-plane to build (and thus layer-cache) the
// app-container images so a subsequent per-app build is a cache hit. It POSTs
// the loopback-guarded endpoint and relays the result to out. The build runs
// synchronously server-side and can take minutes on a cold cache, so no client
// timeout is imposed beyond ctx.
func WarmImages(ctx context.Context, controlPlaneURL string, out io.Writer) error {
	url := strings.TrimRight(controlPlaneURL, "/") + "/api/_debug/prewarm-images"
	fmt.Fprintf(out, "[prewarm] building images via %s ...\n", url)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, nil)
	if err != nil {
		return fmt.Errorf("build request: %w", err)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("contact control plane: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	body, _ := io.ReadAll(resp.Body)
	var parsed imagesResponse
	_ = json.Unmarshal(body, &parsed)

	if resp.StatusCode != http.StatusOK {
		if parsed.Error != "" {
			return fmt.Errorf("prewarm-images failed: %s", parsed.Error)
		}
		return fmt.Errorf("prewarm-images failed: HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	fmt.Fprintf(out, "[prewarm] images built in %dms: %s\n", parsed.DurationMs, strings.Join(parsed.Images, ", "))
	return nil
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd dev-runner && go test ./internal/prewarm/ -v`
Expected: PASS (all prewarm tests).

- [ ] **Step 5: Commit**

```bash
git add dev-runner/internal/prewarm/images.go dev-runner/internal/prewarm/images_test.go
git commit -m "feat(dev-runner): WarmImages calls LCP prewarm endpoint"
```

---

## Phase B — local-control-plane endpoint

### Task B1: `Manager.PrewarmImages()` wrapper

**Files:**
- Modify: `local-control-plane/internal/docker/manager.go` (add method after `ensureImages`, ~line 139)

- [ ] **Step 1: Add the exported wrapper**

Add immediately after the `ensureImages` method (do not modify `ensureImages`/`buildImage`/`buildPublishImage` — identical build args are the whole point):

```go
// PrewarmImages builds the template + publish images, warming the Docker layer
// cache so a subsequent per-app Up()->ensureImages() is a cache hit. It runs
// the identical buildx invocation ensureImages() uses, guaranteeing the same
// cache key.
func (m *Manager) PrewarmImages() error {
	return m.ensureImages()
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd local-control-plane && go build ./...`
Expected: no output (success).

- [ ] **Step 3: Commit**

```bash
git add local-control-plane/internal/docker/manager.go
git commit -m "feat(local-control-plane): exported Manager.PrewarmImages wrapper"
```

---

### Task B2: Loopback-guarded handler + route

**Files:**
- Create: `local-control-plane/internal/api/prewarm.go`
- Create: `local-control-plane/internal/api/prewarm_test.go`
- Modify: `local-control-plane/internal/api/router.go` (add field to `Server`, wire default, register route)

- [ ] **Step 1: Write the failing test**

```go
package api

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type stubPrewarmer struct {
	called bool
	err    error
}

func (s *stubPrewarmer) PrewarmImages() error { s.called = true; return s.err }

func TestPrewarmImagesLoopbackAllowed(t *testing.T) {
	stub := &stubPrewarmer{}
	srv := &Server{imagePrewarmer: stub}

	req := httptest.NewRequest(http.MethodPost, "/api/_debug/prewarm-images", nil)
	req.RemoteAddr = "127.0.0.1:54321"
	rec := httptest.NewRecorder()

	srv.PrewarmImages(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if !stub.called {
		t.Error("PrewarmImages was not called")
	}
	if !strings.Contains(rec.Body.String(), "aab-template-v8:latest") {
		t.Errorf("body missing image names: %s", rec.Body.String())
	}
}

func TestPrewarmImagesNonLoopbackForbidden(t *testing.T) {
	stub := &stubPrewarmer{}
	srv := &Server{imagePrewarmer: stub}

	req := httptest.NewRequest(http.MethodPost, "/api/_debug/prewarm-images", nil)
	req.RemoteAddr = "10.0.0.5:54321"
	rec := httptest.NewRecorder()

	srv.PrewarmImages(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", rec.Code)
	}
	if stub.called {
		t.Error("PrewarmImages should not be called for non-loopback request")
	}
}

func TestPrewarmImagesBuildError(t *testing.T) {
	stub := &stubPrewarmer{err: errors.New("build image aab-template-v8: exit status 1")}
	srv := &Server{imagePrewarmer: stub}

	req := httptest.NewRequest(http.MethodPost, "/api/_debug/prewarm-images", nil)
	req.RemoteAddr = "[::1]:54321"
	rec := httptest.NewRecorder()

	srv.PrewarmImages(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "build image") {
		t.Errorf("body missing error: %s", rec.Body.String())
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd local-control-plane && go test ./internal/api/ -run TestPrewarmImages -v`
Expected: FAIL — `Server has no field imagePrewarmer` / `srv.PrewarmImages undefined`.

- [ ] **Step 3: Write the handler**

Create `local-control-plane/internal/api/prewarm.go`:

```go
package api

import (
	"log/slog"
	"net"
	"net/http"
	"time"
)

// imagePrewarmer builds (and layer-caches) the app-container images. Satisfied
// by *docker.Manager; an interface so handler tests can inject a stub without
// invoking a real docker build.
type imagePrewarmer interface {
	PrewarmImages() error
}

// PrewarmImages builds the template + publish images to warm the Docker layer
// cache. It is a dev-only convenience: local-control-plane is never deployed,
// and this guard rejects any non-loopback caller as defense-in-depth.
func (s *Server) PrewarmImages(w http.ResponseWriter, r *http.Request) {
	if !isLoopbackRequest(r) {
		writeError(w, http.StatusForbidden, "prewarm-images is local-only")
		return
	}

	start := time.Now()
	slog.Info("prewarm.images.start")
	if err := s.imagePrewarmer.PrewarmImages(); err != nil {
		slog.Error("prewarm.images.failed", "error", err)
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	durationMs := time.Since(start).Milliseconds()
	slog.Info("prewarm.images.success", "duration_ms", durationMs)
	writeJSON(w, http.StatusOK, map[string]any{
		"images":     []string{"aab-template-v8:latest", "aab-publish:latest"},
		"durationMs": durationMs,
	})
}

// isLoopbackRequest reports whether the request originates from the local host.
func isLoopbackRequest(r *http.Request) bool {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}
```

- [ ] **Step 4: Wire the Server field + route**

In `local-control-plane/internal/api/router.go`, add the field to `Server`:

```go
type Server struct {
	DB            *store.DB
	DockerManager *docker.Manager
	TemplateSetup *setup.TemplateSetup
	JWT           *auth.JWTService

	// imagePrewarmer warms the Docker image cache (defaults to DockerManager;
	// overridden in handler tests).
	imagePrewarmer imagePrewarmer

	retryDelay func(attempt int) time.Duration
}
```

In `NewRouter`, set the default after `srv` is constructed:

```go
	srv := &Server{
		DB:            db,
		DockerManager: docker.NewManager(),
		TemplateSetup: setup.NewTemplateSetup(),
		JWT:           jwtService,
	}
	srv.imagePrewarmer = srv.DockerManager
```

Register the route beside the other `/api/_debug/*` routes (next to `inject-error`/`clear-error`):

```go
	r.HandleFunc("/api/_debug/prewarm-images", srv.PrewarmImages).Methods("POST")
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd local-control-plane && go test ./internal/api/ -run TestPrewarmImages -v`
Expected: PASS (all three subtests).

- [ ] **Step 6: Commit**

```bash
git add local-control-plane/internal/api/prewarm.go local-control-plane/internal/api/prewarm_test.go local-control-plane/internal/api/router.go
git commit -m "feat(local-control-plane): loopback-guarded /api/_debug/prewarm-images"
```

---

## Phase C — dev-runner TUI integration

### Task C1: Model fields + modal-infra wiring

**Files:**
- Modify: `dev-runner/internal/tui/model.go` (add fields near the other picker fields ~line 192; add `prewarmDoneMsg`)
- Modify: `dev-runner/internal/tui/form_helpers.go` (`anyModalOpen`, `resizeForms`, `forwardToActiveForm`)

- [ ] **Step 1: Add model fields + message type**

In `model.go`, in the `Model` struct near `cleanPickerForm`/`e2ePickerForm` fields, add:

```go
	// prewarm picker + run state (overlay during PhaseRunning)
	prewarmPickerForm  *huh.Form
	prewarmPickerValue *[]int // indices into prewarmGroups
	prewarmRunning     bool
	prewarmOutput      string
	prewarmErr         error
	prewarmOnHealthy   *prewarm.Selection // non-nil => auto-fire once all healthy
	prewarmAutoFired   bool
```

Add the import `"github.com/airo-ai-builder/dev-runner/internal/prewarm"` to `model.go`.

Add the done-message type near `cleanDoneMsg` (~line 104):

```go
// prewarmDoneMsg is emitted once the goroutine running a prewarm finishes.
type prewarmDoneMsg struct {
	Output string
	Err    error
}
```

- [ ] **Step 2: Add `prewarmPickerActive` and wire modal infra**

In `form_helpers.go`, add a helper (near where `e2ePickerActive` etc. are referenced):

```go
// prewarmPickerActive reports whether the prewarm picker overlay is open.
func (m Model) prewarmPickerActive() bool {
	return m.prewarmPickerForm != nil
}
```

Extend `anyModalOpen` to include the prewarm picker AND the running/result overlay (so background interaction is gated while prewarm output is showing):

```go
func (m Model) anyModalOpen() bool {
	return m.settingsForm != nil || m.devSettingsForm != nil || m.quitConfirmForm != nil ||
		m.e2ePickerActive() || m.probePickerActive() || m.probeCustomRunActive() || m.probeEnvEditActive() ||
		m.prewarmPickerActive() || m.prewarmRunning || m.prewarmErr != nil
}
```

Add `m.prewarmPickerForm` to the modal-form list in `resizeForms`:

```go
	for _, f := range []*huh.Form{m.devSettingsForm, m.quitConfirmForm, m.settingsForm, m.e2ePickerForm, m.probePickerForm, m.probeCustomRunForm, m.probeEnvEditForm, m.prewarmPickerForm} {
		m.applyModalForm(f)
	}
```

Add a case to `forwardToActiveForm` (after the probe cases):

```go
	case m.prewarmPickerForm != nil:
		return m.updatePrewarmPicker(msg)
```

- [ ] **Step 3: Verify it compiles (updatePrewarmPicker not yet defined → expect failure, that's fine for now)**

Run: `cd dev-runner && go build ./internal/tui/ 2>&1 | head`
Expected: FAIL — `m.updatePrewarmPicker undefined` and `prewarmGroups undefined`. (Resolved in Task C3.) Do NOT commit yet; continue to C2/C3 which complete the compile.

> Note: Tasks C1–C3 land together as a compiling unit. Commit at the end of C3.

---

### Task C2: `appBaseURL` helper

**Files:**
- Modify: `dev-runner/internal/tui/model.go` (add helper next to `controlPlaneBaseURL`, ~line 637)
- Test: `dev-runner/internal/tui/prewarm_url_test.go`

- [ ] **Step 1: Write the failing test**

```go
package tui

import (
	"testing"
	"time"

	"github.com/airo-ai-builder/dev-runner/internal/config"
)

func TestAppBaseURL(t *testing.T) {
	cfg := &config.Config{Processes: []config.ProcessConfig{
		{Name: "App", HealthCheck: &config.HealthCheck{URL: "https://local.gasket.dev-godaddy.com:8443/api/health", UnhealthyInterval: time.Second}},
	}}
	if got := appBaseURL(cfg); got != "https://local.gasket.dev-godaddy.com:8443" {
		t.Errorf("appBaseURL = %q, want scheme+host", got)
	}
}

func TestAppBaseURLDefault(t *testing.T) {
	cfg := &config.Config{Processes: []config.ProcessConfig{{Name: "Other"}}}
	if got := appBaseURL(cfg); got != "https://local.gasket.dev-godaddy.com:8443" {
		t.Errorf("appBaseURL default = %q", got)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd dev-runner && go test ./internal/tui/ -run TestAppBaseURL -v`
Expected: FAIL — `undefined: appBaseURL` (and the package may not compile yet from C1; that's expected — this test passes once C2+C3 land).

- [ ] **Step 3: Write the helper**

In `model.go`, next to `controlPlaneBaseURL`:

```go
// appBaseURL extracts scheme+host from the App process health check, or
// defaults to the standard local Gasket proxy URL.
func appBaseURL(cfg *config.Config) string {
	for _, p := range cfg.Processes {
		if p.Name == "App" && p.HealthCheck != nil {
			if parsed, err := url.Parse(p.HealthCheck.URL); err == nil {
				return parsed.Scheme + "://" + parsed.Host
			}
		}
	}
	return "https://local.gasket.dev-godaddy.com:8443"
}
```

(`net/url` is already imported in `model.go`.)

---

### Task C3: prewarm picker + runner

**Files:**
- Create: `dev-runner/internal/tui/prewarm_picker.go`
- Test: `dev-runner/internal/tui/prewarm_picker_test.go`

- [ ] **Step 1: Write the failing test**

```go
package tui

import "testing"

func TestAssemblePrewarmSelection(t *testing.T) {
	all := assemblePrewarmSelection([]int{0, 1})
	if !all.API || !all.Docker {
		t.Errorf("indices [0,1] => %+v, want both", all)
	}
	apiOnly := assemblePrewarmSelection([]int{0})
	if !apiOnly.API || apiOnly.Docker {
		t.Errorf("index [0] => %+v, want API only", apiOnly)
	}
	dockerOnly := assemblePrewarmSelection([]int{1})
	if dockerOnly.API || !dockerOnly.Docker {
		t.Errorf("index [1] => %+v, want Docker only", dockerOnly)
	}
	none := assemblePrewarmSelection(nil)
	if !none.Empty() {
		t.Errorf("nil => %+v, want empty", none)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd dev-runner && go test ./internal/tui/ -run TestAssemblePrewarmSelection -v`
Expected: FAIL — `undefined: assemblePrewarmSelection`.

- [ ] **Step 3: Write the picker + runner**

Create `dev-runner/internal/tui/prewarm_picker.go`:

```go
package tui

import (
	"context"
	"strings"

	tea "charm.land/bubbletea/v2"
	"charm.land/huh/v2"
	"charm.land/lipgloss/v2"

	"github.com/airo-ai-builder/dev-runner/internal/clean"
	"github.com/airo-ai-builder/dev-runner/internal/prewarm"
)

// prewarmGroup describes one row in the prewarm picker. set() turns a selected
// index into a prewarm.Selection mutation.
type prewarmGroup struct {
	label    string
	selected bool
	set      func(*prewarm.Selection)
}

var prewarmGroups = []prewarmGroup{
	{
		label:    "API routes (compile Next.js routes via HTTP)",
		selected: true,
		set:      func(s *prewarm.Selection) { s.API = true },
	},
	{
		label:    "Docker images (warm aab-template-v8 + aab-publish layer cache)",
		selected: true,
		set:      func(s *prewarm.Selection) { s.Docker = true },
	},
}

// assemblePrewarmSelection turns picker indices into a prewarm.Selection.
func assemblePrewarmSelection(indices []int) prewarm.Selection {
	var sel prewarm.Selection
	for _, i := range indices {
		if i >= 0 && i < len(prewarmGroups) {
			prewarmGroups[i].set(&sel)
		}
	}
	return sel
}

// openPrewarmPicker builds the multi-select overlay form (both default-on).
func (m *Model) openPrewarmPicker() tea.Cmd {
	opts := make([]huh.Option[int], len(prewarmGroups))
	selected := make([]int, 0, len(prewarmGroups))
	for i, g := range prewarmGroups {
		opts[i] = huh.NewOption(g.label, i).Selected(g.selected)
		if g.selected {
			selected = append(selected, i)
		}
	}
	form := huh.NewForm(
		huh.NewGroup(
			huh.NewMultiSelect[int]().
				Title("Prewarm which targets?").
				Description("Space toggles, Enter confirms, Esc cancels.").
				Options(opts...).
				Value(&selected).
				Height(len(prewarmGroups) + 2),
		),
	).WithShowHelp(true)

	m.prewarmPickerForm = m.applyModalForm(form)
	m.prewarmPickerValue = &selected
	return m.prewarmPickerForm.Init()
}

// updatePrewarmPicker forwards messages to the picker and runs on completion.
func (m *Model) updatePrewarmPicker(msg tea.Msg) tea.Cmd {
	if m.prewarmPickerForm == nil {
		return nil
	}
	var cmd tea.Cmd
	m.prewarmPickerForm, cmd = stepForm(m.prewarmPickerForm, msg)

	switch m.prewarmPickerForm.State {
	case huh.StateCompleted:
		sel := assemblePrewarmSelection(*m.prewarmPickerValue)
		m.prewarmPickerForm = nil
		m.prewarmPickerValue = nil
		if sel.Empty() {
			return nil
		}
		return m.runPrewarm(sel)
	case huh.StateAborted:
		m.prewarmPickerForm = nil
		m.prewarmPickerValue = nil
		return nil
	}
	return cmd
}

// runPrewarm starts a goroutine that runs the selected warmers, capturing
// output to a SafeBuffer and emitting prewarmDoneMsg. Shared by the picker
// confirm and the auto-fire path.
func (m *Model) runPrewarm(sel prewarm.Selection) tea.Cmd {
	m.prewarmRunning = true
	m.prewarmOutput = ""
	m.prewarmErr = nil

	appURL := appBaseURL(m.config)
	cpURL := m.controlPlaneBaseURL
	return tea.Batch(m.spinner.Tick, func() tea.Msg {
		var buf clean.SafeBuffer
		var err error
		if sel.API {
			if e := prewarm.WarmAPI(context.Background(), appURL, &buf); e != nil {
				err = e
			}
		}
		if err == nil && sel.Docker {
			if e := prewarm.WarmImages(context.Background(), cpURL, &buf); e != nil {
				err = e
			}
		}
		return prewarmDoneMsg{Output: buf.String(), Err: err}
	})
}

// renderPrewarmPicker renders the picker overlay box.
func (m Model) renderPrewarmPicker() string {
	var b strings.Builder
	b.WriteString("Prewarm\n\n")
	if m.prewarmPickerForm != nil {
		b.WriteString(m.prewarmPickerForm.View())
	}
	return b.String()
}

// renderPrewarming renders the in-progress spinner / failure overlay. On
// success the prewarmDoneMsg handler clears state, so this is only shown while
// running or after a failure (awaiting dismissal).
func (m Model) renderPrewarming() string {
	var b strings.Builder
	dim := lipgloss.NewStyle().Foreground(lipgloss.Color("244"))
	if m.prewarmRunning {
		b.WriteString(m.spinner.View() + " Prewarming…")
		tail := lastLines(m.prewarmOutput, 6)
		if tail != "" {
			b.WriteString("\n\n" + dim.Render(tail))
		}
		return b.String()
	}
	// Failure (success path clears state and renders no overlay).
	b.WriteString("✗ Prewarm failed\n\n")
	if m.prewarmErr != nil {
		b.WriteString(m.prewarmErr.Error() + "\n\n")
	}
	if tail := lastLines(m.prewarmOutput, 8); tail != "" {
		b.WriteString(dim.Render(tail) + "\n\n")
	}
	b.WriteString("Press Enter or Esc to dismiss.")
	return b.String()
}

// lastLines returns the last n non-empty-trimmed lines of s.
func lastLines(s string, n int) string {
	lines := strings.Split(strings.TrimRight(s, "\n"), "\n")
	if len(lines) > n {
		lines = lines[len(lines)-n:]
	}
	return strings.Join(lines, "\n")
}
```

- [ ] **Step 4: Run the package tests**

Run: `cd dev-runner && go test ./internal/tui/ -run 'TestAssemblePrewarmSelection|TestAppBaseURL' -v`
Expected: PASS. Then `cd dev-runner && go build ./...` → success (C1's references now resolve).

- [ ] **Step 5: Commit (C1+C2+C3 together)**

```bash
git add dev-runner/internal/tui/model.go dev-runner/internal/tui/form_helpers.go \
        dev-runner/internal/tui/prewarm_picker.go dev-runner/internal/tui/prewarm_picker_test.go \
        dev-runner/internal/tui/prewarm_url_test.go
git commit -m "feat(dev-runner): prewarm picker overlay + runner + appBaseURL"
```

---

### Task C4: Keybinding, key interception, and overlay rendering

**Files:**
- Modify: `dev-runner/internal/tui/keymap.go` (add `Prewarm` binding + ShortHelp)
- Modify: `dev-runner/internal/tui/update.go` (open on `w`; intercept keys while picker/running; handle `prewarmDoneMsg`)
- Modify: `dev-runner/internal/tui/view.go` (overlay cases)

- [ ] **Step 1: Add the keybinding**

In `keymap.go`, add to `RunningKeyMap` struct: `Prewarm key.Binding`. In `NewRunningKeyMap`, add:

```go
		Prewarm:    key.NewBinding(key.WithKeys("w"), key.WithHelp("w", "prewarm")),
```

Add `k.Prewarm` to `ShortHelp()`:

```go
func (k RunningKeyMap) ShortHelp() []key.Binding {
	return []key.Binding{k.Tab, k.Mouse, k.DevSetting, k.Settings, k.Prewarm, k.Scroll, k.Search, k.Follow, k.ClearErr, k.Quit}
}
```

- [ ] **Step 2: Handle `prewarmDoneMsg` and intercept keys (update.go)**

Add a message case near the `cleanDoneMsg` case (~line 181) in the main `Update` switch:

```go
	case prewarmDoneMsg:
		m.prewarmRunning = false
		m.prewarmOutput = msg.Output
		m.prewarmErr = msg.Err
		if msg.Err == nil {
			// Success: clear overlay immediately.
			m.prewarmOutput = ""
		}
```

In `handleKey`, intercept keys for the prewarm overlay. Add this block alongside the other picker interceptions (after the probe picker interceptions, before the running-phase global switch — i.e. near update.go:733):

```go
	// Prewarm picker intercepts all keys while open.
	if m.prewarmPickerForm != nil {
		return m.updatePrewarmPicker(msg)
	}
	// While prewarm is running, swallow keys (output box is informational).
	if m.prewarmRunning {
		return nil
	}
	// After a prewarm failure, Enter/Esc dismisses the result overlay.
	if m.prewarmErr != nil {
		if msg.String() == "enter" || msg.String() == "esc" {
			m.prewarmErr = nil
			m.prewarmOutput = ""
		}
		return nil
	}
```

Add the open action to the running-phase global key switch (the `switch {` at update.go:773), as a new case (place it near `m.keys.Settings`):

```go
	case key.Matches(msg, m.keys.Prewarm):
		if m.phase == PhaseRunning {
			return m.openPrewarmPicker()
		}
```

- [ ] **Step 3: Render the overlays (view.go)**

In `View()`, in the overlay `switch` (the `switch {` at ~line 73), add cases before `default`:

```go
		case m.prewarmPickerForm != nil:
			content = m.overlayModal(base, m.renderPrewarmPicker())
		case m.prewarmRunning || m.prewarmErr != nil:
			content = m.overlayModal(base, m.renderPrewarming())
```

- [ ] **Step 4: Build + vet**

Run: `cd dev-runner && go build ./... && go vet ./internal/tui/`
Expected: success, no vet errors.

- [ ] **Step 5: Commit**

```bash
git add dev-runner/internal/tui/keymap.go dev-runner/internal/tui/update.go dev-runner/internal/tui/view.go
git commit -m "feat(dev-runner): w keybinding + prewarm overlay wiring"
```

---

### Task C5: Auto-fire after all-healthy

**Files:**
- Modify: `dev-runner/internal/tui/model.go` (`NewModel` signature: add `prewarmOnHealthy *prewarm.Selection`; add `allHealthCheckedHealthy` helper)
- Modify: `dev-runner/internal/tui/update.go` (`healthCheckMsg` handler: fire once)
- Modify: `dev-runner/cmd/dev-runner/main.go`, `runCleanTUI` call site, and any `NewModel` test call sites (pass `nil`)
- Test: `dev-runner/internal/tui/prewarm_autofire_test.go`

- [ ] **Step 1: Write the failing test**

```go
package tui

import (
	"testing"
	"time"

	"github.com/airo-ai-builder/dev-runner/internal/config"
)

func healthyModel(t *testing.T) Model {
	t.Helper()
	cfg := &config.Config{Processes: []config.ProcessConfig{
		{Name: "App", Command: "x", Dir: ".", HealthCheck: &config.HealthCheck{URL: "https://h/health", UnhealthyInterval: time.Second}},
		{Name: "Agents", Command: "x", Dir: ".", HealthCheck: &config.HealthCheck{URL: "http://h2/health", UnhealthyInterval: time.Second}},
	}}
	return NewModel(cfg, ".", false, false, false, nil)
}

func TestAllHealthCheckedHealthy(t *testing.T) {
	m := healthyModel(t)
	if m.allHealthCheckedHealthy() {
		t.Error("expected not-all-healthy before any health results")
	}
	yes := true
	for i := range m.manager.Processes {
		m.manager.Processes[i].Healthy = &yes
	}
	if !m.allHealthCheckedHealthy() {
		t.Error("expected all-healthy once every process is healthy")
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd dev-runner && go test ./internal/tui/ -run TestAllHealthCheckedHealthy -v`
Expected: FAIL — `NewModel` arg count mismatch and `allHealthCheckedHealthy` undefined.

- [ ] **Step 3: Update `NewModel` + add the predicate (model.go)**

Change the signature to add a trailing param and store it:

```go
func NewModel(cfg *config.Config, projectRoot string, openCleanPicker, cleanAllAtStartup, cleanOnly bool, prewarmOnHealthy *prewarm.Selection) Model {
```

In the struct-literal that builds the model, set `prewarmOnHealthy: prewarmOnHealthy,`.

Add the predicate method:

```go
// allHealthCheckedHealthy reports whether every process that defines a health
// check currently reports healthy. Processes without a health check are
// ignored. False when no process has reported yet.
func (m Model) allHealthCheckedHealthy() bool {
	any := false
	for i, p := range m.config.Processes {
		if p.HealthCheck == nil {
			continue
		}
		any = true
		h := m.manager.Processes[i].Healthy
		if h == nil || !*h {
			return false
		}
	}
	return any
}
```

- [ ] **Step 4: Fire once in the `healthCheckMsg` handler (update.go)**

At the end of the `case healthCheckMsg:` block (after the re-schedule `tea.Tick` append, ~line 287), add:

```go
		if m.prewarmOnHealthy != nil && !m.prewarmAutoFired && m.allHealthCheckedHealthy() {
			m.prewarmAutoFired = true
			cmds = append(cmds, m.runPrewarm(*m.prewarmOnHealthy))
		}
```

- [ ] **Step 5: Fix all `NewModel` call sites**

In `cmd/dev-runner/main.go` (the two `tui.NewModel(...)` calls — main dev path and `runCleanTUI`), append `nil` as the final argument for now (the `prewarm` subcommand wiring lands in Task D2):

```go
	model := tui.NewModel(cfg, projectRoot, mode == cleanModePicker, mode == cleanModeAll, false, nil)
```

and in `runCleanTUI`:

```go
	model := tui.NewModel(cfg, projectRoot, false, false, true, nil)
```

Search for any other call sites and update them:

Run: `cd dev-runner && grep -rn "NewModel(" --include='*.go' . | grep -v "func NewModel"`
Update every hit to pass a trailing `nil` (or a `*prewarm.Selection` where intended). Known sites: the two in `cmd/dev-runner/main.go`; plus any `internal/tui/*_test.go` that constructs a model.

- [ ] **Step 6: Run tests + build**

Run: `cd dev-runner && go build ./... && go test ./internal/tui/ -run 'TestAllHealthCheckedHealthy' -v`
Expected: PASS, build success.

- [ ] **Step 7: Commit**

```bash
git add dev-runner/internal/tui/model.go dev-runner/internal/tui/update.go dev-runner/cmd/dev-runner/main.go dev-runner/internal/tui/prewarm_autofire_test.go
git commit -m "feat(dev-runner): auto-fire prewarm once all services healthy"
```

---

## Phase D — CLI subcommand

### Task D1: `parsePrewarmFlags`

**Files:**
- Modify: `dev-runner/cmd/dev-runner/main.go` (add parser + usage const)
- Test: `dev-runner/cmd/dev-runner/prewarm_flags_test.go`

- [ ] **Step 1: Write the failing test**

```go
package main

import (
	"testing"

	"github.com/airo-ai-builder/dev-runner/internal/prewarm"
)

func TestParsePrewarmFlags(t *testing.T) {
	cases := []struct {
		name    string
		args    []string
		want    prewarm.Selection
		wantErr bool
	}{
		{"no flags => both", nil, prewarm.Selection{API: true, Docker: true}, false},
		{"api only", []string{"--api"}, prewarm.Selection{API: true}, false},
		{"docker only", []string{"--docker"}, prewarm.Selection{Docker: true}, false},
		{"both explicit", []string{"--api", "--docker"}, prewarm.Selection{API: true, Docker: true}, false},
		{"unknown", []string{"--nope"}, prewarm.Selection{}, true},
	}
	for _, c := range cases {
		got, err := parsePrewarmFlags(c.args)
		if (err != nil) != c.wantErr {
			t.Errorf("%s: err = %v, wantErr %v", c.name, err, c.wantErr)
			continue
		}
		if !c.wantErr && got != c.want {
			t.Errorf("%s: got %+v, want %+v", c.name, got, c.want)
		}
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd dev-runner && go test ./cmd/dev-runner/ -run TestParsePrewarmFlags -v`
Expected: FAIL — `undefined: parsePrewarmFlags`.

- [ ] **Step 3: Write the parser + usage**

Add to `main.go`:

```go
const prewarmUsage = "Usage: dev-runner prewarm [--api] [--docker]\n" +
	"  Boots the dev environment, then auto-runs prewarm once all services are healthy.\n" +
	"  No task flags → both API routes and Docker images.\n"

// parsePrewarmFlags parses the `dev-runner prewarm` task flags. Task flags are
// additive; with none, both tasks run.
func parsePrewarmFlags(args []string) (prewarm.Selection, error) {
	var sel prewarm.Selection
	var any bool
	for _, a := range args {
		switch a {
		case "--api":
			sel.API = true
			any = true
		case "--docker":
			sel.Docker = true
			any = true
		default:
			return prewarm.Selection{}, fmt.Errorf("unknown flag %q", a)
		}
	}
	if !any {
		sel = prewarm.Selection{API: true, Docker: true}
	}
	return sel, nil
}
```

Add the import `"github.com/airo-ai-builder/dev-runner/internal/prewarm"` to `main.go`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd dev-runner && go test ./cmd/dev-runner/ -run TestParsePrewarmFlags -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add dev-runner/cmd/dev-runner/main.go dev-runner/cmd/dev-runner/prewarm_flags_test.go
git commit -m "feat(dev-runner): parsePrewarmFlags for prewarm subcommand"
```

---

### Task D2: `prewarm` subcommand dispatch

**Files:**
- Modify: `dev-runner/cmd/dev-runner/main.go` (dispatch `os.Args[1] == "prewarm"`)

- [ ] **Step 1: Add the dispatch block**

In `main()`, after the existing `if len(os.Args) > 1 && os.Args[1] == "clean" { ... }` block and before `mode, err := parseDevFlags(...)`, add:

```go
	if len(os.Args) > 1 && os.Args[1] == "prewarm" {
		sel, err := parsePrewarmFlags(os.Args[2:])
		if err != nil {
			fmt.Fprintf(os.Stderr, "Error: %v\n%s", err, prewarmUsage)
			os.Exit(1)
		}

		configPath := filepath.Join(projectRoot, configFileName)
		if localPath := filepath.Join(projectRoot, localConfigFileName); fileExists(localPath) {
			configPath = localPath
		}
		cfg, err := config.Load(configPath, projectRoot)
		if err != nil {
			fmt.Fprintf(os.Stderr, "Error loading config: %v\n", err)
			os.Exit(1)
		}

		model := tui.NewModel(cfg, projectRoot, false, false, false, &sel)
		if _, err := tea.NewProgram(model).Run(); err != nil {
			fmt.Fprintf(os.Stderr, "Error: %v\n", err)
			os.Exit(1)
		}
		return
	}
```

Update `devUsage` to mention the subcommand:

```go
const devUsage = "Usage: dev-runner [--clean | --clean-all]\n" +
	"       dev-runner prewarm [--api] [--docker]\n" +
	"  --clean      open the clean picker before preflight\n" +
	"  --clean-all  remove every group (build + runtime + env + node_modules) before preflight\n" +
	"  prewarm      boot the dev env and auto-warm routes/images once healthy\n"
```

- [ ] **Step 2: Build + run the existing CLI test suite**

Run: `cd dev-runner && go build ./... && go test ./cmd/dev-runner/ -v`
Expected: PASS (parsePrewarmFlags + any existing clean-flag tests).

- [ ] **Step 3: Commit**

```bash
git add dev-runner/cmd/dev-runner/main.go
git commit -m "feat(dev-runner): dev-runner prewarm startup subcommand"
```

---

## Phase E — cleanup + docs + final verification

### Task E1: Remove the old prewarm script

**Files:**
- Delete: `app/scripts/prewarm.mjs`
- Modify: `package.json` (remove root `"prewarm"` script)
- Modify: `app/package.json` (remove `"prewarm"` script)

- [ ] **Step 1: Delete + edit**

```bash
git rm app/scripts/prewarm.mjs
```

In root `package.json`, remove the line:
```json
    "prewarm": "pnpm --filter website prewarm",
```
In `app/package.json`, remove the line:
```json
    "prewarm": "node scripts/prewarm.mjs",
```

- [ ] **Step 2: Confirm nothing else references it**

Run: `cd "$(git rev-parse --show-toplevel)" && grep -rn "prewarm.mjs\|pnpm prewarm\|run prewarm" --include='*.json' --include='*.mjs' --include='*.sh' --include='*.go' --include='*.md' . | grep -v node_modules | grep -v docs/superpowers`
Expected: no remaining references (other than the new dev-runner code/docs).

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: remove app prewarm.mjs (replaced by dev-runner prewarm)"
```

---

### Task E2: Docs

**Files:**
- Modify: `dev-runner/README.md` (document `w` key + `dev-runner prewarm` subcommand)
- Modify: `dev-runner/CLAUDE.md` (note the prewarm feature + the LCP endpoint dependency)

- [ ] **Step 1: Add to `dev-runner/README.md`**

Add a section:

```markdown
## Prewarm

Speeds up local app creation by warming the two slow paths:

- **API routes** — GETs the app's routes to force Next.js dev compilation.
- **Docker images** — asks local-control-plane to build `aab-template-v8` and
  `aab-publish`, warming the layer cache so the per-app build is a cache hit.

Two ways to trigger (it never runs on a plain `dev-runner` start):

- Press **`w`** on the running dashboard → multi-select popup (both on by default).
- `dev-runner prewarm [--api] [--docker]` — boots the dev env and auto-runs
  prewarm once all services are healthy.

The Docker warm calls `POST /api/_debug/prewarm-images` on local-control-plane,
which is loopback-guarded and reuses the same `docker buildx` invocation the
per-app create path uses (so the cache key matches).
```

- [ ] **Step 2: Add a note to `dev-runner/CLAUDE.md`**

Under Architecture, add a bullet:

```markdown
- `internal/prewarm/` - route + docker-image warming used by the `w` keybinding and the `dev-runner prewarm` subcommand. Docker work is delegated to local-control-plane's loopback-guarded `/api/_debug/prewarm-images` (no internal Go deps; cache-key parity preserved).
```

- [ ] **Step 3: Commit**

```bash
git add dev-runner/README.md dev-runner/CLAUDE.md
git commit -m "docs(dev-runner): document prewarm feature"
```

---

### Task E3: Full verification

- [ ] **Step 1: dev-runner full check**

Run: `cd dev-runner && make check`
Expected: fmt clean, vet clean, lint clean, all tests PASS.

- [ ] **Step 2: local-control-plane full check**

Run: `cd local-control-plane && make check`
Expected: fmt/vet/lint clean, all tests PASS.

- [ ] **Step 3: Confirm dev-runner has no internal-module imports**

Run: `cd dev-runner && go list -deps ./... | grep -E 'gdcorp-(golang|identity|partners)' || echo "OK: no internal modules"`
Expected: `OK: no internal modules`.

- [ ] **Step 4: Manual smoke (optional, requires Docker + a logged-in dev env)**

Run: `pnpm run dev` then press `w`, confirm both selected → observe route lines + image build; or run `dev-runner prewarm` and confirm it auto-fires after services go healthy. Create a new app and confirm `ensureImages` is a fast cache hit in `local-control-plane/dev.log` (`docker.image.build.success` with a low `duration_ms`).

- [ ] **Step 5: Final commit (if any fmt/lint fixups)**

```bash
git add -A
git commit -m "chore: dev-runner prewarm fmt/lint fixups" || echo "nothing to commit"
```

---

## Self-Review Notes (for the implementer)

- **Spec coverage:** §1 prewarm pkg → A1–A4; §2 LCP endpoint → B1–B2; §3 TUI (picker, fields, keybinding, auto-fire, appBaseURL) → C1–C5; §4 CLI → D1–D2; §5 cleanup → E1; docs/tests/verification → E2–E3.
- **Field/type names are consistent across tasks:** `prewarm.Selection{API,Docker}`, `Routes`, `WarmAPI`, `WarmImages`, `Manager.PrewarmImages`, `Server.imagePrewarmer`, `prewarmGroups`, `assemblePrewarmSelection`, `openPrewarmPicker`, `updatePrewarmPicker`, `runPrewarm`, `prewarmDoneMsg`, `appBaseURL`, `allHealthCheckedHealthy`, `parsePrewarmFlags`.
- **The field is `m.keys` (a `RunningKeyMap`), not `m.runningKeys`** — the spec's `m.runningKeys` was corrected here.
- **NewModel signature change ripples** to all call sites (Task C5 Step 5 greps for them).
- **`m.config` is `*config.Config`** — `appBaseURL`/`allHealthCheckedHealthy` and `runPrewarm` read it directly.
```
