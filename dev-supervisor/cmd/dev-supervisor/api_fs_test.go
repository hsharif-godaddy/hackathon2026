package main

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/airo-ai-builder/dev-supervisor/internal/config"
	"github.com/airo-ai-builder/dev-supervisor/internal/validation"
)

// newFsTestServer creates a server with AppDir pointed at the given directory.
func newFsTestServer(appDir string) *Server {
	s := NewServer()
	s.config = &config.Config{AppDir: appDir}
	return s
}

func TestHandleFsRead(t *testing.T) {
	t.Parallel()
	appDir := t.TempDir()
	server := newFsTestServer(appDir)

	// Create a test file
	testContent := "hello world"
	if err := os.WriteFile(filepath.Join(appDir, "test.txt"), []byte(testContent), 0o644); err != nil {
		t.Fatal(err)
	}

	t.Run("read utf-8 file", func(t *testing.T) {
		t.Parallel()
		body := mustMarshalJSON(t, validation.FileReadRequest{
			Path:     "test.txt",
			Encoding: "utf-8",
		})
		req := httptest.NewRequest(http.MethodPost, "/fs/read", bytes.NewReader(body))
		w := httptest.NewRecorder()

		server.handleFsRead(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
		}

		var resp validation.FileReadResponse
		if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
			t.Fatal(err)
		}
		if resp.Content != testContent {
			t.Errorf("expected %q, got %q", testContent, resp.Content)
		}
		if resp.Encoding != "utf-8" {
			t.Errorf("expected encoding utf-8, got %q", resp.Encoding)
		}
		if resp.Size != int64(len(testContent)) {
			t.Errorf("expected size %d, got %d", len(testContent), resp.Size)
		}
	})

	t.Run("read base64 file", func(t *testing.T) {
		t.Parallel()
		body := mustMarshalJSON(t, validation.FileReadRequest{
			Path: "test.txt",
		})
		req := httptest.NewRequest(http.MethodPost, "/fs/read", bytes.NewReader(body))
		w := httptest.NewRecorder()

		server.handleFsRead(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
		}

		var resp validation.FileReadResponse
		if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
			t.Fatal(err)
		}
		decoded, err := base64.StdEncoding.DecodeString(resp.Content)
		if err != nil {
			t.Fatal(err)
		}
		if string(decoded) != testContent {
			t.Errorf("expected %q, got %q", testContent, string(decoded))
		}
		if resp.Encoding != "base64" {
			t.Errorf("expected encoding base64, got %q", resp.Encoding)
		}
	})

	t.Run("read with offset and length", func(t *testing.T) {
		t.Parallel()
		body := mustMarshalJSON(t, validation.FileReadRequest{
			Path:     "test.txt",
			Encoding: "utf-8",
			Offset:   6,
			Length:   5,
		})
		req := httptest.NewRequest(http.MethodPost, "/fs/read", bytes.NewReader(body))
		w := httptest.NewRecorder()

		server.handleFsRead(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
		}

		var resp validation.FileReadResponse
		if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
			t.Fatal(err)
		}
		if resp.Content != "world" {
			t.Errorf("expected %q, got %q", "world", resp.Content)
		}
	})

	t.Run("read offset past EOF returns empty", func(t *testing.T) {
		t.Parallel()
		body := mustMarshalJSON(t, validation.FileReadRequest{
			Path:     "test.txt",
			Encoding: "utf-8",
			Offset:   99999,
		})
		req := httptest.NewRequest(http.MethodPost, "/fs/read", bytes.NewReader(body))
		w := httptest.NewRecorder()

		server.handleFsRead(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
		}

		var resp validation.FileReadResponse
		if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
			t.Fatal(err)
		}
		if resp.Size != 0 {
			t.Errorf("expected size 0 for offset past EOF, got %d", resp.Size)
		}
	})

	t.Run("read utf8 alias without hyphen", func(t *testing.T) {
		t.Parallel()
		body := mustMarshalJSON(t, validation.FileReadRequest{
			Path:     "test.txt",
			Encoding: "utf8",
		})
		req := httptest.NewRequest(http.MethodPost, "/fs/read", bytes.NewReader(body))
		w := httptest.NewRecorder()

		server.handleFsRead(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
		}

		var resp validation.FileReadResponse
		if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
			t.Fatal(err)
		}
		if resp.Encoding != "utf-8" {
			t.Errorf("expected encoding utf-8, got %q", resp.Encoding)
		}
		if resp.Content != testContent {
			t.Errorf("expected %q, got %q", testContent, resp.Content)
		}
	})

	t.Run("read nonexistent file", func(t *testing.T) {
		t.Parallel()
		body := mustMarshalJSON(t, validation.FileReadRequest{
			Path:     "nonexistent.txt",
			Encoding: "utf-8",
		})
		req := httptest.NewRequest(http.MethodPost, "/fs/read", bytes.NewReader(body))
		w := httptest.NewRecorder()

		server.handleFsRead(w, req)

		if w.Code != http.StatusNotFound {
			t.Errorf("expected 404, got %d: %s", w.Code, w.Body.String())
		}
	})

	t.Run("read path traversal rejected", func(t *testing.T) {
		t.Parallel()
		body := mustMarshalJSON(t, validation.FileReadRequest{
			Path: "../../../etc/passwd",
		})
		req := httptest.NewRequest(http.MethodPost, "/fs/read", bytes.NewReader(body))
		w := httptest.NewRecorder()

		server.handleFsRead(w, req)

		if w.Code != http.StatusBadRequest {
			t.Errorf("expected 400, got %d: %s", w.Code, w.Body.String())
		}
	})

	t.Run("read outside base dir rejected", func(t *testing.T) {
		t.Parallel()
		body := mustMarshalJSON(t, validation.FileReadRequest{
			Path: "/etc/passwd",
		})
		req := httptest.NewRequest(http.MethodPost, "/fs/read", bytes.NewReader(body))
		w := httptest.NewRecorder()

		server.handleFsRead(w, req)

		if w.Code != http.StatusBadRequest {
			t.Errorf("expected 400, got %d: %s", w.Code, w.Body.String())
		}
	})
}

