# Workspace Archive Streaming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a generic streaming-zip primitive to dev-supervisor and rewire the app-code download route to use it, so downloaded bundles include every file (no 10MB per-file cap, no 1000-entry tree cap).

**Architecture:** dev-supervisor gains `POST /workspace/files/archive` which walks caller-supplied dirs/files on its own filesystem and streams an `archive/zip` directly to the HTTP response (O(1) memory, no read cap). The agent gains a `WorkspaceClient.files.archive()` method that returns the raw response stream; `download.ts` builds the allowlist, calls it, and pipes the stream to the client — dropping the per-file `tree()`+`download()` loop and the `archiver` dependency. Skip-don't-corrupt (PR #4923) moves server-side.

**Tech Stack:** Go 1.25 (`archive/zip`, `path/filepath` stdlib) for dev-supervisor; TypeScript/Node `http` streams for the agent; Vitest + supertest + yauzl (agent tests); Go `testing` + `httptest` + `archive/zip` reader (dev-supervisor tests).

**Spec:** `docs/superpowers/specs/2026-06-16-workspace-archive-stream-design.md`
**Ticket:** AIROBUILD-2550

---

## File Structure

**dev-supervisor (Go):**
- Modify `dev-supervisor/cmd/dev-supervisor/api_workspace_files.go` — add archive constants, `wsFilesArchiveRequest` type, `handleWorkspaceFilesArchive` handler, and a `wsArchiveAddFile` helper.
- Modify `dev-supervisor/cmd/dev-supervisor/main.go` — register the route.
- Modify `dev-supervisor/cmd/dev-supervisor/api_workspace_files_test.go` — add archive handler tests.

**agents (TypeScript):**
- Modify `agents/src/services/DevSupervisorClient.ts` — generalize `requestStream` to take a body; add public `postStream`.
- Modify `agents/src/workspace/files.ts` — add `ArchiveOptions`, `ArchiveResult`, and `archive()` to the `WorkspaceFiles` interface.
- Modify `agents/src/workspace/adapters/http-files.ts` — implement `archive()`.
- Modify `agents/src/server/routes/download.ts` — rewrite the route to proxy the archive stream.
- Modify `agents/src/server/routes/download.test.ts` — rewrite the "Archive Workspace Integration" describe (auth describe unchanged).
- Delete `agents/src/server/routes/download.archive.test.ts` — its real-zip-composition coverage moves to the Go test (Task 2).

---

## Task 1: dev-supervisor archive endpoint — happy path

**Files:**
- Modify: `dev-supervisor/cmd/dev-supervisor/api_workspace_files.go`
- Modify: `dev-supervisor/cmd/dev-supervisor/main.go`
- Test: `dev-supervisor/cmd/dev-supervisor/api_workspace_files_test.go`

- [ ] **Step 1: Write the failing test**

Append to `api_workspace_files_test.go`:

```go
// --- Archive tests ---

// readZipFromRecorder parses the recorder body as a zip and returns a map of
// entry name -> uncompressed bytes.
func readZipFromRecorder(t *testing.T, w *httptest.ResponseRecorder) map[string][]byte {
	t.Helper()
	body := w.Body.Bytes()
	zr, err := zip.NewReader(bytes.NewReader(body), int64(len(body)))
	if err != nil {
		t.Fatalf("body is not a valid zip (%v); status=%d body=%d bytes", err, w.Code, len(body))
	}
	out := map[string][]byte{}
	for _, f := range zr.File {
		rc, err := f.Open()
		if err != nil {
			t.Fatalf("open zip entry %s: %v", f.Name, err)
		}
		data, err := io.ReadAll(rc)
		rc.Close()
		if err != nil {
			t.Fatalf("read zip entry %s: %v", f.Name, err)
		}
		out[f.Name] = data
	}
	return out
}

func TestWorkspaceFilesArchive_Basic(t *testing.T) {
	server, dir := newTestServerWithDir(t)
	os.MkdirAll(filepath.Join(dir, "src", "components"), 0o755)
	os.WriteFile(filepath.Join(dir, "src", "index.ts"), []byte("export {}\n"), 0o644)
	os.WriteFile(filepath.Join(dir, "src", "components", "Foo.tsx"), []byte("export const Foo = () => null\n"), 0o644)
	os.WriteFile(filepath.Join(dir, "package.json"), []byte("{}\n"), 0o644)

	w := postJSON(t, server.handleWorkspaceFilesArchive, map[string]any{
		"dirs":   []string{"src"},
		"files":  []string{"package.json", "missing-config.json"},
		"prefix": "myapp",
	})

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	if ct := w.Header().Get("Content-Type"); ct != "application/zip" {
		t.Errorf("expected application/zip, got %q", ct)
	}

	entries := readZipFromRecorder(t, w)
	want := []string{
		"myapp/src/index.ts",
		"myapp/src/components/Foo.tsx",
		"myapp/package.json",
	}
	for _, name := range want {
		if _, ok := entries[name]; !ok {
			t.Errorf("missing zip entry %q; got %v", name, keysOf(entries))
		}
	}
	// Missing config file is skipped silently, not an error.
	if _, ok := entries["myapp/missing-config.json"]; ok {
		t.Error("missing-config.json should be skipped")
	}
	if got := string(entries["myapp/src/index.ts"]); got != "export {}\n" {
		t.Errorf("content mismatch for src/index.ts: %q", got)
	}
}

func keysOf(m map[string][]byte) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}
```

