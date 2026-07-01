# Dev Tools Live Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically sync local edits to `app-templates/v8/dev-tools` and `app-templates/v8/source-mapper` into already-running local preview workspaces.

**Architecture:** Add one small `local-control-plane/internal/templatesync` package. It polls the two template folders with stdlib filesystem mtimes and shells out to existing `rsync -a --delete` into every `/tmp/airo-app-builder/<appId>/preview` workspace.

**Tech Stack:** Go 1.25 stdlib, `rsync`, existing `slog`, existing local-control-plane process lifecycle.

---

## File Structure

- Create `local-control-plane/internal/templatesync/live_sync.go` — path resolution, preview discovery, source change detection, rsync execution, and background loop.
- Create `local-control-plane/internal/templatesync/live_sync_test.go` — unit tests for env defaults, preview discovery, generated-folder excludes, and rsync invocation.
- Modify `local-control-plane/cmd/server/main.go` — create a cancellable context and start `templatesync.Start(ctx, logger)` after Docker reconciliation.

## Task 1: Add templatesync tests

**Files:**
- Create: `local-control-plane/internal/templatesync/live_sync_test.go`

- [ ] **Step 1: Create the test file**

Write `local-control-plane/internal/templatesync/live_sync_test.go`:

```go
package templatesync

import (
	"context"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestConfigFromEnvUsesExistingDefaults(t *testing.T) {
	t.Run("explicit template dir", func(t *testing.T) {
		t.Setenv("APPS_BASE_DIR", "/apps")
		t.Setenv("APP_TEMPLATE_DIR", "/template")
		t.Setenv("PROJECT_ROOT", "/ignored")

		cfg := configFromEnv()

		if cfg.AppsBaseDir != "/apps" {
			t.Fatalf("AppsBaseDir = %q, want /apps", cfg.AppsBaseDir)
		}
		if cfg.TemplateDir != "/template" {
			t.Fatalf("TemplateDir = %q, want /template", cfg.TemplateDir)
		}
	})

	t.Run("project root fallback", func(t *testing.T) {
		t.Setenv("APPS_BASE_DIR", "")
		t.Setenv("APP_TEMPLATE_DIR", "")
		t.Setenv("PROJECT_ROOT", "/repo")

		cfg := configFromEnv()

		if cfg.AppsBaseDir != defaultAppsBaseDir {
			t.Fatalf("AppsBaseDir = %q, want %q", cfg.AppsBaseDir, defaultAppsBaseDir)
		}
		want := filepath.Join("/repo", "app-templates", "v8")
		if cfg.TemplateDir != want {
			t.Fatalf("TemplateDir = %q, want %q", cfg.TemplateDir, want)
		}
	})
}

func TestDiscoverPreviewRoots(t *testing.T) {
	base := t.TempDir()
	for _, dir := range []string{
		filepath.Join(base, "app-b", "preview"),
		filepath.Join(base, "app-a", "preview"),
		filepath.Join(base, "app-c", "publish"),
	} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatalf("MkdirAll(%q): %v", dir, err)
		}
	}
	if err := os.WriteFile(filepath.Join(base, "not-an-app"), []byte("x"), 0o644); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}

	got, err := discoverPreviewRoots(base)
	if err != nil {
		t.Fatalf("discoverPreviewRoots: %v", err)
	}

	want := []string{
		filepath.Join(base, "app-a", "preview"),
		filepath.Join(base, "app-b", "preview"),
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("discoverPreviewRoots = %#v, want %#v", got, want)
	}
}

func TestSourceStampIgnoresGeneratedFolders(t *testing.T) {
	root := t.TempDir()
	srcDir := filepath.Join(root, "src")
	distDir := filepath.Join(root, "dist")
	if err := os.MkdirAll(srcDir, 0o755); err != nil {
		t.Fatalf("MkdirAll(src): %v", err)
	}
	if err := os.MkdirAll(distDir, 0o755); err != nil {
		t.Fatalf("MkdirAll(dist): %v", err)
	}

	sourceFile := filepath.Join(srcDir, "index.ts")
	if err := os.WriteFile(sourceFile, []byte("source"), 0o644); err != nil {
		t.Fatalf("WriteFile(source): %v", err)
	}
	generatedFile := filepath.Join(distDir, "bundle.js")
	if err := os.WriteFile(generatedFile, []byte("generated"), 0o644); err != nil {
		t.Fatalf("WriteFile(generated): %v", err)
	}

	sourceTime := time.Unix(100, 0)
	generatedTime := time.Unix(200, 0)
	for _, path := range []string{srcDir, sourceFile} {
		if err := os.Chtimes(path, sourceTime, sourceTime); err != nil {
			t.Fatalf("Chtimes(%q): %v", path, err)
		}
	}
	for _, path := range []string{distDir, generatedFile} {
		if err := os.Chtimes(path, generatedTime, generatedTime); err != nil {
			t.Fatalf("Chtimes(%q): %v", path, err)
		}
	}

	stamp, err := sourceStamp(root, defaultExcludes)
	if err != nil {
		t.Fatalf("sourceStamp: %v", err)
	}
	if !stamp.Equal(sourceTime) {
		t.Fatalf("stamp = %s, want %s", stamp, sourceTime)
	}
}

func TestSyncFoldersRunsRsyncForEachPreview(t *testing.T) {
	templateDir := t.TempDir()
	appsBaseDir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(templateDir, "dev-tools"), 0o755); err != nil {
		t.Fatalf("MkdirAll(dev-tools): %v", err)
	}
	if err := os.WriteFile(filepath.Join(templateDir, "dev-tools", "index.ts"), []byte("x"), 0o644); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}
	for _, appID := range []string{"app-a", "app-b"} {
		if err := os.MkdirAll(filepath.Join(appsBaseDir, appID, "preview"), 0o755); err != nil {
			t.Fatalf("MkdirAll(preview): %v", err)
		}
	}

	type call struct {
		name string
		args []string
	}
	calls := []call{}
	s := newSyncer(Config{
		AppsBaseDir: appsBaseDir,
		TemplateDir:  templateDir,
		Folders:      []string{"dev-tools"},
		Excludes:     defaultExcludes,
		run: func(_ context.Context, name string, args ...string) error {
			calls = append(calls, call{name: name, args: append([]string(nil), args...)})
			return nil
		},
	}, slog.New(slog.NewTextHandler(io.Discard, nil)))

	if err := s.syncFolders(context.Background(), []string{"dev-tools"}); err != nil {
		t.Fatalf("syncFolders: %v", err)
	}
	if len(calls) != 2 {
		t.Fatalf("rsync call count = %d, want 2", len(calls))
	}
	for _, c := range calls {
		if c.name != "rsync" {
			t.Fatalf("command = %q, want rsync", c.name)
		}
		joined := strings.Join(c.args, " ")
		for _, want := range []string{"-a", "--delete", "--exclude node_modules", "--exclude dist", "--exclude .turbo", "--exclude .vite"} {
			if !strings.Contains(joined, want) {
				t.Fatalf("args %q missing %q", joined, want)
			}
		}
	}
}
```

