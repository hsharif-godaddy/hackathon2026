package httpproxy_test

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	httpproxy "github.com/airo-ai-builder/dev-supervisor/internal/proxy/http"
)

func TestImageSlot_Types(t *testing.T) {
	// Verify types compile and can be instantiated with all fields
	slot := httpproxy.ImageSlot{
		CurrentURL:  "https://media.gettyimages.com/id/abc123/photo.jpg",
		SearchQuery: "modern office",
		RequestedSize: &httpproxy.ImageSize{
			Width:  1920,
			Height: 1080,
			Fit:    "cover",
		},
		Alternatives: []string{"https://example.com/alt1.jpg"},
		UserModified: false,
		CreatedAt:    "2025-02-04T10:30:00Z",
		LastUpdated:  "2025-02-04T10:30:00Z",
	}

	// Verify JSON round-trip preserves all fields
	data, err := json.Marshal(slot)
	if err != nil {
		t.Fatalf("failed to marshal slot: %v", err)
	}

	var decoded httpproxy.ImageSlot
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("failed to unmarshal slot: %v", err)
	}

	if decoded.CurrentURL != slot.CurrentURL {
		t.Errorf("CurrentURL mismatch: got %s, want %s", decoded.CurrentURL, slot.CurrentURL)
	}
	if decoded.SearchQuery != slot.SearchQuery {
		t.Errorf("SearchQuery mismatch: got %s, want %s", decoded.SearchQuery, slot.SearchQuery)
	}
	if decoded.RequestedSize == nil || decoded.RequestedSize.Width != 1920 {
		t.Errorf("RequestedSize mismatch: got %+v", decoded.RequestedSize)
	}
	if len(decoded.Alternatives) != 1 {
		t.Errorf("Alternatives length mismatch: got %d", len(decoded.Alternatives))
	}
	if decoded.UserModified != slot.UserModified {
		t.Errorf("UserModified mismatch: got %v", decoded.UserModified)
	}
	if decoded.CreatedAt != slot.CreatedAt {
		t.Errorf("CreatedAt mismatch: got %s", decoded.CreatedAt)
	}
	if decoded.LastUpdated != slot.LastUpdated {
		t.Errorf("LastUpdated mismatch: got %s", decoded.LastUpdated)
	}
}

func TestManifestCache_Get_ReturnsSlot(t *testing.T) {
	tmpDir := t.TempDir()
	manifestPath := filepath.Join(tmpDir, "image-slots.json")

	manifest := httpproxy.ImageManifest{
		"pages/home/hero": {
			CurrentURL:  "https://media.gettyimages.com/id/abc123/photo.jpg",
			SearchQuery: "modern office",
		},
	}
	data, err := json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	if writeErr := os.WriteFile(manifestPath, data, 0600); writeErr != nil {
		t.Fatal(writeErr)
	}

	cache := httpproxy.NewManifestCache(manifestPath)
	slot, err := cache.Get("pages/home/hero")

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if slot == nil {
		t.Fatal("expected slot, got nil")
	}
	if slot.CurrentURL != "https://media.gettyimages.com/id/abc123/photo.jpg" {
		t.Errorf("unexpected CurrentURL: %s", slot.CurrentURL)
	}
}

func TestManifestCache_Get_MissingSlot(t *testing.T) {
	tmpDir := t.TempDir()
	manifestPath := filepath.Join(tmpDir, "image-slots.json")

	manifest := httpproxy.ImageManifest{
		"pages/home/hero": {CurrentURL: "https://media.gettyimages.com/img.jpg"},
	}
	data, _ := json.Marshal(manifest)
	_ = os.WriteFile(manifestPath, data, 0600)

	cache := httpproxy.NewManifestCache(manifestPath)
	slot, err := cache.Get("pages/about/team")

	if !errors.Is(err, httpproxy.ErrSlotNotFound) {
		t.Fatalf("expected ErrSlotNotFound, got: %v", err)
	}
	if slot != nil {
		t.Errorf("expected nil for missing slot, got: %+v", slot)
	}
}

func TestManifestCache_Get_MissingFile(t *testing.T) {
	cache := httpproxy.NewManifestCache("/nonexistent/image-slots.json")
	slot, err := cache.Get("any/slot")

	if err == nil {
		t.Error("expected error for missing file")
	}
	if slot != nil {
		t.Errorf("expected nil slot, got: %+v", slot)
	}
}