- [ ] **Step 2: Add the `zip` import to the test file**

In `api_workspace_files_test.go`, add `"archive/zip"` and `"io"` to the import block (keep imports sorted):

```go
import (
	"archive/zip"
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"slices"
	"testing"

	"github.com/airo-ai-builder/dev-supervisor/internal/config"
)
```

- [ ] **Step 3: Run the test to verify it fails to compile**

Run: `cd dev-supervisor && go test ./cmd/dev-supervisor/ -run TestWorkspaceFilesArchive_Basic`
Expected: FAIL — `server.handleWorkspaceFilesArchive undefined`.

- [ ] **Step 4: Add the `archive/zip` import to the handler file**

In `api_workspace_files.go`, add `"archive/zip"` as the first import (keep sorted):

```go
import (
	"archive/zip"
	"bufio"
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log/slog"
	"mime"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/bmatcuk/doublestar/v4"

	"github.com/airo-ai-builder/dev-supervisor/internal/validation"
)
```

- [ ] **Step 5: Add archive constants**

In `api_workspace_files.go`, add to the existing `const` block (after `wsFilesMaxStatPaths`):

```go
	// Archive backstops — not normal-path limits, just runaway/zip-bomb guards.
	wsFilesMaxArchiveBytes   = 2 * 1024 * 1024 * 1024 // 2GB total uncompressed cap
	wsFilesMaxArchiveEntries = 50000                  // total entry-count cap
```

- [ ] **Step 6: Add the request type**

In `api_workspace_files.go`, in the request/response types section, add:

```go
// wsFilesArchiveRequest is a product-agnostic "zip these paths" request. The
// caller (the agent) supplies the allowlist; dirs are walked recursively and
// files are added if present. prefix becomes the top-level folder inside the
// zip (e.g. "myapp/src/index.ts").
type wsFilesArchiveRequest struct {
	Dirs   []string `json:"dirs,omitempty"`
	Files  []string `json:"files,omitempty"`
	Prefix string   `json:"prefix,omitempty"`
}
```

- [ ] **Step 7: Add the handler and helper**

Append to `api_workspace_files.go` (after `handleWorkspaceFilesDownload`):