- [ ] **Step 2: Run the failing tests**

Run:

```bash
cd /Users/acypert/.codex/worktrees/c272/airo-app-builder/local-control-plane && go test ./internal/templatesync -count=1
```

Expected: FAIL because package functions such as `configFromEnv`, `discoverPreviewRoots`, `sourceStamp`, `syncer`, and `Config` are undefined.

- [ ] **Step 3: Commit the failing tests**

```bash
git add /Users/acypert/.codex/worktrees/c272/airo-app-builder/local-control-plane/internal/templatesync/live_sync_test.go
git commit -m "test: cover template live sync"
```

## Task 2: Implement templatesync package

**Files:**
- Create: `local-control-plane/internal/templatesync/live_sync.go`
- Modify: `local-control-plane/internal/templatesync/live_sync_test.go`

- [ ] **Step 1: Add the implementation**

Write `local-control-plane/internal/templatesync/live_sync.go`:

```go
package templatesync

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

const (
	defaultAppsBaseDir = "/tmp/airo-app-builder"
	defaultProjectRoot = ".."
	defaultPoll        = time.Second
)

var defaultFolders = []string{"dev-tools", "source-mapper"}
var defaultExcludes = []string{"node_modules", "dist", ".turbo", ".vite"}

type commandRunner func(context.Context, string, ...string) error

type Config struct {
	AppsBaseDir string
	TemplateDir string
	Folders     []string
	Excludes    []string
	Poll        time.Duration
	run         commandRunner
}

type syncer struct {
	cfg    Config
	logger *slog.Logger
	last   map[string]time.Time
}

func Start(ctx context.Context, logger *slog.Logger) {
	cfg := configFromEnv()
	cfg.run = runCommand
	newSyncer(cfg, logger).Start(ctx)
}

func configFromEnv() Config {
	appsBaseDir := os.Getenv("APPS_BASE_DIR")
	if appsBaseDir == "" {
		appsBaseDir = defaultAppsBaseDir
	}

	templateDir := os.Getenv("APP_TEMPLATE_DIR")
	if templateDir == "" {
		projectRoot := os.Getenv("PROJECT_ROOT")
		if projectRoot == "" {
			projectRoot = defaultProjectRoot
		}
		templateDir = filepath.Join(projectRoot, "app-templates", "v8")
	}

	return Config{
		AppsBaseDir: appsBaseDir,
		TemplateDir:  templateDir,
		Folders:      append([]string(nil), defaultFolders...),
		Excludes:     append([]string(nil), defaultExcludes...),
		Poll:         defaultPoll,
		run:          runCommand,
	}
}

func newSyncer(cfg Config, logger *slog.Logger) *syncer {
	if logger == nil {
		logger = slog.Default()
	}
	if cfg.AppsBaseDir == "" {
		cfg.AppsBaseDir = defaultAppsBaseDir
	}
	if cfg.TemplateDir == "" {
		cfg.TemplateDir = filepath.Join(defaultProjectRoot, "app-templates", "v8")
	}
	if len(cfg.Folders) == 0 {
		cfg.Folders = append([]string(nil), defaultFolders...)
	}
	if len(cfg.Excludes) == 0 {
		cfg.Excludes = append([]string(nil), defaultExcludes...)
	}
	if cfg.Poll == 0 {
		cfg.Poll = defaultPoll
	}
	if cfg.run == nil {
		cfg.run = runCommand
	}
	return &syncer{cfg: cfg, logger: logger}
}

func (s *syncer) Start(ctx context.Context) {
	go s.run(ctx)
}

func (s *syncer) run(ctx context.Context) {
	s.last = s.snapshot()
	s.logger.Info("template.live_sync.start", "template_dir", s.cfg.TemplateDir, "apps_base_dir", s.cfg.AppsBaseDir)

	ticker := time.NewTicker(s.cfg.Poll)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			changed := s.changedFolders()
			if len(changed) == 0 {
				continue
			}
			s.logger.Info("template.live_sync.changed", "folders", strings.Join(changed, ","))

			if err := s.syncFolders(ctx, changed); err != nil {
				s.logger.Warn("template.live_sync.failed", "error", err)
			}
			s.last = s.snapshot()
		}
	}
}

func (s *syncer) snapshot() map[string]time.Time {
	result := map[string]time.Time{}
	for _, folder := range s.cfg.Folders {
		stamp, err := sourceStamp(filepath.Join(s.cfg.TemplateDir, folder), s.cfg.Excludes)
		if err != nil {
			if !os.IsNotExist(err) {
				s.logger.Warn("template.live_sync.failed", "folder", folder, "error", err)
			}
			continue
		}
		result[folder] = stamp
	}
	return result
}

func (s *syncer) changedFolders() []string {
	next := s.snapshot()
	changed := []string{}
	for _, folder := range s.cfg.Folders {
		if !next[folder].Equal(s.last[folder]) {
			changed = append(changed, folder)
		}
	}
	return changed
}

func (s *syncer) syncFolders(ctx context.Context, folders []string) error {
	previews, err := discoverPreviewRoots(s.cfg.AppsBaseDir)
	if err != nil {
		return err
	}
	if len(previews) == 0 {
		s.logger.Info("template.live_sync.skip", "reason", "no_preview_workspaces")
		return nil
	}

	errs := []error{}
	for _, folder := range folders {
		source := filepath.Join(s.cfg.TemplateDir, folder)
		if _, err := os.Stat(source); err != nil {
			if os.IsNotExist(err) {
				s.logger.Info("template.live_sync.skip", "folder", folder, "reason", "source_missing")
				continue
			}
			errs = append(errs, fmt.Errorf("stat %s: %w", source, err))
			continue
		}

		for _, preview := range previews {
			destination := filepath.Join(preview, folder)
			if err := os.MkdirAll(destination, 0o755); err != nil {
				errs = append(errs, fmt.Errorf("create %s: %w", destination, err))
				continue
			}
			if err := runRsync(ctx, s.cfg.run, source, destination, s.cfg.Excludes); err != nil {
				errs = append(errs, fmt.Errorf("sync %s to %s: %w", source, destination, err))
				s.logger.Warn("template.live_sync.failed", "source", source, "destination", destination, "folder", folder, "error", err)
				continue
			}
			s.logger.Info("template.live_sync.synced", "source", source, "destination", destination, "folder", folder)
		}
	}
	return errors.Join(errs...)
}

func discoverPreviewRoots(appsBaseDir string) ([]string, error) {
	entries, err := os.ReadDir(appsBaseDir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("read apps base dir %s: %w", appsBaseDir, err)
	}

	previews := []string{}
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		preview := filepath.Join(appsBaseDir, entry.Name(), "preview")
		info, err := os.Stat(preview)
		if err != nil || !info.IsDir() {
			continue
		}
		previews = append(previews, preview)
	}
	sort.Strings(previews)
	return previews, nil
}

func sourceStamp(root string, excludes []string) (time.Time, error) {
	var stamp time.Time
	err := filepath.WalkDir(root, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if path == root {
			return nil
		}
		if isExcluded(entry.Name(), excludes) {
			if entry.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}

		info, err := entry.Info()
		if err != nil {
			return err
		}
		if info.ModTime().After(stamp) {
			stamp = info.ModTime()
		}
		return nil
	})
	return stamp, err
}

func isExcluded(name string, excludes []string) bool {
	for _, exclude := range excludes {
		if name == exclude {
			return true
		}
	}
	return false
}

func runRsync(ctx context.Context, runner commandRunner, source, destination string, excludes []string) error {
	args := []string{"-a", "--delete"}
	for _, exclude := range excludes {
		args = append(args, "--exclude", exclude)
	}
	args = append(args, withTrailingSeparator(source), withTrailingSeparator(destination))
	return runner(ctx, "rsync", args...)
}

func withTrailingSeparator(path string) string {
	return strings.TrimRight(path, string(os.PathSeparator)) + string(os.PathSeparator)
}

func runCommand(ctx context.Context, name string, args ...string) error {
	cmd := exec.CommandContext(ctx, name, args...)
	output, err := cmd.CombinedOutput()
	if err == nil {
		return nil
	}

	message := strings.TrimSpace(string(output))
	if message == "" {
		return fmt.Errorf("%s: %w", name, err)
	}
	return fmt.Errorf("%s: %w: %s", name, err, message)
}
```