func TestHandleFsReadEdgeCases(t *testing.T) {
	t.Parallel()
	appDir := t.TempDir()
	server := newFsTestServer(appDir)

	testContent := "hello world"
	if err := os.WriteFile(filepath.Join(appDir, "test.txt"), []byte(testContent), 0o644); err != nil {
		t.Fatal(err)
	}

	t.Run("read exceeding maxReadLength rejected", func(t *testing.T) {
		t.Parallel()
		body := mustMarshalJSON(t, validation.FileReadRequest{
			Path:     "test.txt",
			Encoding: "utf-8",
			Length:   maxReadLength + 1,
		})
		req := httptest.NewRequest(http.MethodPost, "/fs/read", bytes.NewReader(body))
		w := httptest.NewRecorder()

		server.handleFsRead(w, req)

		if w.Code != http.StatusBadRequest {
			t.Errorf("expected 400, got %d: %s", w.Code, w.Body.String())
		}
	})

	t.Run("read negative offset rejected", func(t *testing.T) {
		t.Parallel()
		body := mustMarshalJSON(t, validation.FileReadRequest{
			Path:     "test.txt",
			Encoding: "utf-8",
			Offset:   -1,
		})
		req := httptest.NewRequest(http.MethodPost, "/fs/read", bytes.NewReader(body))
		w := httptest.NewRecorder()

		server.handleFsRead(w, req)

		if w.Code != http.StatusBadRequest {
			t.Errorf("expected 400, got %d: %s", w.Code, w.Body.String())
		}
	})

	t.Run("read negative length rejected", func(t *testing.T) {
		t.Parallel()
		body := mustMarshalJSON(t, validation.FileReadRequest{
			Path:     "test.txt",
			Encoding: "utf-8",
			Length:   -5,
		})
		req := httptest.NewRequest(http.MethodPost, "/fs/read", bytes.NewReader(body))
		w := httptest.NewRecorder()

		server.handleFsRead(w, req)

		if w.Code != http.StatusBadRequest {
			t.Errorf("expected 400, got %d: %s", w.Code, w.Body.String())
		}
	})

	t.Run("read with offset returns total_size", func(t *testing.T) {
		t.Parallel()
		body := mustMarshalJSON(t, validation.FileReadRequest{
			Path:     "test.txt",
			Encoding: "utf-8",
			Offset:   6,
			Length:   5,
		})
		req := httptest.NewRequest(http.MethodPost, "/fs/read", bytes.NewReader(body))
		w := httptest.NewRecorder()

		server.handleFsRead(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
		}

		var resp validation.FileReadResponse
		if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
			t.Fatal(err)
		}
		if resp.Size != 5 {
			t.Errorf("expected size=5, got %d", resp.Size)
		}
		if resp.TotalSize != int64(len(testContent)) {
			t.Errorf("expected total_size=%d, got %d", len(testContent), resp.TotalSize)
		}
	})

	t.Run("full read has total_size equal to size", func(t *testing.T) {
		t.Parallel()
		body := mustMarshalJSON(t, validation.FileReadRequest{
			Path:     "test.txt",
			Encoding: "utf-8",
		})
		req := httptest.NewRequest(http.MethodPost, "/fs/read", bytes.NewReader(body))
		w := httptest.NewRecorder()

		server.handleFsRead(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
		}

		var resp validation.FileReadResponse
		if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
			t.Fatal(err)
		}
		if resp.Size != resp.TotalSize {
			t.Errorf("expected size==total_size for full read, got size=%d total_size=%d", resp.Size, resp.TotalSize)
		}
	})
}

func TestHandleFsWrite(t *testing.T) {
	t.Parallel()
	appDir := t.TempDir()
	server := newFsTestServer(appDir)

	t.Run("write utf-8 file", func(t *testing.T) {
		t.Parallel()
		dir := t.TempDir()
		s := newFsTestServer(dir)

		body := mustMarshalJSON(t, validation.FileWriteRequest{
			Path:    "output.txt",
			Content: "hello write",
		})
		req := httptest.NewRequest(http.MethodPost, "/fs/write", bytes.NewReader(body))
		w := httptest.NewRecorder()

		s.handleFsWrite(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
		}

		var resp validation.FileWriteResponse
		if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
			t.Fatal(err)
		}
		if resp.BytesWritten != 11 {
			t.Errorf("expected 11 bytes, got %d", resp.BytesWritten)
		}

		data, err := os.ReadFile(filepath.Join(dir, "output.txt"))
		if err != nil {
			t.Fatal(err)
		}
		if string(data) != "hello write" {
			t.Errorf("expected %q, got %q", "hello write", string(data))
		}
	})

	t.Run("write base64 file", func(t *testing.T) {
		t.Parallel()
		dir := t.TempDir()
		s := newFsTestServer(dir)

		binaryData := []byte{0x00, 0x01, 0x02, 0xFF}
		body := mustMarshalJSON(t, validation.FileWriteRequest{
			Path:     "binary.bin",
			Content:  base64.StdEncoding.EncodeToString(binaryData),
			Encoding: "base64",
		})
		req := httptest.NewRequest(http.MethodPost, "/fs/write", bytes.NewReader(body))
		w := httptest.NewRecorder()

		s.handleFsWrite(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
		}

		data, err := os.ReadFile(filepath.Join(dir, "binary.bin"))
		if err != nil {
			t.Fatal(err)
		}
		if !bytes.Equal(data, binaryData) {
			t.Errorf("binary content mismatch")
		}
	})

	t.Run("write with mkdir_p", func(t *testing.T) {
		t.Parallel()
		dir := t.TempDir()
		s := newFsTestServer(dir)

		body := mustMarshalJSON(t, validation.FileWriteRequest{
			Path:    "deep/nested/dir/file.txt",
			Content: "nested",
			MkdirP:  true,
		})
		req := httptest.NewRequest(http.MethodPost, "/fs/write", bytes.NewReader(body))
		w := httptest.NewRecorder()

		s.handleFsWrite(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
		}

		data, err := os.ReadFile(filepath.Join(dir, "deep/nested/dir/file.txt"))
		if err != nil {
			t.Fatal(err)
		}
		if string(data) != "nested" {
			t.Errorf("expected %q, got %q", "nested", string(data))
		}
	})

	t.Run("write without mkdir_p fails for missing parent", func(t *testing.T) {
		t.Parallel()
		dir := t.TempDir()
		s := newFsTestServer(dir)

		body := mustMarshalJSON(t, validation.FileWriteRequest{
			Path:    "nonexistent/dir/file.txt",
			Content: "fail",
		})
		req := httptest.NewRequest(http.MethodPost, "/fs/write", bytes.NewReader(body))
		w := httptest.NewRecorder()

		s.handleFsWrite(w, req)

		if w.Code == http.StatusOK {
			t.Error("expected error when parent dir doesn't exist without mkdir_p")
		}
	})

	t.Run("write with custom mode", func(t *testing.T) {
		t.Parallel()
		dir := t.TempDir()
		s := newFsTestServer(dir)

		body := mustMarshalJSON(t, validation.FileWriteRequest{
			Path:    "executable.sh",
			Content: "#!/bin/sh\necho hi",
			Mode:    0o750,
		})
		req := httptest.NewRequest(http.MethodPost, "/fs/write", bytes.NewReader(body))
		w := httptest.NewRecorder()

		s.handleFsWrite(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
		}

		info, err := os.Stat(filepath.Join(dir, "executable.sh"))
		if err != nil {
			t.Fatal(err)
		}
		if info.Mode().Perm() != 0o750 {
			t.Errorf("expected mode 0750, got %04o", info.Mode().Perm())
		}
	})

	t.Run("write path traversal rejected", func(t *testing.T) {
		t.Parallel()
		body := mustMarshalJSON(t, validation.FileWriteRequest{
			Path:    "../../../tmp/evil",
			Content: "bad",
		})
		req := httptest.NewRequest(http.MethodPost, "/fs/write", bytes.NewReader(body))
		w := httptest.NewRecorder()

		server.handleFsWrite(w, req)

		if w.Code != http.StatusBadRequest {
			t.Errorf("expected 400, got %d: %s", w.Code, w.Body.String())
		}
	})

	t.Run("write invalid mode rejected", func(t *testing.T) {
		t.Parallel()
		dir := t.TempDir()
		s := newFsTestServer(dir)

		body := mustMarshalJSON(t, validation.FileWriteRequest{
			Path:    "bad-mode.txt",
			Content: "test",
			Mode:    0o1000, // exceeds 0o777
		})
		req := httptest.NewRequest(http.MethodPost, "/fs/write", bytes.NewReader(body))
		w := httptest.NewRecorder()

		s.handleFsWrite(w, req)

		if w.Code != http.StatusBadRequest {
			t.Errorf("expected 400, got %d: %s", w.Code, w.Body.String())
		}
	})

	t.Run("write negative mode rejected", func(t *testing.T) {
		t.Parallel()
		dir := t.TempDir()
		s := newFsTestServer(dir)

		body := mustMarshalJSON(t, validation.FileWriteRequest{
			Path:    "neg-mode.txt",
			Content: "test",
			Mode:    -1,
		})
		req := httptest.NewRequest(http.MethodPost, "/fs/write", bytes.NewReader(body))
		w := httptest.NewRecorder()

		s.handleFsWrite(w, req)

		if w.Code != http.StatusBadRequest {
			t.Errorf("expected 400, got %d: %s", w.Code, w.Body.String())
		}
	})
}

