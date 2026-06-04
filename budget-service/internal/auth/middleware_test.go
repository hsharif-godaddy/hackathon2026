package auth

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	gdauth "github.com/gdcorp-identity/gd-auth-lib/go/gd_auth_lib"
	"github.com/gorilla/mux"
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
			writeAuthError(w, http.StatusUnauthorized, "AUTH_MISCONFIGURED", "auth misconfigured")
		})
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token := extractToken(r)
		if token == "" {
			writeAuthError(w, http.StatusUnauthorized, "MISSING_AUTHORIZATION", "missing authorization token")
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
			writeAuthError(w, http.StatusUnauthorized, "INVALID_TOKEN", "invalid token")
			return
		}

		tokenType := claims.GetType()
		if tokenType != string(gdauth.AuthTypeAWSIAM) && tokenType != string(gdauth.AuthTypeCERT) {
			writeAuthError(w, http.StatusUnauthorized, "UNAUTHORIZED_TOKEN_TYPE", "unauthorized token type")
			return
		}

		if tokenType == string(gdauth.AuthTypeAWSIAM) {
			if len(m.allowedRoles) == 0 {
				writeAuthError(w, http.StatusForbidden, "IAM_ALLOWLIST_NOT_CONFIGURED", "forbidden: IAM role allowlist not configured")
				return
			}
			arn, err := m.getArn(claims)
			if err != nil {
				writeAuthError(w, http.StatusForbidden, "IAM_ROLE_EXTRACT_FAILED", "forbidden: unable to extract IAM role")
				return
			}
			if !matchesAllowlist(arn, m.allowedRoles) {
				writeAuthError(w, http.StatusForbidden, "IAM_ROLE_DENIED", "forbidden: IAM role not in allowlist")
				return
			}
		}

		if tokenType == string(gdauth.AuthTypeCERT) {
			if len(m.allowedCerts) == 0 {
				writeAuthError(w, http.StatusForbidden, "CERT_ALLOWLIST_NOT_CONFIGURED", "forbidden: cert allowlist not configured")
				return
			}
			cn, err := m.getCN(claims)
			if err != nil {
				writeAuthError(w, http.StatusForbidden, "CERT_CN_EXTRACT_FAILED", "forbidden: unable to extract cert CommonName")
				return
			}
			if !matchesAllowlist(cn, m.allowedCerts) {
				writeAuthError(w, http.StatusForbidden, "CERT_CN_DENIED", "forbidden: cert CommonName not in allowlist")
				return
			}
		}

		ctx := context.WithValue(r.Context(), ClaimsKey, claims)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func (m *testableMiddleware) AuthenticateShopperOrService(next http.Handler) http.Handler {
	if m.authType == "none" {
		return next
	}

	if m.parser == nil {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			writeAuthError(w, http.StatusUnauthorized, "AUTH_MISCONFIGURED", "auth misconfigured")
		})
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token, _ := extractTokenWithCookie(r)
		if token == "" {
			writeAuthError(w, http.StatusUnauthorized, "MISSING_AUTHORIZATION", "missing authorization token")
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
			writeAuthError(w, http.StatusUnauthorized, "INVALID_TOKEN", "invalid token")
			return
		}

		switch claims.GetType() {
		case string(gdauth.AuthTypeAWSIAM):
			if len(m.allowedRoles) == 0 {
				writeAuthError(w, http.StatusForbidden, "IAM_ALLOWLIST_NOT_CONFIGURED", "forbidden: IAM role allowlist not configured")
				return
			}
			arn, err := m.getArn(claims)
			if err != nil {
				writeAuthError(w, http.StatusForbidden, "IAM_ROLE_EXTRACT_FAILED", "forbidden: unable to extract IAM role")
				return
			}
			if !matchesAllowlist(arn, m.allowedRoles) {
				writeAuthError(w, http.StatusForbidden, "IAM_ROLE_DENIED", "forbidden: IAM role not in allowlist")
				return
			}
		case string(gdauth.AuthTypeCERT):
			if len(m.allowedCerts) == 0 {
				writeAuthError(w, http.StatusForbidden, "CERT_ALLOWLIST_NOT_CONFIGURED", "forbidden: cert allowlist not configured")
				return
			}
			cn, err := m.getCN(claims)
			if err != nil {
				writeAuthError(w, http.StatusForbidden, "CERT_CN_EXTRACT_FAILED", "forbidden: unable to extract cert CommonName")
				return
			}
			if !matchesAllowlist(cn, m.allowedCerts) {
				writeAuthError(w, http.StatusForbidden, "CERT_CN_DENIED", "forbidden: cert CommonName not in allowlist")
				return
			}
		case string(gdauth.AuthTypeIDP):
			// shopper — no allowlist; proceed
		default:
			writeAuthError(w, http.StatusUnauthorized, "UNAUTHORIZED_TOKEN_TYPE", "unauthorized token type")
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

	arn := "arn:aws:iam::123456789:role/airo-budget"
	mockParser := &mockGDAuth{
		parseTokenFunc: func(token string, opts *gdauth.AuthOptions) (*gdauth.TokenClaims, error) {
			claims := gdauth.NewTokenClaims(map[string]any{
				"typ": string(gdauth.AuthTypeAWSIAM),
				"jti": "test-jti-123",
			})
			return claims, nil
		},
	}

	m := &testableMiddleware{
		parser:       mockParser,
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

func TestAuthenticateAWSIAMService_ValidCertToken(t *testing.T) {
	t.Parallel()

	cn := "service-a.airo-builder.godaddy.com"
	mockParser := &mockGDAuth{
		parseTokenFunc: func(token string, opts *gdauth.AuthOptions) (*gdauth.TokenClaims, error) {
			claims := gdauth.NewTokenClaims(map[string]any{
				"typ": string(gdauth.AuthTypeCERT),
				"jti": "test-jti-456",
			})
			return claims, nil
		},
	}

	m := &testableMiddleware{
		parser:       mockParser,
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

// --- AuthenticateShopperOrService tests ---

func newShopperMockParser() *mockGDAuth {
	return &mockGDAuth{
		parseTokenFunc: func(token string, opts *gdauth.AuthOptions) (*gdauth.TokenClaims, error) {
			return gdauth.NewTokenClaims(map[string]any{
				"typ": string(gdauth.AuthTypeIDP),
				"jti": "test-shopper-jti",
			}), nil
		},
	}
}

func TestAuthenticateShopperOrService_ValidShopperToken(t *testing.T) {
	t.Parallel()

	m := &testableMiddleware{
		parser:   newShopperMockParser(),
		ssoHost:  "https://sso.test.godaddy.com",
		authType: "jwt",
	}

	handler := m.AuthenticateShopperOrService(dummyHandler())
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	req.Header.Set("Authorization", "Bearer valid-shopper-token")

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected 200, got %d; body: %s", rec.Code, rec.Body.String())
	}
}

func TestAuthenticateShopperOrService_ShopperParseFails(t *testing.T) {
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

	handler := m.AuthenticateShopperOrService(dummyHandler())
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	req.Header.Set("Authorization", "Bearer bad-shopper-token")

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "INVALID_TOKEN") {
		t.Errorf("expected INVALID_TOKEN, got %s", rec.Body.String())
	}
}

func TestAuthenticateShopperOrService_AcceptsIAMWithAllowlist(t *testing.T) {
	t.Parallel()

	arn := "arn:aws:iam::123456789:role/airo-budget"
	m := &testableMiddleware{
		parser:       newIAMMockParser(),
		ssoHost:      "https://sso.test.godaddy.com",
		authType:     "jwt",
		allowedRoles: []string{"arn:aws:iam::123456789:role/airo-*"},
		getArn:       staticClaimGetter(arn),
	}

	handler := m.AuthenticateShopperOrService(dummyHandler())
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	req.Header.Set("Authorization", "Bearer valid-iam-token")

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected 200, got %d; body: %s", rec.Code, rec.Body.String())
	}
}

func TestAuthenticateShopperOrService_RejectsIAMNotInAllowlist(t *testing.T) {
	t.Parallel()

	arn := "arn:aws:iam::999:role/unknown"
	m := &testableMiddleware{
		parser:       newIAMMockParser(),
		ssoHost:      "https://sso.test.godaddy.com",
		authType:     "jwt",
		allowedRoles: []string{"arn:aws:iam::123:role/airo-*"},
		getArn:       staticClaimGetter(arn),
	}

	handler := m.AuthenticateShopperOrService(dummyHandler())
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	req.Header.Set("Authorization", "Bearer iam-token")

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Errorf("expected 403, got %d", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "IAM_ROLE_DENIED") {
		t.Errorf("expected IAM_ROLE_DENIED, got %s", rec.Body.String())
	}
}

func TestAuthenticateShopperOrService_AcceptsCertWithAllowlist(t *testing.T) {
	t.Parallel()

	cn := "service-a.airo-builder.godaddy.com"
	m := &testableMiddleware{
		parser:       newCertMockParser(),
		ssoHost:      "https://sso.test.godaddy.com",
		authType:     "jwt",
		allowedCerts: []string{"service-a.airo-builder.godaddy.com"},
		getCN:        staticClaimGetter(cn),
	}

	handler := m.AuthenticateShopperOrService(dummyHandler())
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	req.Header.Set("Authorization", "sso-jwt valid-cert-token")

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected 200, got %d; body: %s", rec.Code, rec.Body.String())
	}
}