- [ ] **Step 2: Run the templatesync tests**

Run:

```bash
cd /Users/acypert/.codex/worktrees/c272/airo-app-builder/local-control-plane && go test ./internal/templatesync -count=1
```

Expected: PASS.

- [ ] **Step 3: Run gofmt on the package**

Run:

```bash
cd /Users/acypert/.codex/worktrees/c272/airo-app-builder/local-control-plane && gofmt -w internal/templatesync/live_sync.go internal/templatesync/live_sync_test.go
```

Expected: no output.

- [ ] **Step 4: Re-run the templatesync tests after gofmt**

Run:

```bash
cd /Users/acypert/.codex/worktrees/c272/airo-app-builder/local-control-plane && go test ./internal/templatesync -count=1
```

Expected: PASS.

- [ ] **Step 5: Commit the implementation**

```bash
git add /Users/acypert/.codex/worktrees/c272/airo-app-builder/local-control-plane/internal/templatesync/live_sync.go /Users/acypert/.codex/worktrees/c272/airo-app-builder/local-control-plane/internal/templatesync/live_sync_test.go
git commit -m "feat: add template live sync"
```

## Task 3: Start live sync from local-control-plane

**Files:**
- Modify: `local-control-plane/cmd/server/main.go`

- [ ] **Step 1: Update imports and startup wiring**

