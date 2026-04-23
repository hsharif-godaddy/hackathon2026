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

// claimGetter extracts a string claim from token claims (test seam for GDAuth.GetAwsIamArn / GetCommonName).
type claimGetter func(claims *gdauth.TokenClaims) (string, error)

// testableMiddleware is a test-only middleware that accepts an injected tokenParser.
type testableMiddleware struct {
	parser       tokenParser
	ssoHost      string
	authType     string
	allowedRoles []string
	allowedCerts []string
	getArn       claimGetter
	getCN        claimGetter
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

		if tokenType == string(gdauth.AuthTypeAWSIAM) && len(m.allowedRoles) > 0 {
			arn, err := m.getArn(claims)
			if err != nil {
				http.Error(w, `{"error":"forbidden: unable to extract IAM role"}`, http.StatusForbidden)
				return
			}
			if !matchesAllowlist(arn, m.allowedRoles) {
				http.Error(w, `{"error":"forbidden: IAM role not in allowlist"}`, http.StatusForbidden)
				return
			}
		}

		if tokenType == string(gdauth.AuthTypeCERT) && len(m.allowedCerts) > 0 {
			cn, err := m.getCN(claims)
			if err != nil {
				http.Error(w, `{"error":"forbidden: unable to extract cert CommonName"}`, http.StatusForbidden)
				return
			}
			if !matchesAllowlist(cn, m.allowedCerts) {
				http.Error(w, `{"error":"forbidden: cert CommonName not in allowlist"}`, http.StatusForbidden)
				return
			}
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

// --- Role allowlist tests ---

func newIAMMockParser(arn string) *mockGDAuth {
	return &mockGDAuth{
		parseTokenFunc: func(token string, opts *gdauth.AuthOptions) (*gdauth.TokenClaims, error) {
			return gdauth.NewTokenClaims(map[string]any{
				"typ": string(gdauth.AuthTypeAWSIAM),
				"jti": "test-jti",
			}), nil
		},
	}
}

func staticClaimGetter(value string) claimGetter {
	return func(_ *gdauth.TokenClaims) (string, error) { return value, nil }
}

func TestAllowedRoles_MatchExact(t *testing.T) {
	t.Parallel()

	arn := "arn:aws:iam::123456789:role/budget-caller"
	m := &testableMiddleware{
		parser:       newIAMMockParser(arn),
		ssoHost:      "https://sso.test.godaddy.com",
		authType:     "jwt",
		allowedRoles: []string{"arn:aws:iam::123456789:role/budget-caller"},
		getArn:       staticClaimGetter(arn),
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

func TestAllowedRoles_MatchWildcard(t *testing.T) {
	t.Parallel()

	arn := "arn:aws:iam::123456789:role/airo-budget-service"
	m := &testableMiddleware{
		parser:       newIAMMockParser(arn),
		ssoHost:      "https://sso.test.godaddy.com",
		authType:     "jwt",
		allowedRoles: []string{"arn:aws:iam::123456789:role/airo-*"},
		getArn:       staticClaimGetter(arn),
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

func TestAllowedRoles_Denied(t *testing.T) {
	t.Parallel()

	arn := "arn:aws:iam::999999999:role/unknown-service"
	m := &testableMiddleware{
		parser:       newIAMMockParser(arn),
		ssoHost:      "https://sso.test.godaddy.com",
		authType:     "jwt",
		allowedRoles: []string{"arn:aws:iam::123456789:role/airo-*"},
		getArn:       staticClaimGetter(arn),
	}

	handler := m.AuthenticateAWSIAMService(dummyHandler())
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	req.Header.Set("Authorization", "Bearer valid-iam-token")
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Errorf("expected 403, got %d", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "IAM role not in allowlist") {
		t.Errorf("expected allowlist error, got %s", rec.Body.String())
	}
}

func TestAllowedRoles_EmptyList(t *testing.T) {
	t.Parallel()

	m := &testableMiddleware{
		parser:       newIAMMockParser("arn:aws:iam::123:role/anything"),
		ssoHost:      "https://sso.test.godaddy.com",
		authType:     "jwt",
		allowedRoles: nil,
	}

	handler := m.AuthenticateAWSIAMService(dummyHandler())
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	req.Header.Set("Authorization", "Bearer valid-iam-token")
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected 200 (empty allowlist = allow all), got %d; body: %s", rec.Code, rec.Body.String())
	}
}

func TestAllowedRoles_CertTokenSkipped(t *testing.T) {
	t.Parallel()

	m := &testableMiddleware{
		parser: &mockGDAuth{
			parseTokenFunc: func(token string, opts *gdauth.AuthOptions) (*gdauth.TokenClaims, error) {
				return gdauth.NewTokenClaims(map[string]any{
					"typ": string(gdauth.AuthTypeCERT),
					"jti": "test-jti",
				}), nil
			},
		},
		ssoHost:      "https://sso.test.godaddy.com",
		authType:     "jwt",
		allowedRoles: []string{"arn:aws:iam::123456789:role/specific-only"},
	}

	handler := m.AuthenticateAWSIAMService(dummyHandler())
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	req.Header.Set("Authorization", "sso-jwt valid-cert-token")
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected 200 (cert tokens bypass role allowlist), got %d; body: %s", rec.Code, rec.Body.String())
	}
}

func TestMatchesAllowlist(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name     string
		value    string
		patterns []string
		want     bool
	}{
		{"exact match", "arn:aws:iam::123:role/foo", []string{"arn:aws:iam::123:role/foo"}, true},
		{"wildcard match", "arn:aws:iam::123:role/airo-svc", []string{"arn:aws:iam::123:role/airo-*"}, true},
		{"no match", "arn:aws:iam::999:role/bad", []string{"arn:aws:iam::123:role/airo-*"}, false},
		{"multiple patterns", "arn:aws:iam::456:role/other", []string{"arn:aws:iam::123:role/foo", "arn:aws:iam::456:role/other"}, true},
		{"empty patterns", "arn:aws:iam::123:role/foo", nil, false},
		{"empty value", "", []string{"arn:aws:iam::123:role/*"}, false},
		{"wildcard only prefix", "arn:aws:iam::123:role/airo-budget", []string{"arn:aws:iam::123:role/airo-*", "arn:aws:iam::456:role/exact"}, true},
		{"cert cn exact", "service-a.example.com", []string{"service-a.example.com"}, true},
		{"cert cn wildcard", "budget.airo-builder.godaddy.com", []string{"*.airo-builder.godaddy.com"}, false},
		{"cert cn prefix wildcard", "airo-builder.godaddy.com/budget", []string{"airo-builder.godaddy.com/*"}, true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			got := matchesAllowlist(tt.value, tt.patterns)
			if got != tt.want {
				t.Errorf("matchesAllowlist(%q, %v) = %v, want %v", tt.value, tt.patterns, got, tt.want)
			}
		})
	}
}

// --- Cert allowlist tests ---

func newCertMockParser() *mockGDAuth {
	return &mockGDAuth{
		parseTokenFunc: func(token string, opts *gdauth.AuthOptions) (*gdauth.TokenClaims, error) {
			return gdauth.NewTokenClaims(map[string]any{
				"typ": string(gdauth.AuthTypeCERT),
				"jti": "test-jti",
			}), nil
		},
	}
}

func TestAllowedCerts_MatchExact(t *testing.T) {
	t.Parallel()

	cn := "service-a.airo-builder.godaddy.com"
	m := &testableMiddleware{
		parser:       newCertMockParser(),
		ssoHost:      "https://sso.test.godaddy.com",
		authType:     "jwt",
		allowedCerts: []string{"service-a.airo-builder.godaddy.com"},
		getCN:        staticClaimGetter(cn),
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

func TestAllowedCerts_MatchWildcard(t *testing.T) {
	t.Parallel()

	cn := "airo-builder.godaddy.com/budget-service"
	m := &testableMiddleware{
		parser:       newCertMockParser(),
		ssoHost:      "https://sso.test.godaddy.com",
		authType:     "jwt",
		allowedCerts: []string{"airo-builder.godaddy.com/*"},
		getCN:        staticClaimGetter(cn),
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

func TestAllowedCerts_Denied(t *testing.T) {
	t.Parallel()

	cn := "unknown-service.example.com"
	m := &testableMiddleware{
		parser:       newCertMockParser(),
		ssoHost:      "https://sso.test.godaddy.com",
		authType:     "jwt",
		allowedCerts: []string{"service-a.airo-builder.godaddy.com"},
		getCN:        staticClaimGetter(cn),
	}

	handler := m.AuthenticateAWSIAMService(dummyHandler())
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	req.Header.Set("Authorization", "sso-jwt valid-cert-token")
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Errorf("expected 403, got %d", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "cert CommonName not in allowlist") {
		t.Errorf("expected cert allowlist error, got %s", rec.Body.String())
	}
}

func TestAllowedCerts_EmptyList(t *testing.T) {
	t.Parallel()

	m := &testableMiddleware{
		parser:       newCertMockParser(),
		ssoHost:      "https://sso.test.godaddy.com",
		authType:     "jwt",
		allowedCerts: nil,
	}

	handler := m.AuthenticateAWSIAMService(dummyHandler())
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	req.Header.Set("Authorization", "sso-jwt valid-cert-token")
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected 200 (empty allowlist = allow all), got %d; body: %s", rec.Code, rec.Body.String())
	}
}

func TestAllowedCerts_IAMTokenSkipped(t *testing.T) {
	t.Parallel()

	m := &testableMiddleware{
		parser:       newIAMMockParser("arn:aws:iam::123:role/anything"),
		ssoHost:      "https://sso.test.godaddy.com",
		authType:     "jwt",
		allowedCerts: []string{"specific-cert-only.godaddy.com"},
	}

	handler := m.AuthenticateAWSIAMService(dummyHandler())
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	req.Header.Set("Authorization", "Bearer valid-iam-token")
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected 200 (IAM tokens bypass cert allowlist), got %d; body: %s", rec.Code, rec.Body.String())
	}
}