```go
// handleWorkspaceFilesArchive streams a zip of the requested dirs/files built
// directly from the workspace filesystem. It writes the zip to the response as
// it walks (O(1) memory) and applies NO per-file size cap — unlike view/download,
// which cap at wsFilesMaxReadBytes. A per-file read error is logged and skipped
// so one bad file does not corrupt the whole archive; the central directory is
// always written via zw.Close().
func (s *Server) handleWorkspaceFilesArchive(w http.ResponseWriter, r *http.Request) {
	var req wsFilesArchiveRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.sendError(w, http.StatusBadRequest, "invalid_request", "Invalid JSON payload")
		return
	}
	if len(req.Dirs) == 0 && len(req.Files) == 0 {
		s.sendError(w, http.StatusBadRequest, "validation_failed", "dirs or files is required")
		return
	}

	base := s.fsBaseDir()

	// Validate every path up front so traversal attempts fail cleanly with a
	// JSON 400 BEFORE any zip bytes are written. Missing paths are NOT errors
	// here (ValidateFilePath checks the path string, not existence) — they are
	// skipped during the walk/stat below.
	resolvedDirs := make([]string, 0, len(req.Dirs))
	for _, d := range req.Dirs {
		resolved, err := validation.ValidateFilePath(d, base)
		if err != nil {
			s.sendError(w, http.StatusBadRequest, "validation_failed", err.Error())
			return
		}
		resolvedDirs = append(resolvedDirs, resolved)
	}
	resolvedFiles := make([]string, 0, len(req.Files))
	for _, f := range req.Files {
		resolved, err := validation.ValidateFilePath(f, base)
		if err != nil {
			s.sendError(w, http.StatusBadRequest, "validation_failed", err.Error())
			return
		}
		resolvedFiles = append(resolvedFiles, resolved)
	}

	prefix := strings.Trim(req.Prefix, "/")

	w.Header().Set("Content-Type", "application/zip")

	zw := zip.NewWriter(w)
	var entryCount int
	var totalBytes int64
	var failedCount int
	limitHit := false

	addFile := func(absPath string) {
		if entryCount >= wsFilesMaxArchiveEntries || totalBytes >= wsFilesMaxArchiveBytes {
			limitHit = true
			return
		}
		n, err := s.wsArchiveAddFile(zw, base, prefix, absPath)
		if err != nil {
			failedCount++
			slog.Warn("workspace.files.archive.file.failed", "path", absPath, "error", err.Error())
			return
		}
		entryCount++
		totalBytes += n
	}

	for _, dirAbs := range resolvedDirs {
		_ = filepath.WalkDir(dirAbs, func(p string, d fs.DirEntry, err error) error {
			if limitHit {
				return filepath.SkipAll
			}
			if err != nil {
				// Missing/unreadable root or subdir — skip, don't fail the archive.
				slog.Debug("workspace.files.archive.walk.skip", "path", p, "error", err.Error())
				if d != nil && d.IsDir() {
					return filepath.SkipDir
				}
				return nil
			}
			// Only regular files. Skip symlinks (avoid escaping the sandbox) and
			// special files.
			if d.IsDir() || d.Type()&fs.ModeSymlink != 0 || !d.Type().IsRegular() {
				return nil
			}
			addFile(p)
			return nil
		})
	}

	for _, fileAbs := range resolvedFiles {
		if limitHit {
			break
		}
		info, err := os.Lstat(fileAbs)
		if err != nil {
			// Missing config file — skip silently (matches the old per-file
			// download() not_found skip).
			continue
		}
		if !info.Mode().IsRegular() {
			continue
		}
		addFile(fileAbs)
	}

	if err := zw.Close(); err != nil {
		// Close flushes the central directory. If it fails, the stream is
		// already partially sent — abort so the client sees a truncated transfer
		// rather than a structurally valid-looking zip.
		slog.Error("workspace.files.archive.close_failed", "error", err.Error())
		return
	}

	if limitHit {
		slog.Warn("workspace.files.archive.limit_hit",
			"entry_count", entryCount, "total_bytes", totalBytes)
	}
	slog.Debug("workspace.files.archive.success",
		"entry_count", entryCount, "failed_count", failedCount, "total_bytes", totalBytes)
}

// wsArchiveAddFile copies one file into the zip writer under
// prefix/<path-relative-to-base>. Returns the number of bytes copied.
func (s *Server) wsArchiveAddFile(zw *zip.Writer, base, prefix, absPath string) (int64, error) {
	rel, err := filepath.Rel(base, absPath)
	if err != nil {
		return 0, err
	}
	name := rel
	if prefix != "" {
		name = prefix + "/" + rel
	}

	f, err := os.Open(absPath)
	if err != nil {
		return 0, err
	}
	defer f.Close()

	entry, err := zw.Create(name)
	if err != nil {
		return 0, err
	}
	return io.Copy(entry, f)
}
```

- [ ] **Step 8: Register the route**

In `main.go`, after the download route registration (`s.router.HandleFunc("/workspace/files/download", ...)`), the archive endpoint belongs under the `wsFilesRouter` (its request body is a tiny JSON allowlist, so the 10MB request-body middleware is fine). Add to the `wsFilesRouter` block alongside the other POST routes:

```go
	wsFilesRouter.HandleFunc("/archive", s.handleWorkspaceFilesArchive).Methods("POST")
```

- [ ] **Step 9: Run the test to verify it passes**

Run: `cd dev-supervisor && go test ./cmd/dev-supervisor/ -run TestWorkspaceFilesArchive_Basic -v`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add dev-supervisor/cmd/dev-supervisor/api_workspace_files.go dev-supervisor/cmd/dev-supervisor/main.go dev-supervisor/cmd/dev-supervisor/api_workspace_files_test.go
git commit -m "feat(dev-supervisor): add streaming-zip archive endpoint

AIROBUILD-2550

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: dev-supervisor archive — skip-on-failure, traversal, large files

**Files:**
- Test: `dev-supervisor/cmd/dev-supervisor/api_workspace_files_test.go`

- [ ] **Step 1: Write the path-traversal test**

Append to `api_workspace_files_test.go`:

