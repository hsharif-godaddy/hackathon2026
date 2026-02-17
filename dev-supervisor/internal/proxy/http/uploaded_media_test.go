package httpproxy_test

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	httpproxy "github.com/airo-ai-builder/dev-supervisor/internal/proxy/http"
)

func TestUploadedMediaHandler(t *testing.T) {
	// Create temp directory with test file
	tmpDir := t.TempDir()
	mediaDir := filepath.Join(tmpDir, "public", "media")
	if err := os.MkdirAll(mediaDir, 0755); err != nil {
		t.Fatalf("failed to create media dir: %v", err)
	}

	// Create test image file
	testFile := filepath.Join(mediaDir, "hero-abc123.jpg")
	if err := os.WriteFile(testFile, []byte("fake image data"), 0644); err != nil {
		t.Fatalf("failed to create test file: %v", err)
	}

	handler := httpproxy.NewUploadedMediaHandler(tmpDir)

	t.Run("serves existing file", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/airo-assets/uploads/hero-abc123.jpg", nil)
		rec := httptest.NewRecorder()

		handler.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Errorf("expected status 200, got %d", rec.Code)
		}
		if rec.Header().Get("Content-Type") != "image/jpeg" {
			t.Errorf("expected Content-Type image/jpeg, got %s", rec.Header().Get("Content-Type"))
		}
	})

	t.Run("returns 404 for missing file", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/airo-assets/uploads/nonexistent.jpg", nil)
		rec := httptest.NewRecorder()

		handler.ServeHTTP(rec, req)

		if rec.Code != http.StatusNotFound {
			t.Errorf("expected status 404, got %d", rec.Code)
		}
	})

	t.Run("blocks path traversal attempts", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/airo-assets/uploads/../../../etc/passwd", nil)
		rec := httptest.NewRecorder()

		handler.ServeHTTP(rec, req)

		if rec.Code != http.StatusBadRequest {
			t.Errorf("expected status 400, got %d", rec.Code)
		}
	})

	t.Run("only allows GET and HEAD", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/airo-assets/uploads/hero-abc123.jpg", nil)
		rec := httptest.NewRecorder()

		handler.ServeHTTP(rec, req)

		if rec.Code != http.StatusMethodNotAllowed {
			t.Errorf("expected status 405, got %d", rec.Code)
		}
	})
}

func TestUploadedMediaHandler_HeadRequest(t *testing.T) {
	tmpDir := t.TempDir()
	mediaDir := filepath.Join(tmpDir, "public", "media")
	if err := os.MkdirAll(mediaDir, 0755); err != nil {
		t.Fatalf("failed to create media dir: %v", err)
	}

	testFile := filepath.Join(mediaDir, "test-image.png")
	if err := os.WriteFile(testFile, []byte("fake png data"), 0644); err != nil {
		t.Fatalf("failed to create test file: %v", err)
	}

	handler := httpproxy.NewUploadedMediaHandler(tmpDir)

	req := httptest.NewRequest(http.MethodHead, "/airo-assets/uploads/test-image.png", nil)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected status 200 for HEAD, got %d", rec.Code)
	}
	if rec.Header().Get("Content-Type") != "image/png" {
		t.Errorf("expected Content-Type image/png, got %s", rec.Header().Get("Content-Type"))
	}
}

