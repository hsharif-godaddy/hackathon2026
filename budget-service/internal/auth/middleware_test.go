package auth

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	gdauth "github.com/gdcorp-identity/gd-auth-lib/go/gd_auth_lib"
)

// mockGDAuth implements minimal GDAuth behavior for testing.
type mockGDAuth struct {
	parseTokenFunc func(token string, opts *gdauth.AuthOptions) (*gdauth.TokenClaims, error)
}

func (m *mockGDAuth) ParseToken(token string, opts *gdauth.AuthOptions) (*gdauth.TokenClaims, error) {
	return m.parseTokenFunc(token, opts)
}

// tokenParser interface matches the ParseToken method signature.
type tokenParser interface {
	ParseToken(token string, opts *gdauth.AuthOptions) (*gdauth.TokenClaims, error)
}

// testableMiddleware is a test-only middleware that accepts an injected tokenParser.
type testableMiddleware struct {
	parser   tokenParser
	ssoHost  string
	authType string
}

func (m *testableMiddleware) AuthenticateAWSIAMService(next http.Handler) http.Handler {
	if m.authType == "none" {
		return next
	}

	if m.parser == nil {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			http.Error(w, `{"error":"auth misconfigured"}`, http.StatusUnauthorized)
		})
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token := extractToken(r)
		if token == "" {
			http.Error(w, `{"error":"missing authorization token"}`, http.StatusUnauthorized)
			return
		}

		authOptions := &gdauth.AuthOptions{
			GoDaddySSO: &gdauth.GoDaddySSOConfig{
				Host:             m.ssoHost,
				SecurityLevel:    gdauth.SecurityLevelLow,
				Auths:            []gdauth.Auths{gdauth.AuthsBasic, gdauth.AuthsCert2S},
				FilterByAuthType: false,
				AllowHeartbeat:   false,
			},
		}

		claims, err := m.parser.ParseToken(token, authOptions)
		if err != nil {
			http.Error(w, `{"error":"invalid token"}`, http.StatusUnauthorized)
			return
		}

		tokenType := claims.GetType()
		if tokenType != string(gdauth.AuthTypeAWSIAM) && tokenType != string(gdauth.AuthTypeCERT) {
			http.Error(w, `{"error":"unauthorized token type"}`, http.StatusUnauthorized)
			return
		}

		ctx := context.WithValue(r.Context(), ClaimsKey, claims)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// dummyHandler returns 200 OK for successful auth.
func dummyHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"status":"ok"}`))
	})
}

func TestAuthenticateAWSIAMService_MissingToken(t *testing.T) {
	t.Parallel()

	m := &testableMiddleware{
		parser:   &mockGDAuth{},
		ssoHost:  "https://sso.test.godaddy.com",
		authType: "jwt",
	}

	handler := m.AuthenticateAWSIAMService(dummyHandler())
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/test", nil)

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "missing authorization token") {
		t.Errorf("expected 'missing authorization token' error, got %s", rec.Body.String())
	}
}

func TestAuthenticateAWSIAMService_ValidIAMToken(t *testing.T) {
	t.Parallel()

	mockParser := &mockGDAuth{
		parseTokenFunc: func(token string, opts *gdauth.AuthOptions) (*gdauth.TokenClaims, error) {
			// Create claims with typ=awsiam
			claims := gdauth.NewTokenClaims(map[string]any{
				"typ": string(gdauth.AuthTypeAWSIAM),
				"jti": "test-jti-123",
			})
			return claims, nil
		},
	}

	m := &testableMiddleware{
		parser:   mockParser,
		ssoHost:  "https://sso.test.godaddy.com",
		authType: "jwt",
	}

	handler := m.AuthenticateAWSIAMService(dummyHandler())
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	req.Header.Set("Authorization", "Bearer valid-iam-token")

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected 200, got %d; body: %s", rec.Code, rec.Body.String())
	}
}

func TestAuthenticateAWSIAMService_ValidCertToken(t *testing.T) {
	t.Parallel()

	mockParser := &mockGDAuth{
		parseTokenFunc: func(token string, opts *gdauth.AuthOptions) (*gdauth.TokenClaims, error) {
			// Create claims with typ=cert
			claims := gdauth.NewTokenClaims(map[string]any{
				"typ": string(gdauth.AuthTypeCERT),
				"jti": "test-jti-456",
			})
			return claims, nil
		},
	}

	m := &testableMiddleware{
		parser:   mockParser,
		ssoHost:  "https://sso.test.godaddy.com",
		authType: "jwt",
	}

	handler := m.AuthenticateAWSIAMService(dummyHandler())
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	req.Header.Set("Authorization", "sso-jwt valid-cert-token")

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected 200, got %d; body: %s", rec.Code, rec.Body.String())
	}
}

func TestAuthenticateAWSIAMService_WrongTokenType(t *testing.T) {
	t.Parallel()

	mockParser := &mockGDAuth{
		parseTokenFunc: func(token string, opts *gdauth.AuthOptions) (*gdauth.TokenClaims, error) {
			// Create claims with wrong type (jomax - employee token)
			claims := gdauth.NewTokenClaims(map[string]any{
				"typ": string(gdauth.AuthTypeJOMAX),
				"jti": "test-jti-789",
			})
			return claims, nil
		},
	}

	m := &testableMiddleware{
		parser:   mockParser,
		ssoHost:  "https://sso.test.godaddy.com",
		authType: "jwt",
	}

	handler := m.AuthenticateAWSIAMService(dummyHandler())
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	req.Header.Set("Authorization", "Bearer wrong-type-token")

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "unauthorized token type") {
		t.Errorf("expected 'unauthorized token type' error, got %s", rec.Body.String())
	}
}

func TestAuthenticateAWSIAMService_MisconfiguredClient(t *testing.T) {
	t.Parallel()

	m := &testableMiddleware{
		parser:   nil, // Simulates misconfigured client
		ssoHost:  "https://sso.test.godaddy.com",
		authType: "jwt",
	}

	handler := m.AuthenticateAWSIAMService(dummyHandler())
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	req.Header.Set("Authorization", "Bearer some-token")

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "auth misconfigured") {
		t.Errorf("expected 'auth misconfigured' error, got %s", rec.Body.String())
	}
}

func TestAuthenticateAWSIAMService_InvalidToken(t *testing.T) {
	t.Parallel()

	mockParser := &mockGDAuth{
		parseTokenFunc: func(token string, opts *gdauth.AuthOptions) (*gdauth.TokenClaims, error) {
			return nil, errors.New("token validation failed")
		},
	}

	m := &testableMiddleware{
		parser:   mockParser,
		ssoHost:  "https://sso.test.godaddy.com",
		authType: "jwt",
	}

	handler := m.AuthenticateAWSIAMService(dummyHandler())
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	req.Header.Set("Authorization", "Bearer invalid-token")

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "invalid token") {
		t.Errorf("expected 'invalid token' error, got %s", rec.Body.String())
	}
}

func TestAuthenticateAWSIAMService_AuthDisabled(t *testing.T) {
	t.Parallel()

	m := &testableMiddleware{
		parser:   nil, // No parser needed when auth is disabled
		authType: "none",
	}

	handler := m.AuthenticateAWSIAMService(dummyHandler())
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	// No Authorization header

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected 200 (auth disabled should pass through), got %d", rec.Code)
	}
}

func TestExtractToken_BearerPrefix(t *testing.T) {
	t.Parallel()

	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	req.Header.Set("Authorization", "Bearer my-token-123")

	token := extractToken(req)
	if token != "my-token-123" {
		t.Errorf("expected 'my-token-123', got '%s'", token)
	}
}

func TestExtractToken_SsoJwtPrefix(t *testing.T) {
	t.Parallel()

	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	req.Header.Set("Authorization", "sso-jwt my-token-456")

	token := extractToken(req)
	if token != "my-token-456" {
		t.Errorf("expected 'my-token-456', got '%s'", token)
	}
}

func TestExtractToken_NoHeader(t *testing.T) {
	t.Parallel()

	req := httptest.NewRequest(http.MethodGet, "/test", nil)

	token := extractToken(req)
	if token != "" {
		t.Errorf("expected empty string, got '%s'", token)
	}
}

func TestExtractToken_UnsupportedPrefix(t *testing.T) {
	t.Parallel()

	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	req.Header.Set("Authorization", "Basic dXNlcjpwYXNz")

	token := extractToken(req)
	if token != "" {
		t.Errorf("expected empty string for unsupported prefix, got '%s'", token)
	}
}

func TestGetClaims_WithClaims(t *testing.T) {
	t.Parallel()

	claims := gdauth.NewTokenClaims(map[string]any{
		"typ": string(gdauth.AuthTypeAWSIAM),
		"jti": "test-jti",
	})

	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	ctx := context.WithValue(req.Context(), ClaimsKey, claims)
	req = req.WithContext(ctx)

	retrieved := GetClaims(req)
	if retrieved == nil {
		t.Fatal("expected claims, got nil")
	}
	if retrieved.GetType() != string(gdauth.AuthTypeAWSIAM) {
		t.Errorf("expected type '%s', got '%s'", gdauth.AuthTypeAWSIAM, retrieved.GetType())
	}
}

func TestGetClaims_NoClaims(t *testing.T) {
	t.Parallel()

	req := httptest.NewRequest(http.MethodGet, "/test", nil)

	retrieved := GetClaims(req)
	if retrieved != nil {
		t.Errorf("expected nil, got %+v", retrieved)
	}
}
