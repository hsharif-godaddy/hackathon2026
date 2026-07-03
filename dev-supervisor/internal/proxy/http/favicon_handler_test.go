package httpproxy_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	httpproxy "github.com/airo-ai-builder/dev-supervisor/internal/proxy/http"
)

var testAllowedHosts = map[string]struct{}{
	"isteam.wsimg.com": {},
}

func TestFaviconHandler_RedirectsWhenSlotExists(t *testing.T) {
	tmpDir := t.TempDir()
	manifestPath := filepath.Join(tmpDir, "airo-media.json")

	manifest := map[string]httpproxy.ImageSlot{
		"logo/favicon": {
			CurrentURL: "https://isteam.wsimg.com/favicon-abc.png",
			MediaType:  "logo",
		},
	}
	data, _ := json.Marshal(manifest)
	os.WriteFile(manifestPath, data, 0644)

	cache := httpproxy.NewManifestCache(manifestPath)
	fallback := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	})

	handler := httpproxy.NewFaviconHandler(cache, testAllowedHosts, fallback)

	req := httptest.NewRequest(http.MethodGet, "/favicon.ico", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusFound {
		t.Errorf("expected 302 redirect, got: %d", rec.Code)
	}
	location := rec.Header().Get("Location")
	if location != "https://isteam.wsimg.com/favicon-abc.png" {
		t.Errorf("expected redirect to CDN, got: %s", location)
	}
}

func TestFaviconHandler_FallsThrough_NoSlot(t *testing.T) {
	tmpDir := t.TempDir()
	manifestPath := filepath.Join(tmpDir, "airo-media.json")

	manifest := map[string]httpproxy.ImageSlot{
		"logo/primary": {
			CurrentURL: "https://isteam.wsimg.com/logo.png",
			MediaType:  "logo",
		},
	}
	data, _ := json.Marshal(manifest)
	os.WriteFile(manifestPath, data, 0644)

	cache := httpproxy.NewManifestCache(manifestPath)
	fallbackCalled := false
	fallback := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		fallbackCalled = true
		w.WriteHeader(http.StatusOK)
	})

	handler := httpproxy.NewFaviconHandler(cache, testAllowedHosts, fallback)

	req := httptest.NewRequest(http.MethodGet, "/favicon.ico", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if !fallbackCalled {
		t.Error("expected fallback to be called when no favicon slot")
	}
}

func TestFaviconHandler_FallsThrough_NoManifest(t *testing.T) {
	tmpDir := t.TempDir()
	manifestPath := filepath.Join(tmpDir, "airo-media.json")

	cache := httpproxy.NewManifestCache(manifestPath)
	fallbackCalled := false
	fallback := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		fallbackCalled = true
		w.WriteHeader(http.StatusOK)
	})

	handler := httpproxy.NewFaviconHandler(cache, testAllowedHosts, fallback)

	req := httptest.NewRequest(http.MethodGet, "/favicon.ico", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if !fallbackCalled {
		t.Error("expected fallback when manifest missing")
	}
}

func TestFaviconHandler_FallsThrough_UntrustedHost(t *testing.T) {
	tmpDir := t.TempDir()
	manifestPath := filepath.Join(tmpDir, "airo-media.json")

	manifest := map[string]httpproxy.ImageSlot{
		"logo/favicon": {
			CurrentURL: "https://evil.com/favicon.png",
			MediaType:  "logo",
		},
	}
	data, _ := json.Marshal(manifest)
	os.WriteFile(manifestPath, data, 0644)

	cache := httpproxy.NewManifestCache(manifestPath)
	fallbackCalled := false
	fallback := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		fallbackCalled = true
		w.WriteHeader(http.StatusOK)
	})

	handler := httpproxy.NewFaviconHandler(cache, testAllowedHosts, fallback)

	req := httptest.NewRequest(http.MethodGet, "/favicon.ico", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if !fallbackCalled {
		t.Error("expected fallback for untrusted host")
	}
}

func TestFaviconHandler_FallsThrough_LocalPath(t *testing.T) {
	tmpDir := t.TempDir()
	manifestPath := filepath.Join(tmpDir, "airo-media.json")

	manifest := map[string]httpproxy.ImageSlot{
		"logo/favicon": {
			CurrentURL: "/airo-assets/uploads/favicon.png",
			MediaType:  "logo",
		},
	}
	data, _ := json.Marshal(manifest)
	os.WriteFile(manifestPath, data, 0644)

	cache := httpproxy.NewManifestCache(manifestPath)
	fallbackCalled := false
	fallback := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		fallbackCalled = true
		w.WriteHeader(http.StatusOK)
	})

	handler := httpproxy.NewFaviconHandler(cache, testAllowedHosts, fallback)

	req := httptest.NewRequest(http.MethodGet, "/favicon.ico", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if !fallbackCalled {
		t.Error("expected fallback for local path (let Vite serve it)")
	}
}
