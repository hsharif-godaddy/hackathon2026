package auth_test

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"

	"github.com/airo-ai-builder/dev-supervisor/internal/auth"
)

// stubValidator implements auth.TokenValidator, returning a fixed result.
type stubValidator struct {
	result auth.ValidationResult
}

func (s *stubValidator) ValidateToken(_ string) auth.ValidationResult {
	return s.result
}

// newTestMiddleware creates a real JWTMiddleware.Wrap() handler with a stub validator.
func newTestMiddleware(t *testing.T, claims *auth.JWTClaims) http.Handler {
	t.Helper()

	siteID := ""
	if claims != nil {
		siteID = claims.SiteID
	}

	mw := auth.NewJWTMiddleware(auth.JWTMiddlewareConfig{
		Enabled: true,
		Validator: &stubValidator{
			result: auth.ValidationResult{Valid: true, Claims: claims},
		},
		SiteID: siteID,
	})

	inner := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	return mw.Wrap(inner)
}

// findAuthCookie returns the active auth_idp cookie from the recorder's Set-Cookie headers.
// Skips deletion entries (MaxAge < 0) so it returns the real partitioned cookie.
func findAuthCookie(t *testing.T, rec *httptest.ResponseRecorder) *http.Cookie {
	t.Helper()
	for _, c := range rec.Result().Cookies() {
		if c.Name == "auth_idp" && c.MaxAge >= 0 {
			return c
		}
	}
	return nil
}

// findAuthDeletionCookie returns the auth_idp deletion cookie (MaxAge < 0).
func findAuthDeletionCookie(t *testing.T, rec *httptest.ResponseRecorder) *http.Cookie {
	t.Helper()
	for _, c := range rec.Result().Cookies() {
		if c.Name == "auth_idp" && c.MaxAge < 0 {
			return c
		}
	}
	return nil
}

func TestAuthCookie_SetOnAuthorizationHeader(t *testing.T) {
	handler := newTestMiddleware(t, &auth.JWTClaims{
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(2 * time.Hour)),
		},
		SiteID: "site-1",
	})

	req := httptest.NewRequest(http.MethodGet, "/page", nil)
	req.Header.Set("Authorization", "Bearer test-token")
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}

	c := findAuthCookie(t, rec)
	if c == nil {
		t.Fatal("auth_idp cookie not set")
	}

	if !c.HttpOnly {
		t.Error("expected HttpOnly to be true")
	}
	if !c.Secure {
		t.Error("expected Secure to be true")
	}
	if c.SameSite != http.SameSiteNoneMode {
		t.Errorf("expected SameSite=None, got %v", c.SameSite)
	}
	if !c.Partitioned {
		t.Error("expected Partitioned to be true")
	}

	// Verify that a deletion cookie is also sent to clear old unpartitioned cookies
	del := findAuthDeletionCookie(t, rec)
	if del == nil {
		t.Fatal("auth_idp deletion cookie not set (needed to clear old unpartitioned cookie)")
	}
	if del.Partitioned {
		t.Error("deletion cookie must NOT be Partitioned (it targets the old unpartitioned cookie)")
	}
}

func TestAuthCookie_NotSetOnCookieAuth(t *testing.T) {
	handler := newTestMiddleware(t, &auth.JWTClaims{
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(2 * time.Hour)),
		},
		SiteID: "site-1",
	})

	req := httptest.NewRequest(http.MethodGet, "/page", nil)
	req.AddCookie(&http.Cookie{Name: "auth_idp", Value: "test-token"})
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}

	c := findAuthCookie(t, rec)
	if c != nil {
		t.Error("auth_idp cookie should NOT be set when auth comes from cookie")
	}

	del := findAuthDeletionCookie(t, rec)
	if del != nil {
		t.Error("auth_idp deletion cookie should NOT be set when auth comes from cookie")
	}
}

func TestAuthCookie_MaxAgeDerivedFromExp(t *testing.T) {
	handler := newTestMiddleware(t, &auth.JWTClaims{
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(30 * time.Minute)),
		},
		SiteID: "site-1",
	})

	req := httptest.NewRequest(http.MethodGet, "/page", nil)
	req.Header.Set("Authorization", "Bearer test-token")
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	c := findAuthCookie(t, rec)
	if c == nil {
		t.Fatal("auth_idp cookie not set")
	}

	// MaxAge should be approximately 30 minutes (1800s), allow 5s tolerance
	if c.MaxAge < 1795 || c.MaxAge > 1805 {
		t.Errorf("expected MaxAge ~1800, got %d", c.MaxAge)
	}
}