func TestHandleFsStat(t *testing.T) {
	t.Parallel()
	appDir := t.TempDir()
	server := newFsTestServer(appDir)

	// Create test file and directory
	if err := os.WriteFile(filepath.Join(appDir, "file.txt"), []byte("stat test"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(appDir, "subdir"), 0o755); err != nil {
		t.Fatal(err)
	}

	t.Run("stat file", func(t *testing.T) {
		t.Parallel()
		body := mustMarshalJSON(t, validation.FilePathRequest{Path: "file.txt"})
		req := httptest.NewRequest(http.MethodPost, "/fs/stat", bytes.NewReader(body))
		w := httptest.NewRecorder()

		server.handleFsStat(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
		}

		var resp validation.FileStatResponse
		if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
			t.Fatal(err)
		}
		if resp.Size != 9 {
			t.Errorf("expected size 9, got %d", resp.Size)
		}
		if !resp.IsFile {
			t.Error("expected is_file=true")
		}
		if resp.IsDir {
			t.Error("expected is_dir=false")
		}
	})

	t.Run("stat directory", func(t *testing.T) {
		t.Parallel()
		body := mustMarshalJSON(t, validation.FilePathRequest{Path: "subdir"})
		req := httptest.NewRequest(http.MethodPost, "/fs/stat", bytes.NewReader(body))
		w := httptest.NewRecorder()

		server.handleFsStat(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
		}

		var resp validation.FileStatResponse
		if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
			t.Fatal(err)
		}
		if !resp.IsDir {
			t.Error("expected is_dir=true")
		}
		if resp.IsFile {
			t.Error("expected is_file=false")
		}
	})

	t.Run("stat nonexistent", func(t *testing.T) {
		t.Parallel()
		body := mustMarshalJSON(t, validation.FilePathRequest{Path: "nope.txt"})
		req := httptest.NewRequest(http.MethodPost, "/fs/stat", bytes.NewReader(body))
		w := httptest.NewRecorder()

		server.handleFsStat(w, req)

		if w.Code != http.StatusNotFound {
			t.Errorf("expected 404, got %d: %s", w.Code, w.Body.String())
		}
	})
}

func TestHandleFsReaddir(t *testing.T) {
	t.Parallel()
	appDir := t.TempDir()
	server := newFsTestServer(appDir)

	// Create test files and a subdirectory
	for _, name := range []string{"a.txt", "b.txt", "c.txt"} {
		if err := os.WriteFile(filepath.Join(appDir, name), []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.Mkdir(filepath.Join(appDir, "subdir"), 0o750); err != nil {
		t.Fatal(err)
	}

	t.Run("list directory with stat info", func(t *testing.T) {
		t.Parallel()
		body := mustMarshalJSON(t, validation.FileReaddirRequest{
			Path:          ".",
			IncludeHidden: true,
		})
		req := httptest.NewRequest(http.MethodPost, "/fs/readdir", bytes.NewReader(body))
		w := httptest.NewRecorder()

		server.handleFsReaddir(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
		}

		var resp validation.FileReaddirResponse
		if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
			t.Fatal(err)
		}
		if len(resp.Entries) != 4 {
			t.Errorf("expected 4 entries (3 files + 1 dir), got %d: %v", len(resp.Entries), resp.Entries)
		}

		// Verify stat info is populated
		for _, e := range resp.Entries {
			if e.Name == "" {
				t.Error("entry has empty name")
			}
			if e.ModTimeMs == 0 {
				t.Errorf("entry %q has zero mod_time_ms", e.Name)
			}
			if e.Name == "subdir" {
				if !e.IsDir {
					t.Error("expected subdir to be is_dir=true")
				}
			} else {
				if e.IsDir {
					t.Errorf("expected %q to be is_dir=false", e.Name)
				}
				if e.Size != 1 {
					t.Errorf("expected %q size=1, got %d", e.Name, e.Size)
				}
			}
		}
	})

	t.Run("readdir nonexistent", func(t *testing.T) {
		t.Parallel()
		body := mustMarshalJSON(t, validation.FileReaddirRequest{Path: "nodir"})
		req := httptest.NewRequest(http.MethodPost, "/fs/readdir", bytes.NewReader(body))
		w := httptest.NewRecorder()

		server.handleFsReaddir(w, req)

		if w.Code != http.StatusNotFound {
			t.Errorf("expected 404, got %d: %s", w.Code, w.Body.String())
		}
	})

	t.Run("readdir skips hidden files by default", func(t *testing.T) {
		t.Parallel()
		dir := t.TempDir()
		s := newFsTestServer(dir)

		if err := os.WriteFile(filepath.Join(dir, ".hidden"), []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, "visible.txt"), []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}

		body := mustMarshalJSON(t, validation.FileReaddirRequest{Path: "."})
		req := httptest.NewRequest(http.MethodPost, "/fs/readdir", bytes.NewReader(body))
		w := httptest.NewRecorder()

		s.handleFsReaddir(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
		}

		var resp validation.FileReaddirResponse
		if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
			t.Fatal(err)
		}
		if len(resp.Entries) != 1 {
			t.Errorf("expected 1 visible entry, got %d: %v", len(resp.Entries), resp.Entries)
		}
		if resp.Entries[0].Name != "visible.txt" {
			t.Errorf("expected visible.txt, got %q", resp.Entries[0].Name)
		}
	})

	t.Run("readdir with ignore patterns", func(t *testing.T) {
		t.Parallel()
		dir := t.TempDir()
		s := newFsTestServer(dir)

		if err := os.WriteFile(filepath.Join(dir, "keep.txt"), []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, "skip.log"), []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}

		body := mustMarshalJSON(t, validation.FileReaddirRequest{
			Path:           ".",
			IgnorePatterns: []string{"*.log"},
		})
		req := httptest.NewRequest(http.MethodPost, "/fs/readdir", bytes.NewReader(body))
		w := httptest.NewRecorder()

		s.handleFsReaddir(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
		}

		var resp validation.FileReaddirResponse
		if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
			t.Fatal(err)
		}
		if len(resp.Entries) != 1 {
			t.Errorf("expected 1 entry, got %d: %v", len(resp.Entries), resp.Entries)
		}
	})
}

