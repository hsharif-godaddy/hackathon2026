# Supervisor Filesystem Abstraction for Go-Agent Tools

**Date:** 2026-04-03
**Status:** Approved

## Problem

The go-agent tools (`readFile`, `str_replace_based_edit_tool`, `directoryListing`, `grepSearch`) access the filesystem directly via `os.*` calls. All filesystem access should go through the dev-supervisor API instead, for consistent security enforcement and architecture alignment.

## Decision

Extend the existing `supervisor.Client` with filesystem methods. Tools call these methods instead of `os.*`. No new interface abstraction — the supervisor client is the only implementation.

A new `POST /fs/grep` endpoint will be added to the dev-supervisor to support content search, keeping parity with the TypeScript implementation.

Blocked file/extension/directory checks remain in the go-agent as an additional restriction layer on top of the supervisor's path validation.

## Scope

### In scope

- Add filesystem methods to `supervisor.Client`
- Refactor all 4 tools to use supervisor client
- Add `POST /fs/grep` endpoint to dev-supervisor
- Update all tool tests

### Out of scope

- Direct filesystem fallback implementation
- Changes to the terminal tool (already uses supervisor)
- Changes to the dev-supervisor's existing `/fs/*` endpoints

## Design

### 1. Supervisor Client Types (`go-agent/internal/supervisor/types.go`)

New file containing request/response types for all `/fs/*` endpoints:

```go
package supervisor

// FSReadRequest is the request body for POST /fs/read.
type FSReadRequest struct {
    Path     string `json:"path"`
    Encoding string `json:"encoding,omitempty"` // "utf-8" or "base64", defaults to base64
    Offset   int64  `json:"offset,omitempty"`
    Length   int64  `json:"length,omitempty"` // 0 = entire file
}

// FSReadResponse is the response body from POST /fs/read.
type FSReadResponse struct {
    Content   string `json:"content"`
    Size      int64  `json:"size"`       // bytes in response
    TotalSize int64  `json:"total_size"` // actual file size
    Encoding  string `json:"encoding"`
}

// FSWriteRequest is the request body for POST /fs/write.
type FSWriteRequest struct {
    Path     string `json:"path"`
    Content  string `json:"content"`
    Encoding string `json:"encoding,omitempty"` // "utf-8" (default) or "base64"
    Mode     int    `json:"mode,omitempty"`     // file permissions, default 0644
    MkdirP   bool   `json:"mkdir_p,omitempty"`  // create parent dirs
}

// FSWriteResponse is the response body from POST /fs/write.
type FSWriteResponse struct {
    BytesWritten int64 `json:"bytes_written"`
}

// FSStatRequest is the request body for POST /fs/stat.
type FSStatRequest struct {
    Path string `json:"path"`
}

// FSStatResponse is the response body from POST /fs/stat.
type FSStatResponse struct {
    Size        int64  `json:"size"`
    IsDir       bool   `json:"is_dir"`
    IsFile      bool   `json:"is_file"`
    ModTimeMs   int64  `json:"mod_time_ms"`
    ModTime     string `json:"mod_time"`
    Permissions string `json:"permissions"` // octal e.g. "0644"
}

// FSReaddirRequest is the request body for POST /fs/readdir.
type FSReaddirRequest struct {
    Path           string   `json:"path"`
    Recursive      bool     `json:"recursive,omitempty"`
    MaxDepth       int      `json:"max_depth,omitempty"`   // default 100 when recursive
    MaxEntries     int      `json:"max_entries,omitempty"` // default 1000, max 10000
    IgnorePatterns []string `json:"ignore_patterns,omitempty"`
    IncludeHidden  bool     `json:"include_hidden,omitempty"`
}

// FSDirEntry represents a single directory entry.
type FSDirEntry struct {
    Name      string `json:"name"`
    IsDir     bool   `json:"is_dir"`
    Size      int64  `json:"size,omitempty"`
    ModTimeMs int64  `json:"mod_time_ms"`
}

// FSReaddirResponse is the response body from POST /fs/readdir.
type FSReaddirResponse struct {
    Entries   []FSDirEntry `json:"entries"`
    Truncated bool         `json:"truncated,omitempty"`
}

// FSMkdirRequest is the request body for POST /fs/mkdir.
type FSMkdirRequest struct {
    Path      string `json:"path"`
    Recursive bool   `json:"recursive,omitempty"`
}

// FSExistsRequest is the request body for POST /fs/exists.
type FSExistsRequest struct {
    Path string `json:"path"`
}

// FSExistsResponse is the response body from POST /fs/exists.
type FSExistsResponse struct {
    Exists bool `json:"exists"`
}

// FSGrepRequest is the request body for POST /fs/grep.
type FSGrepRequest struct {
    Query            string   `json:"query"`
    Paths            []string `json:"paths,omitempty"`
    Regex            bool     `json:"regex,omitempty"`
    CaseSensitive    bool     `json:"case_sensitive,omitempty"`
    ContextLines     int      `json:"context_lines,omitempty"`
    MaxResults       int      `json:"max_results,omitempty"`        // default 50
    IncludePatterns  []string `json:"include_patterns,omitempty"`
    ExcludePatterns  []string `json:"exclude_patterns,omitempty"`
    NoDefaultIgnores bool     `json:"no_default_ignores,omitempty"` // disable built-in ignores
}

// FSGrepMatch represents a single grep match.
type FSGrepMatch struct {
    File          string   `json:"file"`
    LineNum       int      `json:"line_num"`
    LineText      string   `json:"line_text"`
    ContextBefore []string `json:"context_before,omitempty"`
    ContextAfter  []string `json:"context_after,omitempty"`
}

// FSGrepResponse is the response body from POST /fs/grep.
type FSGrepResponse struct {
    Matches    []FSGrepMatch `json:"matches"`
    TotalFiles int           `json:"total_files"`
}
```