Modify `local-control-plane/cmd/server/main.go` imports so they include `context` and `templatesync`:

```go
import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/airo-ai-builder/local-control-plane/internal/api"
	"github.com/airo-ai-builder/local-control-plane/internal/auth"
	"github.com/airo-ai-builder/local-control-plane/internal/docker"
	"github.com/airo-ai-builder/local-control-plane/internal/store"
	"github.com/airo-ai-builder/local-control-plane/internal/templatesync"

	"github.com/rs/cors"
)
```

In `run()`, add a cancellable context immediately before Docker reconciliation and start sync immediately after reconciliation:

```go
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	docker.NewManager().Reconcile(db)
	templatesync.Start(ctx, logger)
```

Update the signal goroutine to cancel the sync loop before closing the server:

```go
	go func() {
		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
		<-sigCh
		slog.Info("shutting down")
		cancel()
		_ = server.Close()
	}()
```

- [ ] **Step 2: Run gofmt on main.go**

Run:

```bash
cd /Users/acypert/.codex/worktrees/c272/airo-app-builder/local-control-plane && gofmt -w cmd/server/main.go
```

Expected: no output.

- [ ] **Step 3: Run local-control-plane tests**

Run:

```bash
cd /Users/acypert/.codex/worktrees/c272/airo-app-builder/local-control-plane && go test ./... -count=1
```

Expected: PASS.

- [ ] **Step 4: Commit startup wiring**

```bash
git add /Users/acypert/.codex/worktrees/c272/airo-app-builder/local-control-plane/cmd/server/main.go
git commit -m "feat: start template live sync"
```

## Task 4: Run final verification

**Files:**
- No source changes expected.

- [ ] **Step 1: Run the package tests with verbose output**

Run:

```bash
cd /Users/acypert/.codex/worktrees/c272/airo-app-builder/local-control-plane && go test ./internal/templatesync -v -count=1
```

Expected: PASS with the four test names from `live_sync_test.go`.

- [ ] **Step 2: Run all local-control-plane checks that do not require external services**

Run:

```bash
cd /Users/acypert/.codex/worktrees/c272/airo-app-builder/local-control-plane && make fmt && make vet && make test
```

Expected: all commands PASS.

- [ ] **Step 3: Run git diff check**

Run:

```bash
cd /Users/acypert/.codex/worktrees/c272/airo-app-builder && git diff --check
```

Expected: no output.

- [ ] **Step 4: Confirm final status**

Run:

```bash
cd /Users/acypert/.codex/worktrees/c272/airo-app-builder && git status --short
```

Expected: no unstaged files from implementation tasks.