func TestAuthenticateShopperOrService_RejectsCertNotInAllowlist(t *testing.T) {
	t.Parallel()

	cn := "rogue.example.com"
	m := &testableMiddleware{
		parser:       newCertMockParser(),
		ssoHost:      "https://sso.test.godaddy.com",
		authType:     "jwt",
		allowedCerts: []string{"service-a.airo-builder.godaddy.com"},
		getCN:        staticClaimGetter(cn),
	}

	handler := m.AuthenticateShopperOrService(dummyHandler())
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	req.Header.Set("Authorization", "sso-jwt cert-token")

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Errorf("expected 403, got %d", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "CERT_CN_DENIED") {
		t.Errorf("expected CERT_CN_DENIED, got %s", rec.Body.String())
	}
}

func TestAuthenticateShopperOrService_RejectsUnknownTokenType(t *testing.T) {
	t.Parallel()

	mockParser := &mockGDAuth{
		parseTokenFunc: func(token string, opts *gdauth.AuthOptions) (*gdauth.TokenClaims, error) {
			return gdauth.NewTokenClaims(map[string]any{
				"typ": string(gdauth.AuthTypeJOMAX),
				"jti": "jomax-jti",
			}), nil
		},
	}

	m := &testableMiddleware{
		parser:   mockParser,
		ssoHost:  "https://sso.test.godaddy.com",
		authType: "jwt",
	}

	handler := m.AuthenticateShopperOrService(dummyHandler())
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	req.Header.Set("Authorization", "Bearer jomax-token")

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "UNAUTHORIZED_TOKEN_TYPE") {
		t.Errorf("expected UNAUTHORIZED_TOKEN_TYPE, got %s", rec.Body.String())
	}
}

func TestAuthenticateShopperOrService_MissingToken(t *testing.T) {
	t.Parallel()

	m := &testableMiddleware{
		parser:   newShopperMockParser(),
		ssoHost:  "https://sso.test.godaddy.com",
		authType: "jwt",
	}

	handler := m.AuthenticateShopperOrService(dummyHandler())
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	// No Authorization header

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "MISSING_AUTHORIZATION") {
		t.Errorf("expected MISSING_AUTHORIZATION, got %s", rec.Body.String())
	}
}

func TestAuthenticateShopperOrService_AuthDisabled(t *testing.T) {
	t.Parallel()

	m := &testableMiddleware{
		parser:   nil,
		authType: "none",
	}

	handler := m.AuthenticateShopperOrService(dummyHandler())
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/test", nil)

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected 200 (auth disabled), got %d", rec.Code)
	}
}

func TestAuthenticateShopperOrService_NilParserMisconfigured(t *testing.T) {
	t.Parallel()

	m := &testableMiddleware{
		parser:   nil,
		ssoHost:  "https://sso.test.godaddy.com",
		authType: "jwt",
	}

	handler := m.AuthenticateShopperOrService(dummyHandler())
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	req.Header.Set("Authorization", "Bearer some-token")

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "AUTH_MISCONFIGURED") {
		t.Errorf("expected AUTH_MISCONFIGURED, got %s", rec.Body.String())
	}
}

func TestAuthenticateShopperOrService_CookieOnly_ValidShopper(t *testing.T) {
	t.Parallel()

	m := &testableMiddleware{
		parser:   newShopperMockParser(),
		ssoHost:  "https://sso.test.godaddy.com",
		authType: "jwt",
	}

	handler := m.AuthenticateShopperOrService(dummyHandler())
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	req.AddCookie(&http.Cookie{Name: "auth_idp", Value: "valid-shopper-cookie"})

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected 200, got %d; body: %s", rec.Code, rec.Body.String())
	}
}

func TestAuthenticateShopperOrService_HeaderAndCookie_HeaderWins(t *testing.T) {
	t.Parallel()

	mockParser := &mockGDAuth{
		parseTokenFunc: func(token string, opts *gdauth.AuthOptions) (*gdauth.TokenClaims, error) {
			if token == "header-tok" {
				return gdauth.NewTokenClaims(map[string]any{
					"typ": string(gdauth.AuthTypeIDP),
					"jti": "wins-from-header",
				}), nil
			}
			return nil, errors.New("cookie token should not have been parsed")
		},
	}

	m := &testableMiddleware{
		parser:   mockParser,
		ssoHost:  "https://sso.test.godaddy.com",
		authType: "jwt",
	}

	handler := m.AuthenticateShopperOrService(dummyHandler())
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	req.Header.Set("Authorization", "Bearer header-tok")
	req.AddCookie(&http.Cookie{Name: "auth_idp", Value: "cookie-tok"})

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected 200 (header should win), got %d; body: %s", rec.Code, rec.Body.String())
	}
}

func TestAuthenticateShopperOrService_CookieParseFails(t *testing.T) {
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

	handler := m.AuthenticateShopperOrService(dummyHandler())
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	req.AddCookie(&http.Cookie{Name: "auth_idp", Value: "garbage"})

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "INVALID_TOKEN") {
		t.Errorf("expected INVALID_TOKEN, got %s", rec.Body.String())
	}
}