func TestUploadedMediaHandler_CacheHeaders(t *testing.T) {
	tmpDir := t.TempDir()
	mediaDir := filepath.Join(tmpDir, "public", "media")
	if err := os.MkdirAll(mediaDir, 0755); err != nil {
		t.Fatalf("failed to create media dir: %v", err)
	}

	testFile := filepath.Join(mediaDir, "cached-image.webp")
	if err := os.WriteFile(testFile, []byte("fake webp data"), 0644); err != nil {
		t.Fatalf("failed to create test file: %v", err)
	}

	handler := httpproxy.NewUploadedMediaHandler(tmpDir)

	req := httptest.NewRequest(http.MethodGet, "/airo-assets/uploads/cached-image.webp", nil)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", rec.Code)
	}

	cacheControl := rec.Header().Get("Cache-Control")
	if !strings.Contains(cacheControl, "max-age=31536000") {
		t.Errorf("expected Cache-Control with max-age=31536000, got %s", cacheControl)
	}
	if !strings.Contains(cacheControl, "immutable") {
		t.Errorf("expected Cache-Control with immutable, got %s", cacheControl)
	}

	xContentType := rec.Header().Get("X-Content-Type-Options")
	if xContentType != "nosniff" {
		t.Errorf("expected X-Content-Type-Options nosniff, got %s", xContentType)
	}
}

func TestUploadedMediaHandler_EmptyPath(t *testing.T) {
	tmpDir := t.TempDir()
	handler := httpproxy.NewUploadedMediaHandler(tmpDir)

	req := httptest.NewRequest(http.MethodGet, "/airo-assets/uploads/", nil)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("expected status 400 for empty path, got %d", rec.Code)
	}
}

func TestUploadedMediaHandler_SubdirectoryBlocked(t *testing.T) {
	tmpDir := t.TempDir()
	mediaDir := filepath.Join(tmpDir, "public", "media", "subdir")
	if err := os.MkdirAll(mediaDir, 0755); err != nil {
		t.Fatalf("failed to create media dir: %v", err)
	}

	// File exists in subdirectory
	testFile := filepath.Join(mediaDir, "test.jpg")
	if err := os.WriteFile(testFile, []byte("fake image"), 0644); err != nil {
		t.Fatalf("failed to create test file: %v", err)
	}

	handler := httpproxy.NewUploadedMediaHandler(tmpDir)

	// Request with subdirectory path - should be blocked
	req := httptest.NewRequest(http.MethodGet, "/airo-assets/uploads/subdir/test.jpg", nil)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	// Should return 400 because subdirectory paths are blocked for security
	if rec.Code != http.StatusBadRequest {
		t.Errorf("expected status 400 for subdirectory path, got %d", rec.Code)
	}
}

func TestUploadedMediaHandler_DirectoryNotServed(t *testing.T) {
	tmpDir := t.TempDir()
	mediaDir := filepath.Join(tmpDir, "public", "media")
	subDir := filepath.Join(mediaDir, "testdir")
	if err := os.MkdirAll(subDir, 0755); err != nil {
		t.Fatalf("failed to create subdirectory: %v", err)
	}

	handler := httpproxy.NewUploadedMediaHandler(tmpDir)

	// Request the directory name without any subdirectory traversal
	req := httptest.NewRequest(http.MethodGet, "/airo-assets/uploads/testdir", nil)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	// Should return 400 because we don't serve directories
	if rec.Code != http.StatusBadRequest {
		t.Errorf("expected status 400 for directory request, got %d", rec.Code)
	}
}

func TestUploadedMediaHandler_UnknownMimeType(t *testing.T) {
	tmpDir := t.TempDir()
	mediaDir := filepath.Join(tmpDir, "public", "media")
	if err := os.MkdirAll(mediaDir, 0755); err != nil {
		t.Fatalf("failed to create media dir: %v", err)
	}

	// Create file with unknown extension
	testFile := filepath.Join(mediaDir, "file.unknownext")
	if err := os.WriteFile(testFile, []byte("unknown content"), 0644); err != nil {
		t.Fatalf("failed to create test file: %v", err)
	}

	handler := httpproxy.NewUploadedMediaHandler(tmpDir)

	req := httptest.NewRequest(http.MethodGet, "/airo-assets/uploads/file.unknownext", nil)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", rec.Code)
	}
	// Unknown extension should default to application/octet-stream
	if rec.Header().Get("Content-Type") != "application/octet-stream" {
		t.Errorf("expected Content-Type application/octet-stream, got %s", rec.Header().Get("Content-Type"))
	}
}
