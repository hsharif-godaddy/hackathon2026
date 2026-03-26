//nolint:testpackage // Tests use unexported helpers.
package httpproxy

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestPersistentAssets_ServesExistingFile(t *testing.T) {
	tmpDir := t.TempDir()
	assetsDir := filepath.Join(tmpDir, "assets", "photos")
	if err := os.MkdirAll(assetsDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(assetsDir, "product.png"), []byte("PNG DATA"), 0600); err != nil {
		t.Fatal(err)
	}

	fallback := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		t.Error("fallback should not be called")
		w.WriteHeader(http.StatusBadGateway)
	})

	handler := NewPersistentAssetsHandler(tmpDir, fallback)
	req := httptest.NewRequest(http.MethodGet, "/assets/photos/product.png", nil)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rec.Code)
	}
	if rec.Header().Get("Cache-Control") != "public, max-age=86400" {
		t.Errorf("expected Cache-Control header, got %q", rec.Header().Get("Cache-Control"))
	}
	if rec.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Errorf("expected X-Content-Type-Options: nosniff, got %q", rec.Header().Get("X-Content-Type-Options"))
	}
	if !strings.Contains(rec.Body.String(), "PNG DATA") {
		t.Errorf("expected file content, got %q", rec.Body.String())
	}
}

func TestPersistentAssets_ServesNestedSubdirectory(t *testing.T) {
	tmpDir := t.TempDir()
	nestedDir := filepath.Join(tmpDir, "assets", "media", "uploads", "2026")
	if err := os.MkdirAll(nestedDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(nestedDir, "img.jpg"), []byte("JPEG"), 0600); err != nil {
		t.Fatal(err)
	}

	fallback := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		t.Error("fallback should not be called")
		w.WriteHeader(http.StatusBadGateway)
	})

	handler := NewPersistentAssetsHandler(tmpDir, fallback)
	req := httptest.NewRequest(http.MethodGet, "/assets/media/uploads/2026/img.jpg", nil)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rec.Code)
	}
}

func TestPersistentAssets_FallsThroughOnMiss(t *testing.T) {
	tmpDir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(tmpDir, "assets"), 0755); err != nil {
		t.Fatal(err)
	}

	fallbackCalled := false
	fallback := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		fallbackCalled = true
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("proxied"))
	})

	handler := NewPersistentAssetsHandler(tmpDir, fallback)
	req := httptest.NewRequest(http.MethodGet, "/assets/nonexistent.png", nil)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if !fallbackCalled {
		t.Error("expected fallback to be called for missing file")
	}
	if rec.Body.String() != "proxied" {
		t.Errorf("expected proxied response, got %q", rec.Body.String())
	}
}

// TestPersistentAssets_BlocksPathTraversal tests the handler's own traversal defence
// in isolation. Note: in production, http.ServeMux normalizes ".." before the handler
// is invoked, so this path would be redirected to /etc/passwd and routed to the
// catch-all proxy — the handler's 400 would never be reached. This test validates
// the handler's defence-in-depth for direct invocation.
func TestPersistentAssets_BlocksPathTraversal(t *testing.T) {
	tmpDir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(tmpDir, "assets"), 0755); err != nil {
		t.Fatal(err)
	}

	fallbackCalled := false
	fallback := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		fallbackCalled = true
		w.WriteHeader(http.StatusOK)
	})

	handler := NewPersistentAssetsHandler(tmpDir, fallback)
	req := httptest.NewRequest(http.MethodGet, "/assets/../../../etc/passwd", nil)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	// EvalSymlinks fails (path doesn't exist) → falls through to proxy.
	// The confinement check would block it if the path existed outside root.
	if !fallbackCalled {
		t.Error("expected fallback for traversal path that doesn't resolve")
	}
}

// TestPersistentAssets_DoubleSlashFallsThrough verifies that double-slash paths like
// /assets//etc/passwd don't escape the asset root. TrimPrefix yields "/etc/passwd"
// (absolute), filepath.Join safely appends it under the root, and EvalSymlinks
// fails because the path doesn't exist → falls through to proxy.
func TestPersistentAssets_DoubleSlashFallsThrough(t *testing.T) {
	tmpDir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(tmpDir, "assets"), 0755); err != nil {
		t.Fatal(err)
	}

	fallbackCalled := false
	fallback := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		fallbackCalled = true
		w.WriteHeader(http.StatusOK)
	})

	handler := NewPersistentAssetsHandler(tmpDir, fallback)
	req := httptest.NewRequest(http.MethodGet, "/assets//etc/passwd", nil)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if !fallbackCalled {
		t.Error("expected fallback for double-slash path")
	}
}