func TestHandleFsReaddirValidation(t *testing.T) {
	t.Parallel()
	server := newFsTestServer(t.TempDir())

	t.Run("readdir invalid ignore pattern rejected", func(t *testing.T) {
		t.Parallel()
		body := mustMarshalJSON(t, validation.FileReaddirRequest{
			Path:           ".",
			IgnorePatterns: []string{"[invalid"},
		})
		req := httptest.NewRequest(http.MethodPost, "/fs/readdir", bytes.NewReader(body))
		w := httptest.NewRecorder()

		server.handleFsReaddir(w, req)

		if w.Code != http.StatusBadRequest {
			t.Errorf("expected 400, got %d: %s", w.Code, w.Body.String())
		}
	})

	t.Run("readdir negative max_entries rejected", func(t *testing.T) {
		t.Parallel()
		body := mustMarshalJSON(t, validation.FileReaddirRequest{
			Path:       ".",
			MaxEntries: -1,
		})
		req := httptest.NewRequest(http.MethodPost, "/fs/readdir", bytes.NewReader(body))
		w := httptest.NewRecorder()

		server.handleFsReaddir(w, req)

		if w.Code != http.StatusBadRequest {
			t.Errorf("expected 400, got %d: %s", w.Code, w.Body.String())
		}
	})

	t.Run("readdir max_entries over limit rejected", func(t *testing.T) {
		t.Parallel()
		body := mustMarshalJSON(t, validation.FileReaddirRequest{
			Path:       ".",
			MaxEntries: 10001,
		})
		req := httptest.NewRequest(http.MethodPost, "/fs/readdir", bytes.NewReader(body))
		w := httptest.NewRecorder()

		server.handleFsReaddir(w, req)

		if w.Code != http.StatusBadRequest {
			t.Errorf("expected 400, got %d: %s", w.Code, w.Body.String())
		}
	})

	t.Run("readdir negative max_depth rejected", func(t *testing.T) {
		t.Parallel()
		body := mustMarshalJSON(t, validation.FileReaddirRequest{
			Path:     ".",
			MaxDepth: -1,
		})
		req := httptest.NewRequest(http.MethodPost, "/fs/readdir", bytes.NewReader(body))
		w := httptest.NewRecorder()

		server.handleFsReaddir(w, req)

		if w.Code != http.StatusBadRequest {
			t.Errorf("expected 400, got %d: %s", w.Code, w.Body.String())
		}
	})

	t.Run("flat readdir enforces max_entries", func(t *testing.T) {
		t.Parallel()
		dir := t.TempDir()
		s := newFsTestServer(dir)

		for i := range 10 {
			name := fmt.Sprintf("file%02d.txt", i)
			if err := os.WriteFile(filepath.Join(dir, name), []byte("x"), 0o644); err != nil {
				t.Fatal(err)
			}
		}

		body := mustMarshalJSON(t, validation.FileReaddirRequest{
			Path:       ".",
			MaxEntries: 3,
		})
		req := httptest.NewRequest(http.MethodPost, "/fs/readdir", bytes.NewReader(body))
		w := httptest.NewRecorder()

		s.handleFsReaddir(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
		}

		var resp validation.FileReaddirResponse
		if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
			t.Fatal(err)
		}
		if len(resp.Entries) != 3 {
			t.Errorf("expected 3 entries, got %d", len(resp.Entries))
		}
		if !resp.Truncated {
			t.Error("expected truncated=true")
		}
	})
}

func TestHandleFsReaddirRecursive(t *testing.T) {
	t.Parallel()

	t.Run("recursive readdir returns nested entries", func(t *testing.T) {
		t.Parallel()
		dir := t.TempDir()
		s := newFsTestServer(dir)

		// Create: src/a.txt, src/sub/b.txt
		if err := os.MkdirAll(filepath.Join(dir, "src", "sub"), 0o750); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, "src", "a.txt"), []byte("aaa"), 0o644); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, "src", "sub", "b.txt"), []byte("bb"), 0o644); err != nil {
			t.Fatal(err)
		}

		body := mustMarshalJSON(t, validation.FileReaddirRequest{
			Path:      "src",
			Recursive: true,
			MaxDepth:  10,
		})
		req := httptest.NewRequest(http.MethodPost, "/fs/readdir", bytes.NewReader(body))
		w := httptest.NewRecorder()

		s.handleFsReaddir(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
		}

		var resp validation.FileReaddirResponse
		if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
			t.Fatal(err)
		}

		// Expect: a.txt, sub, sub/b.txt
		if len(resp.Entries) != 3 {
			t.Fatalf("expected 3 entries, got %d: %v", len(resp.Entries), resp.Entries)
		}
		if resp.Truncated {
			t.Error("expected truncated=false")
		}

		names := make(map[string]validation.DirEntry)
		for _, e := range resp.Entries {
			names[e.Name] = e
		}

		if e, ok := names["a.txt"]; !ok {
			t.Error("missing a.txt")
		} else if e.Size != 3 {
			t.Errorf("a.txt size: expected 3, got %d", e.Size)
		}

		if e, ok := names["sub"]; !ok {
			t.Error("missing sub")
		} else if !e.IsDir {
			t.Error("sub should be is_dir=true")
		}

		if e, ok := names["sub/b.txt"]; !ok {
			t.Error("missing sub/b.txt")
		} else if e.Size != 2 {
			t.Errorf("sub/b.txt size: expected 2, got %d", e.Size)
		}
	})

	t.Run("recursive readdir defaults max_depth when omitted", func(t *testing.T) {
		t.Parallel()
		dir := t.TempDir()
		s := newFsTestServer(dir)

		// Create nested structure: a/b/c.txt
		if err := os.MkdirAll(filepath.Join(dir, "a", "b"), 0o750); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, "a", "b", "c.txt"), []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}

		// recursive=true with no max_depth should still descend
		body := mustMarshalJSON(t, validation.FileReaddirRequest{
			Path:      ".",
			Recursive: true,
		})
		req := httptest.NewRequest(http.MethodPost, "/fs/readdir", bytes.NewReader(body))
		w := httptest.NewRecorder()

		s.handleFsReaddir(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
		}

		var resp validation.FileReaddirResponse
		if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
			t.Fatal(err)
		}

		// Expect: a, a/b, a/b/c.txt
		names := make(map[string]bool)
		for _, e := range resp.Entries {
			names[e.Name] = true
		}
		if !names["a/b/c.txt"] {
			t.Errorf("expected a/b/c.txt in results, got entries: %v", resp.Entries)
		}
	})

	t.Run("recursive readdir truncated at max_entries", func(t *testing.T) {
		t.Parallel()
		dir := t.TempDir()
		s := newFsTestServer(dir)

		// Create 10 files
		for i := range 10 {
			name := fmt.Sprintf("file%02d.txt", i)
			if err := os.WriteFile(filepath.Join(dir, name), []byte("x"), 0o644); err != nil {
				t.Fatal(err)
			}
		}

		body := mustMarshalJSON(t, validation.FileReaddirRequest{
			Path:       ".",
			Recursive:  true,
			MaxEntries: 5,
		})
		req := httptest.NewRequest(http.MethodPost, "/fs/readdir", bytes.NewReader(body))
		w := httptest.NewRecorder()

		s.handleFsReaddir(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
		}

		var resp validation.FileReaddirResponse
		if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
			t.Fatal(err)
		}
		if len(resp.Entries) != 5 {
			t.Errorf("expected 5 entries, got %d", len(resp.Entries))
		}
		if !resp.Truncated {
			t.Error("expected truncated=true")
		}
	})
}

