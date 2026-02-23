package auth

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// testHandler is a simple handler that writes "OK" to verify the request passed through.
func testHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("OK"))
	})
}

func TestMiddleware_Authenticate_NoAuth(t *testing.T) {
	// Create middleware with authType="none"
	middleware := NewMiddleware("none", "", "", "", "")

	// Create test request without any auth header
	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	rec := httptest.NewRecorder()

	// Apply middleware
	handler := middleware.Authenticate(testHandler())
	handler.ServeHTTP(rec, req)

	// Should pass through without auth
	if rec.Code != http.StatusOK {
		t.Errorf("expected status %d, got %d", http.StatusOK, rec.Code)
	}
	if rec.Body.String() != "OK" {
		t.Errorf("expected body 'OK', got %q", rec.Body.String())
	}
}

func TestMiddleware_Authenticate_MissingHeader(t *testing.T) {
	// Generate RSA key pair and mock JWKS server
	privateKey := createTestRSAKeyPair(t)
	publicKey := &privateKey.PublicKey
	kid := "test-key-id"
	server := createMockJWKSServer(t, publicKey, kid)
	defer server.Close()

	// Create middleware with JWT auth
	middleware := NewMiddleware("jwt", server.URL, "issuer", "audience", "")

	// Create test request without auth header
	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	rec := httptest.NewRecorder()

	// Apply middleware
	handler := middleware.Authenticate(testHandler())
	handler.ServeHTTP(rec, req)

	// Should return 401
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("expected status %d, got %d", http.StatusUnauthorized, rec.Code)
	}

	// Check JSON error response
	var response map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
		t.Fatalf("failed to unmarshal response: %v", err)
	}
	if response["error"] != "missing authorization header" {
		t.Errorf("expected error 'missing authorization header', got %q", response["error"])
	}
}

func TestMiddleware_Authenticate_InvalidFormat(t *testing.T) {
	// Generate RSA key pair and mock JWKS server
	privateKey := createTestRSAKeyPair(t)
	publicKey := &privateKey.PublicKey
	kid := "test-key-id"
	server := createMockJWKSServer(t, publicKey, kid)
	defer server.Close()

	// Create middleware with JWT auth
	middleware := NewMiddleware("jwt", server.URL, "issuer", "audience", "")

	// Create test request with Basic auth instead of Bearer
	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	req.Header.Set("Authorization", "Basic xyz")
	rec := httptest.NewRecorder()

	// Apply middleware
	handler := middleware.Authenticate(testHandler())
	handler.ServeHTTP(rec, req)

	// Should return 401
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("expected status %d, got %d", http.StatusUnauthorized, rec.Code)
	}

	// Check JSON error response
	var response map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
		t.Fatalf("failed to unmarshal response: %v", err)
	}
	if response["error"] != "invalid authorization format" {
		t.Errorf("expected error 'invalid authorization format', got %q", response["error"])
	}
}

func TestMiddleware_Authenticate_ValidToken(t *testing.T) {
	// Generate RSA key pair and mock JWKS server
	privateKey := createTestRSAKeyPair(t)
	publicKey := &privateKey.PublicKey
	kid := "test-key-id"
	server := createMockJWKSServer(t, publicKey, kid)
	defer server.Close()

	// Create middleware with JWT auth - use "airo-app" issuer for token type detection
	issuer := "airo-app"
	audience := "test-audience"
	middleware := NewMiddleware("jwt", server.URL, issuer, audience, "")

	// Create valid token with iss=airo-app to be detected as airo-app token type
	claims := jwt.MapClaims{
		"iss": issuer,
		"aud": audience,
		"sub": "user123",
		"exp": time.Now().Add(time.Hour).Unix(),
		"iat": time.Now().Unix(),
	}
	tokenString := createTestToken(t, privateKey, kid, claims)

	// Create test request with valid Bearer token
	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	req.Header.Set("Authorization", "Bearer "+tokenString)
	rec := httptest.NewRecorder()

	// Apply middleware
	handler := middleware.Authenticate(testHandler())
	handler.ServeHTTP(rec, req)

	// Should pass through
	if rec.Code != http.StatusOK {
		t.Errorf("expected status %d, got %d", http.StatusOK, rec.Code)
	}
	if rec.Body.String() != "OK" {
		t.Errorf("expected body 'OK', got %q", rec.Body.String())
	}
}