func TestAuthCookie_MaxAgeFallbackWhenNoExp(t *testing.T) {
	handler := newTestMiddleware(t, &auth.JWTClaims{
		SiteID: "site-1",
	})

	req := httptest.NewRequest(http.MethodGet, "/page", nil)
	req.Header.Set("Authorization", "Bearer test-token")
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	c := findAuthCookie(t, rec)
	if c == nil {
		t.Fatal("auth_idp cookie not set")
	}

	if c.MaxAge != 43200 {
		t.Errorf("expected fallback MaxAge 43200, got %d", c.MaxAge)
	}
}

// --- Share token cookie tests ---

// newShareValidator creates a ShareValidator backed by a stub HTTP server.
// The server returns valid=true for the given token and appID.
func newShareValidator(t *testing.T, token, appID string, expiresAt time.Time) *auth.ShareValidator {
	t.Helper()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Extract token from URL: /api/share/validate/{token}
		expectedPath := "/api/share/validate/" + token
		if r.URL.Path == expectedPath {
			w.Header().Set("Content-Type", "application/json")
			fmt.Fprintf(w, `{"valid":true,"appId":%q,"expiresAt":%d}`, appID, expiresAt.UnixMilli())
		} else {
			w.Header().Set("Content-Type", "application/json")
			fmt.Fprint(w, `{"valid":false,"reason":"unknown token"}`)
		}
	}))
	t.Cleanup(server.Close)

	return auth.NewShareValidator(server.URL)
}

// newShareMiddleware creates a JWTMiddleware configured with share token validation.
// The JWT validator always succeeds (for fallthrough tests).
func newShareMiddleware(t *testing.T, siteID string, sv *auth.ShareValidator) http.Handler {
	t.Helper()

	mw := auth.NewJWTMiddleware(auth.JWTMiddlewareConfig{
		Enabled: true,
		Validator: &stubValidator{
			result: auth.ValidationResult{Valid: true, Claims: &auth.JWTClaims{SiteID: siteID}},
		},
		ShareValidator: sv,
		SiteID:         siteID,
	})

	inner := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	return mw.Wrap(inner)
}

// findShareCookie returns the airo_share_token cookie from response, skipping deletion entries.
func findShareCookie(t *testing.T, rec *httptest.ResponseRecorder) *http.Cookie {
	t.Helper()
	for _, c := range rec.Result().Cookies() {
		if c.Name == "airo_share_token" && c.MaxAge >= 0 && c.Value != "" {
			return c
		}
	}
	return nil
}

// findShareDeletionCookies returns all airo_share_token deletion cookies (empty value or MaxAge < 0).
func findShareDeletionCookies(t *testing.T, rec *httptest.ResponseRecorder) []*http.Cookie {
	t.Helper()
	var cookies []*http.Cookie
	for _, c := range rec.Result().Cookies() {
		if c.Name == "airo_share_token" && (c.MaxAge < 0 || c.Value == "") {
			cookies = append(cookies, c)
		}
	}
	return cookies
}

func TestShareCookie_SetOnQueryParam(t *testing.T) {
	siteID := "test-site"
	sv := newShareValidator(t, "valid-share-token", siteID, time.Now().Add(1*time.Hour))
	handler := newShareMiddleware(t, siteID, sv)

	req := httptest.NewRequest(http.MethodGet, "/page?airoShareToken=valid-share-token", nil)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}

	c := findShareCookie(t, rec)
	if c == nil {
		t.Fatal("airo_share_token cookie not set")
	}

	if !c.HttpOnly {
		t.Error("expected HttpOnly to be true")
	}
	if !c.Secure {
		t.Error("expected Secure to be true")
	}
	if c.SameSite != http.SameSiteNoneMode {
		t.Errorf("expected SameSite=None, got %v", c.SameSite)
	}
	if !c.Partitioned {
		t.Error("expected Partitioned to be true")
	}

	// Verify that a deletion cookie is also sent to clear old unpartitioned cookies
	delCookies := findShareDeletionCookies(t, rec)
	if len(delCookies) == 0 {
		t.Fatal("airo_share_token deletion cookie not set (needed to clear old unpartitioned cookie)")
	}
	del := delCookies[0]
	if del.Partitioned {
		t.Error("deletion cookie must NOT be Partitioned (it targets the old unpartitioned cookie)")
	}
}

