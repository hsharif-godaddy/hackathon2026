package main

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/airo-ai-builder/dev-supervisor/internal/config"
)

func newTestServerWithDir(t *testing.T) (*Server, string) {
	t.Helper()
	dir := t.TempDir()
	server := NewServer()
	server.config = &config.Config{AppDir: dir}
	return server, dir
}

func postJSON(t *testing.T, handler http.HandlerFunc, body any) *httptest.ResponseRecorder {
	t.Helper()
	data, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPost, "/", bytes.NewReader(data))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	handler(w, req)
	return w
}

func putRaw(t *testing.T, handler http.HandlerFunc, path string, body []byte) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPut, "/workspace/files/upload?path="+path, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/octet-stream")
	w := httptest.NewRecorder()
	handler(w, req)
	return w
}

// --- View tests ---

func TestWorkspaceFilesView_Basic(t *testing.T) {
	server, dir := newTestServerWithDir(t)
	os.WriteFile(filepath.Join(dir, "hello.txt"), []byte("line1\nline2\nline3\n"), 0o644)

	w := postJSON(t, server.handleWorkspaceFilesView, map[string]any{"path": "hello.txt"})

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp wsFilesViewResponse
	json.Unmarshal(w.Body.Bytes(), &resp)

	if resp.Encoding != "utf-8" {
		t.Errorf("expected utf-8 encoding, got %s", resp.Encoding)
	}
	if resp.Lines != 4 { // "line1\nline2\nline3\n" splits to 4 (trailing empty)
		t.Errorf("expected 4 lines, got %d", resp.Lines)
	}
}

func TestWorkspaceFilesView_OffsetLimit(t *testing.T) {
	server, dir := newTestServerWithDir(t)
	content := "a\nb\nc\nd\ne\n"
	os.WriteFile(filepath.Join(dir, "lines.txt"), []byte(content), 0o644)

	w := postJSON(t, server.handleWorkspaceFilesView, map[string]any{
		"path": "lines.txt", "offset": 1, "limit": 2,
	})

	var resp wsFilesViewResponse
	json.Unmarshal(w.Body.Bytes(), &resp)

	if resp.Content != "b\nc" {
		t.Errorf("expected 'b\\nc', got %q", resp.Content)
	}
	if !resp.Truncated {
		t.Error("expected truncated=true")
	}
}

func TestWorkspaceFilesView_NotFound(t *testing.T) {
	server, _ := newTestServerWithDir(t)
	w := postJSON(t, server.handleWorkspaceFilesView, map[string]any{"path": "nope.txt"})
	if w.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d", w.Code)
	}
}

func TestWorkspaceFilesView_PathTraversal(t *testing.T) {
	server, _ := newTestServerWithDir(t)
	w := postJSON(t, server.handleWorkspaceFilesView, map[string]any{"path": "../../../etc/passwd"})
	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for path traversal, got %d: %s", w.Code, w.Body.String())
	}
}

func TestWorkspaceFilesView_FileTooLarge(t *testing.T) {
	server, dir := newTestServerWithDir(t)
	// Create a file just over 10MB
	f, _ := os.Create(filepath.Join(dir, "big.bin"))
	f.Truncate(11 * 1024 * 1024)
	f.Close()

	w := postJSON(t, server.handleWorkspaceFilesView, map[string]any{"path": "big.bin"})
	if w.Code != http.StatusRequestEntityTooLarge {
		t.Errorf("expected 413, got %d", w.Code)
	}
}

func TestWorkspaceFilesView_Binary(t *testing.T) {
	server, dir := newTestServerWithDir(t)
	binaryData := []byte{0x89, 0x50, 0x4E, 0x47, 0x00, 0xFF, 0xFE}
	os.WriteFile(filepath.Join(dir, "img.png"), binaryData, 0o644)

	w := postJSON(t, server.handleWorkspaceFilesView, map[string]any{"path": "img.png"})

	var resp wsFilesViewResponse
	json.Unmarshal(w.Body.Bytes(), &resp)

	if resp.Encoding != "base64" {
		t.Errorf("expected base64 encoding, got %s", resp.Encoding)
	}
	decoded, _ := base64.StdEncoding.DecodeString(resp.Content)
	if !bytes.Equal(decoded, binaryData) {
		t.Error("decoded content doesn't match original")
	}
}

// --- Write tests ---

