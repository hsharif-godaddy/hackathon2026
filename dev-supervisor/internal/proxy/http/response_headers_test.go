//nolint:testpackage // Tests use unexported constants.
package httpproxy

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestResponseHeadersMiddleware(t *testing.T) {
	t.Run("injects X-Product-Id header", func(t *testing.T) {
		inner := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusOK)
		})

		handler := responseHeadersMiddleware(inner)
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		rec := httptest.NewRecorder()

		handler.ServeHTTP(rec, req)

		got := rec.Header().Get(productIDHeader) //nolint:canonicalheader,nolintlint // intentional GD casing
		if got == "" {
			t.Fatal("X-Product-Id header is missing")
		}
		// Without a valid config.json, should fall back to defaultProductID
		if got != defaultProductID {
			t.Errorf("X-Product-Id = %q, want %q", got, defaultProductID)
		}
	})

	t.Run("header present on error responses", func(t *testing.T) {
		inner := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			http.Error(w, "internal error", http.StatusInternalServerError)
		})

		handler := responseHeadersMiddleware(inner)
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		rec := httptest.NewRecorder()

		handler.ServeHTTP(rec, req)

		got := rec.Header().Get(productIDHeader) //nolint:canonicalheader,nolintlint // intentional GD casing
		if got == "" {
			t.Fatal("X-Product-Id header missing on error response")
		}
	})

	t.Run("does not overwrite inner handler headers", func(t *testing.T) {
		inner := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("X-Custom", "value")
			w.WriteHeader(http.StatusOK)
		})

		handler := responseHeadersMiddleware(inner)
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		rec := httptest.NewRecorder()

		handler.ServeHTTP(rec, req)

		if rec.Header().Get("X-Custom") != "value" {
			t.Error("inner handler header X-Custom was lost")
		}
		if rec.Header().Get(productIDHeader) == "" { //nolint:canonicalheader,nolintlint // intentional GD casing
			t.Error("X-Product-Id header is missing")
		}
	})
}
