package auth //nolint:testpackage // Tests access unexported functions (generateCodeVerifier, discoverEndpoints, etc.).

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGenerateCodeVerifier(t *testing.T) {
	verifier, err := generateCodeVerifier()
	require.NoError(t, err)
	// 32 random bytes → base64url-encoded → 43 chars
	assert.Len(t, verifier, 43)

	// Two calls produce different values
	verifier2, err := generateCodeVerifier()
	require.NoError(t, err)
	assert.NotEqual(t, verifier, verifier2)
}

func TestDeriveCodeChallenge(t *testing.T) {
	// RFC 7636 Appendix B test vector
	// code_verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
	// code_challenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
	verifier := "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
	challenge := deriveCodeChallenge(verifier)
	assert.Equal(t, "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM", challenge)
}

func TestGenerateState(t *testing.T) {
	state, err := generateState()
	require.NoError(t, err)
	// 16 random bytes → hex → 32 chars
	assert.Len(t, state, 32)

	state2, err := generateState()
	require.NoError(t, err)
	assert.NotEqual(t, state, state2)
}

func TestDiscoverEndpoints(t *testing.T) {
	t.Run("successful discovery", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			assert.Equal(t, "/.well-known/openid-configuration", r.URL.Path)
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]string{
				"authorization_endpoint": "https://idp.example.com/authorize",
				"token_endpoint":         "https://idp.example.com/token",
				"jwks_uri":               "https://idp.example.com/keys",
				"userinfo_endpoint":      "https://idp.example.com/userinfo",
			})
		}))
		t.Cleanup(server.Close)

		endpoints, err := discoverEndpoints(server.URL)
		require.NoError(t, err)
		assert.Equal(t, "https://idp.example.com/authorize", endpoints.AuthorizationEndpoint)
		assert.Equal(t, "https://idp.example.com/token", endpoints.TokenEndpoint)
		assert.Equal(t, "https://idp.example.com/keys", endpoints.JWKSUri)
	})

	t.Run("missing required endpoints", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]string{
				"jwks_uri": "https://idp.example.com/keys",
			})
		}))
		t.Cleanup(server.Close)

		_, err := discoverEndpoints(server.URL)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "missing required endpoints")
	})

	t.Run("server error", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusInternalServerError)
		}))
		t.Cleanup(server.Close)

		_, err := discoverEndpoints(server.URL)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "500")
	})

	t.Run("unreachable server", func(t *testing.T) {
		_, err := discoverEndpoints("http://127.0.0.1:1")
		assert.Error(t, err)
	})
}

func TestIDPOAuthHandler_HandleCallback(t *testing.T) {
	// Set up mock IDP servers
	tokenServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, http.MethodPost, r.Method)
		assert.Equal(t, "application/x-www-form-urlencoded", r.Header.Get("Content-Type"))

		err := r.ParseForm()
		assert.NoError(t, err)
		assert.Equal(t, "authorization_code", r.FormValue("grant_type"))
		assert.NotEmpty(t, r.FormValue("code"))
		assert.NotEmpty(t, r.FormValue("code_verifier"))

		w.Header().Set("Content-Type", "application/json")
		idToken := makeTestIDToken(t, map[string]any{"email": "user@godaddy.com", "sub": "123"})
		json.NewEncoder(w).Encode(map[string]any{
			"access_token": "access-token-abc",
			"id_token":     idToken,
			"token_type":   "Bearer",
			"expires_in":   3600,
		})
	}))
	t.Cleanup(tokenServer.Close)

	discoveryServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{
			"authorization_endpoint": "https://idp.example.com/authorize",
			"token_endpoint":         tokenServer.URL,
			"jwks_uri":               "https://idp.example.com/keys",
		})
	}))
	t.Cleanup(discoveryServer.Close)

	sessionKey := validTestKey(t)
	handler, err := NewIDPOAuthHandler(IDPOAuthConfig{
		Issuer:              discoveryServer.URL,
		ClientID:            "test-client-id",
		ClientSecret:        "test-client-secret",
		Scopes:              "openid email profile",
		CookieEncryptionKey: sessionKey,
	})
	require.NoError(t, err)

	encryptor := handler.GetEncryptor()

	t.Run("missing code parameter", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/airo/idp/callback?state=abc", nil)
		rec := httptest.NewRecorder()
		handler.HandleCallback(rec, req)
		assert.Equal(t, http.StatusBadRequest, rec.Code)
	})

	t.Run("missing state parameter", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/airo/idp/callback?code=abc", nil)
		rec := httptest.NewRecorder()
		handler.HandleCallback(rec, req)
		assert.Equal(t, http.StatusBadRequest, rec.Code)
	})

	t.Run("missing PKCE cookie", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/airo/idp/callback?code=abc&state=xyz", nil)
		rec := httptest.NewRecorder()
		handler.HandleCallback(rec, req)
		assert.Equal(t, http.StatusBadRequest, rec.Code)
	})

	t.Run("state mismatch", func(t *testing.T) {
		pkce := &IDPPKCEState{
			State:        "expected-state",
			CodeVerifier: "verifier",
			OriginalURL:  "/",
			CreatedAt:    nowUnix(),
		}
		pkceCookieRec := httptest.NewRecorder()
		err := encryptor.SetPKCECookie(pkceCookieRec, pkce)
		require.NoError(t, err)

		req := httptest.NewRequest(http.MethodGet, "/airo/idp/callback?code=abc&state=wrong-state", nil)
		req.AddCookie(pkceCookieRec.Result().Cookies()[0])
		rec := httptest.NewRecorder()
		handler.HandleCallback(rec, req)
		assert.Equal(t, http.StatusForbidden, rec.Code)
	})

	t.Run("successful callback sets session and redirects", func(t *testing.T) {
		state := "valid-state"
		pkce := &IDPPKCEState{
			State:        state,
			CodeVerifier: "test-verifier",
			OriginalURL:  "/dashboard",
			CreatedAt:    nowUnix(),
		}
		pkceCookieRec := httptest.NewRecorder()
		err := encryptor.SetPKCECookie(pkceCookieRec, pkce)
		require.NoError(t, err)

		req := httptest.NewRequest(http.MethodGet, "/airo/idp/callback?code=auth-code-123&state="+state, nil)
		req.AddCookie(pkceCookieRec.Result().Cookies()[0])
		rec := httptest.NewRecorder()
		handler.HandleCallback(rec, req)

		// Should redirect to original URL
		assert.Equal(t, http.StatusFound, rec.Code)
		assert.Equal(t, "/dashboard", rec.Header().Get("Location"))

		// Should set session cookie and clear PKCE cookie
		var hasSession, hasPKCEClear bool
		for _, c := range rec.Result().Cookies() {
			if c.Name == idpSessionCookieName && c.MaxAge > 0 {
				hasSession = true
			}
			if c.Name == idpPKCECookieName && c.MaxAge < 0 {
				hasPKCEClear = true
			}
		}
		assert.True(t, hasSession, "session cookie should be set")
		assert.True(t, hasPKCEClear, "PKCE cookie should be cleared")
	})

	t.Run("IDP error response", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet,
			"/airo/idp/callback?error=access_denied&error_description=User+cancelled", nil)
		rec := httptest.NewRecorder()
		handler.HandleCallback(rec, req)
		assert.Equal(t, http.StatusForbidden, rec.Code)
		assert.Contains(t, rec.Body.String(), "User cancelled")
	})
}