```go
func TestWorkspaceFilesArchive_PathTraversalRejected(t *testing.T) {
	server, _ := newTestServerWithDir(t)
	w := postJSON(t, server.handleWorkspaceFilesArchive, map[string]any{
		"dirs": []string{"../../../etc"},
	})
	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for traversal, got %d: %s", w.Code, w.Body.String())
	}
}

func TestWorkspaceFilesArchive_EmptyRequest(t *testing.T) {
	server, _ := newTestServerWithDir(t)
	w := postJSON(t, server.handleWorkspaceFilesArchive, map[string]any{})
	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for empty request, got %d", w.Code)
	}
}
```

- [ ] **Step 2: Write the large-file test (proves no 10MB cap)**

Append:

```go
func TestWorkspaceFilesArchive_NoSizeCap(t *testing.T) {
	server, dir := newTestServerWithDir(t)
	os.MkdirAll(filepath.Join(dir, "public"), 0o755)
	// 15MB file — would 413 on view/download, must be included here.
	big := make([]byte, 15*1024*1024)
	os.WriteFile(filepath.Join(dir, "public", "big.bin"), big, 0o644)

	w := postJSON(t, server.handleWorkspaceFilesArchive, map[string]any{
		"dirs":   []string{"public"},
		"prefix": "app",
	})
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	entries := readZipFromRecorder(t, w)
	if got := len(entries["app/public/big.bin"]); got != 15*1024*1024 {
		t.Errorf("expected 15MB entry, got %d bytes", got)
	}
}
```

- [ ] **Step 3: Write the symlink-skip test**

Append:

```go
func TestWorkspaceFilesArchive_SkipsSymlinks(t *testing.T) {
	server, dir := newTestServerWithDir(t)
	os.MkdirAll(filepath.Join(dir, "src"), 0o755)
	os.WriteFile(filepath.Join(dir, "src", "real.ts"), []byte("ok\n"), 0o644)
	// Symlink pointing outside the sandbox must not be followed into the zip.
	os.Symlink("/etc/hostname", filepath.Join(dir, "src", "escape.ts"))

	w := postJSON(t, server.handleWorkspaceFilesArchive, map[string]any{
		"dirs":   []string{"src"},
		"prefix": "app",
	})
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	entries := readZipFromRecorder(t, w)
	if _, ok := entries["app/src/real.ts"]; !ok {
		t.Error("expected real.ts in archive")
	}
	if _, ok := entries["app/src/escape.ts"]; ok {
		t.Error("symlink escape.ts must be skipped, not followed")
	}
}
```

- [ ] **Step 4: Write the unreadable-file skip test (AC-3)**

Append:

```go
func TestWorkspaceFilesArchive_SkipsUnreadableFile(t *testing.T) {
	server, dir := newTestServerWithDir(t)
	os.MkdirAll(filepath.Join(dir, "src"), 0o755)
	os.WriteFile(filepath.Join(dir, "src", "ok.ts"), []byte("ok\n"), 0o644)
	// 0o000 → owner lacks read bit; os.Open returns EACCES for a non-root user
	// (CI + local run as a non-root host user), exercising the skip-and-finalize
	// path. The rest of the archive must still produce a valid zip.
	unreadable := filepath.Join(dir, "src", "secret.ts")
	os.WriteFile(unreadable, []byte("nope\n"), 0o000)
	t.Cleanup(func() { os.Chmod(unreadable, 0o644) }) // so t.TempDir cleanup can remove it

	w := postJSON(t, server.handleWorkspaceFilesArchive, map[string]any{
		"dirs":   []string{"src"},
		"prefix": "app",
	})
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	// Body must still parse as a valid zip (central directory written) with the
	// readable file present and the unreadable one skipped.
	entries := readZipFromRecorder(t, w)
	if _, ok := entries["app/src/ok.ts"]; !ok {
		t.Error("expected ok.ts in archive")
	}
	if _, ok := entries["app/src/secret.ts"]; ok {
		t.Error("unreadable secret.ts must be skipped, not included")
	}
}
```

If this test runs as root (e.g. a misconfigured container) the 0o000 open would succeed and the test would fail — that is the documented non-root contract from `dev-supervisor/CLAUDE.md` (tests run as the host user), so a failure here means the test environment is wrong, not the code.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd dev-supervisor && go test ./cmd/dev-supervisor/ -run TestWorkspaceFilesArchive -v`
Expected: PASS (all `TestWorkspaceFilesArchive_*` tests).

- [ ] **Step 6: Run gofmt + vet + lint**

Run: `cd dev-supervisor && make fmt-fix && go vet ./cmd/dev-supervisor/ && make lint`
Expected: no errors. (If `gocyclo` flags `handleWorkspaceFilesArchive` as over complexity 15, extract the walk callback into a named method `wsArchiveWalkDir` and re-run.)

- [ ] **Step 7: Commit**

```bash
git add dev-supervisor/cmd/dev-supervisor/api_workspace_files_test.go dev-supervisor/cmd/dev-supervisor/api_workspace_files.go
git commit -m "test(dev-supervisor): archive traversal/large-file/symlink/unreadable coverage

