package auth_test

import (
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

// findAuthCookie returns the auth_idp cookie from the recorder's Set-Cookie headers.
func findAuthCookie(t *testing.T, rec *httptest.ResponseRecorder) *http.Cookie {
	t.Helper()
	for _, c := range rec.Result().Cookies() {
		if c.Name == "auth_idp" {
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