func TestWorkspaceFilesWrite_CreateFile(t *testing.T) {
	server, dir := newTestServerWithDir(t)

	w := postJSON(t, server.handleWorkspaceFilesWrite, map[string]any{
		"path": "sub/dir/new.txt", "content": "hello world",
	})

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	data, err := os.ReadFile(filepath.Join(dir, "sub/dir/new.txt"))
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "hello world" {
		t.Errorf("expected 'hello world', got %q", string(data))
	}
}

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

func TestWorkspaceFilesWrite_Base64(t *testing.T) {
	server, dir := newTestServerWithDir(t)
	binary := []byte{0x00, 0x01, 0x02, 0x03}
	encoded := base64.StdEncoding.EncodeToString(binary)

	w := postJSON(t, server.handleWorkspaceFilesWrite, map[string]any{
		"path": "data.bin", "content": encoded, "encoding": "base64",
	})

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	data, _ := os.ReadFile(filepath.Join(dir, "data.bin"))
	if !bytes.Equal(data, binary) {
		t.Error("base64 round-trip failed")
	}
}

// --- Edit tests ---

func TestWorkspaceFilesEdit_SingleMatch(t *testing.T) {
	server, dir := newTestServerWithDir(t)
	os.WriteFile(filepath.Join(dir, "app.ts"), []byte("const x = 1;\nconst y = 2;\n"), 0o644)

	w := postJSON(t, server.handleWorkspaceFilesEdit, map[string]any{
		"path": "app.ts", "oldString": "const x = 1", "newString": "const x = 42",
	})

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp wsFilesEditResponse
	json.Unmarshal(w.Body.Bytes(), &resp)
	if resp.Applied != 1 {
		t.Errorf("expected applied=1, got %d", resp.Applied)
	}

	data, _ := os.ReadFile(filepath.Join(dir, "app.ts"))
	if string(data) != "const x = 42;\nconst y = 2;\n" {
		t.Errorf("unexpected content: %q", string(data))
	}
}

func TestWorkspaceFilesEdit_AmbiguousMatch(t *testing.T) {
	server, dir := newTestServerWithDir(t)
	os.WriteFile(filepath.Join(dir, "dup.txt"), []byte("foo bar foo baz foo"), 0o644)

	w := postJSON(t, server.handleWorkspaceFilesEdit, map[string]any{
		"path": "dup.txt", "oldString": "foo", "newString": "qux",
	})

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for ambiguous match, got %d", w.Code)
	}

	var resp map[string]string
	json.Unmarshal(w.Body.Bytes(), &resp)
	if resp["error"] != "ambiguous_match" {
		t.Errorf("expected error=ambiguous_match, got %s", resp["error"])
	}
}

func TestWorkspaceFilesEdit_ReplaceAll(t *testing.T) {
	server, dir := newTestServerWithDir(t)
	os.WriteFile(filepath.Join(dir, "multi.txt"), []byte("aaa bbb aaa ccc aaa"), 0o644)

	w := postJSON(t, server.handleWorkspaceFilesEdit, map[string]any{
		"path": "multi.txt", "oldString": "aaa", "newString": "xxx", "replaceAll": true,
	})

	var resp wsFilesEditResponse
	json.Unmarshal(w.Body.Bytes(), &resp)
	if resp.Applied != 3 {
		t.Errorf("expected applied=3, got %d", resp.Applied)
	}

	data, _ := os.ReadFile(filepath.Join(dir, "multi.txt"))
	if string(data) != "xxx bbb xxx ccc xxx" {
		t.Errorf("unexpected content: %q", string(data))
	}
}

func TestWorkspaceFilesEdit_NoMatch(t *testing.T) {
	server, dir := newTestServerWithDir(t)
	os.WriteFile(filepath.Join(dir, "file.txt"), []byte("hello world"), 0o644)

	w := postJSON(t, server.handleWorkspaceFilesEdit, map[string]any{
		"path": "file.txt", "oldString": "notfound", "newString": "x",
	})

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
}

func TestWorkspaceFilesEdit_FileTooLarge(t *testing.T) {
	server, dir := newTestServerWithDir(t)
	f, _ := os.Create(filepath.Join(dir, "big.txt"))
	f.Truncate(2 * 1024 * 1024) // 2MB > 1MB limit
	f.Close()

	w := postJSON(t, server.handleWorkspaceFilesEdit, map[string]any{
		"path": "big.txt", "oldString": "x", "newString": "y",
	})

	if w.Code != http.StatusRequestEntityTooLarge {
		t.Errorf("expected 413, got %d", w.Code)
	}
}

