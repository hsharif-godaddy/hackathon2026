# WorkspaceFiles Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate all file-writing tools from direct filesystem access (`node:fs`, `FileEditTool`) to the intent-based WorkspaceFiles HTTP API, and delete the `FileEditTool` class.

**Architecture:** The dev-supervisor owns mechanism (atomic read/edit/write). The agent owns policy (AI guardrails: blocked files, immutability, API path validation). Tools call `WorkspaceFiles` methods; error enrichment (fuzzy-match snippets for LLM retry) stays agent-side.

**Tech Stack:** Go 1.25 (dev-supervisor), TypeScript/Vitest (agents), WorkspaceFiles interface (`agents/src/workspace/files.ts`), HttpFiles adapter (`agents/src/workspace/adapters/http-files.ts`)

**Jira:** AIROBUILD-1809

**Supersedes:** PR #3932 (will be closed)

---

## File Structure

### New files
- `dev-supervisor/cmd/dev-supervisor/api_workspace_files_insert.go` — insert endpoint handler (extracted for clarity)
- `agents/src/tools/text-editor-workspace.ts` — new text-editor handlers using WorkspaceFiles (replaces `text-editor-handlers.ts`)
- `agents/src/tools/__tests__/text-editor-workspace.test.ts` — tests for new handlers

### Modified files
- `dev-supervisor/cmd/dev-supervisor/api_workspace_files.go` — add `createOnly` to write, register insert route
- `dev-supervisor/cmd/dev-supervisor/api_workspace_files_test.go` — tests for insert + createOnly
- `dev-supervisor/cmd/dev-supervisor/main.go` — register insert handler
- `agents/src/workspace/files.ts` — add `InsertOptions`, `InsertResult` to interface
- `agents/src/workspace/adapters/http-files.ts` — add `insert()` method
- `agents/src/tools/ai-lib-tools/text-editor.ts` — switch from `FileSystemOperations` to `WorkspaceFiles`
- `agents/src/server/routes/apps.ts` — replace `FileEditTool` with WorkspaceFiles calls
- `agents/src/services/memory-service.ts` — replace `FileEditTool` with WorkspaceFiles calls
- `agents/src/tools/ai-lib-tools/set-project-name.ts` — replace `FileEditTool` with WorkspaceFiles + git commit
- `agents/src/tools/image-editor-tool.ts` — replace `fs.writeFileSync` with `upload()`
- `agents/src/tools/css-color-tool.ts` — replace `readFile`/`writeFile` with `view()`/`write()`
- `agents/src/tools/qr-code-tool.ts` — replace `fs.readFileSync` with `upload()`
- `agents/src/tools/video-generation-tool.ts` — replace final output writes with `upload()`/`write()`

### Deleted files
- `agents/src/tools/text-editor-handlers.ts` — replaced by `text-editor-workspace.ts`
- `agents/src/tools/__tests__/text-editor-handlers.test.ts` — replaced
- `agents/src/tools/file-edit.ts` — `FileEditTool` class deleted; exported utilities extracted
- `agents/src/tools/file-edit.test.ts` — deleted with class

### Extracted (from file-edit.ts deletion)
- `agents/src/tools/file-edit-utils.ts` — `isFileImmutable`, `validateNoApiPaths`, `resolveFilePath`, `resolveSourceFile`
- `agents/src/tools/__tests__/file-edit-utils.test.ts` — security tests for extracted utilities

---

## Task 1: Add `/workspace/files/insert` endpoint to dev-supervisor

**Files:**
- Modify: `dev-supervisor/cmd/dev-supervisor/api_workspace_files.go` (add types + handler)
- Modify: `dev-supervisor/cmd/dev-supervisor/api_workspace_files_test.go`
- Modify: `dev-supervisor/cmd/dev-supervisor/main.go` (register route)

- [ ] **Step 1: Add request/response types**

In `api_workspace_files.go`, after the existing `wsFilesEditRequest` struct (line ~187):

```go
type wsFilesInsertRequest struct {
	Path    string `json:"path"`
	Line    int    `json:"line"`    // 1-based: 0 = prepend, > total lines = append
	Content string `json:"content"`
}

type wsFilesInsertResponse struct {
	Lines int `json:"lines"` // total lines after insert
}
```

- [ ] **Step 2: Write the failing tests**

In `api_workspace_files_test.go`:

```go
func TestWorkspaceFilesInsert_Middle(t *testing.T) {
	server, dir := newTestServerWithDir(t)
	os.WriteFile(filepath.Join(dir, "app.ts"), []byte("line1\nline2\nline3\n"), 0o644)

	w := postJSON(t, server.handleWorkspaceFilesInsert, map[string]any{
		"path": "app.ts", "line": 2, "content": "inserted",
	})

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp wsFilesInsertResponse
	json.Unmarshal(w.Body.Bytes(), &resp)
	if resp.Lines != 4 {
		t.Errorf("expected lines=4, got %d", resp.Lines)
	}

	data, _ := os.ReadFile(filepath.Join(dir, "app.ts"))
	if string(data) != "line1\ninserted\nline2\nline3\n" {
		t.Errorf("unexpected content: %q", string(data))
	}
}

func TestWorkspaceFilesInsert_Prepend(t *testing.T) {
	server, dir := newTestServerWithDir(t)
	os.WriteFile(filepath.Join(dir, "f.txt"), []byte("existing\n"), 0o644)

	w := postJSON(t, server.handleWorkspaceFilesInsert, map[string]any{
		"path": "f.txt", "line": 0, "content": "first",
	})

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	data, _ := os.ReadFile(filepath.Join(dir, "f.txt"))
	if string(data) != "first\nexisting\n" {
		t.Errorf("unexpected content: %q", string(data))
	}
}

func TestWorkspaceFilesInsert_Append(t *testing.T) {
	server, dir := newTestServerWithDir(t)
	os.WriteFile(filepath.Join(dir, "f.txt"), []byte("line1\nline2"), 0o644)

	w := postJSON(t, server.handleWorkspaceFilesInsert, map[string]any{
		"path": "f.txt", "line": 999, "content": "appended",
	})

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	data, _ := os.ReadFile(filepath.Join(dir, "f.txt"))
	if string(data) != "line1\nline2\nappended" {
		t.Errorf("unexpected content: %q", string(data))
	}
}

func TestWorkspaceFilesInsert_FileTooLarge(t *testing.T) {
	server, dir := newTestServerWithDir(t)
	large := make([]byte, wsFilesMaxEditBytes+1)
	os.WriteFile(filepath.Join(dir, "big.txt"), large, 0o644)

	w := postJSON(t, server.handleWorkspaceFilesInsert, map[string]any{
		"path": "big.txt", "line": 1, "content": "x",
	})

	if w.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("expected 413, got %d: %s", w.Code, w.Body.String())
	}
}

func TestWorkspaceFilesInsert_FileNotFound(t *testing.T) {
	server, _ := newTestServerWithDir(t)

	w := postJSON(t, server.handleWorkspaceFilesInsert, map[string]any{
		"path": "nope.txt", "line": 1, "content": "x",
	})

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d: %s", w.Code, w.Body.String())
	}
}

func TestWorkspaceFilesInsert_PreservesPermissions(t *testing.T) {
	server, dir := newTestServerWithDir(t)
	os.WriteFile(filepath.Join(dir, "exec.sh"), []byte("#!/bin/bash\necho hi\n"), 0o755)

	postJSON(t, server.handleWorkspaceFilesInsert, map[string]any{
		"path": "exec.sh", "line": 2, "content": "# comment",
	})

	info, _ := os.Stat(filepath.Join(dir, "exec.sh"))
	if info.Mode().Perm() != 0o755 {
		t.Errorf("expected 0755, got %o", info.Mode().Perm())
	}
}
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd dev-supervisor && go test ./cmd/dev-supervisor/ -run TestWorkspaceFilesInsert -v`
Expected: Compilation failure (handler doesn't exist)

- [ ] **Step 4: Implement the handler**

In `api_workspace_files.go`:

```go
func (s *Server) handleWorkspaceFilesInsert(w http.ResponseWriter, r *http.Request) {
	var req wsFilesInsertRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.sendError(w, http.StatusBadRequest, "invalid_request", "Invalid JSON payload")
		return
	}

	if req.Path == "" {
		s.sendError(w, http.StatusBadRequest, "validation_failed", "path is required")
		return
	}

	resolved, err := validation.ValidateFilePath(req.Path, s.fsBaseDir())
	if err != nil {
		s.sendError(w, http.StatusBadRequest, "validation_failed", err.Error())
		return
	}

	slog.Debug("workspace.files.insert.start", "path", req.Path, "line", req.Line)

	info, err := os.Stat(resolved)
	if err != nil {
		s.sendWsFilesError(w, "workspace.files.insert", req.Path, err)
		return
	}
	if info.Size() > wsFilesMaxEditBytes {
		s.sendError(w, http.StatusRequestEntityTooLarge, "file_too_large",
			fmt.Sprintf("file size %d exceeds edit maximum %d", info.Size(), wsFilesMaxEditBytes))
		return
	}

	data, err := os.ReadFile(resolved)
	if err != nil {
		s.sendWsFilesError(w, "workspace.files.insert", req.Path, err)
		return
	}

	content := string(data)
	lines := strings.Split(content, "\n")

	// Line is 1-based: 0 = prepend, > len = append
	insertIdx := req.Line
	if insertIdx <= 0 {
		insertIdx = 0
	} else if insertIdx > len(lines) {
		insertIdx = len(lines)
	}

	// Splice
	newLines := make([]string, 0, len(lines)+1)
	newLines = append(newLines, lines[:insertIdx]...)
	newLines = append(newLines, req.Content)
	newLines = append(newLines, lines[insertIdx:]...)

	newContent := strings.Join(newLines, "\n")

	// Atomic write preserving permissions
	tmpFile := resolved + ".tmp"
	if err := os.WriteFile(tmpFile, []byte(newContent), 0o600); err != nil {
		s.sendWsFilesError(w, "workspace.files.insert", req.Path, err)
		return
	}
	if err := os.Chmod(tmpFile, info.Mode().Perm()); err != nil {
		_ = os.Remove(tmpFile)
		s.sendWsFilesError(w, "workspace.files.insert", req.Path, err)
		return
	}
	if err := os.Rename(tmpFile, resolved); err != nil {
		_ = os.Remove(tmpFile)
		s.sendWsFilesError(w, "workspace.files.insert", req.Path, err)
		return
	}

	slog.Debug("workspace.files.insert.completed", "path", req.Path, "lines", len(newLines))

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(wsFilesInsertResponse{Lines: len(newLines)})
}
```

- [ ] **Step 5: Register the route**

In `main.go`, after the existing workspace file routes:

```go
mux.HandleFunc("POST /workspace/files/insert", wsFilesMaxBodyMiddleware(srv.handleWorkspaceFilesInsert))
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd dev-supervisor && go test ./cmd/dev-supervisor/ -run TestWorkspaceFilesInsert -v`
Expected: All 6 tests PASS

- [ ] **Step 7: Run full check**

Run: `cd dev-supervisor && make check`
Expected: PASS (fmt, vet, lint, test)

- [ ] **Step 8: Commit**

```bash
git add dev-supervisor/cmd/dev-supervisor/api_workspace_files.go dev-supervisor/cmd/dev-supervisor/api_workspace_files_test.go dev-supervisor/cmd/dev-supervisor/main.go
git commit -m "feat(dev-supervisor): add /workspace/files/insert endpoint"
```

---

## Task 2: Add `createOnly` flag to `/workspace/files/write`

**Files:**
- Modify: `dev-supervisor/cmd/dev-supervisor/api_workspace_files.go:177-180,675-725`
- Modify: `dev-supervisor/cmd/dev-supervisor/api_workspace_files_test.go`

- [ ] **Step 1: Write the failing test**

```go
func TestWorkspaceFilesWrite_CreateOnly_Success(t *testing.T) {
	server, dir := newTestServerWithDir(t)

	w := postJSON(t, server.handleWorkspaceFilesWrite, map[string]any{
		"path": "new.txt", "content": "hello", "createOnly": true,
	})

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	data, _ := os.ReadFile(filepath.Join(dir, "new.txt"))
	if string(data) != "hello" {
		t.Errorf("expected 'hello', got %q", string(data))
	}
}

func TestWorkspaceFilesWrite_CreateOnly_Conflict(t *testing.T) {
	server, dir := newTestServerWithDir(t)
	os.WriteFile(filepath.Join(dir, "existing.txt"), []byte("old"), 0o644)

	w := postJSON(t, server.handleWorkspaceFilesWrite, map[string]any{
		"path": "existing.txt", "content": "new", "createOnly": true,
	})

	if w.Code != http.StatusConflict {
		t.Fatalf("expected 409, got %d: %s", w.Code, w.Body.String())
	}

	// Original content preserved
	data, _ := os.ReadFile(filepath.Join(dir, "existing.txt"))
	if string(data) != "old" {
		t.Errorf("file was overwritten: %q", string(data))
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd dev-supervisor && go test ./cmd/dev-supervisor/ -run TestWorkspaceFilesWrite_CreateOnly -v`
Expected: FAIL (createOnly not implemented)

- [ ] **Step 3: Add CreateOnly field to request struct**

In `api_workspace_files.go`, modify `wsFilesWriteRequest`:

```go
type wsFilesWriteRequest struct {
	Path       string `json:"path"`
	Content    string `json:"content"`
	Encoding   string `json:"encoding,omitempty"`
	CreateOnly bool   `json:"createOnly,omitempty"`
}
```

- [ ] **Step 4: Add createOnly check in handler**

In `handleWorkspaceFilesWrite`, after path validation and before writing (after `resolved` is computed):

```go
if req.CreateOnly {
	if _, err := os.Stat(resolved); err == nil {
		s.sendError(w, http.StatusConflict, "file_exists",
			fmt.Sprintf("file already exists: %s", req.Path))
		return
	}
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd dev-supervisor && go test ./cmd/dev-supervisor/ -run TestWorkspaceFilesWrite -v`
Expected: All write tests PASS

- [ ] **Step 6: Run full check**

Run: `cd dev-supervisor && make check`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add dev-supervisor/cmd/dev-supervisor/api_workspace_files.go dev-supervisor/cmd/dev-supervisor/api_workspace_files_test.go
git commit -m "feat(dev-supervisor): add createOnly flag to /workspace/files/write"
```

---

## Task 3: Update TypeScript WorkspaceFiles interface and HttpFiles adapter

**Files:**
- Modify: `agents/src/workspace/files.ts`
- Modify: `agents/src/workspace/adapters/http-files.ts`

- [ ] **Step 1: Add insert types to workspace/files.ts**

After `EditResult` interface:

```typescript
export interface InsertOptions {
  path: string;
  line: number;
  content: string;
}

export interface InsertResult {
  lines: number;
}
```

Add `createOnly` to `WriteOptions`:

```typescript
export interface WriteOptions {
  path: string;
  content: string;
  encoding?: 'utf-8' | 'base64';
  createOnly?: boolean;
}
```

Add `insert` to the `WorkspaceFiles` interface:

```typescript
export interface WorkspaceFiles {
  tree(options?: TreeOptions): Promise<TreeResult>;
  view(options: ViewOptions): Promise<ViewResult>;
  search(options: SearchOptions): Promise<SearchMatch[]>;
  write(options: WriteOptions): Promise<WriteResult>;
  edit(options: EditOptions): Promise<EditResult>;
  insert(options: InsertOptions): Promise<InsertResult>;
  delete(options: DeleteOptions): Promise<void>;
  move(options: MoveOptions): Promise<void>;
  upload(options: FileUploadOptions): Promise<WriteResult>;
  download(options: DownloadOptions): Promise<DownloadResult>;
}
```

- [ ] **Step 2: Add insert method to HttpFiles adapter**

In `agents/src/workspace/adapters/http-files.ts`:

```typescript
async insert(options: InsertOptions): Promise<InsertResult> {
  const response = await this.client.post('/workspace/files/insert', options);
  return response as InsertResult;
}
```

- [ ] **Step 3: Fix type errors in any mock implementations**

Check that all `WorkspaceFiles` implementations (mocks in tests) include the new `insert` method. The `download` method already exists.

- [ ] **Step 4: Run typecheck**

Run: `pnpm --filter @airo/agents typecheck`
Expected: PASS (may need to add `insert: vi.fn()` to test mocks in existing tests)

- [ ] **Step 5: Commit**

```bash
git add agents/src/workspace/files.ts agents/src/workspace/adapters/http-files.ts
git commit -m "feat(workspace): add insert() and createOnly to WorkspaceFiles interface"
```

---

## Task 4: Extract file-edit utilities to standalone module

**Files:**
- Create: `agents/src/tools/file-edit-utils.ts`
- Create: `agents/src/tools/__tests__/file-edit-utils.test.ts`
- Modify: `agents/src/tools/file-edit.ts` (re-export from new module during transition)

- [ ] **Step 1: Create `file-edit-utils.ts` with extracted functions**

Move these functions from `file-edit.ts` to `file-edit-utils.ts`:
- `isFileImmutable`
- `validateNoApiPaths`
- `resolveFilePath`
- `resolveSourceFile`

```typescript
import { dirname, resolve, relative, basename } from 'path';
import type { FileSystemOperations } from '../filesystem/index.js';
import { defaultLocalFs } from '../filesystem/index.js';
import { translateDockerPath, deriveAssetsDir, validateNoEscapingSymlinks } from '../utils/path-helper.js';
import { logger } from '../logging/index.js';
import { fileUploadService } from '../services/FileUploadService.js';
import { isSourceFile, BINARY_FILE_REGEX } from '../utils/file-types.js';

export async function isFileImmutable(filePath: string, fsOps: FileSystemOperations = defaultLocalFs): Promise<boolean> {
  if (!(await fsOps.exists(filePath))) {
    return false;
  }
  const buffer = Buffer.alloc(500);
  const fd = await fsOps.open(filePath, 'r');
  try {
    const { bytesRead } = await fd.read(buffer, 0, 500, 0);
    const firstLine = buffer.toString('utf-8', 0, bytesRead).split('\n')[0] ?? '';
    return firstLine.includes('TREAT AS IMMUTABLE');
  } finally {
    await fd.close();
  }
}

export function validateNoApiPaths(content: string, filePath: string): { valid: boolean; error?: string } {
  if (!isSourceFile(filePath)) {
    return { valid: true };
  }
  if (content.includes('/api/files/') || content.includes('/files/uploads/')) {
    return {
      valid: false,
      error: `FORBIDDEN: Cannot write upload URLs to source code. These are temporary URLs that will break in production.

The content you're trying to write contains upload URLs.

REQUIRED WORKFLOW for uploaded files:
1. FIRST: Copy file to project (e.g., create new file at "public/assets/image.png")

2. THEN: Reference with project-relative path
   Example: <img src="/assets/image.png" />

DO NOT use upload URLs in source code - they are temporary and will not work in production.`
    };
  }
  return { valid: true };
}

export function resolveFilePath(appPath: string, relativePath: string): string {
  const normalizedPath = translateDockerPath(relativePath);
  const resolved = resolve(appPath, normalizedPath);
  const rel = relative(appPath, resolved);
  if (rel.startsWith('..') || resolve(appPath) === resolved.slice(0, -1)) {
    throw new Error(`File path must be within the app directory. Resolved: ${resolved}, App path: ${appPath}`);
  }
  const assetsDir = deriveAssetsDir(appPath);
  validateNoEscapingSymlinks(resolved, appPath, assetsDir ? [assetsDir] : []);
  return resolved;
}

export async function resolveSourceFile(
  appId: string,
  targetPath: string,
  content: string,
  fullTargetPath?: string,
  fsOps: FileSystemOperations = defaultLocalFs
): Promise<{ content: string; binaryCopied?: boolean } | null> {
  try {
    const filename = basename(targetPath);
    if (content !== '') {
      return null;
    }
    const match = await fileUploadService.findMatchingUpload(appId, filename);
    if (!match) {
      logger.debug('file-edit.auto-resolve.no-match', { appId, filename });
      return null;
    }
    const { file: matchingFile, sourcePath } = match;
    const isBinary = BINARY_FILE_REGEX.test(filename) && !filename.toLowerCase().endsWith('.svg');
    if (isBinary && fullTargetPath) {
      await fsOps.mkdir(dirname(fullTargetPath), { recursive: true });
      await fsOps.writeFile(fullTargetPath, await fsOps.readFile(sourcePath));
      logger.info('file-edit.auto-resolved', {
        appId, filename,
        originalName: matchingFile.originalName,
        from: sourcePath,
        size: matchingFile.size,
        binary: true
      });
      return { content: '', binaryCopied: true };
    }
    logger.info('file-edit.auto-resolved', {
      appId, filename,
      originalName: matchingFile.originalName,
      from: sourcePath,
      size: matchingFile.size
    });
    return { content: await fsOps.readFile(sourcePath, 'utf-8') };
  } catch (error) {
    logger.error('file-edit.auto-resolve.error', {
      appId, targetPath,
      error: error instanceof Error ? error.message : String(error)
    });
    return null;
  }
}
```

- [ ] **Step 2: Update `file-edit.ts` to re-export from new module**

Replace the function definitions in `file-edit.ts` with re-exports:

```typescript
export { isFileImmutable, validateNoApiPaths, resolveFilePath, resolveSourceFile } from './file-edit-utils.js';
```

- [ ] **Step 3: Move existing security tests**

Copy/rename `agents/src/tools/__tests__/file-edit.security.test.ts` to `agents/src/tools/__tests__/file-edit-utils.test.ts`, updating the import path from `'../file-edit.js'` to `'../file-edit-utils.js'`.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @airo/agents test:unit "file-edit"`
Expected: PASS (re-exports maintain backward compatibility)

- [ ] **Step 5: Commit**

```bash
git add agents/src/tools/file-edit-utils.ts agents/src/tools/__tests__/file-edit-utils.test.ts agents/src/tools/file-edit.ts
git commit -m "refactor: extract file-edit utilities to standalone module"
```

---

## Task 5: Rewrite text-editor handlers to use WorkspaceFiles

**Files:**
- Create: `agents/src/tools/text-editor-workspace.ts`
- Create: `agents/src/tools/__tests__/text-editor-workspace.test.ts`
- Modify: `agents/src/tools/ai-lib-tools/text-editor.ts`

This is the core task. The new handlers call WorkspaceFiles methods. Error enrichment (snippet building for LLM retry) stays here — it calls `view()` after an `edit()` failure to get file content for context.

- [ ] **Step 1: Write tests for the new handlers**

Create `agents/src/tools/__tests__/text-editor-workspace.test.ts`. Use the same mock pattern as `read-file.security.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { WorkspaceFiles, ViewResult, EditResult, InsertResult, WriteResult } from '../../workspace/files';
import { handleView, handleStrReplace, handleCreate, handleInsert } from '../text-editor-workspace';

function createMockFiles(overrides?: Partial<WorkspaceFiles>): WorkspaceFiles {
  return {
    tree: vi.fn(),
    view: vi.fn(),
    search: vi.fn(),
    write: vi.fn(),
    edit: vi.fn(),
    insert: vi.fn(),
    delete: vi.fn(),
    move: vi.fn(),
    upload: vi.fn(),
    download: vi.fn(),
    ...overrides,
  } as unknown as WorkspaceFiles;
}

describe('text-editor-workspace handlers', () => {
  describe('handleView', () => {
    it('should format file content with line numbers', async () => {
      const files = createMockFiles({
        view: vi.fn().mockResolvedValue({
          path: 'test.txt', content: 'line1\nline2\nline3',
          encoding: 'utf-8', lines: 3, size: 17, truncated: false,
        }),
      });
      const result = await handleView(files, 'test.txt');
      expect(result).toBe('1: line1\n2: line2\n3: line3');
    });

    it('should pass offset/limit for view_range', async () => {
      const mockView = vi.fn().mockResolvedValue({
        path: 'test.txt', content: 'line2\nline3\nline4',
        encoding: 'utf-8', lines: 5, size: 17, truncated: false,
      });
      const files = createMockFiles({ view: mockView });
      await handleView(files, 'test.txt', [2, 4]);
      expect(mockView).toHaveBeenCalledWith({ path: 'test.txt', offset: 1, limit: 3 });
    });

    it('should detect binary files via encoding', async () => {
      const files = createMockFiles({
        view: vi.fn().mockResolvedValue({
          path: 'img.png', content: 'base64data',
          encoding: 'base64', lines: 0, size: 1024, truncated: false,
        }),
      });
      const result = await handleView(files, 'img.png');
      expect(result).toContain('binary file');
    });

    it('should handle directory listing via tree()', async () => {
      const mockView = vi.fn().mockRejectedValue(new Error('is a directory'));
      const mockTree = vi.fn().mockResolvedValue({
        entries: [
          { path: 'a.txt', kind: 'file', size: 10, modifiedAt: '' },
          { path: 'b.txt', kind: 'file', size: 20, modifiedAt: '' },
        ],
        truncated: false,
      });
      const files = createMockFiles({ view: mockView, tree: mockTree });
      const result = await handleView(files, 'src/');
      expect(result).toContain('a.txt');
      expect(result).toContain('b.txt');
    });
  });

  describe('handleStrReplace', () => {
    it('should call edit and return success', async () => {
      const files = createMockFiles({
        edit: vi.fn().mockResolvedValue({ applied: 1 }),
      });
      const result = await handleStrReplace(files, 'test.txt', 'old', 'new');
      expect(result).toBe('Successfully replaced text.');
      expect(files.edit).toHaveBeenCalledWith({
        path: 'test.txt', oldString: 'old', newString: 'new',
      });
    });

    it('should provide snippet on no_match error', async () => {
      const mockEdit = vi.fn().mockRejectedValue(
        Object.assign(new Error('oldString not found in file'), { code: 'no_match' })
      );
      const mockView = vi.fn().mockResolvedValue({
        path: 'test.txt', content: 'actual content here',
        encoding: 'utf-8', lines: 1, size: 19, truncated: false,
      });
      const files = createMockFiles({ edit: mockEdit, view: mockView });

      await expect(handleStrReplace(files, 'test.txt', 'nonexist', 'new'))
        .rejects.toThrow(/No match found/);
    });

    it('should provide match locations on ambiguous_match error', async () => {
      const mockEdit = vi.fn().mockRejectedValue(
        Object.assign(new Error('oldString found 3 times'), { code: 'ambiguous_match', count: 3 })
      );
      const mockView = vi.fn().mockResolvedValue({
        path: 'test.txt', content: 'foo\nfoo\nfoo',
        encoding: 'utf-8', lines: 3, size: 11, truncated: false,
      });
      const files = createMockFiles({ edit: mockEdit, view: mockView });

      await expect(handleStrReplace(files, 'test.txt', 'foo', 'bar'))
        .rejects.toThrow(/Found 3 matches/);
    });
  });

  describe('handleCreate', () => {
    it('should call write and return success', async () => {
      const files = createMockFiles({
        write: vi.fn().mockResolvedValue({ bytesWritten: 11 }),
      });
      const result = await handleCreate(files, 'new.txt', 'hello world');
      expect(result).toContain('Successfully created');
      expect(files.write).toHaveBeenCalledWith({ path: 'new.txt', content: 'hello world' });
    });
  });

  describe('handleInsert', () => {
    it('should call insert and return success', async () => {
      const files = createMockFiles({
        insert: vi.fn().mockResolvedValue({ lines: 4 }),
      });
      const result = await handleInsert(files, 'test.txt', 2, 'inserted line');
      expect(result).toBe('Successfully inserted text at line 2');
      expect(files.insert).toHaveBeenCalledWith({
        path: 'test.txt', line: 2, content: 'inserted line',
      });
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @airo/agents test:unit "text-editor-workspace"`
Expected: FAIL (module doesn't exist)

- [ ] **Step 3: Implement `text-editor-workspace.ts`**

```typescript
import { basename } from 'node:path';

import type { WorkspaceFiles } from '../workspace/files.js';
import { BINARY_FILE_REGEX, DOCUMENT_FILE_EXTENSIONS, IMAGE_FILE_EXTENSIONS, OTHER_BINARY_EXTENSIONS } from '../utils/file-types.js';

export const EDIT_SUCCESS_PREFIXES = [
  'successfully replaced text',
  'successfully created',
  'successfully inserted text',
] as const;

const MAX_SNIPPET_CHARS = 5_000;
const MULTI_MATCH_CONTEXT_LINES = 2;
const MULTI_MATCH_SNIPPETS_CAP = 5;
const MULTI_MATCH_HEADER_LINES_CAP = 20;

export async function handleView(
  files: WorkspaceFiles,
  path: string,
  viewRange?: [number, number],
): Promise<string> {
  // Check extension-based binary detection before calling the API
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  if ((BINARY_FILE_REGEX.test(path) && ext !== 'svg') || (OTHER_BINARY_EXTENSIONS as readonly string[]).includes(ext)) {
    const name = basename(path);
    if ((IMAGE_FILE_EXTENSIONS as readonly string[]).includes(ext)) {
      return `Cannot read ${name} — image file. Reference by path in code. Ask the user to describe visual content if needed.`;
    }
    if ((DOCUMENT_FILE_EXTENSIONS as readonly string[]).includes(ext)) {
      return `Cannot read ${name} — ${ext.toUpperCase()} not supported. Ask the user to paste relevant content into chat.`;
    }
    return `Cannot read ${name} — binary file. Reference by path in code.`;
  }

  let result;
  try {
    const offset = viewRange ? viewRange[0] - 1 : undefined;
    const limit = viewRange ? (viewRange[1] === -1 ? undefined : viewRange[1] - viewRange[0] + 1) : undefined;
    result = await files.view({ path, offset, limit });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Directory detection — supervisor returns error for directories
    if (msg.includes('is a directory') || msg.includes('EISDIR')) {
      const tree = await files.tree({ path, recursive: false });
      return `Contents:\n${tree.entries.map(e => e.path).join('\n')}`;
    }
    if (msg.includes('not found') || msg.includes('ENOENT')) {
      throw new Error('File does not exist');
    }
    throw err;
  }

  // Binary detection via encoding response
  if (result.encoding === 'base64') {
    return `Cannot read ${basename(path)} — binary file detected. Reference by path in code.`;
  }

  // Format with line numbers
  const lines = result.content.split('\n');
  const startLine = viewRange ? viewRange[0] : 1;
  return lines.map((line, i) => `${startLine + i}: ${line}`).join('\n');
}

export async function handleStrReplace(
  files: WorkspaceFiles,
  path: string,
  oldStr: string,
  newStr: string,
): Promise<string> {
  try {
    await files.edit({ path, oldString: oldStr, newString: newStr });
    return 'Successfully replaced text.';
  } catch (err) {
    const error = err as Error & { code?: string; count?: number };

    if (error.code === 'no_match') {
      // Fetch file content for error enrichment
      const viewResult = await files.view({ path });
      const lines = viewResult.content.split('\n');
      const snippet = buildErrorSnippet(lines, oldStr);
      throw new Error(
        `No match found for old_str in this file.\n\nFile content (${lines.length} lines):\n${snippet}`
      );
    }

    if (error.code === 'ambiguous_match') {
      const viewResult = await files.view({ path });
      const content = viewResult.content;
      const lines = content.split('\n');
      const count = error.count ?? content.split(oldStr).length - 1;
      const matchInfo = buildMultiMatchError(content, lines, oldStr, count);
      throw new Error(matchInfo);
    }

    throw err;
  }
}

export async function handleCreate(
  files: WorkspaceFiles,
  path: string,
  fileText: string,
): Promise<string> {
  await files.write({ path, content: fileText });
  return `Successfully created ${basename(path)}`;
}

export async function handleInsert(
  files: WorkspaceFiles,
  path: string,
  insertLine: number,
  insertText: string,
): Promise<string> {
  await files.insert({ path, line: insertLine, content: insertText });
  return `Successfully inserted text at line ${insertLine}`;
}

// --- Error enrichment helpers (agent-side policy for LLM retry) ---

function buildErrorSnippet(lines: string[], searchText: string): string {
  const formatLines = (selected: string[], startLine: number, charBudget: number): { text: string; chars: number } => {
    let result = '';
    let totalChars = 0;
    for (let i = 0; i < selected.length; i++) {
      const fullLine = `${String(startLine + i).padStart(6)}|${selected[i]!}`;
      if (totalChars + fullLine.length + 1 > charBudget) {
        if (totalChars === 0) {
          const truncLen = Math.max(0, charBudget - 50);
          result = fullLine.slice(0, truncLen) + `\n... (truncated, ${fullLine.length} chars) ...`;
          totalChars = result.length;
        } else {
          result += `\n... (truncated at ${charBudget} chars) ...`;
        }
        break;
      }
      if (i > 0) result += '\n';
      result += fullLine;
      totalChars += fullLine.length + 1;
    }
    return { text: result, chars: totalChars };
  };

  if (lines.length <= 40) {
    return formatLines(lines, 1, MAX_SNIPPET_CHARS).text;
  }

  const firstSearchLine = searchText.split('\n')[0]?.trim();
  if (firstSearchLine && firstSearchLine.length > 10) {
    for (let i = 0; i < lines.length; i++) {
      if (lines[i]!.includes(firstSearchLine)) {
        const start = Math.max(0, i - 50);
        const end = Math.min(lines.length, i + 51);
        return formatLines(lines.slice(start, end), start + 1, MAX_SNIPPET_CHARS).text;
      }
    }
  }

  const headMax = 50;
  const tailMax = 50;
  const headCount = Math.min(headMax, lines.length);
  const tailCount = Math.min(tailMax, lines.length - headCount);

  if (tailCount === 0 || headCount + tailCount === lines.length) {
    return formatLines(lines, 1, MAX_SNIPPET_CHARS).text;
  }

  const omitted = lines.length - headCount - tailCount;
  const head = formatLines(lines.slice(0, headCount), 1, MAX_SNIPPET_CHARS);
  const separator = `\n... (${omitted} line${omitted === 1 ? '' : 's'} omitted) ...\n`;
  const tailBudget = MAX_SNIPPET_CHARS - head.chars - separator.length;
  const tailStartLine = lines.length - tailCount + 1;
  const tail = tailBudget > 0
    ? formatLines(lines.slice(-tailCount), tailStartLine, tailBudget).text
    : '... (tail truncated) ...';
  return `${head.text}${separator}${tail}`;
}

function countNewlines(text: string, from: number, to: number): number {
  let n = 0;
  for (let i = from; i < to; i++) {
    if (text.charCodeAt(i) === 10) n++;
  }
  return n;
}

function formatMatchStartLinesHeader(lines: number[]): string {
  if (lines.length <= MULTI_MATCH_HEADER_LINES_CAP) {
    return lines.join(', ');
  }
  const head = lines.slice(0, MULTI_MATCH_HEADER_LINES_CAP).join(', ');
  const rest = lines.length - MULTI_MATCH_HEADER_LINES_CAP;
  return `${head}, … (${rest} more)`;
}

function buildMultiMatchError(content: string, lines: string[], oldStr: string, count: number): string {
  const oldLineCount = oldStr.split('\n').length;
  const ctx = MULTI_MATCH_CONTEXT_LINES;
  const matchSnippets: string[] = [];
  let searchFrom = 0;
  const lineCount = lines.length;
  const lastLineIdx = lineCount > 0 ? lineCount - 1 : 0;
  const maxShow = Math.min(count, MULTI_MATCH_SNIPPETS_CAP);
  const oldStrNewlineCount = countNewlines(oldStr, 0, oldStr.length);
  let lineAtSearchFrom = 1;
  const matchStartLines: number[] = [];

  for (let i = 0; i < count; i++) {
    const idx = content.indexOf(oldStr, searchFrom);
    if (idx === -1) break;
    const startLine = lineAtSearchFrom + countNewlines(content, searchFrom, idx);
    matchStartLines.push(startLine);

    if (i < maxShow) {
      const rawStartLine0 = startLine - 1;
      const rawEndLine0 = rawStartLine0 + oldLineCount - 1;
      const startLine0 = Math.min(Math.max(0, rawStartLine0), lastLineIdx);
      const endLine0 = Math.min(Math.max(startLine0, rawEndLine0), lastLineIdx);
      const sliceStart = Math.max(0, startLine0 - ctx);
      const sliceEndExclusive = Math.min(lineCount, Math.max(sliceStart + 1, endLine0 + ctx + 1));
      const block = lines.slice(sliceStart, sliceEndExclusive)
        .map((line, j) => `${String(sliceStart + j + 1).padStart(6)}|${line}`)
        .join('\n');
      matchSnippets.push(`Match ${i + 1} (starts line ${startLine}):\n${block}`);
    }

    lineAtSearchFrom = startLine + oldStrNewlineCount;
    searchFrom = idx + oldStr.length;
  }

  let detail = matchSnippets.join('\n\n');
  const truncationNote = `\n\n... (match detail truncated at ${MAX_SNIPPET_CHARS} characters)`;
  if (detail.length > MAX_SNIPPET_CHARS) {
    detail = `${detail.slice(0, MAX_SNIPPET_CHARS - truncationNote.length).trimEnd()}${truncationNote}`;
  }

  const linesHeader = formatMatchStartLinesHeader(matchStartLines);
  const summary = `Found ${count} matches for old_str at lines: ${linesHeader}. Include more surrounding context to make it unique.`;
  const omittedBlocks = count - matchSnippets.length;
  const omittedNote = omittedBlocks > 0
    ? `\n\n${omittedBlocks} more match location${omittedBlocks === 1 ? '' : 's'} not shown.`
    : '';

  return `${summary}\n\n${detail}${omittedNote}`;
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @airo/agents test:unit "text-editor-workspace"`
Expected: PASS

- [ ] **Step 5: Wire up the AI tool to use new handlers**

Modify `agents/src/tools/ai-lib-tools/text-editor.ts`:
- Replace `LocalFileSystemOperations` import with `createForWorkspace`
- Replace handler imports from `'../text-editor-handlers.js'` with `'../text-editor-workspace.js'`
- Get `WorkspaceFiles` via `createForWorkspace(appId, 'preview')!.files`
- Pass `files` and relative `path` to handlers instead of `fullPath` and `fs`

The security layer (`isFileBlocked`, `isFileImmutable`, `validateNoApiPaths`, `resolveSourceFile`) stays — these are policy checks. But `isFileImmutable` now needs to call the workspace API too (use `files.view({ path, limit: 1 })` to read first line).

- [ ] **Step 6: Update `isFileImmutable` to use WorkspaceFiles**

Add a new overload in `file-edit-utils.ts` or create a workspace-aware version in the text-editor module:

```typescript
export async function isFileImmutableViaWorkspace(files: WorkspaceFiles, path: string): Promise<boolean> {
  try {
    const result = await files.view({ path, limit: 1 });
    const firstLine = result.content.split('\n')[0] ?? '';
    return firstLine.includes('TREAT AS IMMUTABLE');
  } catch {
    // File doesn't exist or can't be read — not immutable
    return false;
  }
}
```

- [ ] **Step 7: Run all text-editor tests**

Run: `pnpm --filter @airo/agents test:unit "text-editor"`
Expected: PASS

- [ ] **Step 8: Run typecheck**

Run: `pnpm --filter @airo/agents typecheck`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add agents/src/tools/text-editor-workspace.ts agents/src/tools/__tests__/text-editor-workspace.test.ts agents/src/tools/ai-lib-tools/text-editor.ts agents/src/tools/file-edit-utils.ts
git commit -m "refactor(text-editor): migrate handlers to WorkspaceFiles API"
```

---

## Task 6: Migrate routes/apps.ts from FileEditTool to WorkspaceFiles

**Files:**
- Modify: `agents/src/server/routes/apps.ts:26,46,625-700`

- [ ] **Step 1: Replace FileEditTool usage in `/files/write` route**

Replace:
```typescript
import { FileEditTool } from '../../tools/file-edit.js';
const fileEditTool = new FileEditTool();
```

The `/files/write` route (line 640) should become:

```typescript
const workspace = createForWorkspace(id, 'preview');
if (!workspace) {
  return res.status(404).json({ error: 'Workspace not available' });
}

if (mode === 'create') {
  const writeResult = await workspace.files.write({ path: filePath, content, createOnly: true });
  return res.json({ success: true, path: filePath, mode: 'create', bytesWritten: writeResult.bytesWritten });
} else {
  const writeResult = await workspace.files.write({ path: filePath, content });
  return res.json({ success: true, path: filePath, mode: mode || 'rewrite', bytesWritten: writeResult.bytesWritten });
}
```

- [ ] **Step 2: Replace FileEditTool usage in `/files/edit` route**

The `/files/edit` route (line 682) accepts `edits[]` array. Replace with sequential `workspace.files.edit()` calls:

```typescript
const workspace = createForWorkspace(id, 'preview');
if (!workspace) {
  return res.status(404).json({ error: 'Workspace not available' });
}

const results: Array<{ old: string; applied: number; error?: string }> = [];
for (const edit of edits) {
  try {
    const editResult = await workspace.files.edit({
      path: filePath,
      oldString: edit.old,
      newString: edit.new,
    });
    results.push({ old: edit.old, applied: editResult.applied });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    results.push({ old: edit.old, applied: 0, error: msg });
  }
}

const allSucceeded = results.every(r => r.applied > 0);
return res.json({
  success: allSucceeded,
  path: filePath,
  mode: 'edit',
  edits: results,
  ...(allSucceeded ? {} : { error: 'Some edits failed' }),
});
```

- [ ] **Step 3: Run typecheck**

Run: `pnpm --filter @airo/agents typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add agents/src/server/routes/apps.ts
git commit -m "refactor(routes): migrate /files/write and /files/edit to WorkspaceFiles"
```

---

## Task 7: Migrate memory-service.ts from FileEditTool to WorkspaceFiles

**Files:**
- Modify: `agents/src/services/memory-service.ts`
- Modify: `app-templates/v8/.gitignore` (add `.memory/`)

- [ ] **Step 1: Add `.memory/` to gitignore**

Append to `app-templates/v8/.gitignore`:

```
# Agent memory (runtime state)
.memory/
```

- [ ] **Step 2: Replace FileEditTool in memory-service.ts**

Replace the FileEditTool import and usage with direct WorkspaceFiles calls:

```typescript
import { createForWorkspace } from '../workspace/index.js';
```

In `set()` method, replace the `fileEditTool.editFile()` call:

```typescript
const workspace = createForWorkspace(appId, 'preview');
if (!workspace) {
  throw new Error('Workspace not available for memory write');
}
await workspace.files.write({ path: paths.relativePath, content });
```

In `delete()` method:

```typescript
const workspace = createForWorkspace(appId, 'preview');
if (!workspace) {
  throw new Error('Workspace not available for memory delete');
}
await workspace.files.delete({ path: paths.relativePath });
```

Remove `autoCommit` — memory files are now gitignored.

- [ ] **Step 3: Run memory tests**

Run: `pnpm --filter @airo/agents test:unit "memory-service"`
Expected: PASS (may need to mock `createForWorkspace`)

- [ ] **Step 4: Commit**

```bash
git add agents/src/services/memory-service.ts app-templates/v8/.gitignore
git commit -m "refactor(memory): migrate to WorkspaceFiles, gitignore .memory/"
```

---

## Task 8: Migrate set-project-name.ts from FileEditTool to WorkspaceFiles

**Files:**
- Modify: `agents/src/tools/ai-lib-tools/set-project-name.ts`

- [ ] **Step 1: Replace FileEditTool with WorkspaceFiles + git commit**

Replace the title update section (lines 108-136):

```typescript
import { createForWorkspace } from '../../workspace/index.js';
import { GitTool } from '../git-tool.js';
```

```typescript
if (existingApp.path) {
  try {
    const defaultTitle = '<title>App Template</title>'
    const safeTitle = escapeJsxText(input.name)
    const newTitle = `<title>${safeTitle}</title>`

    const workspace = createForWorkspace(appId, 'preview')
    if (workspace) {
      try {
        await workspace.files.edit({
          path: 'src/layouts/RootLayout.tsx',
          oldString: defaultTitle,
          newString: newTitle,
        })

        // Commit the title change
        const gitTool = new GitTool(workspace.tasks)
        await gitTool.executeGitOperation(existingApp.path, {
          operation: 'add',
          files: ['src/layouts/RootLayout.tsx']
        })
        await gitTool.executeGitOperation(existingApp.path, {
          operation: 'commit',
          message: `Set page title to "${input.name}"`
        })

        logger.info('setProjectName.titleUpdated', { appId, title: input.name })
      } catch (editErr) {
        const msg = editErr instanceof Error ? editErr.message : String(editErr)
        if (msg.includes('not found') || msg.includes('no_match')) {
          logger.info('setProjectName.titleSkipped', { appId, reason: 'already-customized' })
        } else {
          logger.warn('setProjectName.titleUpdateFailed', { appId, error: msg })
        }
      }
    }
  } catch (err) {
    logger.warn('setProjectName.titleUpdateFailed', {
      appId,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}
```

- [ ] **Step 2: Run set-project-name tests**

Run: `pnpm --filter @airo/agents test:unit "set-project-name"`
Expected: PASS (may need mock updates)

- [ ] **Step 3: Commit**

```bash
git add agents/src/tools/ai-lib-tools/set-project-name.ts
git commit -m "refactor(set-project-name): migrate to WorkspaceFiles + explicit git commit"
```

---

## Task 9: Migrate image-editor-tool.ts to WorkspaceFiles

**Files:**
- Modify: `agents/src/tools/image-editor-tool.ts`

- [ ] **Step 1: Replace fs.writeFileSync with upload()**

Replace:
```typescript
import fs from 'node:fs';
import { getPersistentPublicDir } from '../utils/persistent-assets.js';
```

With:
```typescript
import { createForWorkspace } from '../workspace/index.js';
```

In `processImage()`, replace the file write:

```typescript
// Before:
// const imagesDir = path.join(getPersistentPublicDir(appPath), 'images');
// fs.mkdirSync(imagesDir, { recursive: true });
// ...
// fs.writeFileSync(filePath, imageBuffer);

// After:
const workspace = createForWorkspace(appId, 'preview');
if (!workspace) {
  return { success: false, error: 'Workspace not available' };
}

const uploadPath = `public/assets/images/${fullFilename}`;
await workspace.files.upload({ path: uploadPath, data: imageBuffer });

const publicPath = `/airo-assets/uploads/${fullFilename}`;
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm --filter @airo/agents typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add agents/src/tools/image-editor-tool.ts
git commit -m "refactor(image-editor): migrate to WorkspaceFiles upload()"
```

---

## Task 10: Migrate css-color-tool.ts to WorkspaceFiles

**Files:**
- Modify: `agents/src/tools/css-color-tool.ts`

- [ ] **Step 1: Replace readFile/writeFile with view()/write()**

Replace:
```typescript
import { readFile, writeFile } from 'node:fs/promises'
```

The `updateCssColorPalette` function reads a CSS file and writes it back. Replace:

```typescript
// Before:
// let content = await readFile(cssPath, 'utf-8')
// ... modify content ...
// await writeFile(cssPath, content, 'utf-8')

// After (pass WorkspaceFiles + relative path):
const viewResult = await files.view({ path: cssRelativePath });
let content = viewResult.content;
// ... modify content (same logic) ...
await files.write({ path: cssRelativePath, content });
```

This requires refactoring `updateCssColorPalette` to accept `WorkspaceFiles` and a relative path instead of an absolute `cssPath`. The function signature changes from:

```typescript
export async function updateCssColorPalette(cssPath: string, palette: ColorPalette): Promise<void>
```

To:

```typescript
export async function updateCssColorPalette(files: WorkspaceFiles, cssPath: string, palette: ColorPalette): Promise<void>
```

Update callers (the `cssColorAITool` in `ai-lib-tools/css-color.ts`) to pass the workspace files instance.

- [ ] **Step 2: Run typecheck**

Run: `pnpm --filter @airo/agents typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add agents/src/tools/css-color-tool.ts agents/src/tools/ai-lib-tools/css-color.ts
git commit -m "refactor(css-color): migrate to WorkspaceFiles view()/write()"
```

---

## Task 11: Migrate qr-code-tool.ts to WorkspaceFiles

**Files:**
- Modify: `agents/src/tools/qr-code-tool.ts`

- [ ] **Step 1: Replace fs usage with upload()**

The QR code tool generates a QR code image (via the `qrcode` library which writes to a temp path), then reads it back and returns a public URL. Migrate the final write to `upload()`:

```typescript
// Before:
// import fs from 'node:fs';
// const qrImageBuffer = fs.readFileSync(filePath);

// After:
import { createForWorkspace } from '../workspace/index.js';

// Generate QR to a temp buffer (qrcode library supports toBuffer)
// Then upload via workspace:
const workspace = createForWorkspace(appId, 'preview');
if (!workspace) {
  throw new Error('Workspace not available');
}
const uploadPath = `public/assets/qr-codes/${filename}`;
await workspace.files.upload({ path: uploadPath, data: qrBuffer });
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm --filter @airo/agents typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add agents/src/tools/qr-code-tool.ts
git commit -m "refactor(qr-code): migrate to WorkspaceFiles upload()"
```

---

## Task 12: Migrate video-generation-tool.ts to WorkspaceFiles (partial)

**Files:**
- Modify: `agents/src/tools/video-generation-tool.ts`

FFmpeg needs real filesystem paths for concat/stitch. Only migrate the **final outputs** (video binary + metadata JSON). Temp processing stays on local fs.

- [ ] **Step 1: Replace metadata read/write with view()/write()**

```typescript
// Before:
// existingMetadata = JSON.parse(await readFile(this.videoMetadataPath, 'utf-8'));
// await writeFile(this.videoMetadataPath, JSON.stringify(videoMetadata, null, 2));

// After:
const metadataPath = '.airo/video.json';
try {
  const viewResult = await this.workspace.files.view({ path: metadataPath });
  existingMetadata = JSON.parse(viewResult.content);
} catch { /* file doesn't exist yet */ }

await this.workspace.files.write({ path: metadataPath, content: JSON.stringify(videoMetadata, null, 2) });
```

- [ ] **Step 2: Replace final video write with upload()**

```typescript
// Before:
// await writeFile(filePath, videoBuffer);

// After:
const videoUploadPath = `public/assets/images/${filename}`;
await this.workspace.files.upload({ path: videoUploadPath, data: videoBuffer });
```

- [ ] **Step 3: Keep local fs for temp/intermediate files**

FFmpeg concat list, temp outro video, and intermediate processing files stay on local fs (they need real paths for ffmpeg). Only remove `readFile`/`writeFile` imports that are replaced; keep `access`, `mkdir`, `rename`, `unlink`, `stat` for temp file management.

- [ ] **Step 4: Run typecheck**

Run: `pnpm --filter @airo/agents typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add agents/src/tools/video-generation-tool.ts
git commit -m "refactor(video-generation): migrate outputs to WorkspaceFiles, keep temp fs for ffmpeg"
```

---

## Task 13: Delete FileEditTool class and old text-editor-handlers

**Files:**
- Delete: `agents/src/tools/file-edit.ts` (class only — utilities already extracted)
- Delete: `agents/src/tools/__tests__/text-editor-handlers.test.ts`
- Delete: `agents/src/tools/text-editor-handlers.ts`
- Modify: `agents/src/tools/index.ts` (remove FileEditTool export)

- [ ] **Step 1: Remove FileEditTool from file-edit.ts**

Replace the entire file with just the re-exports from `file-edit-utils.ts`:

```typescript
export { isFileImmutable, validateNoApiPaths, resolveFilePath, resolveSourceFile } from './file-edit-utils.js';
```

- [ ] **Step 2: Remove FileEditTool export from tools/index.ts**

Remove line: `export { FileEditTool } from './file-edit.js';`

Keep other exports from `file-edit.js` (the utility re-exports).

- [ ] **Step 3: Delete old handler files**

```bash
rm agents/src/tools/text-editor-handlers.ts
rm agents/src/tools/__tests__/text-editor-handlers.test.ts
```

- [ ] **Step 4: Update imports across codebase**

Any remaining imports of `FileEditTool` should have been removed in prior tasks. Verify:

Run: `grep -rn "FileEditTool" agents/src/ --include="*.ts" | grep -v __tests__ | grep -v ".d.ts"`
Expected: No results (or only re-export line)

- [ ] **Step 5: Run full test suite**

Run: `pnpm --filter @airo/agents test:unit`
Expected: PASS

- [ ] **Step 6: Run typecheck**

Run: `pnpm --filter @airo/agents typecheck`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add -A agents/src/tools/file-edit.ts agents/src/tools/text-editor-handlers.ts agents/src/tools/__tests__/text-editor-handlers.test.ts agents/src/tools/index.ts
git commit -m "chore: delete FileEditTool class and old text-editor-handlers"
```

---

## Task 14: Final verification and cleanup

**Files:**
- All modified files from above

- [ ] **Step 1: Run full typecheck**

Run: `pnpm typecheck`
Expected: PASS across all 24 packages

- [ ] **Step 2: Run full lint**

Run: `pnpm lint`
Expected: PASS

- [ ] **Step 3: Run full agents test suite**

Run: `pnpm --filter @airo/agents test:unit`
Expected: PASS

- [ ] **Step 4: Run dev-supervisor check**

Run: `cd dev-supervisor && make check`
Expected: PASS

- [ ] **Step 5: Verify no direct fs imports remain in migrated tools**

Run: `grep -rn "from.*'node:fs'\|from.*'fs'" agents/src/tools/image-editor-tool.ts agents/src/tools/css-color-tool.ts agents/src/tools/qr-code-tool.ts agents/src/tools/ai-lib-tools/text-editor.ts agents/src/services/memory-service.ts agents/src/tools/ai-lib-tools/set-project-name.ts`
Expected: No results

- [ ] **Step 6: Close PR #3932**

```bash
gh pr close 3932 --comment "Superseded by the workspace files migration PR"
```

- [ ] **Step 7: Verify build**

Run: `pnpm build`
Expected: PASS