func TestHandleFsReaddirRecursiveFiltering(t *testing.T) {
	t.Parallel()

	t.Run("recursive readdir with ignore patterns skips subtrees", func(t *testing.T) {
		t.Parallel()
		dir := t.TempDir()
		s := newFsTestServer(dir)

		// Create: src/a.txt, node_modules/pkg/index.js
		if err := os.MkdirAll(filepath.Join(dir, "src"), 0o750); err != nil {
			t.Fatal(err)
		}
		if err := os.MkdirAll(filepath.Join(dir, "node_modules", "pkg"), 0o750); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, "src", "a.txt"), []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, "node_modules", "pkg", "index.js"), []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}

		body := mustMarshalJSON(t, validation.FileReaddirRequest{
			Path:           ".",
			Recursive:      true,
			MaxDepth:       10,
			IgnorePatterns: []string{"node_modules"},
		})
		req := httptest.NewRequest(http.MethodPost, "/fs/readdir", bytes.NewReader(body))
		w := httptest.NewRecorder()

		s.handleFsReaddir(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
		}

		var resp validation.FileReaddirResponse
		if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
			t.Fatal(err)
		}

		for _, e := range resp.Entries {
			if strings.Contains(e.Name, "node_modules") {
				t.Errorf("expected node_modules to be filtered, found %q", e.Name)
			}
		}
		// Should have: src, src/a.txt
		if len(resp.Entries) != 2 {
			t.Errorf("expected 2 entries, got %d: %v", len(resp.Entries), resp.Entries)
		}
	})

	t.Run("recursive readdir respects max_depth", func(t *testing.T) {
		t.Parallel()
		dir := t.TempDir()
		s := newFsTestServer(dir)

		// Create: a/b/c/deep.txt
		if err := os.MkdirAll(filepath.Join(dir, "a", "b", "c"), 0o750); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, "a", "b", "c", "deep.txt"), []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}

		body := mustMarshalJSON(t, validation.FileReaddirRequest{
			Path:      ".",
			Recursive: true,
			MaxDepth:  1,
		})
		req := httptest.NewRequest(http.MethodPost, "/fs/readdir", bytes.NewReader(body))
		w := httptest.NewRecorder()

		s.handleFsReaddir(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
		}

		var resp validation.FileReaddirResponse
		if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
			t.Fatal(err)
		}

		// max_depth=1: should see a, a/b but not a/b/c or a/b/c/deep.txt
		for _, e := range resp.Entries {
			if strings.Count(e.Name, "/") > 1 {
				t.Errorf("entry %q exceeds max_depth=1", e.Name)
			}
		}
	})

	t.Run("recursive readdir skips symlink escapes", func(t *testing.T) {
		t.Parallel()
		dir := t.TempDir()
		s := newFsTestServer(dir)

		if err := os.WriteFile(filepath.Join(dir, "safe.txt"), []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
		// Create symlink pointing outside sandbox
		if err := os.Symlink("/tmp", filepath.Join(dir, "escape")); err != nil {
			t.Skipf("cannot create symlinks: %v", err)
		}

		body := mustMarshalJSON(t, validation.FileReaddirRequest{
			Path:          ".",
			Recursive:     true,
			MaxDepth:      10,
			IncludeHidden: true,
		})
		req := httptest.NewRequest(http.MethodPost, "/fs/readdir", bytes.NewReader(body))
		w := httptest.NewRecorder()

		s.handleFsReaddir(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
		}

		var resp validation.FileReaddirResponse
		if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
			t.Fatal(err)
		}

		// The symlink entry itself appears, but its children should not
		for _, e := range resp.Entries {
			if strings.HasPrefix(e.Name, "escape/") {
				t.Errorf("symlink escape was followed: found %q", e.Name)
			}
		}
	})

	t.Run("recursive readdir with include_hidden", func(t *testing.T) {
		t.Parallel()
		dir := t.TempDir()
		s := newFsTestServer(dir)

		if err := os.WriteFile(filepath.Join(dir, ".hidden"), []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, "visible.txt"), []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}

		body := mustMarshalJSON(t, validation.FileReaddirRequest{
			Path:          ".",
			Recursive:     true,
			IncludeHidden: true,
		})
		req := httptest.NewRequest(http.MethodPost, "/fs/readdir", bytes.NewReader(body))
		w := httptest.NewRecorder()

		s.handleFsReaddir(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
		}

		var resp validation.FileReaddirResponse
		if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
			t.Fatal(err)
		}
		if len(resp.Entries) != 2 {
			t.Errorf("expected 2 entries with include_hidden, got %d", len(resp.Entries))
		}
	})
}

func TestHandleFsMkdir(t *testing.T) {
	t.Parallel()

	t.Run("mkdir simple", func(t *testing.T) {
		t.Parallel()
		dir := t.TempDir()
		s := newFsTestServer(dir)

		body := mustMarshalJSON(t, validation.FileMkdirRequest{Path: "newdir"})
		req := httptest.NewRequest(http.MethodPost, "/fs/mkdir", bytes.NewReader(body))
		w := httptest.NewRecorder()

		s.handleFsMkdir(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
		}

		info, err := os.Stat(filepath.Join(dir, "newdir"))
		if err != nil {
			t.Fatal(err)
		}
		if !info.IsDir() {
			t.Error("expected directory")
		}
	})

	t.Run("mkdir recursive", func(t *testing.T) {
		t.Parallel()
		dir := t.TempDir()
		s := newFsTestServer(dir)

		body := mustMarshalJSON(t, validation.FileMkdirRequest{
			Path:      "a/b/c",
			Recursive: true,
		})
		req := httptest.NewRequest(http.MethodPost, "/fs/mkdir", bytes.NewReader(body))
		w := httptest.NewRecorder()

		s.handleFsMkdir(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
		}

		info, err := os.Stat(filepath.Join(dir, "a/b/c"))
		if err != nil {
			t.Fatal(err)
		}
		if !info.IsDir() {
			t.Error("expected directory")
		}
	})
}

func TestHandleFsUnlink(t *testing.T) {
	t.Parallel()

	t.Run("unlink file", func(t *testing.T) {
		t.Parallel()
		dir := t.TempDir()
		s := newFsTestServer(dir)

		filePath := filepath.Join(dir, "delete-me.txt")
		if err := os.WriteFile(filePath, []byte("bye"), 0o644); err != nil {
			t.Fatal(err)
		}

		body := mustMarshalJSON(t, validation.FilePathRequest{Path: "delete-me.txt"})
		req := httptest.NewRequest(http.MethodPost, "/fs/unlink", bytes.NewReader(body))
		w := httptest.NewRecorder()

		s.handleFsUnlink(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
		}

		if _, err := os.Stat(filePath); !os.IsNotExist(err) {
			t.Error("expected file to be deleted")
		}
	})

	t.Run("unlink nonexistent", func(t *testing.T) {
		t.Parallel()
		dir := t.TempDir()
		s := newFsTestServer(dir)

		body := mustMarshalJSON(t, validation.FilePathRequest{Path: "nope.txt"})
		req := httptest.NewRequest(http.MethodPost, "/fs/unlink", bytes.NewReader(body))
		w := httptest.NewRecorder()

		s.handleFsUnlink(w, req)

		if w.Code != http.StatusNotFound {
			t.Errorf("expected 404, got %d: %s", w.Code, w.Body.String())
		}
	})
}

