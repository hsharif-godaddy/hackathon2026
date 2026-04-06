package goauth_test

import (
	"net/http"
	"net/http/httptest"
	"testing"

	goauth "github.com/gdcorp-partners/airo-app-builder/packages/go-auth"
)

func okHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
}

// none mode must always pass through, no token needed
func TestAuthenticate_NoneMode_Passthrough(t *testing.T) {
	m := goauth.NewMiddleware("none", "")
	handler := m.Authenticate(okHandler())

	req := httptest.NewRequest(http.MethodGet, "/api/v1/search", nil)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rr.Code)
	}
}

// missing token must return 401
func TestAuthenticate_MissingToken_Returns401(t *testing.T) {
	m := goauth.NewMiddleware("jwt", "sso.dev-godaddy.com")
	handler := m.Authenticate(okHandler())

	req := httptest.NewRequest(http.MethodGet, "/api/v1/search", nil)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rr.Code)
	}
}

// malformed token must return 401
func TestAuthenticate_InvalidToken_Returns401(t *testing.T) {
	m := goauth.NewMiddleware("jwt", "sso.dev-godaddy.com")
	handler := m.Authenticate(okHandler())

	req := httptest.NewRequest(http.MethodGet, "/api/v1/search", nil)
	req.Header.Set("Authorization", "sso-jwt notavalidtoken")
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rr.Code)
	}
}

// none mode on AuthenticateWithKind must pass through
func TestAuthenticateWithKind_NoneMode_Passthrough(t *testing.T) {
	m := goauth.NewMiddleware("none", "")
	handler := m.AuthenticateWithKind("awsiam")(okHandler())

	req := httptest.NewRequest(http.MethodPost, "/api/v1/ingest", nil)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rr.Code)
	}
}

// missing token on AuthenticateWithKind must return 401
func TestAuthenticateWithKind_MissingToken_Returns401(t *testing.T) {
	m := goauth.NewMiddleware("jwt", "sso.dev-godaddy.com")
	handler := m.AuthenticateWithKind("awsiam")(okHandler())

	req := httptest.NewRequest(http.MethodPost, "/api/v1/ingest", nil)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rr.Code)
	}
}

func TestAuthenticateCert_NoneMode_Passthrough(t *testing.T) {
	m := goauth.NewMiddleware("none", "")
	handler := m.AuthenticateCert(okHandler())

	req := httptest.NewRequest(http.MethodGet, "/api/v1/cert-auth-check", nil)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rr.Code)
	}
}

func TestAuthenticateCert_MissingToken_Returns401(t *testing.T) {
	m := goauth.NewMiddleware("jwt", "sso.dev-godaddy.com")
	handler := m.AuthenticateCert(okHandler())

	req := httptest.NewRequest(http.MethodGet, "/api/v1/cert-auth-check", nil)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rr.Code)
	}
}