func TestWorkspaceFilesEdit_PreservesPermissions(t *testing.T) {
	server, dir := newTestServerWithDir(t)
	path := filepath.Join(dir, "script.sh")
	os.WriteFile(path, []byte("#!/bin/bash\necho old"), 0o755)

	postJSON(t, server.handleWorkspaceFilesEdit, map[string]any{
		"path": "script.sh", "oldString": "echo old", "newString": "echo new",
	})

	info, _ := os.Stat(path)
	if info.Mode().Perm() != 0o755 {
		t.Errorf("expected 0755, got %04o", info.Mode().Perm())
	}
}

// --- Insert tests ---

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
	if resp.Lines != 5 {
		t.Errorf("expected 5 lines, got %d", resp.Lines)
	}

	data, _ := os.ReadFile(filepath.Join(dir, "app.ts"))
	if string(data) != "line1\ninserted\nline2\nline3\n" {
		t.Errorf("unexpected content: %q", string(data))
	}
}

func TestWorkspaceFilesInsert_Prepend(t *testing.T) {
	server, dir := newTestServerWithDir(t)
	os.WriteFile(filepath.Join(dir, "app.ts"), []byte("line1\nline2\n"), 0o644)

	w := postJSON(t, server.handleWorkspaceFilesInsert, map[string]any{
		"path": "app.ts", "line": 0, "content": "header",
	})

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	data, _ := os.ReadFile(filepath.Join(dir, "app.ts"))
	if string(data) != "header\nline1\nline2\n" {
		t.Errorf("unexpected content: %q", string(data))
	}
}

func TestWorkspaceFilesInsert_Append(t *testing.T) {
	server, dir := newTestServerWithDir(t)
	os.WriteFile(filepath.Join(dir, "app.ts"), []byte("line1\nline2\n"), 0o644)

	w := postJSON(t, server.handleWorkspaceFilesInsert, map[string]any{
		"path": "app.ts", "line": 999, "content": "footer",
	})

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	data, _ := os.ReadFile(filepath.Join(dir, "app.ts"))
	if string(data) != "line1\nline2\nfooter\n" {
		t.Errorf("unexpected content: %q", string(data))
	}
}

func TestWorkspaceFilesInsert_FileTooLarge(t *testing.T) {
	server, dir := newTestServerWithDir(t)
	f, _ := os.Create(filepath.Join(dir, "big.txt"))
	f.Truncate(2 * 1024 * 1024) // 2MB > 1MB limit
	f.Close()

	w := postJSON(t, server.handleWorkspaceFilesInsert, map[string]any{
		"path": "big.txt", "line": 1, "content": "x",
	})

	if w.Code != http.StatusRequestEntityTooLarge {
		t.Errorf("expected 413, got %d", w.Code)
	}
}

func TestWorkspaceFilesInsert_NotFound(t *testing.T) {
	server, _ := newTestServerWithDir(t)
	w := postJSON(t, server.handleWorkspaceFilesInsert, map[string]any{
		"path": "nope.txt", "line": 1, "content": "x",
	})
	if w.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d", w.Code)
	}
}

func TestWorkspaceFilesInsert_PreservesPermissions(t *testing.T) {
	server, dir := newTestServerWithDir(t)
	path := filepath.Join(dir, "script.sh")
	os.WriteFile(path, []byte("#!/bin/bash\necho hello"), 0o755)

	postJSON(t, server.handleWorkspaceFilesInsert, map[string]any{
		"path": "script.sh", "line": 1, "content": "# comment",
	})

	info, _ := os.Stat(path)
	if info.Mode().Perm() != 0o755 {
		t.Errorf("expected 0755, got %04o", info.Mode().Perm())
	}
}

// --- Delete tests ---

func TestWorkspaceFilesDelete_File(t *testing.T) {
	server, dir := newTestServerWithDir(t)
	path := filepath.Join(dir, "delete-me.txt")
	os.WriteFile(path, []byte("bye"), 0o644)

	w := postJSON(t, server.handleWorkspaceFilesDelete, map[string]any{"path": "delete-me.txt"})
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Error("file should be deleted")
	}
}