func TestAuthenticateShopperOrService_EmptyCookie_NoHeader_MissingAuthorization(t *testing.T) {
	t.Parallel()

	m := &testableMiddleware{
		parser:   newShopperMockParser(),
		ssoHost:  "https://sso.test.godaddy.com",
		authType: "jwt",
	}

	handler := m.AuthenticateShopperOrService(dummyHandler())
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	req.AddCookie(&http.Cookie{Name: "auth_idp", Value: ""})

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "MISSING_AUTHORIZATION") {
		t.Errorf("expected MISSING_AUTHORIZATION, got %s", rec.Body.String())
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

func TestExtractTokenWithCookie_HeaderOnly(t *testing.T) {
	t.Parallel()
	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	req.Header.Set("Authorization", "Bearer header-tok")
	tok, src := extractTokenWithCookie(req)
	if tok != "header-tok" || src != "header" {
		t.Fatalf("got (%q, %q), want (\"header-tok\", \"header\")", tok, src)
	}
}

func TestExtractTokenWithCookie_HeaderAndCookie_HeaderWins(t *testing.T) {
	t.Parallel()
	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	req.Header.Set("Authorization", "sso-jwt header-tok")
	req.AddCookie(&http.Cookie{Name: "auth_idp", Value: "cookie-tok"})
	tok, src := extractTokenWithCookie(req)
	if tok != "header-tok" || src != "header" {
		t.Fatalf("got (%q, %q), want (\"header-tok\", \"header\")", tok, src)
	}
}

func TestExtractTokenWithCookie_CookieOnly(t *testing.T) {
	t.Parallel()
	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	req.AddCookie(&http.Cookie{Name: "auth_idp", Value: "cookie-tok"})
	tok, src := extractTokenWithCookie(req)
	if tok != "cookie-tok" || src != "cookie" {
		t.Fatalf("got (%q, %q), want (\"cookie-tok\", \"cookie\")", tok, src)
	}
}

func TestExtractTokenWithCookie_Neither(t *testing.T) {
	t.Parallel()
	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	tok, src := extractTokenWithCookie(req)
	if tok != "" || src != "" {
		t.Fatalf("got (%q, %q), want (\"\", \"\")", tok, src)
	}
}

func TestExtractTokenWithCookie_MalformedHeaderFallsBackToCookie(t *testing.T) {
	t.Parallel()
	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	req.Header.Set("Authorization", "Basic dXNlcjpwYXNz") // unsupported prefix
	req.AddCookie(&http.Cookie{Name: "auth_idp", Value: "cookie-tok"})
	tok, src := extractTokenWithCookie(req)
	if tok != "cookie-tok" || src != "cookie" {
		t.Fatalf("got (%q, %q), want (\"cookie-tok\", \"cookie\")", tok, src)
	}
}

func TestExtractTokenWithCookie_EmptyCookieValue(t *testing.T) {
	t.Parallel()
	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	req.AddCookie(&http.Cookie{Name: "auth_idp", Value: ""})
	tok, src := extractTokenWithCookie(req)
	if tok != "" || src != "" {
		t.Fatalf("got (%q, %q), want (\"\", \"\")", tok, src)
	}
}

func TestExtractTokenWithCookie_DifferentCookieIgnored(t *testing.T) {
	t.Parallel()
	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	req.AddCookie(&http.Cookie{Name: "session", Value: "should-not-be-used"})
	tok, src := extractTokenWithCookie(req)
	if tok != "" || src != "" {
		t.Fatalf("got (%q, %q), want (\"\", \"\") — only auth_idp should be read", tok, src)
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

func newIAMMockParser() *mockGDAuth {
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
		parser:       newIAMMockParser(),
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
		parser:       newIAMMockParser(),
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
		parser:       newIAMMockParser(),
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

func TestAllowedRoles_EmptyListFailsClosed(t *testing.T) {
	t.Parallel()

	m := &testableMiddleware{
		parser:       newIAMMockParser(),
		ssoHost:      "https://sso.test.godaddy.com",
		authType:     "jwt",
		allowedRoles: nil,
	}

	handler := m.AuthenticateAWSIAMService(dummyHandler())
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	req.Header.Set("Authorization", "Bearer valid-iam-token")
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Errorf("expected 403 (empty role allowlist = fail closed), got %d; body: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "IAM role allowlist not configured") {
		t.Errorf("expected fail-closed error, got %s", rec.Body.String())
	}
}

func TestAllowedRoles_CertTokenIgnoresRoleAllowlist(t *testing.T) {
	t.Parallel()

	cn := "service-a.airo-builder.godaddy.com"
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
		allowedCerts: []string{"service-a.airo-builder.godaddy.com"},
		getCN:        staticClaimGetter(cn),
	}

	handler := m.AuthenticateAWSIAMService(dummyHandler())
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	req.Header.Set("Authorization", "sso-jwt valid-cert-token")
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected 200 (cert tokens are gated by cert allowlist, not role), got %d; body: %s", rec.Code, rec.Body.String())
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

func TestAllowedCerts_EmptyListFailsClosed(t *testing.T) {
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

	if rec.Code != http.StatusForbidden {
		t.Errorf("expected 403 (empty cert allowlist = fail closed), got %d; body: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "cert allowlist not configured") {
		t.Errorf("expected fail-closed error, got %s", rec.Body.String())
	}
}

func TestAllowedCerts_IAMTokenIgnoresCertAllowlist(t *testing.T) {
	t.Parallel()

	arn := "arn:aws:iam::123:role/anything"
	m := &testableMiddleware{
		parser:       newIAMMockParser(),
		ssoHost:      "https://sso.test.godaddy.com",
		authType:     "jwt",
		allowedRoles: []string{"arn:aws:iam::123:role/anything"},
		allowedCerts: []string{"specific-cert-only.godaddy.com"},
		getArn:       staticClaimGetter(arn),
	}

	handler := m.AuthenticateAWSIAMService(dummyHandler())
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	req.Header.Set("Authorization", "Bearer valid-iam-token")
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected 200 (IAM tokens are gated by role allowlist, not cert), got %d; body: %s", rec.Code, rec.Body.String())
	}
}

// stubProdGDAuth implements GDAuthValidator for exercising real Middleware.AuthenticateAWSIAMService.
type stubProdGDAuth struct {
	claims   *gdauth.TokenClaims
	parseErr error
}

func (s *stubProdGDAuth) ParseToken(token string, opts *gdauth.AuthOptions) (*gdauth.TokenClaims, error) {
	if s.parseErr != nil {
		return nil, s.parseErr
	}
	if s.claims != nil {
		return s.claims, nil
	}
	return gdauth.NewTokenClaims(map[string]any{
		"typ": string(gdauth.AuthTypeAWSIAM),
		"jti": "stub",
	}), nil
}

func (s *stubProdGDAuth) GetAwsIamArn(claims *gdauth.TokenClaims) (string, error) {
	return "arn:aws:iam::123456789012:role/stub", nil
}

func (s *stubProdGDAuth) GetCommonName(claims *gdauth.TokenClaims) (string, error) {
	return "stub-cn.example.com", nil
}

func TestMiddleware_AuthenticateAWSIAMService_FailClosedEmptyRoles(t *testing.T) {
	t.Parallel()

	claims := gdauth.NewTokenClaims(map[string]any{
		"typ": string(gdauth.AuthTypeAWSIAM),
		"jti": "prod-test",
	})
	m := &Middleware{
		authType:     "jwt",
		allowedRoles: nil,
		allowedCerts: []string{"airo-builder.godaddy.com/*"},
		client:       &Client{SSOHost: "https://sso.test.godaddy.com"},
		validator:    &stubProdGDAuth{claims: claims},
	}
	h := m.AuthenticateAWSIAMService(dummyHandler())
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/x", nil)
	req.Header.Set("Authorization", "Bearer token")
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("want 403, got %d body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "IAM_ALLOWLIST_NOT_CONFIGURED") {
		t.Fatalf("body should include fail-closed code: %s", rec.Body.String())
	}
}

func TestMiddleware_AuthenticateAWSIAMService_FailClosedEmptyCerts(t *testing.T) {
	t.Parallel()

	claims := gdauth.NewTokenClaims(map[string]any{
		"typ": string(gdauth.AuthTypeCERT),
		"jti": "prod-test-cert",
	})
	m := &Middleware{
		authType:     "jwt",
		allowedRoles: []string{"arn:aws:iam::123456789012:role/x"},
		allowedCerts: nil,
		client:       &Client{SSOHost: "https://sso.test.godaddy.com"},
		validator:    &stubProdGDAuth{claims: claims},
	}
	h := m.AuthenticateAWSIAMService(dummyHandler())
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/x", nil)
	req.Header.Set("Authorization", "sso-jwt token")
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("want 403, got %d body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "CERT_ALLOWLIST_NOT_CONFIGURED") {
		t.Fatalf("body should include fail-closed code: %s", rec.Body.String())
	}
}

func TestNewMiddleware_AuthDisabledIgnoresBearerWithEmptyAllowlists(t *testing.T) {
	t.Parallel()

	m := NewMiddleware("none", nil, nil)
	h := m.AuthenticateAWSIAMService(dummyHandler())
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/x", nil)
	req.Header.Set("Authorization", "Bearer any-token-should-not-matter")
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200 when auth disabled, got %d body=%s", rec.Code, rec.Body.String())
	}
}

func TestMiddleware_AuthenticateAWSIAMService_ClientWithNilGDAuth(t *testing.T) {
	t.Parallel()

	m := &Middleware{
		authType:     "jwt",
		allowedRoles: []string{"arn:aws:iam::1:role/x"},
		allowedCerts: []string{"cn.example"},
		client:       &Client{SSOHost: "https://sso.test.godaddy.com", GDAuth: nil},
		validator:    nil,
	}
	h := m.AuthenticateAWSIAMService(dummyHandler())
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/x", nil)
	req.Header.Set("Authorization", "Bearer t")
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("want 401 misconfigured, got %d body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "AUTH_MISCONFIGURED") {
		t.Fatalf("body=%s", rec.Body.String())
	}
}

type stubProdGDAuthWithErrors struct {
	claims *gdauth.TokenClaims
	arnErr error
	cnErr  error
	arn    string
	cn     string
}

func (s *stubProdGDAuthWithErrors) ParseToken(token string, opts *gdauth.AuthOptions) (*gdauth.TokenClaims, error) {
	return s.claims, nil
}

func (s *stubProdGDAuthWithErrors) GetAwsIamArn(claims *gdauth.TokenClaims) (string, error) {
	return s.arn, s.arnErr
}

func (s *stubProdGDAuthWithErrors) GetCommonName(claims *gdauth.TokenClaims) (string, error) {
	return s.cn, s.cnErr
}

func TestMiddleware_AuthenticateAWSIAMService_ArnExtractionFailed(t *testing.T) {
	t.Parallel()

	claims := gdauth.NewTokenClaims(map[string]any{
		"typ": string(gdauth.AuthTypeAWSIAM),
		"jti": "prod-test-arn-err",
	})
	m := &Middleware{
		authType:     "jwt",
		allowedRoles: []string{"arn:aws:iam::123:role/x"},
		allowedCerts: []string{"cn.example"},
		client:       &Client{SSOHost: "https://sso.test.godaddy.com"},
		validator:    &stubProdGDAuthWithErrors{claims: claims, arnErr: errors.New("arn extraction failed")},
	}
	h := m.AuthenticateAWSIAMService(dummyHandler())
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/x", nil)
	req.Header.Set("Authorization", "Bearer token")
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("want 403, got %d body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "IAM_ROLE_EXTRACT_FAILED") {
		t.Fatalf("body=%s", rec.Body.String())
	}
}

func TestMiddleware_AuthenticateAWSIAMService_RoleDenied(t *testing.T) {
	t.Parallel()

	claims := gdauth.NewTokenClaims(map[string]any{
		"typ": string(gdauth.AuthTypeAWSIAM),
		"jti": "prod-test-role-denied",
	})
	m := &Middleware{
		authType:     "jwt",
		allowedRoles: []string{"arn:aws:iam::999:role/allowed-only"},
		allowedCerts: []string{"cn.example"},
		client:       &Client{SSOHost: "https://sso.test.godaddy.com"},
		validator:    &stubProdGDAuthWithErrors{claims: claims, arn: "arn:aws:iam::123:role/denied"},
	}
	h := m.AuthenticateAWSIAMService(dummyHandler())
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/x", nil)
	req.Header.Set("Authorization", "Bearer token")
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("want 403, got %d body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "IAM_ROLE_DENIED") {
		t.Fatalf("body=%s", rec.Body.String())
	}
}

func TestMiddleware_AuthenticateAWSIAMService_CnExtractionFailed(t *testing.T) {
	t.Parallel()

	claims := gdauth.NewTokenClaims(map[string]any{
		"typ": string(gdauth.AuthTypeCERT),
		"jti": "prod-test-cn-err",
	})
	m := &Middleware{
		authType:     "jwt",
		allowedRoles: []string{"arn:aws:iam::123:role/x"},
		allowedCerts: []string{"cn.example"},
		client:       &Client{SSOHost: "https://sso.test.godaddy.com"},
		validator:    &stubProdGDAuthWithErrors{claims: claims, cnErr: errors.New("cn extraction failed")},
	}
	h := m.AuthenticateAWSIAMService(dummyHandler())
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/x", nil)
	req.Header.Set("Authorization", "sso-jwt token")
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("want 403, got %d body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "CERT_CN_EXTRACT_FAILED") {
		t.Fatalf("body=%s", rec.Body.String())
	}
}

func TestMiddleware_AuthenticateAWSIAMService_CertDenied(t *testing.T) {
	t.Parallel()

	claims := gdauth.NewTokenClaims(map[string]any{
		"typ": string(gdauth.AuthTypeCERT),
		"jti": "prod-test-cert-denied",
	})
	m := &Middleware{
		authType:     "jwt",
		allowedRoles: []string{"arn:aws:iam::123:role/x"},
		allowedCerts: []string{"allowed-cert.godaddy.com"},
		client:       &Client{SSOHost: "https://sso.test.godaddy.com"},
		validator:    &stubProdGDAuthWithErrors{claims: claims, cn: "denied-cert.evil.com"},
	}
	h := m.AuthenticateAWSIAMService(dummyHandler())
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/x", nil)
	req.Header.Set("Authorization", "sso-jwt token")
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("want 403, got %d body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "CERT_CN_DENIED") {
		t.Fatalf("body=%s", rec.Body.String())
	}
}

func TestMiddleware_AuthenticateAWSIAMService_InvalidToken(t *testing.T) {
	t.Parallel()

	m := &Middleware{
		authType:     "jwt",
		allowedRoles: []string{"arn:aws:iam::123:role/x"},
		allowedCerts: []string{"cn.example"},
		client:       &Client{SSOHost: "https://sso.test.godaddy.com"},
		validator:    &stubProdGDAuth{parseErr: errors.New("invalid token")},
	}
	h := m.AuthenticateAWSIAMService(dummyHandler())
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/x", nil)
	req.Header.Set("Authorization", "Bearer bad-token")
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("want 401, got %d body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "INVALID_TOKEN") {
		t.Fatalf("body=%s", rec.Body.String())
	}
}

func TestMiddleware_AuthenticateAWSIAMService_NilClient(t *testing.T) {
	t.Parallel()

	m := &Middleware{
		authType:     "jwt",
		allowedRoles: []string{"arn:aws:iam::123:role/x"},
		allowedCerts: []string{"cn.example"},
		client:       nil,
	}
	h := m.AuthenticateAWSIAMService(dummyHandler())
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/x", nil)
	req.Header.Set("Authorization", "Bearer token")
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("want 401, got %d body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "AUTH_MISCONFIGURED") {
		t.Fatalf("body=%s", rec.Body.String())
	}
}

func TestNewMiddleware_JWTWithNilClient(t *testing.T) {
	t.Parallel()

	// When GetClient() returns nil (InitClient not called), NewMiddleware still returns
	// a Middleware, but AuthenticateAWSIAMService will return 401 AUTH_MISCONFIGURED.
	if GetClient() != nil {
		t.Skip("singleton already initialized")
	}
	m := NewMiddleware("jwt", []string{"role"}, []string{"cert"})
	if m == nil {
		t.Fatal("NewMiddleware returned nil")
	}
	if m.authType != "jwt" {
		t.Fatalf("authType = %q want jwt", m.authType)
	}
	// Verify the middleware rejects requests since client is nil
	h := m.AuthenticateAWSIAMService(dummyHandler())
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/x", nil)
	req.Header.Set("Authorization", "Bearer token")
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("want 401, got %d body=%s", rec.Code, rec.Body.String())
	}
}

func TestMiddleware_AuthenticateAWSIAMService_WrongTokenType(t *testing.T) {
	t.Parallel()
	claims := gdauth.NewTokenClaims(map[string]any{
		"typ": string(gdauth.AuthTypeJOMAX),
		"jti": "prod-wrong-type",
	})
	m := &Middleware{
		authType:     "jwt",
		allowedRoles: []string{"arn:aws:iam::123:role/x"},
		allowedCerts: []string{"cn.example"},
		client:       &Client{SSOHost: "https://sso.test.godaddy.com"},
		validator:    &stubProdGDAuth{claims: claims},
	}
	h := m.AuthenticateAWSIAMService(dummyHandler())
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/x", nil)
	req.Header.Set("Authorization", "Bearer token")
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("want 401, got %d body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "UNAUTHORIZED_TOKEN_TYPE") {
		t.Fatalf("body=%s", rec.Body.String())
	}
}

// --- Middleware.AuthenticateShopperOrService production-path tests ---

func TestMiddleware_AuthenticateShopperOrService_AcceptsShopper(t *testing.T) {
	t.Parallel()

	claims := gdauth.NewTokenClaims(map[string]any{
		"typ": string(gdauth.AuthTypeIDP),
		"jti": "prod-shopper",
	})
	m := &Middleware{
		authType:     "jwt",
		allowedRoles: []string{"arn:aws:iam::123:role/x"},
		allowedCerts: []string{"cn.example"},
		client:       &Client{SSOHost: "https://sso.test.godaddy.com"},
		validator:    &stubProdGDAuth{claims: claims},
	}
	h := m.AuthenticateShopperOrService(dummyHandler())
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/budgets/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", nil)
	req.Header.Set("Authorization", "Bearer shopper-token")
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d body=%s", rec.Code, rec.Body.String())
	}
}

func TestMiddleware_AuthenticateShopperOrService_AcceptsIAMInAllowlist(t *testing.T) {
	t.Parallel()

	claims := gdauth.NewTokenClaims(map[string]any{
		"typ": string(gdauth.AuthTypeAWSIAM),
		"jti": "prod-iam",
	})
	m := &Middleware{
		authType:     "jwt",
		allowedRoles: []string{"arn:aws:iam::123456789012:role/stub"},
		allowedCerts: []string{"cn.example"},
		client:       &Client{SSOHost: "https://sso.test.godaddy.com"},
		validator:    &stubProdGDAuth{claims: claims},
	}
	h := m.AuthenticateShopperOrService(dummyHandler())
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/budgets/x", nil)
	req.Header.Set("Authorization", "Bearer iam-token")
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d body=%s", rec.Code, rec.Body.String())
	}
}