func TestShareCookie_NotSetOnCookieAuth(t *testing.T) {
	siteID := "test-site"
	sv := newShareValidator(t, "valid-share-token", siteID, time.Now().Add(1*time.Hour))
	handler := newShareMiddleware(t, siteID, sv)

	// Auth via cookie (not query param) — should NOT set a new cookie
	req := httptest.NewRequest(http.MethodGet, "/page", nil)
	req.AddCookie(&http.Cookie{Name: "airo_share_token", Value: "valid-share-token"})
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}

	c := findShareCookie(t, rec)
	if c != nil {
		t.Error("airo_share_token cookie should NOT be set when auth comes from cookie")
	}
}

func TestShareCookie_DeletionHasCorrectAttributes(t *testing.T) {
	siteID := "test-site"
	// Stub server returns valid=false for any token
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{"valid":false,"reason":"expired"}`)
	}))
	t.Cleanup(server.Close)
	sv := auth.NewShareValidator(server.URL)

	mw := auth.NewJWTMiddleware(auth.JWTMiddlewareConfig{
		Enabled: true,
		Validator: &stubValidator{
			result: auth.ValidationResult{Valid: true, Claims: &auth.JWTClaims{SiteID: siteID}},
		},
		ShareValidator: sv,
		SiteID:         siteID,
	})

	inner := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	handler := mw.Wrap(inner)

	// Send an invalid share token via cookie — should trigger deletion cookie then fall through to JWT
	req := httptest.NewRequest(http.MethodGet, "/page", nil)
	req.AddCookie(&http.Cookie{Name: "airo_share_token", Value: "invalid-token"})
	req.Header.Set("Authorization", "Bearer test-jwt") // JWT fallback so request succeeds
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}

	delCookies := findShareDeletionCookies(t, rec)
	if len(delCookies) < 2 {
		t.Fatalf("expected 2 deletion cookies (unpartitioned + partitioned), got %d", len(delCookies))
	}

	// First deletion cookie: unpartitioned variant
	unpart := delCookies[0]
	if !unpart.HttpOnly {
		t.Error("unpartitioned deletion cookie: expected HttpOnly to be true")
	}
	if !unpart.Secure {
		t.Error("unpartitioned deletion cookie: expected Secure to be true")
	}
	if unpart.SameSite != http.SameSiteNoneMode {
		t.Errorf("unpartitioned deletion cookie: expected SameSite=None, got %v", unpart.SameSite)
	}
	if unpart.Partitioned {
		t.Error("unpartitioned deletion cookie: expected Partitioned to be false")
	}

	// Second deletion cookie: partitioned variant
	part := delCookies[1]
	if !part.HttpOnly {
		t.Error("partitioned deletion cookie: expected HttpOnly to be true")
	}
	if !part.Secure {
		t.Error("partitioned deletion cookie: expected Secure to be true")
	}
	if part.SameSite != http.SameSiteNoneMode {
		t.Errorf("partitioned deletion cookie: expected SameSite=None, got %v", part.SameSite)
	}
	if !part.Partitioned {
		t.Error("partitioned deletion cookie: expected Partitioned to be true")
	}
}

func TestCookieMaxAgeFromClaims(t *testing.T) {
	tests := []struct {
		name    string
		claims  *auth.JWTClaims
		wantMin int
		wantMax int
	}{
		{
			name:    "nil claims",
			claims:  nil,
			wantMin: 43200,
			wantMax: 43200,
		},
		{
			name:    "no expiry",
			claims:  &auth.JWTClaims{},
			wantMin: 43200,
			wantMax: 43200,
		},
		{
			name: "2 hours from now",
			claims: &auth.JWTClaims{
				RegisteredClaims: jwt.RegisteredClaims{
					ExpiresAt: jwt.NewNumericDate(time.Now().Add(2 * time.Hour)),
				},
			},
			wantMin: 7195,
			wantMax: 7205,
		},
		{
			name: "already expired returns 1",
			claims: &auth.JWTClaims{
				RegisteredClaims: jwt.RegisteredClaims{
					ExpiresAt: jwt.NewNumericDate(time.Now().Add(-1 * time.Minute)),
				},
			},
			wantMin: 1,
			wantMax: 1,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := auth.CookieMaxAgeFromClaims(tt.claims)
			if got < tt.wantMin || got > tt.wantMax {
				t.Errorf("CookieMaxAgeFromClaims() = %d, want [%d, %d]", got, tt.wantMin, tt.wantMax)
			}
		})
	}
}