func TestManifestCache_Get_InvalidJSON(t *testing.T) {
	tmpDir := t.TempDir()
	manifestPath := filepath.Join(tmpDir, "image-slots.json")
	_ = os.WriteFile(manifestPath, []byte("not valid json"), 0600)

	cache := httpproxy.NewManifestCache(manifestPath)
	slot, err := cache.Get("any/slot")

	if err == nil {
		t.Error("expected error for invalid JSON")
	}
	if slot != nil {
		t.Errorf("expected nil slot, got: %+v", slot)
	}
}

func TestManifestCache_Get_ReloadsOnMtimeChange(t *testing.T) {
	tmpDir := t.TempDir()
	manifestPath := filepath.Join(tmpDir, "image-slots.json")

	manifest := httpproxy.ImageManifest{
		"pages/home/hero": {CurrentURL: "https://media.gettyimages.com/v1.jpg"},
	}
	data, _ := json.Marshal(manifest)
	_ = os.WriteFile(manifestPath, data, 0600)

	cache := httpproxy.NewManifestCache(manifestPath)

	slot, err := cache.Get("pages/home/hero")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if slot.CurrentURL != "https://media.gettyimages.com/v1.jpg" {
		t.Errorf("expected v1 URL, got: %s", slot.CurrentURL)
	}

	time.Sleep(10 * time.Millisecond)

	manifest["pages/home/hero"] = httpproxy.ImageSlot{CurrentURL: "https://media.gettyimages.com/v2.jpg"}
	data, _ = json.Marshal(manifest)
	_ = os.WriteFile(manifestPath, data, 0600)

	slot, err = cache.Get("pages/home/hero")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if slot.CurrentURL != "https://media.gettyimages.com/v2.jpg" {
		t.Errorf("expected v2 URL after mtime change, got: %s", slot.CurrentURL)
	}
}

func TestHandleImageSlot_Success(t *testing.T) {
	tmpDir := t.TempDir()
	manifestPath := filepath.Join(tmpDir, "image-slots.json")

	manifest := httpproxy.ImageManifest{
		"pages/home/hero": {CurrentURL: "https://media.gettyimages.com/id/abc123/photo.jpg"},
	}
	data, _ := json.Marshal(manifest)
	_ = os.WriteFile(manifestPath, data, 0600)

	cache := httpproxy.NewManifestCache(manifestPath)
	handler := httpproxy.NewImageSlotHandler(cache)

	req := httptest.NewRequest(http.MethodGet, "/airo-assets/images/pages/home/hero", nil)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusFound {
		t.Errorf("expected status 302, got: %d", rec.Code)
	}
	location := rec.Header().Get("Location")
	if location != "https://media.gettyimages.com/id/abc123/photo.jpg" {
		t.Errorf("expected redirect to Getty URL, got: %s", location)
	}
}

func TestHandleImageSlot_NotFound(t *testing.T) {
	tmpDir := t.TempDir()
	manifestPath := filepath.Join(tmpDir, "image-slots.json")

	manifest := httpproxy.ImageManifest{}
	data, _ := json.Marshal(manifest)
	_ = os.WriteFile(manifestPath, data, 0600)

	cache := httpproxy.NewManifestCache(manifestPath)
	handler := httpproxy.NewImageSlotHandler(cache)

	req := httptest.NewRequest(http.MethodGet, "/airo-assets/images/pages/missing/slot", nil)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Errorf("expected status 404, got: %d", rec.Code)
	}

	contentType := rec.Header().Get("Content-Type")
	if !strings.Contains(contentType, "application/json") {
		t.Errorf("expected JSON content type, got: %s", contentType)
	}
}

func TestHandleImageSlot_EmptySlotPath(t *testing.T) {
	tmpDir := t.TempDir()
	manifestPath := filepath.Join(tmpDir, "image-slots.json")
	_ = os.WriteFile(manifestPath, []byte("{}"), 0600)

	cache := httpproxy.NewManifestCache(manifestPath)
	handler := httpproxy.NewImageSlotHandler(cache)

	req := httptest.NewRequest(http.MethodGet, "/airo-assets/images/", nil)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("expected status 400, got: %d", rec.Code)
	}
}

func TestHandleImageSlot_MethodNotAllowed(t *testing.T) {
	tmpDir := t.TempDir()
	manifestPath := filepath.Join(tmpDir, "image-slots.json")
	_ = os.WriteFile(manifestPath, []byte("{}"), 0600)

	cache := httpproxy.NewManifestCache(manifestPath)
	handler := httpproxy.NewImageSlotHandler(cache)

	req := httptest.NewRequest(http.MethodPost, "/airo-assets/images/pages/home/hero", nil)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("expected status 405, got: %d", rec.Code)
	}
}