func TestMiddleware_AuthenticateShopperOrService_RejectsJOMAX(t *testing.T) {
	t.Parallel()

	claims := gdauth.NewTokenClaims(map[string]any{
		"typ": string(gdauth.AuthTypeJOMAX),
		"jti": "prod-jomax",
	})
	m := &Middleware{
		authType:     "jwt",
		allowedRoles: []string{"arn:aws:iam::123:role/x"},
		allowedCerts: []string{"cn.example"},
		client:       &Client{SSOHost: "https://sso.test.godaddy.com"},
		validator:    &stubProdGDAuth{claims: claims},
	}
	h := m.AuthenticateShopperOrService(dummyHandler())
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/budgets/x", nil)
	req.Header.Set("Authorization", "Bearer jomax-token")
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("want 401, got %d body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "UNAUTHORIZED_TOKEN_TYPE") {
		t.Fatalf("body=%s", rec.Body.String())
	}
}

func TestMiddleware_AuthenticateShopperOrService_NilClient(t *testing.T) {
	t.Parallel()

	m := &Middleware{authType: "jwt", client: nil}
	h := m.AuthenticateShopperOrService(dummyHandler())
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/budgets/x", nil)
	req.Header.Set("Authorization", "Bearer t")
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("want 401, got %d", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "AUTH_MISCONFIGURED") {
		t.Fatalf("body=%s", rec.Body.String())
	}
}

