package auth //nolint:testpackage // Tests access unexported types and helpers.

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// idpMiddlewareTestEnv bundles the moving parts an IDP middleware test needs:
// the auth.json file, the loader, the middleware itself, and the OAuth handler
// (built lazily by the middleware, returned here so tests can mint cookies
// keyed to its encryption key).
type idpMiddlewareTestEnv struct {
	authPath      string
	discoveryURL  string
	loader        *SecretsLoader
	mw            *IDPAuthMiddleware
	clientID      string
	clientSecret  string
	encryptor     *SessionEncryptor // resolved on first call to resolveEncryptor
	encryptorOnce sync.Once         // ensures encryptor is resolved at most once
}

// writeAuthJSONFile writes the three-row format auth.json the SecretsLoader
// expects. Pass ssoRequired=false to test the passthrough path.
func writeAuthJSONFile(t *testing.T, path, issuer, clientID, clientSecret string, ssoRequired bool) {
	t.Helper()
	const clientIDKey = "TEST_SSO_CLIENT_ID"
	const clientSecretKey = "TEST_SSO_CLIENT_SECRET"
	contents := map[string]any{
		"SSO_OAUTH_CONFIG": map[string]any{
			"SYSTEM_MANAGED": true,
			"AUTH":           true,
			"VALUE": map[string]any{
				"idpType":          "test",
				"issuer":           issuer,
				"jwksUrl":          issuer + "/keys",
				"expectedAudience": "",
				"ssoRequired":      ssoRequired,
				"clientIdKey":      clientIDKey,
				"clientSecretKey":  clientSecretKey,
			},
		},
		clientIDKey: map[string]any{
			"SYSTEM_MANAGED": false,
			"AUTH":           true,
			"VALUE":          clientID,
		},
		clientSecretKey: map[string]any{
			"SYSTEM_MANAGED": false,
			"AUTH":           true,
			"VALUE":          clientSecret,
		},
	}
	data, err := json.Marshal(contents)
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(path, data, 0o600))
}

// newTestIDPMiddlewareEnv spins up a test discovery server, writes an
// auth.json fixture, and constructs the middleware with a real
// SecretsLoader pointing at the file.
func newTestIDPMiddlewareEnv(t *testing.T) *idpMiddlewareTestEnv {
	t.Helper()

	discoveryServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{
			"authorization_endpoint": "https://idp.example.com/authorize",
			"token_endpoint":         "https://idp.example.com/token",
			"jwks_uri":               "https://idp.example.com/keys",
		})
	}))
	t.Cleanup(discoveryServer.Close)

	dir := t.TempDir()
	authPath := filepath.Join(dir, "auth.json")
	clientID := "test-client-id"
	clientSecret := "test-client-secret"
	writeAuthJSONFile(t, authPath, discoveryServer.URL, clientID, clientSecret, true)

	loader := NewSecretsLoader(authPath)
	// Short TTL so race-window tests pick up file changes promptly without
	// having to reach in and reset the cache manually.
	loader.ttl = 5 * time.Millisecond

	mw := NewIDPAuthMiddleware(IDPAuthMiddlewareConfig{
		Enabled:       true,
		AuthLoader:    loader,
		ExcludedPaths: []string{"/airo/health", "/airo/idp/callback"},
	})

	return &idpMiddlewareTestEnv{
		authPath:     authPath,
		discoveryURL: discoveryServer.URL,
		loader:       loader,
		mw:           mw,
		clientID:     clientID,
		clientSecret: clientSecret,
	}
}

// resolveEncryptor triggers the lazy handler build (via GetOAuthHandler) and
// returns the SessionEncryptor whose key matches the cookies the middleware
// will accept. Cached so repeated calls don't churn the handler.
func (e *idpMiddlewareTestEnv) resolveEncryptor(t *testing.T) *SessionEncryptor {
	t.Helper()
	e.encryptorOnce.Do(func() {
		oauthHandler, err := e.mw.GetOAuthHandler()
		require.NoError(t, err)
		e.encryptor = oauthHandler.GetEncryptor()
	})
	return e.encryptor
}