func TestWorkspaceFilesDelete_RecursiveDir(t *testing.T) {
	server, dir := newTestServerWithDir(t)
	os.MkdirAll(filepath.Join(dir, "rmdir/sub"), 0o755)
	os.WriteFile(filepath.Join(dir, "rmdir/sub/file.txt"), []byte("x"), 0o644)

	w := postJSON(t, server.handleWorkspaceFilesDelete, map[string]any{
		"path": "rmdir", "recursive": true,
	})
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	if _, err := os.Stat(filepath.Join(dir, "rmdir")); !os.IsNotExist(err) {
		t.Error("directory should be deleted")
	}
}

// --- Move tests ---

func TestWorkspaceFilesMove_Basic(t *testing.T) {
	server, dir := newTestServerWithDir(t)
	os.WriteFile(filepath.Join(dir, "old.txt"), []byte("data"), 0o644)

	w := postJSON(t, server.handleWorkspaceFilesMove, map[string]any{
		"from": "old.txt", "to": "new.txt",
	})
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	if _, err := os.Stat(filepath.Join(dir, "old.txt")); !os.IsNotExist(err) {
		t.Error("old path should not exist")
	}
	data, _ := os.ReadFile(filepath.Join(dir, "new.txt"))
	if string(data) != "data" {
		t.Errorf("expected 'data', got %q", string(data))
	}
}

func TestWorkspaceFilesMove_DestinationExists(t *testing.T) {
	server, dir := newTestServerWithDir(t)
	os.WriteFile(filepath.Join(dir, "a.txt"), []byte("a"), 0o644)
	os.WriteFile(filepath.Join(dir, "b.txt"), []byte("b"), 0o644)

	w := postJSON(t, server.handleWorkspaceFilesMove, map[string]any{
		"from": "a.txt", "to": "b.txt",
	})
	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for destination_exists, got %d", w.Code)
	}
}

// --- Tree tests ---

func TestWorkspaceFilesTree_Basic(t *testing.T) {
	server, dir := newTestServerWithDir(t)
	os.WriteFile(filepath.Join(dir, "file1.txt"), []byte("x"), 0o644)
	os.MkdirAll(filepath.Join(dir, "subdir"), 0o755)

	w := postJSON(t, server.handleWorkspaceFilesTree, map[string]any{})

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp wsFilesTreeResponse
	json.Unmarshal(w.Body.Bytes(), &resp)

	if len(resp.Entries) != 2 {
		t.Fatalf("expected 2 entries, got %d", len(resp.Entries))
	}
}

func TestWorkspaceFilesTree_NotFound(t *testing.T) {
	server, _ := newTestServerWithDir(t)
	w := postJSON(t, server.handleWorkspaceFilesTree, map[string]any{"path": "nonexistent"})
	if w.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d: %s", w.Code, w.Body.String())
	}
}

func TestWorkspaceFilesTree_InvalidGlob(t *testing.T) {
	server, _ := newTestServerWithDir(t)
	w := postJSON(t, server.handleWorkspaceFilesTree, map[string]any{
		"includeGlobs": []string{"[invalid"},
	})
	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for bad glob, got %d: %s", w.Code, w.Body.String())
	}
}

// --- Upload tests ---

func TestWorkspaceFilesUpload_Basic(t *testing.T) {
	server, dir := newTestServerWithDir(t)
	data := []byte{0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A}

	w := putRaw(t, server.handleWorkspaceFilesUpload, "images/logo.png", data)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	written, _ := os.ReadFile(filepath.Join(dir, "images/logo.png"))
	if !bytes.Equal(written, data) {
		t.Error("uploaded content doesn't match")
	}
}

func TestWorkspaceFilesUpload_PathTraversal(t *testing.T) {
	server, _ := newTestServerWithDir(t)
	w := putRaw(t, server.handleWorkspaceFilesUpload, "../../../etc/evil", []byte("hack"))
	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for path traversal, got %d", w.Code)
	}
}

func TestWorkspaceFilesUpload_MissingPath(t *testing.T) {
	server, _ := newTestServerWithDir(t)
	req := httptest.NewRequest(http.MethodPut, "/workspace/files/upload", bytes.NewReader([]byte("x")))
	w := httptest.NewRecorder()
	server.handleWorkspaceFilesUpload(w, req)
	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for missing path, got %d", w.Code)
	}
}

// --- Download tests ---

func getRaw(t *testing.T, handler http.HandlerFunc, path string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/workspace/files/download?path="+path, nil)
	w := httptest.NewRecorder()
	handler(w, req)
	return w
}