AIROBUILD-2550

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: agent client — streaming POST + WorkspaceFiles.archive

**Files:**
- Modify: `agents/src/services/DevSupervisorClient.ts:1113-1185` (`requestStream`)
- Modify: `agents/src/workspace/files.ts`
- Modify: `agents/src/workspace/adapters/http-files.ts`

- [ ] **Step 1: Generalize `requestStream` to accept a body**

In `DevSupervisorClient.ts`, change the `requestStream` signature and add the body write. Replace the signature line and the `req.end()` at the end of the method:

Change:
```ts
  private requestStream(
    method: string,
    requestPath: string,
    headers?: Record<string, string>,
  ): Promise<{ stream: http.IncomingMessage; contentType: string; contentLength: number }> {
    return new Promise((resolve, reject) => {
      const reqHeaders: Record<string, string> = { ...headers };
```
to:
```ts
  private requestStream(
    method: string,
    requestPath: string,
    headers?: Record<string, string>,
    body?: string,
  ): Promise<{ stream: http.IncomingMessage; contentType: string; contentLength: number }> {
    return new Promise((resolve, reject) => {
      const reqHeaders: Record<string, string> = { ...headers };
      if (body !== undefined) {
        reqHeaders['Content-Length'] = String(Buffer.byteLength(body));
      }
```

And change the final `req.end();` of `requestStream` to:
```ts
      if (body !== undefined) {
        req.write(body);
      }
      req.end();
```

- [ ] **Step 2: Add the public `postStream` method**

In `DevSupervisorClient.ts`, immediately after `requestStream` (before `getRaw`), add:

```ts
  /**
   * POST a JSON body and return the response stream directly (no buffering).
   * For endpoints whose response is large and should be piped to an HTTP
   * response — e.g. /workspace/files/archive streams a zip. Non-2xx responses
   * reject with a DevSupervisorError (error body consumed and parsed), so a
   * pre-stream failure surfaces before any bytes are piped.
   */
  async postStream(
    requestPath: string,
    data: unknown,
  ): Promise<{ stream: http.IncomingMessage; contentType: string; contentLength: number }> {
    return this.requestStream(
      'POST',
      requestPath,
      { 'Content-Type': 'application/json', Accept: 'application/zip' },
      JSON.stringify(data ?? {}),
    );
  }
```

- [ ] **Step 3: Add archive types and interface method**

In `files.ts`, after the `DownloadResult` interface (around line 146), add:

```ts
export interface ArchiveOptions {
  /** Workspace-relative directories to walk recursively. Missing dirs are skipped. */
  dirs?: string[];
  /** Workspace-relative files to include. Missing files are skipped. */
  files?: string[];
  /** Top-level folder name inside the zip (e.g. entries become `<prefix>/src/x.ts`). */
  prefix?: string;
}

export interface ArchiveResult {
  /** Raw zip byte stream. Pipe straight to an HTTP response. */
  stream: NodeJS.ReadableStream;
  contentType: string;
}
```

In the same file, add to the `WorkspaceFiles` interface (after the `download(...)` line):

```ts
  /**
   * Stream a zip of the given dirs/files, assembled server-side. Unlike
   * download(), there is no per-file size cap — use this for bulk export.
   */
  archive(options: ArchiveOptions): Promise<ArchiveResult>;
```

- [ ] **Step 4: Implement `archive()` in the adapter**

In `http-files.ts`, add `ArchiveOptions` and `ArchiveResult` to the type import block (lines 2-23), then add the method after `download()`:

```ts
  async archive(options: ArchiveOptions): Promise<ArchiveResult> {
    const { stream, contentType } = await this.client.postStream(
      '/workspace/files/archive',
      {
        dirs: options.dirs ?? [],
        files: options.files ?? [],
        prefix: options.prefix ?? '',
      },
    );
    return { stream, contentType };
  }
```

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @airo/agents typecheck`
Expected: PASS (no errors). This proves the interface, adapter, and client method are type-consistent.

- [ ] **Step 6: Commit**

```bash
git add agents/src/services/DevSupervisorClient.ts agents/src/workspace/files.ts agents/src/workspace/adapters/http-files.ts
git commit -m "feat(agents): WorkspaceClient.files.archive() streaming method

AIROBUILD-2550

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: rewrite the download route to proxy the archive stream

**Files:**
- Modify: `agents/src/server/routes/download.ts`

- [ ] **Step 1: Replace the route file**

