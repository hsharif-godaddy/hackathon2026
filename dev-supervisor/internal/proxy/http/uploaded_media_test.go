package httpproxy_test

import (
	"net/http"
	"net/http/httptest"
	"net/url"
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

	handler := httpproxy.NewUploadedMediaHandler([]string{filepath.Join(tmpDir, "public", "media")})

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

	t.Run("blocks null bytes", func(t *testing.T) {
		// Note: httptest.NewRequest rejects null bytes in URLs at the HTTP parsing layer,
		// which is the first line of defense. This test verifies our handler also blocks
		// them as defense-in-depth in case requests come from internal sources.
		// We construct the request manually to bypass HTTP parsing validation.
		req := &http.Request{
			Method: http.MethodGet,
			URL: &url.URL{
				Path: "/airo-assets/uploads/file\x00.jpg",
			},
		}
		rec := httptest.NewRecorder()

		handler.ServeHTTP(rec, req)

		if rec.Code != http.StatusBadRequest {
			t.Errorf("expected status 400 for null byte in filename, got %d", rec.Code)
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

	handler := httpproxy.NewUploadedMediaHandler([]string{filepath.Join(tmpDir, "public", "media")})

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

	handler := httpproxy.NewUploadedMediaHandler([]string{filepath.Join(tmpDir, "public", "media")})

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
	handler := httpproxy.NewUploadedMediaHandler([]string{filepath.Join(tmpDir, "public", "media")})

	req := httptest.NewRequest(http.MethodGet, "/airo-assets/uploads/", nil)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("expected status 400 for empty path, got %d", rec.Code)
	}
}

func TestUploadedMediaHandler_SubdirectoryAllowed(t *testing.T) {
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

	handler := httpproxy.NewUploadedMediaHandler([]string{filepath.Join(tmpDir, "public", "media")})

	// Request with subdirectory path - should now be allowed
	req := httptest.NewRequest(http.MethodGet, "/airo-assets/uploads/subdir/test.jpg", nil)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	// Should return 200 because legitimate subdirectories are now allowed
	if rec.Code != http.StatusOK {
		t.Errorf("expected status 200 for subdirectory path, got %d: %s", rec.Code, rec.Body.String())
	}
	if rec.Header().Get("Content-Type") != "image/jpeg" {
		t.Errorf("expected Content-Type image/jpeg, got %s", rec.Header().Get("Content-Type"))
	}
}

func TestUploadedMediaHandler_ArbitrarySubdirectoryViaBaseDir(t *testing.T) {
	tmpDir := t.TempDir()
	assetsDir := filepath.Join(tmpDir, "public", "assets")
	pdfsDir := filepath.Join(assetsDir, "pdfs")
	if err := os.MkdirAll(pdfsDir, 0755); err != nil {
		t.Fatalf("failed to create pdfs dir: %v", err)
	}

	// File in arbitrary subdirectory (not media/, images/, or uploads/)
	testFile := filepath.Join(pdfsDir, "document.pdf")
	if err := os.WriteFile(testFile, []byte("fake pdf content"), 0644); err != nil {
		t.Fatalf("failed to create test file: %v", err)
	}

	// Handler with base directory first, then specific subdirs
	// Only the base directory should find pdfs/ subdirectory
	handler := httpproxy.NewUploadedMediaHandler([]string{
		filepath.Join(tmpDir, "public", "assets"), // base (catches all subdirs)
		filepath.Join(tmpDir, "public", "assets", "media"),
		filepath.Join(tmpDir, "public", "assets", "images"),
		filepath.Join(tmpDir, "public", "assets", "uploads"),
	})

	req := httptest.NewRequest(http.MethodGet, "/airo-assets/uploads/pdfs/document.pdf", nil)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf(
			"expected status 200 for arbitrary subdirectory via base path, got %d: %s",
			rec.Code,
			rec.Body.String(),
		)
	}
	if rec.Header().Get("Content-Type") != "application/pdf" {
		t.Errorf("expected Content-Type application/pdf, got %s", rec.Header().Get("Content-Type"))
	}

	// Verify cache headers - pdfs/ is not content-hashed, should get shorter cache
	cacheControl := rec.Header().Get("Cache-Control")
	if !strings.Contains(cacheControl, "max-age=86400") {
		t.Errorf("expected Cache-Control with max-age=86400 for non-hashed file, got %s", cacheControl)
	}
	if strings.Contains(cacheControl, "immutable") {
		t.Errorf("expected no immutable cache for non-hashed file, got %s", cacheControl)
	}
}

func TestUploadedMediaHandler_AbsolutePathBlocked(t *testing.T) {
	tmpDir := t.TempDir()
	handler := httpproxy.NewUploadedMediaHandler([]string{filepath.Join(tmpDir, "public", "media")})

	// Double slash in URL: /airo-assets/uploads//etc/passwd
	// After TrimPrefix("/airo-assets/uploads/"): /etc/passwd (absolute path)
	// Should be blocked by primary security check
	req := httptest.NewRequest(http.MethodGet, "/airo-assets/uploads//etc/passwd", nil)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("expected status 400 for absolute path via double slash, got %d", rec.Code)
	}
}