func TestHandleFsRename(t *testing.T) {
	t.Parallel()

	t.Run("rename file", func(t *testing.T) {
		t.Parallel()
		dir := t.TempDir()
		s := newFsTestServer(dir)

		if err := os.WriteFile(filepath.Join(dir, "old.txt"), []byte("move me"), 0o644); err != nil {
			t.Fatal(err)
		}

		body := mustMarshalJSON(t, validation.FileRenameRequest{
			OldPath: "old.txt",
			NewPath: "new.txt",
		})
		req := httptest.NewRequest(http.MethodPost, "/fs/rename", bytes.NewReader(body))
		w := httptest.NewRecorder()

		s.handleFsRename(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
		}

		if _, err := os.Stat(filepath.Join(dir, "old.txt")); !os.IsNotExist(err) {
			t.Error("expected old file to be gone")
		}
		data, err := os.ReadFile(filepath.Join(dir, "new.txt"))
		if err != nil {
			t.Fatal(err)
		}
		if string(data) != "move me" {
			t.Errorf("expected %q, got %q", "move me", string(data))
		}
	})

	t.Run("rename nonexistent source", func(t *testing.T) {
		t.Parallel()
		dir := t.TempDir()
		s := newFsTestServer(dir)

		body := mustMarshalJSON(t, validation.FileRenameRequest{
			OldPath: "nonexistent.txt",
			NewPath: "dest.txt",
		})
		req := httptest.NewRequest(http.MethodPost, "/fs/rename", bytes.NewReader(body))
		w := httptest.NewRecorder()

		s.handleFsRename(w, req)

		if w.Code != http.StatusNotFound {
			t.Errorf("expected 404, got %d: %s", w.Code, w.Body.String())
		}
	})

	t.Run("rename path traversal in new_path rejected", func(t *testing.T) {
		t.Parallel()
		dir := t.TempDir()
		s := newFsTestServer(dir)

		if err := os.WriteFile(filepath.Join(dir, "src.txt"), []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}

		body := mustMarshalJSON(t, validation.FileRenameRequest{
			OldPath: "src.txt",
			NewPath: "../../../tmp/evil",
		})
		req := httptest.NewRequest(http.MethodPost, "/fs/rename", bytes.NewReader(body))
		w := httptest.NewRecorder()

		s.handleFsRename(w, req)

		if w.Code != http.StatusBadRequest {
			t.Errorf("expected 400, got %d: %s", w.Code, w.Body.String())
		}
	})
}

func TestHandleFsExists(t *testing.T) {
	t.Parallel()
	appDir := t.TempDir()
	server := newFsTestServer(appDir)

	if err := os.WriteFile(filepath.Join(appDir, "exists.txt"), []byte("here"), 0o644); err != nil {
		t.Fatal(err)
	}

	t.Run("file exists", func(t *testing.T) {
		t.Parallel()
		body := mustMarshalJSON(t, validation.FilePathRequest{Path: "exists.txt"})
		req := httptest.NewRequest(http.MethodPost, "/fs/exists", bytes.NewReader(body))
		w := httptest.NewRecorder()

		server.handleFsExists(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
		}

		var resp validation.FileExistsResponse
		if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
			t.Fatal(err)
		}
		if !resp.Exists {
			t.Error("expected exists=true")
		}
	})

	t.Run("file does not exist", func(t *testing.T) {
		t.Parallel()
		body := mustMarshalJSON(t, validation.FilePathRequest{Path: "nope.txt"})
		req := httptest.NewRequest(http.MethodPost, "/fs/exists", bytes.NewReader(body))
		w := httptest.NewRecorder()

		server.handleFsExists(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
		}

		var resp validation.FileExistsResponse
		if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
			t.Fatal(err)
		}
		if resp.Exists {
			t.Error("expected exists=false")
		}
	})
}

func TestHandleFsExistsPermissionDenied(t *testing.T) {
	t.Parallel()

	if os.Getuid() == 0 {
		t.Skip("test requires non-root user")
	}

	appDir := t.TempDir()
	server := newFsTestServer(appDir)

	// Create a directory with no permissions, then try to stat a file inside it.
	// os.Stat on the child fails with EACCES (not ENOENT) because the parent
	// directory cannot be searched.
	noAccessDir := filepath.Join(appDir, "noaccess")
	if err := os.Mkdir(noAccessDir, 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(noAccessDir, "secret.txt"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(noAccessDir, 0o000); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.Chmod(noAccessDir, 0o750) })

	body := mustMarshalJSON(t, validation.FilePathRequest{Path: "noaccess/secret.txt"})
	req := httptest.NewRequest(http.MethodPost, "/fs/exists", bytes.NewReader(body))
	w := httptest.NewRecorder()

	server.handleFsExists(w, req)

	// Should NOT return 200 with exists=false (that would mask the real error).
	// Should return an error status (403 for permission denied).
	if w.Code == http.StatusOK {
		var resp validation.FileExistsResponse
		if err := json.NewDecoder(w.Body).Decode(&resp); err == nil && !resp.Exists {
			t.Error("expected permission error, not exists=false")
		}
	}
	if w.Code != http.StatusForbidden {
		t.Errorf("expected 403, got %d: %s", w.Code, w.Body.String())
	}
}

func TestHandleFsInvalidJSON(t *testing.T) {
	t.Parallel()
	server := newFsTestServer(t.TempDir())

	endpoints := []struct {
		name    string
		handler func(http.ResponseWriter, *http.Request)
	}{
		{"read", server.handleFsRead},
		{"write", server.handleFsWrite},
		{"stat", server.handleFsStat},
		{"readdir", server.handleFsReaddir},
		{"mkdir", server.handleFsMkdir},
		{"unlink", server.handleFsUnlink},
		{"rename", server.handleFsRename},
		{"exists", server.handleFsExists},
		{"grep", server.handleFsGrep},
	}

	for _, ep := range endpoints {
		t.Run(ep.name, func(t *testing.T) {
			t.Parallel()
			req := httptest.NewRequest(http.MethodPost, "/fs/"+ep.name, bytes.NewReader([]byte("not json")))
			w := httptest.NewRecorder()

			ep.handler(w, req)

			if w.Code != http.StatusBadRequest {
				t.Errorf("expected 400, got %d: %s", w.Code, w.Body.String())
			}
		})
	}
}

// requireRg skips the test if rg (ripgrep) is not available.
func requireRg(t *testing.T) {
	t.Helper()
	if _, err := exec.LookPath("rg"); err != nil {
		t.Skip("rg (ripgrep) not found, skipping grep tests")
	}
}