Replace the entire contents of `download.ts` with:

```ts
/**
 * Download Route
 *
 * Handles app download/zip operations with JWT-based authorization.
 * Requires canDownload permission in JWT claims (Airo Plus subscription).
 *
 * The zip is assembled server-side by dev-supervisor (WorkspaceFiles.archive)
 * and streamed straight through this route — no per-file size cap, no in-memory
 * buffering of file contents in the agent.
 */

import { Router, Request, Response } from 'express';
import { AppRepository } from '../../database/index.js';
import { Logger, log } from '../../logging/index.js';
import { ALLOWED_DIRECTORIES, ALLOWED_CONFIG_FILES } from '../../config/app-download.js';
import { validateAppOwnership } from '../middleware/app-ownership.js';
import { requirePermission } from '../middleware/require-permission.js';
import { createForWorkspace } from '../../workspace/index.js';

const router: Router = Router();
const appRepo = new AppRepository();
const logger = Logger.create({ component: 'download-routes' });

type NameStyle = 'appId' | 'name';

/**
 * Build the zip's base name, used for both Content-Disposition and the
 * top-level folder inside the archive.
 *
 * - `appId` style → `appId_<id>_<friendlyName>` (or `appId_<id>` if name empty);
 *    used by internal tools (debug-console) where the id is the primary key.
 * - `name` style → `<friendlyName>` (or `app-<id>` if name empty); used by the
 *    customer-facing download path.
 */
function buildBaseName(id: string, rawName: string | null | undefined, style: NameStyle): string {
  const friendlyName = (rawName ?? '').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  if (style === 'appId') {
    return friendlyName ? `appId_${id}_${friendlyName}` : `appId_${id}`;
  }
  return friendlyName || `app-${id}`;
}

/**
 * GET /apps/:id/zip - Stream a zip archive of the user-facing app files.
 *
 * dev-supervisor walks the allowlisted dirs/files on the workspace filesystem
 * and streams the zip; this route proxies that stream to the client.
 */
router.get('/apps/:id/zip', validateAppOwnership, requirePermission('canDownload'), async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const contextLogger = log.forApp(id);

  try {
    const app = appRepo.findById(id);
    if (!app) {
      return res.status(404).json({ error: 'App not found' });
    }

    const workspace = createForWorkspace(id, 'preview');
    if (!workspace) {
      log.error(contextLogger, 'route.apps.zip.failure', new Error('Workspace unavailable'), {
        appId: id,
        reason: 'workspace_unavailable',
      });
      return res.status(503).json({
        error: 'App workspace is not available',
        details: 'The app preview is not running. Start the preview and try again.',
      });
    }

    const nameStyle: NameStyle = req.query.nameStyle === 'appId' ? 'appId' : 'name';
    const baseName = buildBaseName(id, app.name, nameStyle);

    logger.info('route.apps.zip.begin', { appId: id, includedDirs: ALLOWED_DIRECTORIES });

    // archive() resolves once dev-supervisor has responded 2xx and started
    // streaming. A pre-stream failure (path validation, supervisor down)
    // rejects here BEFORE we touch the response, so we can still send a clean
    // JSON error.
    const result = await workspace.files.archive({
      dirs: [...ALLOWED_DIRECTORIES],
      files: [...ALLOWED_CONFIG_FILES],
      prefix: baseName,
    });

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${baseName}.zip"`);

    result.stream.on('error', (err: Error) => {
      // Failure after headers were sent — destroy the socket so the client sees
      // a truncated transfer, not a structurally-valid (but incomplete) zip.
      log.error(contextLogger, 'route.apps.zip.stream.failure', err, { appId: id });
      res.destroy(err);
    });
    result.stream.on('end', () => {
      logger.info('route.apps.zip.success', { appId: id });
    });

    result.stream.pipe(res);
    return;
  } catch (error) {
    log.error(contextLogger, 'route.apps.zip.failure', error as Error, {
      appId: id,
      errorMessage: error instanceof Error ? error.message : String(error),
      errorStack: error instanceof Error ? error.stack : undefined,
      reason: 'unexpected_error',
    });

    if (!res.headersSent) {
      return res.status(500).json({
        error: 'Failed to create zip archive',
        details: error instanceof Error ? error.message : 'Unknown error',
      });
    }
    res.destroy(error as Error);
    return;
  }
});

export default router;
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @airo/agents typecheck`
Expected: PASS. (`archiver`, `withConcurrency`, `listDirectoryFiles`, `isDevSupervisorNotFound`, and `WorkspaceClient` type import are all gone — typecheck confirms nothing else in this file referenced them.)

- [ ] **Step 3: Commit**

```bash
git add agents/src/server/routes/download.ts
git commit -m "refactor(agents): stream app-zip via WorkspaceClient.archive