func TestIDPAuthMiddleware_Disabled(t *testing.T) {
	mw := NewIDPAuthMiddleware(IDPAuthMiddlewareConfig{
		Enabled: false,
	})

	called := false
	inner := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	})

	req := httptest.NewRequest(http.MethodGet, "/page", nil)
	rec := httptest.NewRecorder()
	mw.Wrap(inner).ServeHTTP(rec, req)

	assert.True(t, called, "inner handler should be called when middleware is disabled")
	assert.Equal(t, http.StatusOK, rec.Code)
}

func TestIDPAuthMiddleware_ExcludedPaths(t *testing.T) {
	env := newTestIDPMiddlewareEnv(t)

	tests := []struct {
		name string
		path string
	}{
		{"health endpoint", "/airo/health"},
		{"IDP callback", "/airo/idp/callback"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			called := false
			inner := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				called = true
				w.WriteHeader(http.StatusOK)
			})

			req := httptest.NewRequest(http.MethodGet, tt.path, nil)
			rec := httptest.NewRecorder()
			env.mw.Wrap(inner).ServeHTTP(rec, req)

			assert.True(t, called, "inner handler should be called for excluded path %s", tt.path)
			assert.Equal(t, http.StatusOK, rec.Code)
		})
	}
}

func TestIDPAuthMiddleware_ValidSession(t *testing.T) {
	env := newTestIDPMiddlewareEnv(t)
	encryptor := env.resolveEncryptor(t)

	session := &IDPSession{
		AccessToken: "valid-token",
		ExpiresAt:   time.Now().Add(1 * time.Hour).Unix(),
	}
	cookieRec := httptest.NewRecorder()
	require.NoError(t, encryptor.SetSessionCookie(cookieRec, session))

	called := false
	inner := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	})

	req := httptest.NewRequest(http.MethodGet, "/protected/page", nil)
	req.AddCookie(cookieRec.Result().Cookies()[0])
	rec := httptest.NewRecorder()
	env.mw.Wrap(inner).ServeHTTP(rec, req)

	assert.True(t, called, "inner handler should be called with valid session")
	assert.Equal(t, http.StatusOK, rec.Code)
}

func TestIDPAuthMiddleware_NoSession_BrowserRedirect(t *testing.T) {
	env := newTestIDPMiddlewareEnv(t)

	called := false
	inner := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	})

	req := httptest.NewRequest(http.MethodGet, "/protected/page", nil)
	req.Header.Set("Accept", "text/html")
	rec := httptest.NewRecorder()
	env.mw.Wrap(inner).ServeHTTP(rec, req)

	assert.False(t, called, "inner handler should NOT be called without session")
	assert.Equal(t, http.StatusFound, rec.Code)

	location := rec.Header().Get("Location")
	assert.Contains(t, location, "https://idp.example.com/authorize")
	assert.Contains(t, location, "client_id=test-client-id")
}

func TestIDPAuthMiddleware_NoSession_API401(t *testing.T) {
	env := newTestIDPMiddlewareEnv(t)

	called := false
	inner := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	})

	tests := []struct {
		name   string
		path   string
		accept string
		ctype  string
	}{
		{"API path", "/api/data", "", ""},
		{"JSON Accept header", "/page", "application/json", ""},
		{"JSON Content-Type", "/page", "", "application/json"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			called = false
			req := httptest.NewRequest(http.MethodGet, tt.path, nil)
			if tt.accept != "" {
				req.Header.Set("Accept", tt.accept)
			}
			if tt.ctype != "" {
				req.Header.Set("Content-Type", tt.ctype)
			}
			rec := httptest.NewRecorder()
			env.mw.Wrap(inner).ServeHTTP(rec, req)

			assert.False(t, called, "inner handler should NOT be called")
			assert.Equal(t, http.StatusUnauthorized, rec.Code)
			assert.Equal(t, "Bearer", rec.Header().Get("WWW-Authenticate"))
		})
	}
}