### 2. Client Methods (`go-agent/internal/supervisor/client_fs.go`)

Add a generic `post` helper and one method per endpoint:

```go
// post sends a JSON POST request and decodes the response.
// For endpoints that return only {"status":"ok"}, pass nil for resp.
func (c *Client) post(ctx context.Context, path string, req, resp any) error

func (c *Client) FSRead(ctx context.Context, req FSReadRequest) (*FSReadResponse, error)
func (c *Client) FSWrite(ctx context.Context, req FSWriteRequest) (*FSWriteResponse, error)
func (c *Client) FSStat(ctx context.Context, req FSStatRequest) (*FSStatResponse, error)
func (c *Client) FSReaddir(ctx context.Context, req FSReaddirRequest) (*FSReaddirResponse, error)
func (c *Client) FSMkdir(ctx context.Context, req FSMkdirRequest) error
func (c *Client) FSExists(ctx context.Context, req FSExistsRequest) (*FSExistsResponse, error)
func (c *Client) FSGrep(ctx context.Context, req FSGrepRequest) (*FSGrepResponse, error)
```

Refactor existing `Exec` method to use the `post` helper too.

Error handling: The `post` helper maps HTTP status codes to typed errors:

- 404 → `ErrNotFound`
- 403 → `ErrPermissionDenied`
- 400 → `ErrValidation` (with message from response)
- 413 → `ErrTooLarge`
- Other non-200 → generic error with status code and body

### 3. Tool Refactoring

All 4 tools get a `*supervisor.ClientFactory` injected via constructor, matching the existing terminal tool pattern.

#### readFile

```go
func NewReadFile(factory *supervisor.ClientFactory) *ReadFile

// Execute changes:
// - Get client via factory.Get(scope.SupervisorAddr)
// - Call client.FSRead(ctx, {Path: in.Path, Encoding: "utf-8"})
// - Keep CheckBlocked(in.Path)
// - Remove ValidatePath call (supervisor validates)
// - Line numbering and formatting stays in agent
```

#### str_replace_based_edit_tool

```go
func NewTextEditor(factory *supervisor.ClientFactory) *TextEditor

// view file:    client.FSStat → client.FSRead
// view dir:     client.FSReaddir (non-recursive)
// create:       client.FSWrite({MkdirP: true})
// str_replace:  client.FSRead → find/replace → client.FSWrite
// insert:       client.FSRead → insert lines → client.FSWrite

// For str_replace/insert, preserve file mode:
//   Read existing permissions via client.FSStat, pass mode to FSWrite
```

#### directoryListing

```go
func NewDirectoryListing(factory *supervisor.ClientFactory) *DirectoryListing

// Execute changes:
// - Call client.FSReaddir with recursive=true, passing through maxDepth, includeHidden
// - Pass IgnoredDirs as ignore_patterns
// - Build tree structure from flat entry list (entries have relative paths like "subdir/file.txt")
// - Tree formatting stays in agent
```

#### grepSearch

```go
func NewSearch(factory *supervisor.ClientFactory) *Search

// Execute changes:
// - Call client.FSGrep with all parameters mapped
// - Keep CheckBlocked for include/exclude patterns
// - Formatting of results stays in agent
```

### 4. Path Handling Changes