func TestWorkspaceFilesDownload_TextFile(t *testing.T) {
	server, dir := newTestServerWithDir(t)
	content := "hello world\nline two\n"
	os.WriteFile(filepath.Join(dir, "readme.txt"), []byte(content), 0o644)

	w := getRaw(t, server.handleWorkspaceFilesDownload, "readme.txt")

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	if ct := w.Header().Get("Content-Type"); ct != "text/plain; charset=utf-8" {
		t.Errorf("expected text/plain; charset=utf-8, got %s", ct)
	}
	if w.Body.String() != content {
		t.Errorf("body mismatch: got %q", w.Body.String())
	}
}

func TestWorkspaceFilesDownload_BinaryFile(t *testing.T) {
	server, dir := newTestServerWithDir(t)
	pngData := []byte{0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A}
	os.WriteFile(filepath.Join(dir, "img.png"), pngData, 0o644)

	w := getRaw(t, server.handleWorkspaceFilesDownload, "img.png")

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	if ct := w.Header().Get("Content-Type"); ct != "image/png" {
		t.Errorf("expected image/png, got %s", ct)
	}
	if cl := w.Header().Get("Content-Length"); cl != "8" {
		t.Errorf("expected Content-Length 8, got %s", cl)
	}
	if !bytes.Equal(w.Body.Bytes(), pngData) {
		t.Error("body doesn't match PNG data")
	}
}

func TestWorkspaceFilesDownload_NotFound(t *testing.T) {
	server, _ := newTestServerWithDir(t)
	w := getRaw(t, server.handleWorkspaceFilesDownload, "nonexistent.txt")
	if w.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d", w.Code)
	}
}

func TestWorkspaceFilesDownload_PathTraversal(t *testing.T) {
	server, _ := newTestServerWithDir(t)
	w := getRaw(t, server.handleWorkspaceFilesDownload, "../../../etc/passwd")
	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for path traversal, got %d: %s", w.Code, w.Body.String())
	}
}

func TestWorkspaceFilesDownload_MissingPath(t *testing.T) {
	server, _ := newTestServerWithDir(t)
	req := httptest.NewRequest(http.MethodGet, "/workspace/files/download", nil)
	w := httptest.NewRecorder()
	server.handleWorkspaceFilesDownload(w, req)
	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for missing path, got %d", w.Code)
	}
}

func TestWorkspaceFilesDownload_TooLarge(t *testing.T) {
	server, dir := newTestServerWithDir(t)
	f, _ := os.Create(filepath.Join(dir, "huge.bin"))
	f.Truncate(11 * 1024 * 1024) // 11MB > 10MB limit
	f.Close()

	w := getRaw(t, server.handleWorkspaceFilesDownload, "huge.bin")
	if w.Code != http.StatusRequestEntityTooLarge {
		t.Errorf("expected 413, got %d", w.Code)
	}
}

func TestWorkspaceFilesDownload_Directory(t *testing.T) {
	server, dir := newTestServerWithDir(t)
	os.MkdirAll(filepath.Join(dir, "subdir"), 0o755)

	w := getRaw(t, server.handleWorkspaceFilesDownload, "subdir")
	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for directory, got %d", w.Code)
	}
}

// --- Search tests ---

func TestWorkspaceFilesSearch_EmptyPattern(t *testing.T) {
	server, _ := newTestServerWithDir(t)
	w := postJSON(t, server.handleWorkspaceFilesSearch, map[string]any{"pattern": ""})
	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for empty pattern, got %d", w.Code)
	}
}

func TestWorkspaceFilesSearch_InvalidGlob(t *testing.T) {
	server, _ := newTestServerWithDir(t)
	w := postJSON(t, server.handleWorkspaceFilesSearch, map[string]any{
		"pattern": "foo", "includeGlobs": []string{"[bad"},
	})
	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for bad glob, got %d: %s", w.Code, w.Body.String())
	}
}

func TestWorkspaceFilesSearch_NoMatches(t *testing.T) {
	server, dir := newTestServerWithDir(t)
	os.WriteFile(filepath.Join(dir, "file.txt"), []byte("hello world"), 0o644)

	w := postJSON(t, server.handleWorkspaceFilesSearch, map[string]any{
		"pattern": "zzz_not_present",
	})

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp wsFilesSearchResponse
	json.Unmarshal(w.Body.Bytes(), &resp)
	if len(resp.Matches) != 0 {
		t.Errorf("expected 0 matches, got %d", len(resp.Matches))
	}
}
