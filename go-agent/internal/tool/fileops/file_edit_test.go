package fileops

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/gdcorp-partners/airo-app-builder/go-agent/internal/supervisor"
	"github.com/gdcorp-partners/airo-app-builder/go-agent/internal/tool"
)

// mockFS is an in-memory filesystem used by the test supervisor server.
type mockFS struct {
	mu    sync.RWMutex
	files map[string]mockFile       // path -> file
	dirs  map[string][]mockDirEntry // path -> entries
}

type mockFile struct {
	content     string
	permissions string // octal e.g. "0644"
}

type mockDirEntry struct {
	name  string
	isDir bool
}

func newMockFS() *mockFS {
	return &mockFS{
		files: make(map[string]mockFile),
		dirs:  make(map[string][]mockDirEntry),
	}
}

func (fs *mockFS) setFile(path, content, perms string) {
	fs.mu.Lock()
	defer fs.mu.Unlock()
	fs.files[path] = mockFile{content: content, permissions: perms}
}

func (fs *mockFS) getFile(path string) (mockFile, bool) {
	fs.mu.RLock()
	defer fs.mu.RUnlock()
	f, ok := fs.files[path]
	return f, ok
}

func (fs *mockFS) setDir(path string, entries []mockDirEntry) {
	fs.mu.Lock()
	defer fs.mu.Unlock()
	fs.dirs[path] = entries
}

// setupTextEditorServer creates a test HTTP server that mocks supervisor fs endpoints.
func setupTextEditorServer(t *testing.T, fs *mockFS) (*httptest.Server, *supervisor.ClientFactory, context.Context) {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/fs/read":
			var req supervisor.FSReadRequest
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				w.WriteHeader(http.StatusBadRequest)
				json.NewEncoder(w).Encode(map[string]string{"error": "bad_request", "message": err.Error()})
				return
			}
			f, ok := fs.getFile(req.Path)
			if !ok {
				w.WriteHeader(http.StatusNotFound)
				json.NewEncoder(w).Encode(map[string]string{"error": "not_found", "message": "file does not exist"})
				return
			}
			json.NewEncoder(w).Encode(supervisor.FSReadResponse{
				Content:   f.content,
				Size:      int64(len(f.content)),
				TotalSize: int64(len(f.content)),
				Encoding:  "utf-8",
			})

		case "/fs/write":
			var req supervisor.FSWriteRequest
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				w.WriteHeader(http.StatusBadRequest)
				json.NewEncoder(w).Encode(map[string]string{"error": "bad_request", "message": err.Error()})
				return
			}
			perms := "0644"
			if req.Mode != 0 {
				perms = "0" + strconv.FormatInt(int64(req.Mode), 8)
			}
			// Check if file exists to preserve permissions if mode not specified.
			if req.Mode == 0 {
				if existing, ok := fs.getFile(req.Path); ok {
					perms = existing.permissions
				}
			}
			fs.setFile(req.Path, req.Content, perms)
			json.NewEncoder(w).Encode(supervisor.FSWriteResponse{
				BytesWritten: int64(len(req.Content)),
			})

		case "/fs/stat":
			var req supervisor.FSStatRequest
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				w.WriteHeader(http.StatusBadRequest)
				json.NewEncoder(w).Encode(map[string]string{"error": "bad_request", "message": err.Error()})
				return
			}
			// Check dirs first.
			fs.mu.RLock()
			_, isDir := fs.dirs[req.Path]
			fs.mu.RUnlock()
			if isDir {
				json.NewEncoder(w).Encode(supervisor.FSStatResponse{
					IsDir:       true,
					IsFile:      false,
					Permissions: "0755",
				})
				return
			}
			f, ok := fs.getFile(req.Path)
			if !ok {
				w.WriteHeader(http.StatusNotFound)
				json.NewEncoder(w).Encode(map[string]string{"error": "not_found", "message": "file does not exist"})
				return
			}
			json.NewEncoder(w).Encode(supervisor.FSStatResponse{
				Size:        int64(len(f.content)),
				IsDir:       false,
				IsFile:      true,
				Permissions: f.permissions,
			})

		case "/fs/readdir":
			var req supervisor.FSReaddirRequest
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				w.WriteHeader(http.StatusBadRequest)
				json.NewEncoder(w).Encode(map[string]string{"error": "bad_request", "message": err.Error()})
				return
			}
			fs.mu.RLock()
			entries, ok := fs.dirs[req.Path]
			fs.mu.RUnlock()
			if !ok {
				w.WriteHeader(http.StatusNotFound)
				json.NewEncoder(w).Encode(map[string]string{
					"error": "not_found", "message": "directory does not exist",
				})
				return
			}
			var dirEntries []supervisor.FSDirEntry
			for _, e := range entries {
				dirEntries = append(dirEntries, supervisor.FSDirEntry{
					Name:  e.name,
					IsDir: e.isDir,
				})
			}
			json.NewEncoder(w).Encode(supervisor.FSReaddirResponse{
				Entries: dirEntries,
			})

		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))

	factory := supervisor.NewClientFactory()
	addr := "http://" + srv.Listener.Addr().String()
	ctx := tool.TestContextWithSupervisor("", addr)

	return srv, factory, ctx
}