| Before                                                    | After                                                               |
| --------------------------------------------------------- | ------------------------------------------------------------------- |
| `ValidatePath(appRoot, relPath)` → absolute path → `os.*` | Send relative path directly to supervisor                           |
| `appRoot` used for path resolution                        | Supervisor resolves paths against its base dir                      |
| Agent validates traversal                                 | Supervisor validates traversal (agent's CheckBlocked is additional) |

`ValidatePath` can be removed or deprecated. `CheckBlocked` stays.

### 5. Tool Registration Changes (`cmd/agent/main.go`)

```go
// Before:
registry.Register(fileops.NewReadFile())
registry.Register(fileops.NewTextEditor())
registry.Register(fileops.NewDirectoryListing())
registry.Register(grep.NewSearch())

// After:
factory := supervisor.NewClientFactory()
registry.Register(fileops.NewReadFile(factory))
registry.Register(fileops.NewTextEditor(factory))
registry.Register(fileops.NewDirectoryListing(factory))
registry.Register(grep.NewSearch(factory))
registry.Register(terminal.NewCommand(factory))  // already uses factory
```

### 6. New Dev-Supervisor Endpoint: `POST /fs/grep`

Add to `dev-supervisor/cmd/dev-supervisor/api_fs.go`:

**Request** (`validation.FileGrepRequest`):

```go
type FileGrepRequest struct {
    Query            string   `json:"query"`
    Paths            []string `json:"paths,omitempty"`             // dirs or files, default: base dir
    Regex            bool     `json:"regex,omitempty"`              // default: literal match
    CaseSensitive    bool     `json:"case_sensitive,omitempty"`     // default: false (case-insensitive)
    ContextLines     int      `json:"context_lines,omitempty"`
    MaxResults       int      `json:"max_results,omitempty"`        // global limit, default 50
    IncludePatterns  []string `json:"include_patterns,omitempty"`   // basename globs
    ExcludePatterns  []string `json:"exclude_patterns,omitempty"`   // basename globs
    NoDefaultIgnores bool     `json:"no_default_ignores,omitempty"` // disable built-in ignores
}
```

**Response** (`validation.FileGrepResponse`):

```go
type FileGrepMatch struct {
    File          string   `json:"file"`
    LineNum       int      `json:"line_num"`
    LineText      string   `json:"line_text"`
    ContextBefore []string `json:"context_before,omitempty"`
    ContextAfter  []string `json:"context_after,omitempty"`
}

type FileGrepResponse struct {
    Matches    []FileGrepMatch `json:"matches"`
    TotalFiles int             `json:"total_files"`
}
```

**Implementation strategy:**

- Requires `rg` (ripgrep) — we control the runtime, no fallback needed
- Builds an `rg` command with flags:
  - `-F` for literal mode (omit for regex)
  - `-i` when `case_sensitive=false` (matching current default)
  - `-C N` for context lines
  - `--sort path` for deterministic output
  - `--json` for structured output parsing
- **Default ignores** (baked in, disabled via `no_default_ignores`):
  - Ignored dirs: `--glob "!node_modules"`, `--glob "!.git"`, etc. (all 24 from current `IgnoredDirs`)
  - Blocked extensions: `--glob "!*.log"`, `--glob "!*.db"`, etc. (all from current `BlockedExtensions`)
  - `rg` already skips hidden files and binary files by default
- Caller-provided patterns appended on top of defaults:
  - `include_patterns` → `--glob "*.go"` etc.
  - `exclude_patterns` → `--glob "!*.md"` etc.
- **Global max results**: Parse `--json` output line by line, count match entries, kill the process after N matches reached
- Paths validated against base directory (same as other `/fs/*` endpoints)
- Paths can be files or directories (improvement over current go-agent which only supports directories)

**Route registration** in `main.go`:

```go
mux.HandleFunc("POST /fs/grep", srv.handleFSGrep)
```

### 7. Testing Strategy

| Component                      | Test approach                                              |
| ------------------------------ | ---------------------------------------------------------- |
| `supervisor.Client` FS methods | `NewTestClient(httptest.Server)` with mock handlers        |
| Tool unit tests                | Test server returning canned supervisor responses          |
| Dev-supervisor grep endpoint   | Unit tests in `api_fs_test.go` following existing patterns |

### 8. Files Changed

| File                                                       | Change                                     |
| ---------------------------------------------------------- | ------------------------------------------ |
| `go-agent/internal/supervisor/types.go`                    | **New:** FS request/response types         |
| `go-agent/internal/supervisor/client.go`                   | Add `post` helper, refactor `Exec`         |
| `go-agent/internal/supervisor/client_fs.go`                | **New:** FS method implementations         |
| `go-agent/internal/supervisor/client_fs_test.go`           | **New:** tests                             |
| `go-agent/internal/tool/fileops/read_file.go`              | Use supervisor client                      |
| `go-agent/internal/tool/fileops/file_edit.go`              | Use supervisor client                      |
| `go-agent/internal/tool/fileops/directory_listing.go`      | Use supervisor `FSReaddir`                 |
| `go-agent/internal/tool/grep/grep.go`                      | Use supervisor `FSGrep`                    |
| `go-agent/internal/tool/fileops/read_file_test.go`         | Update for supervisor                      |
| `go-agent/internal/tool/fileops/file_edit_test.go`         | Update for supervisor                      |
| `go-agent/internal/tool/fileops/directory_listing_test.go` | Update for supervisor                      |
| `go-agent/internal/tool/grep/grep_test.go`                 | Update for supervisor                      |
| `go-agent/cmd/agent/main.go`                               | Pass `ClientFactory` to all tools          |
| `go-agent/internal/tool/paths.go`                          | Remove `ValidatePath`, keep `CheckBlocked` |
| `dev-supervisor/cmd/dev-supervisor/api_fs.go`              | Add `handleFSGrep`                         |
| `dev-supervisor/internal/validation/types.go`              | Add grep types                             |
| `dev-supervisor/cmd/dev-supervisor/main.go`                | Register `/fs/grep` route                  |
| `dev-supervisor/cmd/dev-supervisor/api_fs_test.go`         | Add grep tests                             |
