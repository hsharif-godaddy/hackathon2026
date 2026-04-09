package openapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gorilla/mux"
)

func TestOpenAPISpecAndSwaggerUI(t *testing.T) {
	t.Parallel()
	r := mux.NewRouter()
	Mount(r)

	t.Run("openapi_yaml", func(t *testing.T) {
		t.Parallel()
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/openapi.yaml", nil)
		r.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("GET /openapi.yaml status %d", rec.Code)
		}
		if ct := rec.Header().Get("Content-Type"); !strings.Contains(ct, "yaml") {
			t.Fatalf("Content-Type %q", ct)
		}
		if len(rec.Body.Bytes()) == 0 {
			t.Fatal("empty body")
		}
		body := rec.Body.String()
		if !strings.HasPrefix(body, "openapi:") {
			t.Fatalf("expected yaml prefix, got %q", body[:min(20, len(body))])
		}
	})

	t.Run("openapi_yaml_head", func(t *testing.T) {
		t.Parallel()
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodHead, "/openapi.yaml", nil)
		r.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("HEAD /openapi.yaml status %d", rec.Code)
		}
		if rec.Body.Len() != 0 {
			t.Fatal("HEAD should have no body")
		}
	})

	t.Run("swagger_redirect", func(t *testing.T) {
		t.Parallel()
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/swagger", nil)
		r.ServeHTTP(rec, req)
		if rec.Code != http.StatusMovedPermanently {
			t.Fatalf("status %d", rec.Code)
		}
		loc := rec.Header().Get("Location")
		if loc != "/swagger/" {
			t.Fatalf("Location %q", loc)
		}
	})

	t.Run("swagger_index", func(t *testing.T) {
		t.Parallel()
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/swagger/", nil)
		r.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("GET /swagger/ status %d body %s", rec.Code, rec.Body.String())
		}
		if ct := rec.Header().Get("Content-Type"); !strings.Contains(ct, "text/html") {
			t.Fatalf("Content-Type %q", ct)
		}
		body := rec.Body.String()
		if !strings.Contains(body, `<div id="swagger-ui">`) {
			t.Fatal(`expected index HTML to contain <div id="swagger-ui">`)
		}
		if !strings.Contains(body, `swagger-ui-bundle.js`) {
			t.Fatal(`expected index HTML to reference swagger-ui-bundle.js`)
		}
		if !strings.Contains(body, "SwaggerUIBundle") || !strings.Contains(body, "<!DOCTYPE html") {
			t.Fatalf("expected Swagger UI bootstrap, got %q", body[:min(200, len(body))])
		}
	})

	t.Run("swagger_assets", func(t *testing.T) {
		t.Parallel()
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/swagger/swagger-ui.css", nil)
		r.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("GET /swagger/swagger-ui.css status %d", rec.Code)
		}
		if ct := rec.Header().Get("Content-Type"); !strings.Contains(ct, "text/css") {
			t.Fatalf("GET /swagger/swagger-ui.css Content-Type %q", ct)
		}

		rec = httptest.NewRecorder()
		req = httptest.NewRequest(http.MethodGet, "/swagger/swagger-ui-bundle.js", nil)
		r.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("GET /swagger/swagger-ui-bundle.js status %d", rec.Code)
		}
		if ct := rec.Header().Get("Content-Type"); !strings.Contains(ct, "javascript") {
			t.Fatalf("GET /swagger/swagger-ui-bundle.js Content-Type %q", ct)
		}
	})
}