func TestMiddleware_AuthenticateShopperOrService_ClientWithNilGDAuth(t *testing.T) {
	t.Parallel()

	m := &Middleware{
		authType:     "jwt",
		allowedRoles: []string{"arn:aws:iam::1:role/x"},
		allowedCerts: []string{"cn.example"},
		client:       &Client{SSOHost: "https://sso.test.godaddy.com", GDAuth: nil},
		validator:    nil,
	}
	h := m.AuthenticateShopperOrService(dummyHandler())
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/x", nil)
	req.Header.Set("Authorization", "Bearer t")
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("want 401 misconfigured, got %d body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "AUTH_MISCONFIGURED") {
		t.Fatalf("body=%s", rec.Body.String())
	}
}

func TestMiddleware_AuthenticateShopperOrService_AcceptsShopperFromCookie(t *testing.T) {
	t.Parallel()

	claims := gdauth.NewTokenClaims(map[string]any{
		"typ": string(gdauth.AuthTypeIDP),
		"jti": "prod-shopper-cookie",
	})
	m := &Middleware{
		authType:     "jwt",
		allowedRoles: []string{"arn:aws:iam::123:role/x"},
		allowedCerts: []string{"cn.example"},
		client:       &Client{SSOHost: "https://sso.test.godaddy.com"},
		validator:    &stubProdGDAuth{claims: claims},
	}
	h := m.AuthenticateShopperOrService(dummyHandler())
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/budgets/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", nil)
	req.AddCookie(&http.Cookie{Name: "auth_idp", Value: "cookie-shopper-token"})
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d body=%s", rec.Code, rec.Body.String())
	}
}

func TestMiddleware_AuthenticateAWSIAMService_RejectsCookieOnly(t *testing.T) {
	t.Parallel()

	claims := gdauth.NewTokenClaims(map[string]any{
		"typ": string(gdauth.AuthTypeAWSIAM),
		"jti": "service-cookie-attempt",
	})
	m := &Middleware{
		authType:     "jwt",
		allowedRoles: []string{"arn:aws:iam::123:role/x"},
		allowedCerts: []string{"cn.example"},
		client:       &Client{SSOHost: "https://sso.test.godaddy.com"},
		validator:    &stubProdGDAuth{claims: claims},
	}
	h := m.AuthenticateAWSIAMService(dummyHandler())
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/x", nil)
	req.AddCookie(&http.Cookie{Name: "auth_idp", Value: "ignored-by-service-middleware"})
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("want 401, got %d body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "MISSING_AUTHORIZATION") {
		t.Fatalf("want MISSING_AUTHORIZATION (cookie ignored on service middleware), got %s", rec.Body.String())
	}
}

