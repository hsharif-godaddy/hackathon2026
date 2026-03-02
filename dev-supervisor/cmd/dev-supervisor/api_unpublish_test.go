package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

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

	// Symlink should be removed regardless of restart outcome
	if _, err := os.Lstat(currentPath); !os.IsNotExist(err) {
		t.Fatal("expected current symlink to be removed")
	}

	// Restart will fail because no process is running, which is expected
	// in this test environment. The handler returns 500 with "restart_failed".
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500 (restart fails with no process), got %d", rec.Code)
	}

	var body ErrorResponse
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if body.Error != "restart_failed" {
		t.Fatalf("expected error 'restart_failed', got %q", body.Error)
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