func TestIDPAuthMiddleware_ExpiredSession(t *testing.T) {
	env := newTestIDPMiddlewareEnv(t)
	encryptor := env.resolveEncryptor(t)

	expiredSession := &IDPSession{
		AccessToken: "expired-token",
		ExpiresAt:   time.Now().Add(-1 * time.Hour).Unix(),
	}
	cookieRec := httptest.NewRecorder()
	require.NoError(t, encryptor.SetSessionCookie(cookieRec, expiredSession))

	called := false
	inner := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	})

	req := httptest.NewRequest(http.MethodGet, "/protected/page", nil)
	req.AddCookie(cookieRec.Result().Cookies()[0])
	req.Header.Set("Accept", "text/html,application/xhtml+xml")
	rec := httptest.NewRecorder()
	env.mw.Wrap(inner).ServeHTTP(rec, req)

	assert.False(t, called, "inner handler should NOT be called with expired session")
	assert.Equal(t, http.StatusFound, rec.Code)
}

// TestIDPAuthMiddleware_AuthFileMissing — non-ent / boot-window passthrough.
// When auth.json doesn't exist at the loader path, every request passes
// through unchanged. This is the dev-supervisor-is-not-canonical posture
// (mhp-core §3.5.1): the publish-prerequisite gate at hosting is the
// authoritative authority.
func TestIDPAuthMiddleware_AuthFileMissing(t *testing.T) {
	dir := t.TempDir()
	// No auth.json file in dir → loader will get ENOENT
	loader := NewSecretsLoader(filepath.Join(dir, "auth.json"))

	mw := NewIDPAuthMiddleware(IDPAuthMiddlewareConfig{
		Enabled:    true,
		AuthLoader: loader,
	})

	called := false
	inner := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	})

	req := httptest.NewRequest(http.MethodGet, "/protected/page", nil)
	req.Header.Set("Accept", "text/html")
	rec := httptest.NewRecorder()
	mw.Wrap(inner).ServeHTTP(rec, req)

	assert.True(t, called, "missing auth.json should pass through (non-ent path)")
	assert.Equal(t, http.StatusOK, rec.Code)
}

// TestIDPAuthMiddleware_SSORequiredFalse — auth.json present but the cache
// row says SSO is not required for this app. Same passthrough behavior as
// missing file.
func TestIDPAuthMiddleware_SSORequiredFalse(t *testing.T) {
	dir := t.TempDir()
	authPath := filepath.Join(dir, "auth.json")
	writeAuthJSONFile(t, authPath, "https://example.com", "cid", "csecret", false)

	loader := NewSecretsLoader(authPath)
	mw := NewIDPAuthMiddleware(IDPAuthMiddlewareConfig{
		Enabled:    true,
		AuthLoader: loader,
	})

	called := false
	inner := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	})

	req := httptest.NewRequest(http.MethodGet, "/page", nil)
	rec := httptest.NewRecorder()
	mw.Wrap(inner).ServeHTTP(rec, req)

	assert.True(t, called, "ssoRequired=false should pass through")
	assert.Equal(t, http.StatusOK, rec.Code)
}