func TestHandleFsGrepBasic(t *testing.T) {
	t.Parallel()
	requireRg(t)

	t.Run("basic literal search", func(t *testing.T) {
		t.Parallel()
		dir := t.TempDir()
		s := newFsTestServer(dir)

		content := "hello world\nfoo bar\nhello again\n"
		if err := os.WriteFile(filepath.Join(dir, "hello.txt"), []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}

		body := mustMarshalJSON(t, validation.FileGrepRequest{Query: "hello"})
		req := httptest.NewRequest(http.MethodPost, "/fs/grep", bytes.NewReader(body))
		w := httptest.NewRecorder()

		s.handleFsGrep(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
		}

		var resp validation.FileGrepResponse
		if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
			t.Fatal(err)
		}
		if len(resp.Matches) != 2 {
			t.Fatalf("expected 2 matches, got %d: %+v", len(resp.Matches), resp.Matches)
		}
		if resp.TotalFiles != 1 {
			t.Errorf("expected 1 total file, got %d", resp.TotalFiles)
		}
		if resp.Matches[0].LineNum != 1 {
			t.Errorf("expected first match at line 1, got %d", resp.Matches[0].LineNum)
		}
		if resp.Matches[1].LineNum != 3 {
			t.Errorf("expected second match at line 3, got %d", resp.Matches[1].LineNum)
		}
	})

	t.Run("regex search", func(t *testing.T) {
		t.Parallel()
		dir := t.TempDir()
		s := newFsTestServer(dir)

		if err := os.WriteFile(filepath.Join(dir, "data.txt"), []byte("abc123\ndef456\nabc789\n"), 0o644); err != nil {
			t.Fatal(err)
		}

		body := mustMarshalJSON(t, validation.FileGrepRequest{Query: "abc\\d+", Regex: true})
		req := httptest.NewRequest(http.MethodPost, "/fs/grep", bytes.NewReader(body))
		w := httptest.NewRecorder()

		s.handleFsGrep(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
		}

		var resp validation.FileGrepResponse
		if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
			t.Fatal(err)
		}
		if len(resp.Matches) != 2 {
			t.Fatalf("expected 2 matches, got %d", len(resp.Matches))
		}
	})

	t.Run("no matches returns empty result", func(t *testing.T) {
		t.Parallel()
		dir := t.TempDir()
		s := newFsTestServer(dir)

		if err := os.WriteFile(filepath.Join(dir, "a.txt"), []byte("nothing here\n"), 0o644); err != nil {
			t.Fatal(err)
		}

		body := mustMarshalJSON(t, validation.FileGrepRequest{Query: "nonexistentpattern12345"})
		req := httptest.NewRequest(http.MethodPost, "/fs/grep", bytes.NewReader(body))
		w := httptest.NewRecorder()

		s.handleFsGrep(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
		}

		var resp validation.FileGrepResponse
		if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
			t.Fatal(err)
		}
		if len(resp.Matches) != 0 {
			t.Errorf("expected 0 matches, got %d", len(resp.Matches))
		}
		if resp.TotalFiles != 0 {
			t.Errorf("expected 0 total_files, got %d", resp.TotalFiles)
		}
	})
}

func TestHandleFsGrepCaseSensitivity(t *testing.T) {
	t.Parallel()
	requireRg(t)

	t.Run("case sensitive", func(t *testing.T) {
		t.Parallel()
		dir := t.TempDir()
		s := newFsTestServer(dir)

		if err := os.WriteFile(filepath.Join(dir, "case.txt"), []byte("Hello\nhello\nHELLO\n"), 0o644); err != nil {
			t.Fatal(err)
		}

		body := mustMarshalJSON(t, validation.FileGrepRequest{Query: "Hello", CaseSensitive: true})
		req := httptest.NewRequest(http.MethodPost, "/fs/grep", bytes.NewReader(body))
		w := httptest.NewRecorder()

		s.handleFsGrep(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
		}

		var resp validation.FileGrepResponse
		if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
			t.Fatal(err)
		}
		if len(resp.Matches) != 1 {
			t.Fatalf("expected 1 match (case sensitive), got %d", len(resp.Matches))
		}
		if resp.Matches[0].LineText != "Hello" {
			t.Errorf("expected 'Hello', got %q", resp.Matches[0].LineText)
		}
	})

	t.Run("case insensitive (default)", func(t *testing.T) {
		t.Parallel()
		dir := t.TempDir()
		s := newFsTestServer(dir)

		if err := os.WriteFile(filepath.Join(dir, "case.txt"), []byte("Hello\nhello\nHELLO\n"), 0o644); err != nil {
			t.Fatal(err)
		}

		body := mustMarshalJSON(t, validation.FileGrepRequest{Query: "hello"})
		req := httptest.NewRequest(http.MethodPost, "/fs/grep", bytes.NewReader(body))
		w := httptest.NewRecorder()

		s.handleFsGrep(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
		}

		var resp validation.FileGrepResponse
		if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
			t.Fatal(err)
		}
		if len(resp.Matches) != 3 {
			t.Fatalf("expected 3 matches (case insensitive), got %d", len(resp.Matches))
		}
	})
}

func TestHandleFsGrepContext(t *testing.T) {
	t.Parallel()
	requireRg(t)

	dir := t.TempDir()
	s := newFsTestServer(dir)

	content := "line1\nline2\nMATCH\nline4\nline5\n"
	if err := os.WriteFile(filepath.Join(dir, "ctx.txt"), []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}

	body := mustMarshalJSON(t, validation.FileGrepRequest{
		Query:         "MATCH",
		CaseSensitive: true,
		ContextLines:  2,
	})
	req := httptest.NewRequest(http.MethodPost, "/fs/grep", bytes.NewReader(body))
	w := httptest.NewRecorder()

	s.handleFsGrep(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp validation.FileGrepResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatal(err)
	}
	if len(resp.Matches) != 1 {
		t.Fatalf("expected 1 match, got %d", len(resp.Matches))
	}
	m := resp.Matches[0]
	if len(m.ContextBefore) != 2 {
		t.Errorf("expected 2 context_before lines, got %d: %v", len(m.ContextBefore), m.ContextBefore)
	}
	if len(m.ContextAfter) != 2 {
		t.Errorf("expected 2 context_after lines, got %d: %v", len(m.ContextAfter), m.ContextAfter)
	}
	if len(m.ContextBefore) == 2 {
		if m.ContextBefore[0] != "line1" || m.ContextBefore[1] != "line2" {
			t.Errorf("unexpected context_before: %v", m.ContextBefore)
		}
	}
	if len(m.ContextAfter) == 2 {
		if m.ContextAfter[0] != "line4" || m.ContextAfter[1] != "line5" {
			t.Errorf("unexpected context_after: %v", m.ContextAfter)
		}
	}
}

func TestHandleFsGrepMaxResults(t *testing.T) {
	t.Parallel()
	requireRg(t)

	dir := t.TempDir()
	s := newFsTestServer(dir)

	var lines strings.Builder
	for i := range 20 {
		fmt.Fprintf(&lines, "match line %d\n", i)
	}
	if err := os.WriteFile(filepath.Join(dir, "many.txt"), []byte(lines.String()), 0o644); err != nil {
		t.Fatal(err)
	}

	body := mustMarshalJSON(t, validation.FileGrepRequest{Query: "match", MaxResults: 5})
	req := httptest.NewRequest(http.MethodPost, "/fs/grep", bytes.NewReader(body))
	w := httptest.NewRecorder()

	s.handleFsGrep(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp validation.FileGrepResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatal(err)
	}
	if len(resp.Matches) != 5 {
		t.Errorf("expected 5 matches, got %d", len(resp.Matches))
	}
}

