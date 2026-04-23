package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gdcorp-partners/airo-app-builder/budget-service/internal/auth"
)

func TestRouterNotFoundReturnsJSONEnvelope(t *testing.T) {
	t.Parallel()
	h := NewRouter(&Server{}, auth.NewMiddleware("none", nil, nil))

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/not-a-route", nil)
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status %d, body %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"code":"NOT_FOUND"`) {
		t.Fatalf("expected NOT_FOUND code, got %s", rec.Body.String())
	}
}

func TestRouterMethodNotAllowedReturnsJSONEnvelope(t *testing.T) {
	t.Parallel()
	h := NewRouter(&Server{}, auth.NewMiddleware("none", nil, nil))

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/health", nil)
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status %d, body %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"code":"METHOD_NOT_ALLOWED"`) {
		t.Fatalf("expected METHOD_NOT_ALLOWED code, got %s", rec.Body.String())
	}
}

func TestRouterOpenAPIPublic(t *testing.T) {
	t.Parallel()
	h := NewRouter(&Server{}, auth.NewMiddleware("none", nil, nil))

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/openapi.yaml", nil)
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("GET /openapi.yaml status %d", rec.Code)
	}
	if !strings.HasPrefix(rec.Body.String(), "openapi:") {
		t.Fatalf("expected OpenAPI yaml prefix")
	}
}
