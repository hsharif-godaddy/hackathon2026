package httpproxy //nolint:testpackage // tests access the unexported handleStorageAccess

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestStorageAccess_GET_ServesBootstrapHTML(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/airo/storage-access?redirect=%2F%3FairoShareToken%3Dabc", nil)
	rec := httptest.NewRecorder()

	handleStorageAccess(rec, req)

	res := rec.Result()
	defer res.Body.Close()

	if res.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", res.StatusCode)
	}
	if ct := res.Header.Get("Content-Type"); !strings.HasPrefix(ct, "text/html") {
		t.Fatalf("expected text/html content-type, got %q", ct)
	}
	if cc := res.Header.Get("Cache-Control"); !strings.Contains(cc, "no-store") {
		t.Errorf("expected no-store cache-control, got %q", cc)
	}

	body, _ := io.ReadAll(res.Body)
	html := string(body)

	// Must drive the Storage Access flow.
	for _, want := range []string{"requestStorageAccess", "hasStorageAccess", "Enable preview"} {
		if !strings.Contains(html, want) {
			t.Errorf("bootstrap HTML missing %q", want)
		}
	}

	// Must be fully self-contained: no external scripts/styles/links, since any
	// sub-resource would itself 307 in the cookie-blocked state this page exists
	// to fix. (Inline <style>/<script> are fine; src=/href-to-asset are not.)
	for _, forbidden := range []string{"<script src", "<link ", "src=\"http", "src=\"/"} {
		if strings.Contains(html, forbidden) {
			t.Errorf("bootstrap HTML must not reference external resource (found %q)", forbidden)
		}
	}
}

func TestStorageAccess_HEAD_NoBody(t *testing.T) {
	req := httptest.NewRequest(http.MethodHead, "/airo/storage-access", nil)
	rec := httptest.NewRecorder()

	handleStorageAccess(rec, req)

	res := rec.Result()
	defer res.Body.Close()

	if res.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 for HEAD, got %d", res.StatusCode)
	}
	body, _ := io.ReadAll(res.Body)
	if len(body) != 0 {
		t.Errorf("expected empty body for HEAD, got %d bytes", len(body))
	}
}

func TestStorageAccess_POST_MethodNotAllowed(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/airo/storage-access", nil)
	rec := httptest.NewRecorder()

	handleStorageAccess(rec, req)

	if rec.Result().StatusCode != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405 for POST, got %d", rec.Result().StatusCode)
	}
}
