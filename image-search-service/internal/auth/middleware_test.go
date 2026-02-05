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
	middleware := NewMiddleware("none", "", "", "")

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
	middleware := NewMiddleware("jwt", server.URL, "issuer", "audience")

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
	middleware := NewMiddleware("jwt", server.URL, "issuer", "audience")

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

	// Create middleware with JWT auth
	issuer := "https://test-issuer.com"
	audience := "test-audience"
	middleware := NewMiddleware("jwt", server.URL, issuer, audience)

	// Create valid token
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
	middleware := NewMiddleware("jwt", server.URL, "issuer", "audience")

	// Create test request with invalid token
	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	req.Header.Set("Authorization", "Bearer invalid.token.here")
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

	// Create middleware with JWT auth
	issuer := "https://test-issuer.com"
	audience := "test-audience"
	middleware := NewMiddleware("jwt", server.URL, issuer, audience)

	// Create expired token
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
	middleware := NewMiddleware("jwt", server.URL, "issuer", "audience")

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