// TestIDPAuthMiddleware_RaceFilesAppearsBetweenRequests reproduces the
// bug-this-PR-fixes scenario: dev-supervisor starts before the hosting
// secrets tar lands /alloc/auth.json. With the old boot-time init the
// first request passed through and ALL subsequent requests passed through
// (no re-check). With the lazy-load fix the first request passes through
// (file missing) and the next request — after the file is created —
// enforces correctly. No container restart required.
func TestIDPAuthMiddleware_RaceFilesAppearsBetweenRequests(t *testing.T) {
	dir := t.TempDir()
	authPath := filepath.Join(dir, "auth.json")

	discoveryServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{
			"authorization_endpoint": "https://idp.example.com/authorize",
			"token_endpoint":         "https://idp.example.com/token",
			"jwks_uri":               "https://idp.example.com/keys",
		})
	}))
	t.Cleanup(discoveryServer.Close)

	loader := NewSecretsLoader(authPath)
	loader.ttl = 1 * time.Millisecond // bypass cache between requests

	mw := NewIDPAuthMiddleware(IDPAuthMiddlewareConfig{
		Enabled:    true,
		AuthLoader: loader,
	})

	called := false
	inner := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	})

	// First request: file doesn't exist yet → passthrough (file genuinely
	// missing OR boot-before-secrets window).
	req1 := httptest.NewRequest(http.MethodGet, "/page", nil)
	req1.Header.Set("Accept", "text/html")
	rec1 := httptest.NewRecorder()
	mw.Wrap(inner).ServeHTTP(rec1, req1)
	assert.True(t, called, "first request before auth.json exists should pass through")
	assert.Equal(t, http.StatusOK, rec1.Code)

	// Hosting drops auth.json mid-life.
	writeAuthJSONFile(t, authPath, discoveryServer.URL, "test-cid", "test-csecret", true)
	time.Sleep(5 * time.Millisecond) // ensure loader TTL has elapsed

	// Second request: file now exists and ssoRequired=true → enforce.
	// Browser navigation (Accept: text/html) → redirect to IDP.
	called = false
	req2 := httptest.NewRequest(http.MethodGet, "/page", nil)
	req2.Header.Set("Accept", "text/html")
	rec2 := httptest.NewRecorder()
	mw.Wrap(inner).ServeHTTP(rec2, req2)
	assert.False(t, called, "after auth.json appears the request must NOT pass through")
	assert.Equal(t, http.StatusFound, rec2.Code, "should redirect to IDP")
	assert.Contains(t, rec2.Header().Get("Location"), "https://idp.example.com/authorize")
}

// TestIDPAuthMiddleware_HandlerCachedAcrossRequests — once the OAuth handler
// is built, subsequent requests reuse it (don't rebuild on every hit).
// Indirect assertion: the same fingerprint must stay valid → cookies set by
// one request must be accepted by the next.
func TestIDPAuthMiddleware_HandlerCachedAcrossRequests(t *testing.T) {
	env := newTestIDPMiddlewareEnv(t)
	encryptor := env.resolveEncryptor(t)

	// Mint a session cookie using the lazily-built handler.
	session := &IDPSession{
		AccessToken: "cached-token",
		ExpiresAt:   time.Now().Add(1 * time.Hour).Unix(),
	}
	cookieRec := httptest.NewRecorder()
	require.NoError(t, encryptor.SetSessionCookie(cookieRec, session))

	// Verify session works across multiple requests without rebuilding.
	// Note: cache TTL is 5ms in newTestIDPMiddlewareEnv. We deliberately
	// sleep past it between requests to force the loader to re-read, but
	// the fingerprint stays the same so the handler is NOT rebuilt.
	for i := range 3 {
		called := false
		inner := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			called = true
			w.WriteHeader(http.StatusOK)
		})
		req := httptest.NewRequest(http.MethodGet, "/page", nil)
		req.AddCookie(cookieRec.Result().Cookies()[0])
		rec := httptest.NewRecorder()
		env.mw.Wrap(inner).ServeHTTP(rec, req)
		assert.True(t, called, "request %d should pass through with cached handler", i)
		time.Sleep(10 * time.Millisecond) // outlive loader TTL
	}
}