AIROBUILD-2550

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: rewrite the agent route tests

**Files:**
- Modify: `agents/src/server/routes/download.test.ts`
- Delete: `agents/src/server/routes/download.archive.test.ts`

- [ ] **Step 1: Delete the real-archiver test file**

Its purpose was to exercise real zip composition + per-file skip in the agent. That logic now lives in dev-supervisor and is covered by Task 1/2 Go tests. Remove it:

```bash
git rm agents/src/server/routes/download.archive.test.ts
```

- [ ] **Step 2: Replace the "Archive Workspace Integration" describe block**

In `download.test.ts`, remove the `archiver` mock and the entire `describe('Archive Workspace Integration', ...)` block, and the now-unused imports. Specifically:

Delete the import line:
```ts
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
```
and replace with:
```ts
import { Readable } from 'node:stream';
```

Delete these lines near the top:
```ts
const mockArchiverFn = vi.fn();
```
```ts
vi.mock('archiver', () => ({
  default: mockArchiverFn,
}));
```

Then replace the whole `describe('Archive Workspace Integration', ...)` block (lines 332-707) with:

```ts
describe('Archive Workspace Integration', () => {
  let app: Express;
  const appId = 'klmnopqrst';

  function createPermittedApp(): Express {
    const testApp = express();
    testApp.use(express.json());
    testApp.use((req, _res, next) => {
      (req as AuthenticatedRequest).agentContext = {
        siteId: appId,
        canDownload: true,
        canPublish: false,
        isE2S: false,
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
      } as any;
      next();
    });
    testApp.use('/', downloadRouter);
    return testApp;
  }

  // A workspace whose archive() returns a Readable of the given bytes. Captures
  // the options it was called with for assertions.
  function streamingWorkspace(zipBytes: Buffer) {
    const calls: Array<Record<string, unknown>> = [];
    const archive = vi.fn(async (options: Record<string, unknown>) => {
      calls.push(options);
      return { stream: Readable.from([zipBytes]), contentType: 'application/zip' };
    });
    return { files: { archive }, calls };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockFindById.mockReturnValue({
      id: appId,
      name: 'Test App',
      path: `/tmp/apps/${appId}/app`,
    });
    app = createPermittedApp();
  });

  it('returns 503 when workspace is unavailable', async () => {
    mockCreateForWorkspace.mockReturnValue(null);

    const response = await request(app).get(`/apps/${appId}/zip`).expect(503);
    expect(response.body.error).toBe('App workspace is not available');
  });

  it('pipes the archive stream through with zip headers and the allowlist', async () => {
    const ws = streamingWorkspace(Buffer.from('PK\x03\x04 fake-zip-bytes'));
    mockCreateForWorkspace.mockReturnValue(ws);

    const response = await request(app)
      .get(`/apps/${appId}/zip?nameStyle=appId`)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c as Buffer));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toBe('application/zip');
    expect(response.headers['content-disposition']).toBe(
      'attachment; filename="appId_klmnopqrst_Test_App.zip"',
    );
    // Bytes arrive intact (proxy is byte-faithful).
    expect((response.body as Buffer).toString()).toBe('PK\x03\x04 fake-zip-bytes');
    // The route passes the allowlist + baseName prefix straight through.
    expect(ws.calls[0]).toEqual({
      dirs: ['src', 'public'],
      files: ['package.json', '.env.example'],
      prefix: 'appId_klmnopqrst_Test_App',
    });
  });

  it('uses the customer-facing name (no appId prefix) by default', async () => {
    const ws = streamingWorkspace(Buffer.from('PK'));
    mockCreateForWorkspace.mockReturnValue(ws);

    const response = await request(app).get(`/apps/${appId}/zip`).buffer(true);

    expect(response.status).toBe(200);
    expect(response.headers['content-disposition']).toBe(
      'attachment; filename="Test_App.zip"',
    );
    expect(ws.calls[0].prefix).toBe('Test_App');
  });

  it('falls back to app-<id> when name is empty (default style)', async () => {
    mockFindById.mockReturnValue({ id: appId, name: '', path: `/tmp/apps/${appId}/app` });
    const ws = streamingWorkspace(Buffer.from('PK'));
    mockCreateForWorkspace.mockReturnValue(ws);

    const response = await request(app).get(`/apps/${appId}/zip`).buffer(true);

    expect(response.status).toBe(200);
    expect(response.headers['content-disposition']).toBe(
      `attachment; filename="app-${appId}.zip"`,
    );
  });

  it('returns 500 when archive() rejects before streaming', async () => {
    const archive = vi.fn().mockRejectedValue(new Error('supervisor down'));
    mockCreateForWorkspace.mockReturnValue({ files: { archive } });

    const response = await request(app).get(`/apps/${appId}/zip`).expect(500);
    expect(response.body.error).toBe('Failed to create zip archive');
  });
});
```