func execTextEditor(ctx context.Context, t *testing.T, te tool.Tool, input map[string]any) (string, error) {
	t.Helper()
	data, err := json.Marshal(input)
	require.NoError(t, err)
	var stream tool.BufferedStream
	execErr := te.Execute(ctx, data, &stream)
	return stream.String(), execErr
}

func TestTextEditorStrReplace(t *testing.T) {
	fs := newMockFS()
	fs.setFile("hello.txt", "hello world\n", "0644")
	srv, factory, ctx := setupTextEditorServer(t, fs)
	defer srv.Close()

	te := NewTextEditor(factory)
	out, err := execTextEditor(ctx, t, te, map[string]any{
		"command": "str_replace",
		"path":    "hello.txt",
		"old_str": "hello world",
		"new_str": "goodbye world",
	})
	require.NoError(t, err)
	assert.Contains(t, out, "replaced")

	f, ok := fs.getFile("hello.txt")
	require.True(t, ok)
	assert.Equal(t, "goodbye world\n", f.content)
}

func TestTextEditorStrReplacePreservesPermissions(t *testing.T) {
	fs := newMockFS()
	fs.setFile("script.sh", "#!/bin/bash\necho old\n", "0755")
	srv, factory, ctx := setupTextEditorServer(t, fs)
	defer srv.Close()

	te := NewTextEditor(factory)
	_, err := execTextEditor(ctx, t, te, map[string]any{
		"command": "str_replace",
		"path":    "script.sh",
		"old_str": "echo old",
		"new_str": "echo new",
	})
	require.NoError(t, err)

	f, ok := fs.getFile("script.sh")
	require.True(t, ok)
	assert.Equal(t, "0755", f.permissions)
}

