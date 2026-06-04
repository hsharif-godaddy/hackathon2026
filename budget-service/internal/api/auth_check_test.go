package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	gdauth "github.com/gdcorp-identity/gd-auth-lib/go/gd_auth_lib"
	"github.com/gdcorp-partners/airo-app-builder/budget-service/internal/auth"
)

// stubValidator is a tiny GDAuthValidator that always returns the configured
// claims. principalARN / principalCN are the values returned by GetAwsIamArn /
// GetCommonName so the allowlist gates pass on routes that hit them.
type stubValidator struct {
	claims       *gdauth.TokenClaims
	principalARN string
	principalCN  string
}

func (s *stubValidator) ParseToken(_ string, _ *gdauth.AuthOptions) (*gdauth.TokenClaims, error) {
	return s.claims, nil
}
func (s *stubValidator) GetAwsIamArn(_ *gdauth.TokenClaims) (string, error) {
	return s.principalARN, nil
}
func (s *stubValidator) GetCommonName(_ *gdauth.TokenClaims) (string, error) {
	return s.principalCN, nil
}

// authCheckTestRouter wires NewRouter with the supplied middleware so
// /api/v1/auth-check goes through the real shopperOrServiceAuth chain.
func authCheckTestRouter(mw *auth.Middleware) http.Handler {
	return NewRouter(&Server{}, mw)
}

func decodeAuthCheckBody(t *testing.T, rec *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode body: %v; raw=%s", err, rec.Body.String())
	}
	return body
}

// Case 1: service IAM token via Authorization header → 200 with
// tokenType:"awsiam" and tokenSource:"header". Confirms /auth-check still
// accepts service callers after the swap to shopperOrServiceAuth.
func TestAuthCheck_ServiceHeader_EmitsTokenTypeAndSource(t *testing.T) {
	t.Parallel()

	const arn = "arn:aws:iam::123456789012:role/airo-budget"
	mw := auth.NewMiddlewareWithValidator(
		"jwt",
		[]string{arn},
		[]string{"unused.example.com"},
		"https://sso.test.godaddy.com",
		&stubValidator{
			claims: gdauth.NewTokenClaims(map[string]any{
				"typ": string(gdauth.AuthTypeAWSIAM),
				"jti": "auth-check-iam",
			}),
			principalARN: arn,
		},
	)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth-check", nil)
	req.Header.Set("Authorization", "Bearer iam-token")
	authCheckTestRouter(mw).ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	body := decodeAuthCheckBody(t, rec)
	if got := body["tokenType"]; got != "awsiam" {
		t.Errorf("tokenType=%v want awsiam", got)
	}
	if got := body["tokenSource"]; got != "header" {
		t.Errorf("tokenSource=%v want header", got)
	}
	if got, _ := body["message"].(string); !strings.Contains(got, "awsiam token accepted") {
		t.Errorf("message=%q want substring 'awsiam token accepted'", got)
	}
}

// Case 2: shopper idp token via auth_idp cookie → 200 with tokenType:"idp"
// and tokenSource:"cookie". This is the new behavior the change exists to
// enable.
func TestAuthCheck_ShopperCookie_EmitsTokenTypeAndSource(t *testing.T) {
	t.Parallel()

	mw := auth.NewMiddlewareWithValidator(
		"jwt",
		[]string{"arn:aws:iam::123:role/x"},
		[]string{"cn.example"},
		"https://sso.test.godaddy.com",
		&stubValidator{
			claims: gdauth.NewTokenClaims(map[string]any{
				"typ": string(gdauth.AuthTypeIDP),
				"jti": "auth-check-shopper-cookie",
			}),
		},
	)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth-check", nil)
	req.AddCookie(&http.Cookie{Name: "auth_idp", Value: "shopper-cookie-value"})
	authCheckTestRouter(mw).ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	body := decodeAuthCheckBody(t, rec)
	if got := body["tokenType"]; got != "idp" {
		t.Errorf("tokenType=%v want idp", got)
	}
	if got := body["tokenSource"]; got != "cookie" {
		t.Errorf("tokenSource=%v want cookie", got)
	}
	if got, _ := body["message"].(string); !strings.Contains(got, "idp token accepted") {
		t.Errorf("message=%q want substring 'idp token accepted'", got)
	}
}

// Case 3: no Authorization header and no auth_idp cookie → 401
// MISSING_AUTHORIZATION from AuthenticateShopperOrService.
func TestAuthCheck_NoCredentials_Returns401(t *testing.T) {
	t.Parallel()

	mw := auth.NewMiddlewareWithValidator(
		"jwt",
		[]string{"arn:aws:iam::123:role/x"},
		[]string{"cn.example"},
		"https://sso.test.godaddy.com",
		&stubValidator{},
	)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth-check", nil)
	authCheckTestRouter(mw).ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("want 401, got %d body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "MISSING_AUTHORIZATION") {
		t.Fatalf("want MISSING_AUTHORIZATION, got %s", rec.Body.String())
	}
}

// Case 4: authType="none" bypasses the middleware so claims is nil. The
// handler's auth-disabled branch returns the legacy "none (auth disabled)"
// body with no tokenType or tokenSource fields.
func TestAuthCheck_AuthDisabled_ReturnsLegacyBody(t *testing.T) {
	t.Parallel()

	mw := auth.NewMiddleware("none", nil, nil)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth-check", nil)
	authCheckTestRouter(mw).ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	body := decodeAuthCheckBody(t, rec)
	if got, _ := body["message"].(string); got != "none (auth disabled)" {
		t.Errorf("message=%q want %q", got, "none (auth disabled)")
	}
	if _, ok := body["tokenType"]; ok {
		t.Errorf("auth-disabled body should not include tokenType: %v", body)
	}
	if _, ok := body["tokenSource"]; ok {
		t.Errorf("auth-disabled body should not include tokenSource: %v", body)
	}
}