func TestHandleImageSlot_HeadRequest(t *testing.T) {
	tmpDir := t.TempDir()
	manifestPath := filepath.Join(tmpDir, "image-slots.json")

	manifest := httpproxy.ImageManifest{
		"pages/home/hero": {CurrentURL: "https://media.gettyimages.com/image.jpg"},
	}
	data, _ := json.Marshal(manifest)
	_ = os.WriteFile(manifestPath, data, 0600)

	cache := httpproxy.NewManifestCache(manifestPath)
	handler := httpproxy.NewImageSlotHandler(cache)

	req := httptest.NewRequest(http.MethodHead, "/airo-assets/images/pages/home/hero", nil)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusFound {
		t.Errorf("expected status 302 for HEAD, got: %d", rec.Code)
	}
}

func TestHandleImageSlot_ManifestReadError(t *testing.T) {
	cache := httpproxy.NewManifestCache("/nonexistent/image-slots.json")
	handler := httpproxy.NewImageSlotHandler(cache)

	req := httptest.NewRequest(http.MethodGet, "/airo-assets/images/pages/home/hero", nil)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Errorf("expected status 500, got: %d", rec.Code)
	}
}

func TestHandleImageSlot_InvalidRedirectURL(t *testing.T) {
	tmpDir := t.TempDir()
	manifestPath := filepath.Join(tmpDir, "image-slots.json")

	// Use untrusted domain - should be blocked
	manifest := httpproxy.ImageManifest{
		"pages/home/hero": {CurrentURL: "https://malicious.example.com/image.jpg"},
	}
	data, _ := json.Marshal(manifest)
	_ = os.WriteFile(manifestPath, data, 0600)

	cache := httpproxy.NewManifestCache(manifestPath)
	handler := httpproxy.NewImageSlotHandler(cache)

	req := httptest.NewRequest(http.MethodGet, "/airo-assets/images/pages/home/hero", nil)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Errorf("expected status 500 for untrusted domain, got: %d", rec.Code)
	}
}

func TestHandleImageSlot_MalformedPath(t *testing.T) {
	tmpDir := t.TempDir()
	manifestPath := filepath.Join(tmpDir, "image-slots.json")
	_ = os.WriteFile(manifestPath, []byte("{}"), 0600)

	cache := httpproxy.NewManifestCache(manifestPath)
	handler := httpproxy.NewImageSlotHandler(cache)

	// Path that doesn't match prefix at all - TrimPrefix won't remove anything
	// so slotPath == r.URL.Path, triggering the invalid path check
	req := httptest.NewRequest(http.MethodGet, "/other-path", nil)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	// Should return bad request since TrimPrefix won't remove anything
	if rec.Code != http.StatusBadRequest {
		t.Errorf("expected status 400 for malformed path, got: %d", rec.Code)
	}
}

func TestHandleImageSlot_InvalidScheme(t *testing.T) {
	tmpDir := t.TempDir()
	manifestPath := filepath.Join(tmpDir, "image-slots.json")

	// Use javascript: scheme to test scheme validation
	manifest := httpproxy.ImageManifest{
		"pages/home/hero": {CurrentURL: "javascript:alert('xss')"},
	}
	data, _ := json.Marshal(manifest)
	_ = os.WriteFile(manifestPath, data, 0600)

	cache := httpproxy.NewManifestCache(manifestPath)
	handler := httpproxy.NewImageSlotHandler(cache)

	req := httptest.NewRequest(http.MethodGet, "/airo-assets/images/pages/home/hero", nil)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Errorf("expected status 500 for javascript: scheme, got: %d", rec.Code)
	}
}

func TestHandleImageSlot_DataScheme(t *testing.T) {
	tmpDir := t.TempDir()
	manifestPath := filepath.Join(tmpDir, "image-slots.json")

	// Use data: scheme to test scheme validation
	manifest := httpproxy.ImageManifest{
		"pages/home/hero": {CurrentURL: "data:text/html,<script>alert('xss')</script>"},
	}
	data, _ := json.Marshal(manifest)
	_ = os.WriteFile(manifestPath, data, 0600)

	cache := httpproxy.NewManifestCache(manifestPath)
	handler := httpproxy.NewImageSlotHandler(cache)

	req := httptest.NewRequest(http.MethodGet, "/airo-assets/images/pages/home/hero", nil)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Errorf("expected status 500 for data: scheme, got: %d", rec.Code)
	}
}