func TestUploadedMediaHandler_DirectoryNotServed(t *testing.T) {
	tmpDir := t.TempDir()
	mediaDir := filepath.Join(tmpDir, "public", "media")
	subDir := filepath.Join(mediaDir, "testdir")
	if err := os.MkdirAll(subDir, 0755); err != nil {
		t.Fatalf("failed to create subdirectory: %v", err)
	}

	handler := httpproxy.NewUploadedMediaHandler([]string{filepath.Join(tmpDir, "public", "media")})

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

	handler := httpproxy.NewUploadedMediaHandler([]string{filepath.Join(tmpDir, "public", "media")})

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

func TestUploadedMediaHandler_CacheHeadersForHashedVsNonHashed(t *testing.T) {
	tmpDir := t.TempDir()
	assetsDir := filepath.Join(tmpDir, "public", "assets")

	// Create content-hashed file in media/ subdirectory
	mediaDir := filepath.Join(assetsDir, "media")
	if err := os.MkdirAll(mediaDir, 0755); err != nil {
		t.Fatalf("failed to create media dir: %v", err)
	}
	hashedFile := filepath.Join(mediaDir, "hero-abc123.jpg")
	if err := os.WriteFile(hashedFile, []byte("fake image"), 0644); err != nil {
		t.Fatalf("failed to create hashed file: %v", err)
	}

	// Create non-hashed file in arbitrary subdirectory
	pdfsDir := filepath.Join(assetsDir, "pdfs")
	if err := os.MkdirAll(pdfsDir, 0755); err != nil {
		t.Fatalf("failed to create pdfs dir: %v", err)
	}
	nonHashedFile := filepath.Join(pdfsDir, "document.pdf")
	if err := os.WriteFile(nonHashedFile, []byte("fake pdf"), 0644); err != nil {
		t.Fatalf("failed to create non-hashed file: %v", err)
	}

	handler := httpproxy.NewUploadedMediaHandler([]string{
		filepath.Join(tmpDir, "public", "assets"),
		filepath.Join(tmpDir, "public", "assets", "media"),
		filepath.Join(tmpDir, "public", "assets", "images"),
		filepath.Join(tmpDir, "public", "assets", "uploads"),
	})

	t.Run("content-hashed file gets immutable cache", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/airo-assets/uploads/media/hero-abc123.jpg", nil)
		rec := httptest.NewRecorder()

		handler.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Errorf("expected status 200, got %d", rec.Code)
		}
		cacheControl := rec.Header().Get("Cache-Control")
		if !strings.Contains(cacheControl, "immutable") {
			t.Errorf("expected immutable cache for content-hashed file, got %s", cacheControl)
		}
		if !strings.Contains(cacheControl, "max-age=31536000") {
			t.Errorf("expected 1-year cache for content-hashed file, got %s", cacheControl)
		}
	})

	t.Run("non-hashed file gets shorter cache", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/airo-assets/uploads/pdfs/document.pdf", nil)
		rec := httptest.NewRecorder()

		handler.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Errorf("expected status 200, got %d", rec.Code)
		}
		cacheControl := rec.Header().Get("Cache-Control")
		if strings.Contains(cacheControl, "immutable") {
			t.Errorf("expected no immutable cache for non-hashed file, got %s", cacheControl)
		}
		if !strings.Contains(cacheControl, "max-age=86400") {
			t.Errorf("expected 24-hour cache for non-hashed file, got %s", cacheControl)
		}
	})
}
