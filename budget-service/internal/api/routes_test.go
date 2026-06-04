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

func TestRouterRejectsPOSTWithoutJSONContentType(t *testing.T) {
	t.Parallel()
	h := NewRouter(&Server{}, auth.NewMiddleware("none", nil, nil))

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/products", strings.NewReader(`{"productKey":"test"}`))
	req.Header.Set("Content-Type", "text/plain")
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnsupportedMediaType {
		t.Fatalf("status %d, body %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "UNSUPPORTED_MEDIA_TYPE") {
		t.Fatalf("expected UNSUPPORTED_MEDIA_TYPE, got %s", rec.Body.String())
	}
}

func TestRouter_BudgetByIdAllMethodsReachable(t *testing.T) {
	t.Parallel()
	h := NewRouter(&Server{}, auth.NewMiddleware("none", nil, nil))

	cases := []struct {
		method   string
		body     string
		wantCode int // 503 SERVICE_UNAVAILABLE because Server.Store is nil
	}{
		{http.MethodGet, "", http.StatusServiceUnavailable},
		{http.MethodPatch, `{"items":[{"budgetItemId":"00000000-0000-0000-0000-000000000000"}]}`, http.StatusServiceUnavailable},
		{http.MethodDelete, "", http.StatusServiceUnavailable},
	}

	for _, tc := range cases {
		t.Run(tc.method, func(t *testing.T) {
			t.Parallel()
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(tc.method, "/api/v1/budgets/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", strings.NewReader(tc.body))
			if tc.body != "" {
				req.Header.Set("Content-Type", "application/json")
			}
			h.ServeHTTP(rec, req)
			if rec.Code != tc.wantCode {
				t.Fatalf("%s: want %d, got %d body=%s", tc.method, tc.wantCode, rec.Code, rec.Body.String())
			}
			// Sanity: not a routing error
			if strings.Contains(rec.Body.String(), `"code":"NOT_FOUND"`) || strings.Contains(rec.Body.String(), `"code":"METHOD_NOT_ALLOWED"`) {
				t.Fatalf("%s: routing error returned: %s", tc.method, rec.Body.String())
			}
		})
	}
}
