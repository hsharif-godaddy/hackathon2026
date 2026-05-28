package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	httpproxy "github.com/airo-ai-builder/dev-supervisor/internal/proxy/http"
)

// mustNewStatusPage wraps httpproxy.NewStatusPage so test bodies stay
// focused on the assertion under test.
func mustNewStatusPage(t *testing.T, cfg httpproxy.StatusPageConfig) *httpproxy.StatusPage {
	t.Helper()
	sp, err := httpproxy.NewStatusPage(cfg)
	if err != nil {
		t.Fatalf("NewStatusPage: %v", err)
	}
	return sp
}

func TestIsNoProcessErr(t *testing.T) {
	cases := []struct {
		err  string
		want bool
	}{
		// ProcessManager.Stop strings
		{"no process is running", true},
		{"process is not running (current state: stopped)", true},
		// ManagedProcess.Stop strings (race window after pm.mu is released)
		{"process not running (current state: error)", true},
		{"process not initialized", true},
		// Anything else is a real error
		{"timed out waiting for shutdown", false},
		{"some other error", false},
		{"", false},
	}
	for _, tc := range cases {
		if got := isNoProcessErr(errors.New(tc.err)); got != tc.want {
			t.Errorf("isNoProcessErr(%q) = %v, want %v", tc.err, got, tc.want)
		}
	}
}

func TestHandleUnpublish_SymlinkMissing(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("DIST_DIR", tmpDir)

	s := NewServer()
	req := httptest.NewRequest(http.MethodPost, "/unpublish", nil)
	rec := httptest.NewRecorder()

	s.handleUnpublish(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}

	var body map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if body["status"] != "not_published" {
		t.Fatalf("expected status 'not_published', got %q", body["status"])
	}
}

func TestHandleUnpublish_NotASymlink(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("DIST_DIR", tmpDir)

	currentPath := filepath.Join(tmpDir, "current")
	if err := os.WriteFile(currentPath, []byte("not a symlink"), 0644); err != nil {
		t.Fatalf("failed to create test file: %v", err)
	}

	s := NewServer()
	req := httptest.NewRequest(http.MethodPost, "/unpublish", nil)
	rec := httptest.NewRecorder()

	s.handleUnpublish(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", rec.Code)
	}

	var body ErrorResponse
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if body.Error != "not_a_symlink" {
		t.Fatalf("expected error 'not_a_symlink', got %q", body.Error)
	}
}

func TestHandleUnpublish_SymlinkPresent(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("DIST_DIR", tmpDir)

	targetFile := filepath.Join(tmpDir, "abc123.tar.gz")
	if err := os.WriteFile(targetFile, []byte("archive"), 0644); err != nil {
		t.Fatalf("failed to create target file: %v", err)
	}
	currentPath := filepath.Join(tmpDir, "current")
	if err := os.Symlink("abc123.tar.gz", currentPath); err != nil {
		t.Fatalf("failed to create symlink: %v", err)
	}

	s := NewServer()
	req := httptest.NewRequest(http.MethodPost, "/unpublish", nil)
	rec := httptest.NewRecorder()

	s.handleUnpublish(rec, req)

	// Symlink should be removed.
	if _, err := os.Lstat(currentPath); !os.IsNotExist(err) {
		t.Fatal("expected current symlink to be removed")
	}

	// Stop returns "no process is running" in this test env (no child was
	// ever launched). That case is tolerated, so the handler returns 200.
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 (stop tolerates no-process), got %d: %s", rec.Code, rec.Body.String())
	}

	var body map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if body["status"] != "success" {
		t.Fatalf("expected status 'success', got %q", body["status"])
	}
}

func TestHandlePublish_SuspendedStaysActive(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("DIST_DIR", tmpDir)

	commit := "abc123"
	if err := os.WriteFile(filepath.Join(tmpDir, commit+".tar.gz"), []byte("archive"), 0644); err != nil {
		t.Fatalf("failed to create archive: %v", err)
	}

	s := NewServer()
	s.statusPage = mustNewStatusPage(t, httpproxy.StatusPageConfig{
		Suspended: true,
		DistDir:   tmpDir,
	})

	rec := httptest.NewRecorder()
	s.handlePublish(rec, httptest.NewRequest(http.MethodPost, "/publish",
		bytes.NewBufferString(`{"commitHash":"`+commit+`"}`)))

	// Status page must stay active for a suspended site even after a
	// successful publish (sticky). The handler runs the normal restart
	// path, which fails in this test env (no managed process); response
	// code is incidental — the sticky-Active assertion is what matters.
	if !s.statusPage.Active() {
		t.Errorf("status page should remain active for suspended site after publish")
	}
}

func TestHandlePublish_RestartFailure_RestoresStatusPage(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("DIST_DIR", tmpDir)

	commit := "abc123"
	if err := os.WriteFile(filepath.Join(tmpDir, commit+".tar.gz"), []byte("archive"), 0644); err != nil {
		t.Fatalf("failed to create archive: %v", err)
	}

	s := NewServer()
	s.statusPage = mustNewStatusPage(t, httpproxy.StatusPageConfig{DistDir: tmpDir})
	if !s.statusPage.Active() {
		t.Fatal("precondition: status page active before publish")
	}

	// Drive /publish. In this test env procMgr.Restart fails ("no previous
	// process to restart and no start configuration available"), exercising
	// the new rollback branch.
	rec := httptest.NewRecorder()
	s.handlePublish(rec, httptest.NewRequest(http.MethodPost, "/publish",
		bytes.NewBufferString(`{"commitHash":"`+commit+`"}`)))

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500 (restart failed), got %d: %s", rec.Code, rec.Body.String())
	}

	var body ErrorResponse
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if body.Error != "restart_failed" {
		t.Errorf("expected error code 'restart_failed', got %q", body.Error)
	}

	// Critical assertion: the rollback flipped the fallback back on.
	if !s.statusPage.Active() {
		t.Errorf("expected status page Active=true after restart failure (rollback)")
	}
}

func TestHandleUnpublish_LstatPermissionError(t *testing.T) {
	tmpDir := t.TempDir()

	// Create a subdirectory and remove read permission to cause Lstat to fail
	distDir := filepath.Join(tmpDir, "restricted")
	if err := os.MkdirAll(distDir, 0755); err != nil {
		t.Fatalf("failed to create dist dir: %v", err)
	}

	// Create the symlink first, then restrict the directory
	targetFile := filepath.Join(distDir, "abc123.tar.gz")
	if err := os.WriteFile(targetFile, []byte("archive"), 0644); err != nil {
		t.Fatalf("failed to create target file: %v", err)
	}
	currentPath := filepath.Join(distDir, "current")
	if err := os.Symlink("abc123.tar.gz", currentPath); err != nil {
		t.Fatalf("failed to create symlink: %v", err)
	}

	// Remove all permissions from the directory so Lstat fails with EACCES
	if err := os.Chmod(distDir, 0000); err != nil {
		t.Fatalf("failed to chmod: %v", err)
	}
	t.Cleanup(func() {
		os.Chmod(distDir, 0755)
	})

	t.Setenv("DIST_DIR", distDir)

	s := NewServer()
	req := httptest.NewRequest(http.MethodPost, "/unpublish", nil)
	rec := httptest.NewRecorder()

	s.handleUnpublish(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", rec.Code)
	}

	var body ErrorResponse
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if body.Error != "lstat_failed" {
		t.Fatalf("expected error 'lstat_failed', got %q", body.Error)
	}
}