func TestGdAuthMethodReturnsPriority(t *testing.T) {
	t.Parallel()
	stub := &stubProdGDAuth{}
	// validator takes priority over client.GDAuth
	m := &Middleware{validator: stub, client: &Client{SSOHost: "x"}}
	if m.gdAuth() != stub {
		t.Fatal("validator should take priority")
	}
	// nil validator and nil client → nil
	m2 := &Middleware{validator: nil, client: nil}
	if m2.gdAuth() != nil {
		t.Fatal("should return nil when both are nil")
	}
	// nil validator, client present but GDAuth is nil → nil
	m3 := &Middleware{validator: nil, client: &Client{SSOHost: "x", GDAuth: nil}}
	if m3.gdAuth() != nil {
		t.Fatal("should return nil when client.GDAuth is nil")
	}
}

func TestMiddleware_AuthenticateAWSIAMService_MissingAuthHeader(t *testing.T) {
	t.Parallel()

	claims := gdauth.NewTokenClaims(map[string]any{"typ": string(gdauth.AuthTypeAWSIAM)})
	m := &Middleware{
		authType:     "jwt",
		allowedRoles: []string{"arn:aws:iam::123:role/x"},
		allowedCerts: []string{"cn.example"},
		client:       &Client{SSOHost: "https://sso.test.godaddy.com"},
		validator:    &stubProdGDAuth{claims: claims},
	}
	h := m.AuthenticateAWSIAMService(dummyHandler())
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/x", nil)
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("want 401, got %d body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "MISSING_AUTHORIZATION") {
		t.Fatalf("body=%s", rec.Body.String())
	}
}

// Exercises the real Middleware happy path for IAM tokens: matching ARN and
// claims stored in context. The seclog.AuthSuccess emit is asserted separately
// in TestMiddleware_AuthSuccess_EmitsSeclogEvent (non-parallel).
func TestMiddleware_AuthenticateAWSIAMService_IAMSuccess(t *testing.T) {
	t.Parallel()

	claims := gdauth.NewTokenClaims(map[string]any{
		"typ": string(gdauth.AuthTypeAWSIAM),
		"jti": "prod-iam-success",
	})
	m := &Middleware{
		authType:     "jwt",
		allowedRoles: []string{"arn:aws:iam::123456789012:role/stub"},
		allowedCerts: []string{"unused.example.com"},
		client:       &Client{SSOHost: "https://sso.test.godaddy.com"},
		validator:    &stubProdGDAuth{claims: claims},
	}

	var seenClaims *gdauth.TokenClaims
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seenClaims = GetClaims(r)
		w.WriteHeader(http.StatusOK)
	})
	h := m.AuthenticateAWSIAMService(next)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/x", nil)
	req.Header.Set("Authorization", "Bearer token")
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	if seenClaims == nil {
		t.Fatal("expected claims propagated to next handler")
	}
	if seenClaims.GetType() != string(gdauth.AuthTypeAWSIAM) {
		t.Fatalf("want IAM claims type, got %q", seenClaims.GetType())
	}
}

// Exercises the real Middleware happy path for cert tokens: matching CN and
// claims propagated. The seclog.AuthSuccess emit is asserted separately in
// TestMiddleware_AuthSuccess_EmitsSeclogEvent (non-parallel).
func TestMiddleware_AuthenticateAWSIAMService_CertSuccess(t *testing.T) {
	t.Parallel()

	claims := gdauth.NewTokenClaims(map[string]any{
		"typ": string(gdauth.AuthTypeCERT),
		"jti": "prod-cert-success",
	})
	m := &Middleware{
		authType:     "jwt",
		allowedRoles: []string{"arn:aws:iam::999:role/unused"},
		allowedCerts: []string{"stub-cn.example.com"},
		client:       &Client{SSOHost: "https://sso.test.godaddy.com"},
		validator:    &stubProdGDAuth{claims: claims},
	}

	var seenClaims *gdauth.TokenClaims
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seenClaims = GetClaims(r)
		w.WriteHeader(http.StatusOK)
	})
	h := m.AuthenticateAWSIAMService(next)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/x", nil)
	req.Header.Set("Authorization", "sso-jwt token")
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	if seenClaims == nil {
		t.Fatal("expected claims propagated to next handler")
	}
	if seenClaims.GetType() != string(gdauth.AuthTypeCERT) {
		t.Fatalf("want CERT claims type, got %q", seenClaims.GetType())
	}
}

// findSeclogLine walks captured slog output and returns the parsed JSON line
// tagged as a security event. Multiple log lines may be emitted in one request
// (regular slog calls + seclog); we want only the seclog one. Returns nil if
// no security event was emitted.
func findSeclogLine(t *testing.T, buf *bytes.Buffer) map[string]any {
	t.Helper()
	for _, line := range strings.Split(strings.TrimSpace(buf.String()), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		var got map[string]any
		if err := json.Unmarshal([]byte(line), &got); err != nil {
			continue
		}
		tags, ok := got["tags"].([]any)
		if !ok || len(tags) == 0 || tags[0] != "security" {
			continue
		}
		return got
	}
	return nil
}

// nestedString walks nested map[string]any using dot-path. "" when missing.
func nestedString(m map[string]any, path string) string {
	keys := strings.Split(path, ".")
	cur := any(m)
	for _, k := range keys {
		obj, ok := cur.(map[string]any)
		if !ok {
			return ""
		}
		cur = obj[k]
	}
	if s, ok := cur.(string); ok {
		return s
	}
	return ""
}

// Asserts that a successful authentication actually emits a seclog event with
// event.outcome=success. Captures slog.Default() output for the duration of
// the test (non-parallel — slog.Default is process-global).
func TestMiddleware_AuthSuccess_EmitsSeclogEvent(t *testing.T) {
	cases := []struct {
		name       string
		typ        string
		authHeader string
		wantUser   string
	}{
		{
			name:       "IAM",
			typ:        string(gdauth.AuthTypeAWSIAM),
			authHeader: "Bearer token",
			wantUser:   "arn:aws:iam::123456789012:role/stub", // matches stubProdGDAuth.GetAwsIamArn
		},
		{
			name:       "Cert",
			typ:        string(gdauth.AuthTypeCERT),
			authHeader: "sso-jwt token",
			wantUser:   "stub-cn.example.com", // matches stubProdGDAuth.GetCommonName
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var buf bytes.Buffer
			prev := slog.Default()
			slog.SetDefault(slog.New(slog.NewJSONHandler(&buf, nil)))
			t.Cleanup(func() { slog.SetDefault(prev) })

			claims := gdauth.NewTokenClaims(map[string]any{
				"typ": tc.typ,
				"jti": "seclog-emit-" + tc.name,
			})
			m := &Middleware{
				authType:     "jwt",
				allowedRoles: []string{"arn:aws:iam::123456789012:role/stub"},
				allowedCerts: []string{"stub-cn.example.com"},
				client:       &Client{SSOHost: "https://sso.test.godaddy.com"},
				validator:    &stubProdGDAuth{claims: claims},
			}

			h := m.AuthenticateAWSIAMService(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(http.StatusOK)
			}))
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodGet, "/api/v1/x", nil)
			req.Header.Set("Authorization", tc.authHeader)
			h.ServeHTTP(rec, req)

			if rec.Code != http.StatusOK {
				t.Fatalf("want 200, got %d body=%s", rec.Code, rec.Body.String())
			}

			got := findSeclogLine(t, &buf)
			if got == nil {
				t.Fatalf("no seclog event captured; output=%q", buf.String())
			}
			if v := nestedString(got, "event.outcome"); v != "success" {
				t.Errorf("event.outcome=%q want success", v)
			}
			if v := nestedString(got, "event.category"); v != "authentication" {
				t.Errorf("event.category=%q want authentication", v)
			}
			if v := nestedString(got, "event.reason"); v != "AUTH_SUCCESS" {
				t.Errorf("event.reason=%q want AUTH_SUCCESS", v)
			}
			if v := nestedString(got, "user.name"); v != tc.wantUser {
				t.Errorf("user.name=%q want %q", v, tc.wantUser)
			}
		})
	}
}