func TestMiddleware_Authenticate_InvalidToken(t *testing.T) {
	// Generate RSA key pair and mock JWKS server
	privateKey := createTestRSAKeyPair(t)
	publicKey := &privateKey.PublicKey
	kid := "test-key-id"
	server := createMockJWKSServer(t, publicKey, kid)
	defer server.Close()

	// Create middleware with JWT auth
	middleware := NewMiddleware("jwt", server.URL, "airo-app", "audience", "")

	// Create a properly structured but invalid token (wrong signature)
	// Build a token with iss=airo-app so it's detected as airo-app type
	claims := jwt.MapClaims{
		"iss": "airo-app",
		"aud": "audience",
		"sub": "user123",
		"exp": time.Now().Add(time.Hour).Unix(),
	}
	// Use a different key to sign, making the signature invalid when verified
	otherKey := createTestRSAKeyPair(t)
	tokenString := createTestToken(t, otherKey, kid, claims)

	// Create test request with invalid token (signed by wrong key)
	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	req.Header.Set("Authorization", "Bearer "+tokenString)
	rec := httptest.NewRecorder()

	// Apply middleware
	handler := middleware.Authenticate(testHandler())
	handler.ServeHTTP(rec, req)

	// Should return 401
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("expected status %d, got %d", http.StatusUnauthorized, rec.Code)
	}

	// Check JSON error response
	var response map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
		t.Fatalf("failed to unmarshal response: %v", err)
	}
	if response["error"] != "invalid token" {
		t.Errorf("expected error 'invalid token', got %q", response["error"])
	}
}

func TestMiddleware_Authenticate_ExpiredToken(t *testing.T) {
	// Generate RSA key pair and mock JWKS server
	privateKey := createTestRSAKeyPair(t)
	publicKey := &privateKey.PublicKey
	kid := "test-key-id"
	server := createMockJWKSServer(t, publicKey, kid)
	defer server.Close()

	// Create middleware with JWT auth - use "airo-app" issuer for token type detection
	issuer := "airo-app"
	audience := "test-audience"
	middleware := NewMiddleware("jwt", server.URL, issuer, audience, "")

	// Create expired token with iss=airo-app
	claims := jwt.MapClaims{
		"iss": issuer,
		"aud": audience,
		"sub": "user123",
		"exp": time.Now().Add(-time.Hour).Unix(), // Expired
		"iat": time.Now().Add(-2 * time.Hour).Unix(),
	}
	tokenString := createTestToken(t, privateKey, kid, claims)

	// Create test request with expired token
	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	req.Header.Set("Authorization", "Bearer "+tokenString)
	rec := httptest.NewRecorder()

	// Apply middleware
	handler := middleware.Authenticate(testHandler())
	handler.ServeHTTP(rec, req)

	// Should return 401
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("expected status %d, got %d", http.StatusUnauthorized, rec.Code)
	}

	// Check JSON error response
	var response map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
		t.Fatalf("failed to unmarshal response: %v", err)
	}
	if response["error"] != "invalid token" {
		t.Errorf("expected error 'invalid token', got %q", response["error"])
	}
}

func TestMiddleware_Authenticate_EmptyToken(t *testing.T) {
	// Generate RSA key pair and mock JWKS server
	privateKey := createTestRSAKeyPair(t)
	publicKey := &privateKey.PublicKey
	kid := "test-key-id"
	server := createMockJWKSServer(t, publicKey, kid)
	defer server.Close()

	// Create middleware with JWT auth
	middleware := NewMiddleware("jwt", server.URL, "issuer", "audience", "")

	// Create test request with empty Bearer token
	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	req.Header.Set("Authorization", "Bearer ")
	rec := httptest.NewRecorder()

	// Apply middleware
	handler := middleware.Authenticate(testHandler())
	handler.ServeHTTP(rec, req)

	// Should return 401
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("expected status %d, got %d", http.StatusUnauthorized, rec.Code)
	}

	// Check JSON error response
	var response map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
		t.Fatalf("failed to unmarshal response: %v", err)
	}
	if response["error"] != "empty token" {
		t.Errorf("expected error 'empty token', got %q", response["error"])
	}
}