func TestIDPOAuthHandler_RedirectToIDP(t *testing.T) {
	discoveryServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{
			"authorization_endpoint": "https://idp.example.com/oauth2/v1/authorize",
			"token_endpoint":         "https://idp.example.com/token",
			"jwks_uri":               "https://idp.example.com/keys",
		})
	}))
	t.Cleanup(discoveryServer.Close)

	handler, err := NewIDPOAuthHandler(IDPOAuthConfig{
		Issuer:              discoveryServer.URL,
		ClientID:            "test-client-id",
		ClientSecret:        "test-secret",
		Scopes:              "openid email profile",
		CookieEncryptionKey: validTestKey(t),
	})
	require.NoError(t, err)

	req := httptest.NewRequest(http.MethodGet, "/protected/page", nil)
	rec := httptest.NewRecorder()
	handler.RedirectToIDP(rec, req)

	assert.Equal(t, http.StatusFound, rec.Code)

	location := rec.Header().Get("Location")
	assert.Contains(t, location, "https://idp.example.com/oauth2/v1/authorize")
	assert.Contains(t, location, "client_id=test-client-id")
	assert.Contains(t, location, "response_type=code")
	assert.Contains(t, location, "scope=openid+email+profile")
	assert.Contains(t, location, "redirect_uri=")
	assert.Contains(t, location, "code_challenge=")
	assert.Contains(t, location, "code_challenge_method=S256")
	assert.Contains(t, location, "state=")

	// Should set PKCE cookie
	cookies := rec.Result().Cookies()
	var pkceCookie *http.Cookie
	for _, c := range cookies {
		if c.Name == idpPKCECookieName {
			pkceCookie = c
		}
	}
	require.NotNil(t, pkceCookie, "PKCE cookie should be set")
	assert.Equal(t, pkceMaxAgeSec, pkceCookie.MaxAge)
}

// makeTestIDToken creates a minimal unsigned JWT with the given claims for testing.
func makeTestIDToken(t *testing.T, claims map[string]any) string {
	t.Helper()
	header := base64URLEncode([]byte(`{"alg":"none","typ":"JWT"}`))
	payload, err := json.Marshal(claims)
	require.NoError(t, err)
	return fmt.Sprintf("%s.%s.signature", header, base64URLEncode(payload))
}

func base64URLEncode(data []byte) string {
	encoded := make([]byte, base64URLEncodedLen(len(data)))
	base64URLEncodeImpl(encoded, data)
	return string(encoded)
}

// Minimal base64url encoding without padding (matches JWT standard)
func base64URLEncodedLen(n int) int {
	return (n*8 + 5) / 6
}

func base64URLEncodeImpl(dst, src []byte) {
	const encodeURL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
	di, si := 0, 0
	n := (len(src) / 3) * 3
	for si < n {
		val := uint(src[si+0])<<16 | uint(src[si+1])<<8 | uint(src[si+2])
		dst[di+0] = encodeURL[val>>18&0x3F]
		dst[di+1] = encodeURL[val>>12&0x3F]
		dst[di+2] = encodeURL[val>>6&0x3F]
		dst[di+3] = encodeURL[val&0x3F]
		si += 3
		di += 4
	}
	remain := len(src) - si
	if remain == 0 {
		return
	}
	val := uint(src[si+0]) << 16
	if remain == 2 {
		val |= uint(src[si+1]) << 8
	}
	dst[di+0] = encodeURL[val>>18&0x3F]
	dst[di+1] = encodeURL[val>>12&0x3F]
	if remain == 2 {
		dst[di+2] = encodeURL[val>>6&0x3F]
	}
}

func nowUnix() int64 {
	return time.Now().Unix()
}