// resolveUserForToken's default leg is unreachable through the normal flow
// (the caller gates on awsiam | cert), but tested directly here so a future
// refactor that relaxes the gate fails closed loudly instead of silently
// allowing requests through with an empty principal.
func TestMiddleware_ResolveUserForToken_UnexpectedTokenTypeFailsClosed(t *testing.T) {
	var buf bytes.Buffer
	prev := slog.Default()
	slog.SetDefault(slog.New(slog.NewJSONHandler(&buf, nil)))
	t.Cleanup(func() { slog.SetDefault(prev) })

	m := &Middleware{
		authType:     "jwt",
		allowedRoles: []string{"arn:aws:iam::123:role/x"},
		allowedCerts: []string{"cn.example"},
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/x", nil)
	claims := gdauth.NewTokenClaims(map[string]any{"typ": "shopper"}) // not awsiam, not cert

	user, handled := m.resolveUserForToken(rec, req, &stubProdGDAuth{claims: claims}, claims, "shopper")

	if !handled {
		t.Fatalf("default leg must return handled=true to fail closed; got handled=false user=%q", user)
	}
	if user != "" {
		t.Errorf("user=%q want empty when failing closed", user)
	}
	if rec.Code != http.StatusInternalServerError {
		t.Errorf("status=%d want 500 (internal error, not silent 200)", rec.Code)
	}

	got := findSeclogLine(t, &buf)
	if got == nil {
		t.Fatalf("default leg must emit a seclog event; output=%q", buf.String())
	}
	if v := nestedString(got, "event.reason"); v != "UNEXPECTED_TOKEN_TYPE_PATH" {
		t.Errorf("event.reason=%q want UNEXPECTED_TOKEN_TYPE_PATH", v)
	}
	if v := nestedString(got, "event.outcome"); v != "failure" {
		t.Errorf("event.outcome=%q want failure", v)
	}
}

// AUTH_MISCONFIGURED has two distinct branches (`cause=client_nil` vs
// `cause=gdauth_nil`) — the only signal SIEM has to distinguish them. Without
// these asserts, swapping the labels by accident would not be caught.
func TestMiddleware_AuthMisconfigured_EmitsCauseLabel(t *testing.T) {
	cases := []struct {
		name      string
		mw        *Middleware
		wantCause string
	}{
		{
			name: "client_nil",
			mw: &Middleware{
				authType:     "jwt",
				allowedRoles: []string{"arn:aws:iam::123:role/x"},
				allowedCerts: []string{"cn.example"},
				client:       nil,
			},
			wantCause: "client_nil",
		},
		{
			name: "gdauth_nil",
			mw: &Middleware{
				authType:     "jwt",
				allowedRoles: []string{"arn:aws:iam::123:role/x"},
				allowedCerts: []string{"cn.example"},
				client:       &Client{SSOHost: "https://sso.test.godaddy.com", GDAuth: nil},
				validator:    nil,
			},
			wantCause: "gdauth_nil",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var buf bytes.Buffer
			prev := slog.Default()
			slog.SetDefault(slog.New(slog.NewJSONHandler(&buf, nil)))
			t.Cleanup(func() { slog.SetDefault(prev) })

			h := tc.mw.AuthenticateAWSIAMService(dummyHandler())
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodGet, "/api/v1/x", nil)
			req.Header.Set("Authorization", "Bearer token")
			h.ServeHTTP(rec, req)

			if rec.Code != http.StatusUnauthorized {
				t.Fatalf("want 401, got %d body=%s", rec.Code, rec.Body.String())
			}

			got := findSeclogLine(t, &buf)
			if got == nil {
				t.Fatalf("no seclog event captured; output=%q", buf.String())
			}
			if v := nestedString(got, "event.reason"); v != "AUTH_MISCONFIGURED" {
				t.Errorf("event.reason=%q want AUTH_MISCONFIGURED", v)
			}
			labels, ok := got["labels"].(map[string]any)
			if !ok {
				t.Fatalf("labels missing or not an object; got %v", got["labels"])
			}
			if cause, _ := labels["cause"].(string); cause != tc.wantCause {
				t.Errorf("labels.cause=%v want %q", labels["cause"], tc.wantCause)
			}
		})
	}
}
func TestPerRouteHandlerWrappingAppliesShopperMiddlewareOnGetOnly(t *testing.T) {
	t.Parallel()

	shopperClaims := gdauth.NewTokenClaims(map[string]any{
		"typ": string(gdauth.AuthTypeIDP),
		"jti": "wiring-shopper",
	})

	m := &Middleware{
		authType:     "jwt",
		allowedRoles: []string{"arn:aws:iam::123:role/x"},
		allowedCerts: []string{"cn.example"},
		client:       &Client{SSOHost: "https://sso.test.godaddy.com"},
		validator:    &stubProdGDAuth{claims: shopperClaims},
	}

	serviceAuth := mux.MiddlewareFunc(m.AuthenticateAWSIAMService)
	shopperOrServiceAuth := mux.MiddlewareFunc(m.AuthenticateShopperOrService)

	okHandler := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	r := mux.NewRouter()
	v1 := r.PathPrefix("/api/v1").Subrouter()

	// GET /budgets/{budgetId}: shopper or service auth (per-handler wrap)
	v1.Handle("/budgets/{budgetId}", shopperOrServiceAuth(okHandler)).Methods(http.MethodGet)
	// PATCH and DELETE: service-only auth (per-handler wrap)
	v1.Handle("/budgets/{budgetId}", serviceAuth(okHandler)).Methods(http.MethodPatch)
	v1.Handle("/budgets/{budgetId}", serviceAuth(okHandler)).Methods(http.MethodDelete)

	cases := []struct {
		name       string
		method     string
		wantStatus int
		wantBody   string
	}{
		{"GET shopper accepted", http.MethodGet, http.StatusOK, ""},
		{"PATCH shopper rejected as wrong typ", http.MethodPatch, http.StatusUnauthorized, "UNAUTHORIZED_TOKEN_TYPE"},
		{"DELETE shopper rejected as wrong typ", http.MethodDelete, http.StatusUnauthorized, "UNAUTHORIZED_TOKEN_TYPE"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(tc.method, "/api/v1/budgets/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", nil)
			req.Header.Set("Authorization", "Bearer shopper-token")
			r.ServeHTTP(rec, req)
			if rec.Code != tc.wantStatus {
				t.Fatalf("%s: want %d, got %d body=%s", tc.name, tc.wantStatus, rec.Code, rec.Body.String())
			}
			if tc.wantBody != "" && !strings.Contains(rec.Body.String(), tc.wantBody) {
				t.Fatalf("%s: body=%s want substring %q", tc.name, rec.Body.String(), tc.wantBody)
			}
		})
	}
}

