package api

import (
	"net/http"
	"net/http/httptest"
	"testing"

	goauth "github.com/gdcorp-partners/airo-app-builder/packages/go-auth"
)

// newTestRouterServer returns a *Server populated for router-level tests.
// authType "none" bypasses gd-auth so handler-behavior tests don't need to
// mint real SSO tokens. Pass "jwt" to exercise the real auth path.
func newTestRouterServer(env, version, authType string) *Server {
	return &Server{
		Environment: env,
		Version:     version,
		Auth:        goauth.NewMiddleware(authType, "sso.dev-godaddy.com"),
	}
}

func TestPostSandboxesRequiresAuth(t *testing.T) {
	srv := newTestRouterServer("dev", "0.0.0", "jwt")
	h := NewRouter(srv)

	req := httptest.NewRequest(http.MethodPost, "/v1/sandboxes", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status: want 401 with no Authorization header, got %d (body=%q)", rec.Code, rec.Body.String())
	}
}

func TestPostSandboxesStubReturns501WhenAuthBypassed(t *testing.T) {
	srv := newTestRouterServer("dev", "0.0.0", "none")
	h := NewRouter(srv)

	req := httptest.NewRequest(http.MethodPost, "/v1/sandboxes", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotImplemented {
		t.Fatalf("status: want 501 with auth bypassed, got %d (body=%q)", rec.Code, rec.Body.String())
	}
}

func TestHealthUnauthenticatedEvenWhenJwtEnforced(t *testing.T) {
	srv := newTestRouterServer("dev", "0.0.0", "jwt")
	h := NewRouter(srv)

	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("/health should be public; got %d", rec.Code)
	}
}