func TestTextEditorStrReplaceNotFound(t *testing.T) {
	fs := newMockFS()
	fs.setFile("hello.txt", "hello world\n", "0644")
	srv, factory, ctx := setupTextEditorServer(t, fs)
	defer srv.Close()

	te := NewTextEditor(factory)
	_, err := execTextEditor(ctx, t, te, map[string]any{
		"command": "str_replace",
		"path":    "hello.txt",
		"old_str": "not in file",
		"new_str": "replacement",
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "not found")
}

func TestTextEditorStrReplaceMultipleMatches(t *testing.T) {
	fs := newMockFS()
	fs.setFile("dup.txt", "foo\nbar\nfoo\n", "0644")
	srv, factory, ctx := setupTextEditorServer(t, fs)
	defer srv.Close()

	te := NewTextEditor(factory)
	_, err := execTextEditor(ctx, t, te, map[string]any{
		"command": "str_replace",
		"path":    "dup.txt",
		"old_str": "foo",
		"new_str": "baz",
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "multiple")
}

func TestTextEditorCreate(t *testing.T) {
	fs := newMockFS()
	srv, factory, ctx := setupTextEditorServer(t, fs)
	defer srv.Close()

	te := NewTextEditor(factory)
	out, err := execTextEditor(ctx, t, te, map[string]any{
		"command":   "create",
		"path":      "sub/new.txt",
		"file_text": "new content\n",
	})
	require.NoError(t, err)
	assert.Contains(t, out, "created")

	f, ok := fs.getFile("sub/new.txt")
	require.True(t, ok)
	assert.Equal(t, "new content\n", f.content)
}

func TestTextEditorCreateOverwritesExisting(t *testing.T) {
	fs := newMockFS()
	fs.setFile("exists.txt", "old", "0644")
	srv, factory, ctx := setupTextEditorServer(t, fs)
	defer srv.Close()

	te := NewTextEditor(factory)
	out, err := execTextEditor(ctx, t, te, map[string]any{
		"command":   "create",
		"path":      "exists.txt",
		"file_text": "new content",
	})
	require.NoError(t, err)
	assert.Contains(t, out, "created")

	f, ok := fs.getFile("exists.txt")
	require.True(t, ok)
	assert.Equal(t, "new content", f.content)
}

func TestTextEditorCreateOverwritePreservesPermissions(t *testing.T) {
	fs := newMockFS()
	fs.setFile("script.sh", "#!/bin/bash\necho old\n", "0755")
	srv, factory, ctx := setupTextEditorServer(t, fs)
	defer srv.Close()

	te := NewTextEditor(factory)
	_, err := execTextEditor(ctx, t, te, map[string]any{
		"command":   "create",
		"path":      "script.sh",
		"file_text": "#!/bin/bash\necho new\n",
	})
	require.NoError(t, err)

	f, ok := fs.getFile("script.sh")
	require.True(t, ok)
	assert.Equal(t, "0755", f.permissions)
}

func TestTextEditorCreateImmutable(t *testing.T) {
	fs := newMockFS()
	srv, factory, ctx := setupTextEditorServer(t, fs)
	defer srv.Close()

	te := NewTextEditor(factory)
	_, err := execTextEditor(ctx, t, te, map[string]any{
		"command":   "create",
		"path":      "locked.txt",
		"file_text": "// TREAT AS IMMUTABLE\nsome content",
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "immutable")
}

func TestTextEditorView(t *testing.T) {
	fs := newMockFS()
	fs.setFile("view.txt", "line1\nline2\n", "0644")
	srv, factory, ctx := setupTextEditorServer(t, fs)
	defer srv.Close()

	te := NewTextEditor(factory)
	out, err := execTextEditor(ctx, t, te, map[string]any{
		"command": "view",
		"path":    "view.txt",
	})
	require.NoError(t, err)
	assert.Contains(t, out, "line1")
	assert.Contains(t, out, "line2")
}

func TestTextEditorViewRange(t *testing.T) {
	fs := newMockFS()
	fs.setFile("multi.txt", "line1\nline2\nline3\nline4\nline5\n", "0644")
	srv, factory, ctx := setupTextEditorServer(t, fs)
	defer srv.Close()

	te := NewTextEditor(factory)
	out, err := execTextEditor(ctx, t, te, map[string]any{
		"command":    "view",
		"path":       "multi.txt",
		"view_range": []int{2, 4},
	})
	require.NoError(t, err)
	assert.NotContains(t, out, "line1")
	assert.Contains(t, out, "line2")
	assert.Contains(t, out, "line3")
	assert.Contains(t, out, "line4")
	assert.NotContains(t, out, "line5")
}

func TestTextEditorViewRangeInverted(t *testing.T) {
	fs := newMockFS()
	fs.setFile("multi.txt", "line1\nline2\nline3\nline4\nline5\n", "0644")
	srv, factory, ctx := setupTextEditorServer(t, fs)
	defer srv.Close()

	te := NewTextEditor(factory)
	_, err := execTextEditor(ctx, t, te, map[string]any{
		"command":    "view",
		"path":       "multi.txt",
		"view_range": []int{5, 2},
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "must be >= start")
}

func TestTextEditorViewDirectory(t *testing.T) {
	fs := newMockFS()
	fs.setDir("src", []mockDirEntry{
		{name: "main.go", isDir: false},
		{name: "sub", isDir: true},
	})
	srv, factory, ctx := setupTextEditorServer(t, fs)
	defer srv.Close()

	te := NewTextEditor(factory)
	out, err := execTextEditor(ctx, t, te, map[string]any{
		"command": "view",
		"path":    "src",
	})
	require.NoError(t, err)
	assert.Contains(t, out, "main.go")
	assert.Contains(t, out, "sub/")
}

func TestTextEditorInsert(t *testing.T) {
	fs := newMockFS()
	fs.setFile("insert.txt", "line1\nline2\nline3\n", "0644")
	srv, factory, ctx := setupTextEditorServer(t, fs)
	defer srv.Close()

	te := NewTextEditor(factory)
	out, err := execTextEditor(ctx, t, te, map[string]any{
		"command":     "insert",
		"path":        "insert.txt",
		"insert_line": 1,
		"insert_text": "inserted",
	})
	require.NoError(t, err)
	assert.Contains(t, out, "inserted text")

	f, ok := fs.getFile("insert.txt")
	require.True(t, ok)
	assert.Equal(t, "line1\ninserted\nline2\nline3\n", f.content)
}

func TestTextEditorInsertAtBeginning(t *testing.T) {
	fs := newMockFS()
	fs.setFile("begin.txt", "line1\nline2\n", "0644")
	srv, factory, ctx := setupTextEditorServer(t, fs)
	defer srv.Close()

	te := NewTextEditor(factory)
	_, err := execTextEditor(ctx, t, te, map[string]any{
		"command":     "insert",
		"path":        "begin.txt",
		"insert_line": 0,
		"insert_text": "header",
	})
	require.NoError(t, err)

	f, ok := fs.getFile("begin.txt")
	require.True(t, ok)
	assert.Equal(t, "header\nline1\nline2\n", f.content)
}

func TestTextEditorToolMetadata(t *testing.T) {
	te := NewTextEditor(supervisor.NewClientFactory())

	assert.Equal(t, "str_replace_based_edit_tool", te.Name())
	assert.NotEmpty(t, te.Description())

	var schema map[string]any
	require.NoError(t, json.Unmarshal(te.InputSchema(), &schema))
	props := schema["properties"].(map[string]any)
	assert.Contains(t, props, "command")
	assert.Contains(t, props, "path")
	assert.Contains(t, props, "insert_line")
	assert.Contains(t, props, "view_range")
}

func TestTextEditorInvalidCommand(t *testing.T) {
	fs := newMockFS()
	srv, factory, ctx := setupTextEditorServer(t, fs)
	defer srv.Close()

	te := NewTextEditor(factory)
	_, err := execTextEditor(ctx, t, te, map[string]any{
		"command": "drop_tables",
		"path":    "x.txt",
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "unknown command")
}

func TestTextEditorBlockedFile(t *testing.T) {
	fs := newMockFS()
	fs.setFile("package-lock.json", "{}", "0644")
	srv, factory, ctx := setupTextEditorServer(t, fs)
	defer srv.Close()

	te := NewTextEditor(factory)
	_, err := execTextEditor(ctx, t, te, map[string]any{
		"command": "view",
		"path":    "package-lock.json",
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "blocked")
}

func TestTextEditorImmutableFile(t *testing.T) {
	fs := newMockFS()
	content := "// TREAT AS IMMUTABLE\nconst x = 1;\n"
	fs.setFile("locked.js", content, "0644")
	srv, factory, ctx := setupTextEditorServer(t, fs)
	defer srv.Close()

	te := NewTextEditor(factory)

	// str_replace should fail
	_, err := execTextEditor(ctx, t, te, map[string]any{
		"command": "str_replace",
		"path":    "locked.js",
		"old_str": "const x = 1;",
		"new_str": "const x = 2;",
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "immutable")

	// insert should fail
	_, err = execTextEditor(ctx, t, te, map[string]any{
		"command":     "insert",
		"path":        "locked.js",
		"insert_line": 1,
		"insert_text": "// injected",
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "immutable")

	// view should still work
	out, err := execTextEditor(ctx, t, te, map[string]any{
		"command": "view",
		"path":    "locked.js",
	})
	require.NoError(t, err)
	assert.Contains(t, out, "TREAT AS IMMUTABLE")
}

func TestTextEditorCreateBlockedFile(t *testing.T) {
	fs := newMockFS()
	srv, factory, ctx := setupTextEditorServer(t, fs)
	defer srv.Close()

	te := NewTextEditor(factory)

	// create inside node_modules should be blocked
	_, err := execTextEditor(ctx, t, te, map[string]any{
		"command":   "create",
		"path":      "node_modules/pkg/index.js",
		"file_text": "module.exports = {}",
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "blocked")

	// create with blocked extension should be blocked
	_, err = execTextEditor(ctx, t, te, map[string]any{
		"command":   "create",
		"path":      "data.sqlite",
		"file_text": "binary",
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "blocked")
}

func TestTextEditorMissingScope(t *testing.T) {
	te := NewTextEditor(supervisor.NewClientFactory())

	var stream tool.BufferedStream
	data, _ := json.Marshal(map[string]any{
		"command": "view",
		"path":    "any.txt",
	})
	err := te.Execute(context.Background(), data, &stream)
	require.ErrorIs(t, err, tool.ErrNoScope)
}

func TestTextEditorStrReplaceFileNotExist(t *testing.T) {
	fs := newMockFS()
	srv, factory, ctx := setupTextEditorServer(t, fs)
	defer srv.Close()

	te := NewTextEditor(factory)
	_, err := execTextEditor(ctx, t, te, map[string]any{
		"command": "str_replace",
		"path":    "nonexistent.txt",
		"old_str": "hello",
		"new_str": "world",
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "does not exist")
}

func TestTextEditorViewFileNotExist(t *testing.T) {
	fs := newMockFS()
	srv, factory, ctx := setupTextEditorServer(t, fs)
	defer srv.Close()

	te := NewTextEditor(factory)
	_, err := execTextEditor(ctx, t, te, map[string]any{
		"command": "view",
		"path":    "nonexistent.txt",
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "does not exist")
}

func TestTextEditorInsertFileNotExist(t *testing.T) {
	fs := newMockFS()
	srv, factory, ctx := setupTextEditorServer(t, fs)
	defer srv.Close()

	te := NewTextEditor(factory)
	_, err := execTextEditor(ctx, t, te, map[string]any{
		"command":     "insert",
		"path":        "nonexistent.txt",
		"insert_line": 0,
		"insert_text": "hello",
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "does not exist")
}