// TestIDPAuthMiddleware_ClientSecretRotation — when client_secret changes
// in auth.json, the middleware rebuilds the OAuth handler with the new
// encryption key. Existing cookies (encrypted with the old key) stop
// being accepted, forcing re-authentication. This is the acceptable
// rotation cost.
func TestIDPAuthMiddleware_ClientSecretRotation(t *testing.T) {
	env := newTestIDPMiddlewareEnv(t)
	originalEncryptor := env.resolveEncryptor(t)

	// Mint a cookie with the original encryption key.
	session := &IDPSession{
		AccessToken: "pre-rotation-token",
		ExpiresAt:   time.Now().Add(1 * time.Hour).Unix(),
	}
	cookieRec := httptest.NewRecorder()
	require.NoError(t, originalEncryptor.SetSessionCookie(cookieRec, session))

	// Rotate the client_secret in the auth.json fixture. Use env.clientSecret
	// to anchor the "before" state and a distinct value for the "after".
	require.NotEmpty(t, env.clientSecret, "fixture must have an initial secret")
	writeAuthJSONFile(t, env.authPath, env.discoveryURL, env.clientID, env.clientSecret+"-rotated", true)
	time.Sleep(10 * time.Millisecond) // outlive loader TTL

	// Same cookie under the new key → should NOT validate; request redirects.
	called := false
	inner := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	})
	req := httptest.NewRequest(http.MethodGet, "/protected/page", nil)
	req.AddCookie(cookieRec.Result().Cookies()[0])
	req.Header.Set("Accept", "text/html")
	rec := httptest.NewRecorder()
	env.mw.Wrap(inner).ServeHTTP(rec, req)

	assert.False(t, called, "old cookie must NOT be accepted after secret rotation")
	assert.Equal(t, http.StatusFound, rec.Code, "should redirect to IDP")

	// New handler exists and its encryptor differs from the old one — we can
	// freshly mint a cookie that DOES validate against the new key.
	newHandler, err := env.mw.GetOAuthHandler()
	require.NoError(t, err)
	newEncryptor := newHandler.GetEncryptor()
	assert.NotSame(t, originalEncryptor, newEncryptor,
		"middleware must rebuild the OAuth handler on client_secret rotation")
}

// TestIDPAuthMiddleware_NilLoader — defensive: if someone constructs the
// middleware without a loader, fail open. The canonical hosting gate
// still applies; better than a panic.
func TestIDPAuthMiddleware_NilLoader(t *testing.T) {
	mw := NewIDPAuthMiddleware(IDPAuthMiddlewareConfig{
		Enabled:    true,
		AuthLoader: nil,
	})

	called := false
	inner := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	})

	req := httptest.NewRequest(http.MethodGet, "/page", nil)
	rec := httptest.NewRecorder()
	mw.Wrap(inner).ServeHTTP(rec, req)

	assert.True(t, called, "nil loader should fail open (passthrough)")
	assert.Equal(t, http.StatusOK, rec.Code)
}

// TestIDPAuthMiddleware_GetOAuthHandler_NotRequired — the callback handler
// resolution should report a clear error when SSO isn't required, so the
// callback route can respond with 503 instead of panicking.
func TestIDPAuthMiddleware_GetOAuthHandler_NotRequired(t *testing.T) {
	dir := t.TempDir()
	authPath := filepath.Join(dir, "auth.json")
	writeAuthJSONFile(t, authPath, "https://example.com", "cid", "csec", false)

	mw := NewIDPAuthMiddleware(IDPAuthMiddlewareConfig{
		Enabled:    true,
		AuthLoader: NewSecretsLoader(authPath),
	})

	_, err := mw.GetOAuthHandler()
	require.Error(t, err)
	assert.Contains(t, err.Error(), "SSO not required")
}

// TestIDPAuthMiddleware_GetOAuthHandler_NoFile — same callback resolution
// path when auth.json is genuinely missing (boot window or non-ent app).
func TestIDPAuthMiddleware_GetOAuthHandler_NoFile(t *testing.T) {
	dir := t.TempDir()
	mw := NewIDPAuthMiddleware(IDPAuthMiddlewareConfig{
		Enabled:    true,
		AuthLoader: NewSecretsLoader(filepath.Join(dir, "auth.json")),
	})
	_, err := mw.GetOAuthHandler()
	require.Error(t, err)
	assert.Contains(t, err.Error(), "load auth.json")
}