- [ ] **Step 3: Run the route tests**

Run: `pnpm --filter @airo/agents test:unit src/server/routes/download.test.ts`
Expected: PASS — the "Download Route Authorization" suite (unchanged) plus the rewritten "Archive Workspace Integration" suite. No `download.archive.test.ts` collected.

- [ ] **Step 4: Commit**

```bash
git add agents/src/server/routes/download.test.ts
git commit -m "test(agents): cover archive-stream proxy; drop in-agent zip tests

AIROBUILD-2550

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: dependency cleanup + full verification

**Files:**
- Possibly modify: `agents/package.json`

- [ ] **Step 1: Check whether `archiver` is still used anywhere in agents**

Run: `cd /Users/deverton/work/gdcorp-partners/airo-app-builder && grep -rn "from 'archiver'\|require('archiver')\|import archiver" agents/src`
Expected: no matches (the download route was the only consumer).

- [ ] **Step 2: If unused, remove the dependency**

Only if Step 1 returned nothing:

```bash
cd agents && pnpm remove archiver @types/archiver
```

Then verify the lockfile diff only touches `archiver`/`@types/archiver` and re-run install if needed. If `archiver` IS still referenced elsewhere, skip this step and leave the dependency in place.

- [ ] **Step 3: Run the agent gates**

Run:
```bash
pnpm --filter @airo/agents typecheck
pnpm --filter @airo/agents lint
pnpm --filter @airo/agents test:unit src/server/routes/download
```
Expected: all PASS.

- [ ] **Step 4: Run the dev-supervisor full Linux suite (authoritative gate)**

Run: `cd dev-supervisor && make test-linux`
Expected: PASS — fmt, vet, lint, `go test -race`, Rust, and integration (subproc + strangler). This is the source of truth per dev-supervisor/CLAUDE.md.

- [ ] **Step 5: Commit any cleanup**

```bash
git add agents/package.json pnpm-lock.yaml
git commit -m "chore(agents): drop unused archiver dependency

AIROBUILD-2550

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

(Skip this commit if Step 2 was skipped.)

---

## Manual verification (after all tasks)

Per the design's test plan, before opening the PR:

- [ ] Run a local app with the dev runner, populate `public/` with a file >10MB, and hit the download flow (BFF or `GET /apps/:id/zip`). Confirm:
  - the response is a valid zip (`unzip -tq`) that **includes** the >10MB file
  - dev-supervisor logs `workspace.files.archive.success` (debug) with the expected `entry_count`
  - the agent logs `route.apps.zip.success`
- [ ] Confirm the top-level folder inside the zip matches the filename base (single labeled folder on extract).

---

## Notes for the implementer

- **dev-supervisor is Linux-only.** `make test` on macOS is best-effort; `make test-linux` is the gate. The archive handler uses only cross-platform stdlib (`archive/zip`, `path/filepath`, `os`), so the macOS `go test` run in Task 1/2 is representative, but still run `make test-linux` in Task 6.
- **No version skew:** agent + preview deploy in the same Nomad job, so the new agent never talks to an old dev-supervisor. No capability fallback is needed.
- **Out of scope (do not do here):** publish/export adoption of `archive()`, and the separate `view`-handler `IsDir`-rejection parity fix.
- **Total-failure floor — IMPLEMENTED (resolved during final review).** This plan originally proposed dropping the floor, on the reasoning that porting it would require buffering. That reasoning was wrong: the final code review found a clean, O(1)-memory way to preserve it — create the `zip.Writer` **lazily** on the first successfully-opened file, so a walk that opens zero files leaves the response un-flushed and can still return a JSON 500. Implemented in commit `18345821`: if every matched file fails to open (`entryCount == 0 && failedCount > 0`), the handler returns `500 archive_failed`; a genuinely empty input set returns a valid empty 200 zip. Paired with this, a post-first-byte failure (`zip.Create`/`io.Copy`/`zw.Close` error) now `panic(http.ErrAbortHandler)`s to abort the connection, so a truncated/corrupt zip is never delivered as a clean 200 — fully honoring the design's "never a fake-200 corrupt zip" promise. No deviation from the committed design remains.
- If `make lint` flags `handleWorkspaceFilesArchive` for `gocyclo` (>15), extract the `WalkDir` callback into a method and the per-file guard into the existing `addFile` closure (already factored) — do not raise the lint threshold.
```