func TestMiddleware_DualAuth(t *testing.T) {
	// Generate RSA key pair and mock JWKS server for airo-app tokens
	privateKey := createTestRSAKeyPair(t)
	publicKey := &privateKey.PublicKey
	kid := "test-key-id"
	jwksServer := createMockJWKSServer(t, publicKey, kid)
	defer jwksServer.Close()

	// Create mock SSO server for JOMAX keys
	ssoServer := createMockSSOServer(t, publicKey, kid)
	defer ssoServer.Close()

	// Create middleware with dual auth
	middleware := NewMiddleware("jwt", jwksServer.URL, "airo-app", "test-audience", ssoServer.URL)

	// Verify both validators are initialized
	if middleware.airoValidator == nil {
		t.Error("expected airoValidator to be initialized")
	}
	if middleware.jomaxValidator == nil {
		t.Error("expected jomaxValidator to be initialized")
	}
}

func TestMiddleware_DualAuth_AiroAppToken(t *testing.T) {
	// Generate RSA key pair and mock JWKS server for airo-app tokens
	privateKey := createTestRSAKeyPair(t)
	publicKey := &privateKey.PublicKey
	kid := "test-key-id"
	jwksServer := createMockJWKSServer(t, publicKey, kid)
	defer jwksServer.Close()

	// Create mock SSO server for JOMAX keys
	ssoServer := createMockSSOServer(t, publicKey, kid)
	defer ssoServer.Close()

	// Create middleware with dual auth
	middleware := NewMiddleware("jwt", jwksServer.URL, "airo-app", "test-audience", ssoServer.URL)

	// Create valid airo-app token
	claims := jwt.MapClaims{
		"iss": "airo-app",
		"aud": "test-audience",
		"sub": "user123",
		"exp": time.Now().Add(time.Hour).Unix(),
		"iat": time.Now().Unix(),
	}
	tokenString := createTestToken(t, privateKey, kid, claims)

	// Create test request with valid airo-app Bearer token
	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	req.Header.Set("Authorization", "Bearer "+tokenString)
	rec := httptest.NewRecorder()

	// Apply middleware
	handler := middleware.Authenticate(testHandler())
	handler.ServeHTTP(rec, req)

	// Should pass through
	if rec.Code != http.StatusOK {
		t.Errorf("expected status %d, got %d", http.StatusOK, rec.Code)
	}
	if rec.Body.String() != "OK" {
		t.Errorf("expected body 'OK', got %q", rec.Body.String())
	}
}

func TestMiddleware_DualAuth_JomaxToken(t *testing.T) {
	// Generate RSA key pair and mock JWKS server for airo-app tokens
	privateKey := createTestRSAKeyPair(t)
	publicKey := &privateKey.PublicKey
	kid := "test-key-id"
	jwksServer := createMockJWKSServer(t, publicKey, kid)
	defer jwksServer.Close()

	// Create mock SSO server for JOMAX keys
	ssoServer := createMockSSOServer(t, publicKey, kid)
	defer ssoServer.Close()

	// Create middleware with dual auth
	middleware := NewMiddleware("jwt", jwksServer.URL, "airo-app", "test-audience", ssoServer.URL)

	// Create valid JOMAX token (has shopperId claim)
	claims := jwt.MapClaims{
		"shopperId": "12345678",
		"sub":       "employee123",
		"exp":       time.Now().Add(time.Hour).Unix(),
		"iat":       time.Now().Unix(),
	}
	tokenString := createTestToken(t, privateKey, kid, claims)

	// Create test request with valid JOMAX Bearer token
	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	req.Header.Set("Authorization", "Bearer "+tokenString)
	rec := httptest.NewRecorder()

	// Apply middleware
	handler := middleware.Authenticate(testHandler())
	handler.ServeHTTP(rec, req)

	// Should pass through
	if rec.Code != http.StatusOK {
		t.Errorf("expected status %d, got %d", http.StatusOK, rec.Code)
	}
	if rec.Body.String() != "OK" {
		t.Errorf("expected body 'OK', got %q", rec.Body.String())
	}
}