// Asserts that AuthenticateShopperOrService propagates the resolved token
// source ("header" vs "cookie") into seclog events. This label is the only
// SIEM signal distinguishing a bad-Authorization-header attempt from a
// bad-auth_idp-cookie attempt; without these asserts, accidental drops of
// the label would silently regress that distinction.
func TestMiddleware_AuthenticateShopperOrService_EmitsTokenSourceLabel(t *testing.T) {
	cases := []struct {
		name       string
		setup      func(*http.Request)
		wantSource string
	}{
		{
			name: "header",
			setup: func(req *http.Request) {
				req.Header.Set("Authorization", "Bearer shopper-token")
			},
			wantSource: "header",
		},
		{
			name: "cookie",
			setup: func(req *http.Request) {
				req.AddCookie(&http.Cookie{Name: "auth_idp", Value: "shopper-token"})
			},
			wantSource: "cookie",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name+"_success", func(t *testing.T) {
			var buf bytes.Buffer
			prev := slog.Default()
			slog.SetDefault(slog.New(slog.NewJSONHandler(&buf, nil)))
			t.Cleanup(func() { slog.SetDefault(prev) })

			claims := gdauth.NewTokenClaims(map[string]any{
				"typ": string(gdauth.AuthTypeIDP),
				"jti": "shopper-source-" + tc.name,
			})
			m := &Middleware{
				authType:     "jwt",
				allowedRoles: []string{"arn:aws:iam::123:role/x"},
				allowedCerts: []string{"cn.example"},
				client:       &Client{SSOHost: "https://sso.test.godaddy.com"},
				validator:    &stubProdGDAuth{claims: claims},
			}

			h := m.AuthenticateShopperOrService(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(http.StatusOK)
			}))
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodGet, "/api/v1/budgets/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", nil)
			tc.setup(req)
			h.ServeHTTP(rec, req)

			if rec.Code != http.StatusOK {
				t.Fatalf("want 200, got %d body=%s", rec.Code, rec.Body.String())
			}
			got := findSeclogLine(t, &buf)
			if got == nil {
				t.Fatalf("no seclog event captured; output=%q", buf.String())
			}
			if v := nestedString(got, "event.outcome"); v != "success" {
				t.Errorf("event.outcome=%q want success", v)
			}
			labels, ok := got["labels"].(map[string]any)
			if !ok {
				t.Fatalf("labels missing or not an object; got %v", got["labels"])
			}
			if src, _ := labels["token_source"].(string); src != tc.wantSource {
				t.Errorf("labels.token_source=%v want %q", labels["token_source"], tc.wantSource)
			}
		})

		t.Run(tc.name+"_invalid_token", func(t *testing.T) {
			var buf bytes.Buffer
			prev := slog.Default()
			slog.SetDefault(slog.New(slog.NewJSONHandler(&buf, nil)))
			t.Cleanup(func() { slog.SetDefault(prev) })

			m := &Middleware{
				authType:     "jwt",
				allowedRoles: []string{"arn:aws:iam::123:role/x"},
				allowedCerts: []string{"cn.example"},
				client:       &Client{SSOHost: "https://sso.test.godaddy.com"},
				validator:    &stubProdGDAuth{parseErr: errors.New("token validation error: bad sig (code: 1)")},
			}

			h := m.AuthenticateShopperOrService(dummyHandler())
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodGet, "/api/v1/budgets/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", nil)
			tc.setup(req)
			h.ServeHTTP(rec, req)

			if rec.Code != http.StatusUnauthorized {
				t.Fatalf("want 401, got %d body=%s", rec.Code, rec.Body.String())
			}
			got := findSeclogLine(t, &buf)
			if got == nil {
				t.Fatalf("no seclog event captured; output=%q", buf.String())
			}
			if v := nestedString(got, "event.reason"); v != "INVALID_TOKEN" {
				t.Errorf("event.reason=%q want INVALID_TOKEN", v)
			}
			labels, ok := got["labels"].(map[string]any)
			if !ok {
				t.Fatalf("labels missing or not an object; got %v", got["labels"])
			}
			if src, _ := labels["token_source"].(string); src != tc.wantSource {
				t.Errorf("labels.token_source=%v want %q", labels["token_source"], tc.wantSource)
			}
		})
	}
}

// Covers the simpler entry paths on the real Middleware that the
// testableMiddleware variant doesn't exercise: auth disabled, missing both
// header and cookie. Both must still flow through the shopper middleware
// (auth disabled = bypass; missing token = 401 with MISSING_AUTHORIZATION
// seclog event, no token_source label since the source is unresolved).
func TestMiddleware_AuthenticateShopperOrService_EntryPaths(t *testing.T) {
	t.Run("auth_disabled_bypasses", func(t *testing.T) {
		t.Parallel()
		m := &Middleware{authType: "none"}
		called := false
		h := m.AuthenticateShopperOrService(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			called = true
			w.WriteHeader(http.StatusOK)
		}))
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/api/v1/budgets/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", nil)
		h.ServeHTTP(rec, req)
		if !called {
			t.Fatalf("next handler should run when authType=none")
		}
		if rec.Code != http.StatusOK {
			t.Fatalf("want 200, got %d", rec.Code)
		}
	})

	t.Run("missing_token_emits_seclog", func(t *testing.T) {
		var buf bytes.Buffer
		prev := slog.Default()
		slog.SetDefault(slog.New(slog.NewJSONHandler(&buf, nil)))
		t.Cleanup(func() { slog.SetDefault(prev) })

		claims := gdauth.NewTokenClaims(map[string]any{"typ": string(gdauth.AuthTypeIDP)})
		m := &Middleware{
			authType:     "jwt",
			allowedRoles: []string{"arn:aws:iam::123:role/x"},
			allowedCerts: []string{"cn.example"},
			client:       &Client{SSOHost: "https://sso.test.godaddy.com"},
			validator:    &stubProdGDAuth{claims: claims},
		}

		h := m.AuthenticateShopperOrService(dummyHandler())
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/api/v1/budgets/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", nil)
		h.ServeHTTP(rec, req)

		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("want 401, got %d body=%s", rec.Code, rec.Body.String())
		}
		got := findSeclogLine(t, &buf)
		if got == nil {
			t.Fatalf("no seclog event captured; output=%q", buf.String())
		}
		if v := nestedString(got, "event.reason"); v != "MISSING_AUTHORIZATION" {
			t.Errorf("event.reason=%q want MISSING_AUTHORIZATION", v)
		}
		if v := nestedString(got, "event.outcome"); v != "failure" {
			t.Errorf("event.outcome=%q want failure", v)
		}
	})
}

// Shopper middleware accepts awsiam/cert tokens too — when one of those fails
// the allowlist, resolveUserForToken writes the response and returns
// handled=true; AuthenticateShopperOrService must honor that and not call
// next. Without this assertion, a regression that ignores `handled` would let
// an unauthorized service token through on shopper-accessible routes.
func TestMiddleware_AuthenticateShopperOrService_AllowlistDenialBlocksNext(t *testing.T) {
	t.Parallel()

	claims := gdauth.NewTokenClaims(map[string]any{
		"typ": string(gdauth.AuthTypeAWSIAM),
		"jti": "shopper-mw-iam-denied",
	})
	m := &Middleware{
		authType:     "jwt",
		allowedRoles: []string{"arn:aws:iam::999:role/not-stub"}, // stubProdGDAuth returns ::123456789012:role/stub
		allowedCerts: []string{"cn.example"},
		client:       &Client{SSOHost: "https://sso.test.godaddy.com"},
		validator:    &stubProdGDAuth{claims: claims},
	}

	called := false
	h := m.AuthenticateShopperOrService(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	}))
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/budgets/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", nil)
	req.Header.Set("Authorization", "Bearer iam-token")
	h.ServeHTTP(rec, req)

	if called {
		t.Fatalf("next handler must not run when allowlist denies the token")
	}
	if rec.Code != http.StatusForbidden {
		t.Fatalf("want 403, got %d body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "IAM_ROLE_DENIED") {
		t.Fatalf("body=%s want IAM_ROLE_DENIED", rec.Body.String())
	}
}