func TestHandleFsGrepPatterns(t *testing.T) {
	t.Parallel()
	requireRg(t)

	t.Run("include patterns", func(t *testing.T) {
		t.Parallel()
		dir := t.TempDir()
		s := newFsTestServer(dir)

		if err := os.WriteFile(filepath.Join(dir, "code.go"), []byte("findme in go\n"), 0o644); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, "code.js"), []byte("findme in js\n"), 0o644); err != nil {
			t.Fatal(err)
		}

		body := mustMarshalJSON(t, validation.FileGrepRequest{
			Query:           "findme",
			IncludePatterns: []string{"*.go"},
		})
		req := httptest.NewRequest(http.MethodPost, "/fs/grep", bytes.NewReader(body))
		w := httptest.NewRecorder()

		s.handleFsGrep(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
		}

		var resp validation.FileGrepResponse
		if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
			t.Fatal(err)
		}
		if len(resp.Matches) != 1 {
			t.Fatalf("expected 1 match (only .go), got %d", len(resp.Matches))
		}
		if !strings.HasSuffix(resp.Matches[0].File, "code.go") {
			t.Errorf("expected code.go, got %q", resp.Matches[0].File)
		}
	})

	t.Run("exclude patterns", func(t *testing.T) {
		t.Parallel()
		dir := t.TempDir()
		s := newFsTestServer(dir)

		if err := os.WriteFile(filepath.Join(dir, "keep.txt"), []byte("findme keep\n"), 0o644); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, "skip.md"), []byte("findme skip\n"), 0o644); err != nil {
			t.Fatal(err)
		}

		body := mustMarshalJSON(t, validation.FileGrepRequest{
			Query:           "findme",
			ExcludePatterns: []string{"*.md"},
		})
		req := httptest.NewRequest(http.MethodPost, "/fs/grep", bytes.NewReader(body))
		w := httptest.NewRecorder()

		s.handleFsGrep(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
		}

		var resp validation.FileGrepResponse
		if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
			t.Fatal(err)
		}
		if len(resp.Matches) != 1 {
			t.Fatalf("expected 1 match (exclude .md), got %d", len(resp.Matches))
		}
	})
}

func TestHandleFsGrepPaths(t *testing.T) {
	t.Parallel()
	requireRg(t)

	t.Run("specific directory", func(t *testing.T) {
		t.Parallel()
		dir := t.TempDir()
		s := newFsTestServer(dir)

		if err := os.MkdirAll(filepath.Join(dir, "src"), 0o750); err != nil {
			t.Fatal(err)
		}
		if err := os.MkdirAll(filepath.Join(dir, "lib"), 0o750); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, "src", "a.txt"), []byte("findme\n"), 0o644); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, "lib", "b.txt"), []byte("findme\n"), 0o644); err != nil {
			t.Fatal(err)
		}

		body := mustMarshalJSON(t, validation.FileGrepRequest{Query: "findme", Paths: []string{"src"}})
		req := httptest.NewRequest(http.MethodPost, "/fs/grep", bytes.NewReader(body))
		w := httptest.NewRecorder()

		s.handleFsGrep(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
		}

		var resp validation.FileGrepResponse
		if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
			t.Fatal(err)
		}
		if len(resp.Matches) != 1 {
			t.Fatalf("expected 1 match (only src/), got %d", len(resp.Matches))
		}
	})

	t.Run("specific file", func(t *testing.T) {
		t.Parallel()
		dir := t.TempDir()
		s := newFsTestServer(dir)

		if err := os.WriteFile(filepath.Join(dir, "a.txt"), []byte("findme\n"), 0o644); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, "b.txt"), []byte("findme\n"), 0o644); err != nil {
			t.Fatal(err)
		}

		body := mustMarshalJSON(t, validation.FileGrepRequest{Query: "findme", Paths: []string{"a.txt"}})
		req := httptest.NewRequest(http.MethodPost, "/fs/grep", bytes.NewReader(body))
		w := httptest.NewRecorder()

		s.handleFsGrep(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
		}

		var resp validation.FileGrepResponse
		if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
			t.Fatal(err)
		}
		if len(resp.Matches) != 1 {
			t.Fatalf("expected 1 match (only a.txt), got %d", len(resp.Matches))
		}
	})
}

func TestHandleFsGrepIgnores(t *testing.T) {
	t.Parallel()
	requireRg(t)

	t.Run("default ignores skip node_modules", func(t *testing.T) {
		t.Parallel()
		dir := t.TempDir()
		s := newFsTestServer(dir)

		if err := os.MkdirAll(filepath.Join(dir, "node_modules", "pkg"), 0o750); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(
			filepath.Join(dir, "node_modules", "pkg", "index.js"), []byte("findme\n"), 0o644,
		); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, "app.js"), []byte("findme\n"), 0o644); err != nil {
			t.Fatal(err)
		}

		body := mustMarshalJSON(t, validation.FileGrepRequest{Query: "findme"})
		req := httptest.NewRequest(http.MethodPost, "/fs/grep", bytes.NewReader(body))
		w := httptest.NewRecorder()

		s.handleFsGrep(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
		}

		var resp validation.FileGrepResponse
		if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
			t.Fatal(err)
		}
		if len(resp.Matches) != 1 {
			t.Fatalf("expected 1 match (node_modules ignored), got %d", len(resp.Matches))
		}
		if strings.Contains(resp.Matches[0].File, "node_modules") {
			t.Errorf("expected node_modules to be excluded, got %q", resp.Matches[0].File)
		}
	})

	t.Run("no_default_ignores includes node_modules", func(t *testing.T) {
		t.Parallel()
		dir := t.TempDir()
		s := newFsTestServer(dir)

		if err := os.MkdirAll(filepath.Join(dir, "node_modules", "pkg"), 0o750); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(
			filepath.Join(dir, "node_modules", "pkg", "index.js"), []byte("findme\n"), 0o644,
		); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, "app.js"), []byte("findme\n"), 0o644); err != nil {
			t.Fatal(err)
		}

		body := mustMarshalJSON(t, validation.FileGrepRequest{Query: "findme", NoDefaultIgnores: true})
		req := httptest.NewRequest(http.MethodPost, "/fs/grep", bytes.NewReader(body))
		w := httptest.NewRecorder()

		s.handleFsGrep(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
		}

		var resp validation.FileGrepResponse
		if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
			t.Fatal(err)
		}
		if len(resp.Matches) != 2 {
			t.Fatalf("expected 2 matches (no_default_ignores), got %d", len(resp.Matches))
		}
	})
}

func TestHandleFsGrepValidation(t *testing.T) {
	t.Parallel()
	requireRg(t)

	t.Run("empty query returns 400", func(t *testing.T) {
		t.Parallel()
		dir := t.TempDir()
		s := newFsTestServer(dir)

		body := mustMarshalJSON(t, validation.FileGrepRequest{Query: ""})
		req := httptest.NewRequest(http.MethodPost, "/fs/grep", bytes.NewReader(body))
		w := httptest.NewRecorder()

		s.handleFsGrep(w, req)

		if w.Code != http.StatusBadRequest {
			t.Errorf("expected 400, got %d: %s", w.Code, w.Body.String())
		}
	})

	t.Run("path traversal rejected", func(t *testing.T) {
		t.Parallel()
		dir := t.TempDir()
		s := newFsTestServer(dir)

		body := mustMarshalJSON(t, validation.FileGrepRequest{
			Query: "test",
			Paths: []string{"../../../etc"},
		})
		req := httptest.NewRequest(http.MethodPost, "/fs/grep", bytes.NewReader(body))
		w := httptest.NewRecorder()

		s.handleFsGrep(w, req)

		if w.Code != http.StatusBadRequest {
			t.Errorf("expected 400, got %d: %s", w.Code, w.Body.String())
		}
	})

	t.Run("max_results over limit rejected", func(t *testing.T) {
		t.Parallel()
		dir := t.TempDir()
		s := newFsTestServer(dir)

		body := mustMarshalJSON(t, validation.FileGrepRequest{Query: "test", MaxResults: 1001})
		req := httptest.NewRequest(http.MethodPost, "/fs/grep", bytes.NewReader(body))
		w := httptest.NewRecorder()

		s.handleFsGrep(w, req)

		if w.Code != http.StatusBadRequest {
			t.Errorf("expected 400 for max_results=1001, got %d: %s", w.Code, w.Body.String())
		}
	})
}