func TestMiddleware_DualAuth_UnknownToken(t *testing.T) {
	// Generate RSA key pair and mock JWKS server for airo-app tokens
	privateKey := createTestRSAKeyPair(t)
	publicKey := &privateKey.PublicKey
	kid := "test-key-id"
	jwksServer := createMockJWKSServer(t, publicKey, kid)
	defer jwksServer.Close()

	// Create mock SSO server for JOMAX keys
	ssoServer := createMockSSOServer(t, publicKey, kid)
	defer ssoServer.Close()

	// Create middleware with dual auth
	middleware := NewMiddleware("jwt", jwksServer.URL, "airo-app", "test-audience", ssoServer.URL)

	// Create token with unknown type (no iss=airo-app, no per, no shopperId)
	claims := jwt.MapClaims{
		"iss": "some-other-issuer",
		"sub": "user123",
		"exp": time.Now().Add(time.Hour).Unix(),
		"iat": time.Now().Unix(),
	}
	tokenString := createTestToken(t, privateKey, kid, claims)

	// Create test request with unknown token type
	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	req.Header.Set("Authorization", "Bearer "+tokenString)
	rec := httptest.NewRecorder()

	// Apply middleware
	handler := middleware.Authenticate(testHandler())
	handler.ServeHTTP(rec, req)

	// Should return 401 for unknown token type
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("expected status %d, got %d", http.StatusUnauthorized, rec.Code)
	}

	// Check JSON error response
	var response map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
		t.Fatalf("failed to unmarshal response: %v", err)
	}
	if response["error"] != "unknown token type" {
		t.Errorf("expected error 'unknown token type', got %q", response["error"])
	}
}

func TestDetectTokenType_FromTokenString(t *testing.T) {
	privateKey := createTestRSAKeyPair(t)
	kid := "test-key-id"

	tests := []struct {
		name     string
		claims   jwt.MapClaims
		expected string
	}{
		{
			name: "airo-app token",
			claims: jwt.MapClaims{
				"iss": TokenTypeAiroApp,
				"sub": "user123",
				"exp": time.Now().Add(time.Hour).Unix(),
			},
			expected: TokenTypeAiroApp,
		},
		{
			name: "JOMAX token with per claim",
			claims: jwt.MapClaims{
				"per":       true,
				"shopperId": "12345678",
				"sub":       "employee123",
				"exp":       time.Now().Add(time.Hour).Unix(),
			},
			expected: TokenTypeJomax,
		},
		{
			name: "JOMAX token with shopperId only",
			claims: jwt.MapClaims{
				"shopperId": "12345678",
				"sub":       "employee123",
				"exp":       time.Now().Add(time.Hour).Unix(),
			},
			expected: TokenTypeJomax,
		},
		{
			name: "unknown token type",
			claims: jwt.MapClaims{
				"iss": "some-other-issuer",
				"sub": "user123",
				"exp": time.Now().Add(time.Hour).Unix(),
			},
			expected: TokenTypeUnknown,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tokenString := createTestToken(t, privateKey, kid, tt.claims)
			result := detectTokenType(tokenString)
			if result != tt.expected {
				t.Errorf("detectTokenType() = %q, want %q", result, tt.expected)
			}
		})
	}
}

func TestDetectTokenType_InvalidTokenString(t *testing.T) {
	// Test with invalid token string
	result := detectTokenType("not.a.valid.token")
	if result != TokenTypeUnknown {
		t.Errorf("detectTokenType(invalid) = %q, want %q", result, TokenTypeUnknown)
	}

	// Test with empty string
	result = detectTokenType("")
	if result != TokenTypeUnknown {
		t.Errorf("detectTokenType(empty) = %q, want %q", result, TokenTypeUnknown)
	}

	// Test with non-base64 payload
	result = detectTokenType("header.not-valid-base64!@#$.signature")
	if result != TokenTypeUnknown {
		t.Errorf("detectTokenType(non-base64) = %q, want %q", result, TokenTypeUnknown)
	}
}