func TestPersistentAssets_HEADWorks(t *testing.T) {
	tmpDir := t.TempDir()
	publicDir := filepath.Join(tmpDir, "assets")
	if err := os.MkdirAll(publicDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(publicDir, "file.css"), []byte("body{}"), 0600); err != nil {
		t.Fatal(err)
	}

	fallback := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		t.Error("fallback should not be called")
		w.WriteHeader(http.StatusBadGateway)
	})

	handler := NewPersistentAssetsHandler(tmpDir, fallback)
	req := httptest.NewRequest(http.MethodHead, "/assets/file.css", nil)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rec.Code)
	}
	if rec.Body.Len() > 0 {
		t.Errorf("expected empty body for HEAD, got %d bytes", rec.Body.Len())
	}
}

func TestPersistentAssets_DirectoryFallsThrough(t *testing.T) {
	tmpDir := t.TempDir()
	dirPath := filepath.Join(tmpDir, "assets", "photos")
	if err := os.MkdirAll(dirPath, 0755); err != nil {
		t.Fatal(err)
	}

	fallbackCalled := false
	fallback := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		fallbackCalled = true
		w.WriteHeader(http.StatusOK)
	})

	handler := NewPersistentAssetsHandler(tmpDir, fallback)
	req := httptest.NewRequest(http.MethodGet, "/assets/photos", nil)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if !fallbackCalled {
		t.Error("expected fallback for directory request")
	}
}

func TestPersistentAssets_POSTFallsThrough(t *testing.T) {
	tmpDir := t.TempDir()
	publicDir := filepath.Join(tmpDir, "assets")
	if err := os.MkdirAll(publicDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(publicDir, "file.txt"), []byte("data"), 0600); err != nil {
		t.Fatal(err)
	}

	fallbackCalled := false
	fallback := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		fallbackCalled = true
		w.WriteHeader(http.StatusOK)
	})

	handler := NewPersistentAssetsHandler(tmpDir, fallback)
	req := httptest.NewRequest(http.MethodPost, "/assets/file.txt", nil)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if !fallbackCalled {
		t.Error("expected fallback for POST request")
	}
}

func TestPersistentAssets_SymlinkEscapeBlocked(t *testing.T) {
	tmpDir := t.TempDir()
	publicDir := filepath.Join(tmpDir, "assets")
	if err := os.MkdirAll(publicDir, 0755); err != nil {
		t.Fatal(err)
	}

	// Create a file outside the asset root.
	outsideDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(outsideDir, "secret.txt"), []byte("SECRET"), 0600); err != nil {
		t.Fatal(err)
	}

	// Create a symlink inside public/ that points outside.
	if err := os.Symlink(outsideDir, filepath.Join(publicDir, "escape")); err != nil {
		t.Fatal(err)
	}

	fallback := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		t.Error("fallback should not be called for symlink escape")
		w.WriteHeader(http.StatusBadGateway)
	})

	handler := NewPersistentAssetsHandler(tmpDir, fallback)
	req := httptest.NewRequest(http.MethodGet, "/assets/escape/secret.txt", nil)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for symlink escape, got %d", rec.Code)
	}
	if strings.Contains(rec.Body.String(), "SECRET") {
		t.Error("symlink escape served file content outside asset root")
	}
}

func TestPersistentAssets_EmptyRelativePathFallsThrough(t *testing.T) {
	tmpDir := t.TempDir()

	fallbackCalled := false
	fallback := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		fallbackCalled = true
		w.WriteHeader(http.StatusOK)
	})

	handler := NewPersistentAssetsHandler(tmpDir, fallback)
	req := httptest.NewRequest(http.MethodGet, "/assets/", nil)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if !fallbackCalled {
		t.Error("expected fallback for empty relative path")
	}
}
