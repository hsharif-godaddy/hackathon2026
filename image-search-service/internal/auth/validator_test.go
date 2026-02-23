package auth

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// createTestRSAKeyPair generates an RSA key pair for testing.
func createTestRSAKeyPair(t *testing.T) *rsa.PrivateKey {
	t.Helper()
	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("failed to generate RSA key: %v", err)
	}
	return privateKey
}

// createMockJWKSServer creates a test server that returns a JWKS with the given public key.
func createMockJWKSServer(t *testing.T, publicKey *rsa.PublicKey, kid string) *httptest.Server {
	t.Helper()

	jwks := JWKS{
		Keys: []JWK{
			{
				Kty: "RSA",
				Use: "sig",
				Kid: kid,
				Alg: "RS256",
				N:   base64.RawURLEncoding.EncodeToString(publicKey.N.Bytes()),
				E:   base64.RawURLEncoding.EncodeToString([]byte{1, 0, 1}), // 65537
			},
		},
	}

	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(jwks); err != nil {
			t.Errorf("failed to encode JWKS: %v", err)
		}
	}))
}

// createTestToken creates a signed JWT token with the given claims.
func createTestToken(t *testing.T, privateKey *rsa.PrivateKey, kid string, claims jwt.MapClaims) string {
	t.Helper()

	token := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	token.Header["kid"] = kid

	tokenString, err := token.SignedString(privateKey)
	if err != nil {
		t.Fatalf("failed to sign token: %v", err)
	}

	return tokenString
}

func TestValidator_Validate(t *testing.T) {
	// Generate RSA key pair
	privateKey := createTestRSAKeyPair(t)
	publicKey := &privateKey.PublicKey

	// Create mock JWKS server
	kid := "test-key-id"
	server := createMockJWKSServer(t, publicKey, kid)
	defer server.Close()

	// Create validator
	issuer := "https://test-issuer.com"
	audience := "test-audience"
	validator := NewValidator(server.URL, issuer, audience)

	// Create valid token
	claims := jwt.MapClaims{
		"iss": issuer,
		"aud": audience,
		"sub": "user123",
		"exp": time.Now().Add(time.Hour).Unix(),
		"iat": time.Now().Unix(),
	}
	tokenString := createTestToken(t, privateKey, kid, claims)

	// Validate token
	validatedClaims, err := validator.Validate(tokenString)
	if err != nil {
		t.Fatalf("unexpected error validating token: %v", err)
	}

	// Verify claims
	if validatedClaims["sub"] != "user123" {
		t.Errorf("expected sub=user123, got %v", validatedClaims["sub"])
	}
	if validatedClaims["iss"] != issuer {
		t.Errorf("expected iss=%s, got %v", issuer, validatedClaims["iss"])
	}
}

func TestValidator_Validate_AudienceArray(t *testing.T) {
	// Generate RSA key pair
	privateKey := createTestRSAKeyPair(t)
	publicKey := &privateKey.PublicKey

	// Create mock JWKS server
	kid := "test-key-id"
	server := createMockJWKSServer(t, publicKey, kid)
	defer server.Close()

	// Create validator
	issuer := "https://test-issuer.com"
	audience := "test-audience"
	validator := NewValidator(server.URL, issuer, audience)

	// Create token with audience as array
	claims := jwt.MapClaims{
		"iss": issuer,
		"aud": []string{"other-audience", audience, "another-audience"},
		"sub": "user123",
		"exp": time.Now().Add(time.Hour).Unix(),
		"iat": time.Now().Unix(),
	}
	tokenString := createTestToken(t, privateKey, kid, claims)

	// Validate token
	_, err := validator.Validate(tokenString)
	if err != nil {
		t.Fatalf("unexpected error validating token with audience array: %v", err)
	}
}

func TestValidator_Validate_ExpiredToken(t *testing.T) {
	// Generate RSA key pair
	privateKey := createTestRSAKeyPair(t)
	publicKey := &privateKey.PublicKey

	// Create mock JWKS server
	kid := "test-key-id"
	server := createMockJWKSServer(t, publicKey, kid)
	defer server.Close()

	// Create validator
	issuer := "https://test-issuer.com"
	audience := "test-audience"
	validator := NewValidator(server.URL, issuer, audience)

	// Create expired token
	claims := jwt.MapClaims{
		"iss": issuer,
		"aud": audience,
		"sub": "user123",
		"exp": time.Now().Add(-time.Hour).Unix(), // Expired 1 hour ago
		"iat": time.Now().Add(-2 * time.Hour).Unix(),
	}
	tokenString := createTestToken(t, privateKey, kid, claims)

	// Validate token - should fail
	_, err := validator.Validate(tokenString)
	if err == nil {
		t.Fatal("expected error for expired token, got nil")
	}

	// Check it's the expected error type
	if !errors.Is(err, ErrTokenExpired) {
		t.Errorf("expected ErrTokenExpired, got: %v", err)
	}
}

func TestValidator_Validate_WrongIssuer(t *testing.T) {
	// Generate RSA key pair
	privateKey := createTestRSAKeyPair(t)
	publicKey := &privateKey.PublicKey

	// Create mock JWKS server
	kid := "test-key-id"
	server := createMockJWKSServer(t, publicKey, kid)
	defer server.Close()

	// Create validator expecting a specific issuer
	expectedIssuer := "https://expected-issuer.com"
	audience := "test-audience"
	validator := NewValidator(server.URL, expectedIssuer, audience)

	// Create token with wrong issuer
	claims := jwt.MapClaims{
		"iss": "https://wrong-issuer.com",
		"aud": audience,
		"sub": "user123",
		"exp": time.Now().Add(time.Hour).Unix(),
		"iat": time.Now().Unix(),
	}
	tokenString := createTestToken(t, privateKey, kid, claims)

	// Validate token - should fail
	_, err := validator.Validate(tokenString)
	if err == nil {
		t.Fatal("expected error for wrong issuer, got nil")
	}

	// Check it contains the expected error
	if err.Error() == "" || !containsError(err, ErrInvalidIssuer) {
		t.Errorf("expected ErrInvalidIssuer, got: %v", err)
	}
}

func TestValidator_Validate_WrongAudience(t *testing.T) {
	// Generate RSA key pair
	privateKey := createTestRSAKeyPair(t)
	publicKey := &privateKey.PublicKey

	// Create mock JWKS server
	kid := "test-key-id"
	server := createMockJWKSServer(t, publicKey, kid)
	defer server.Close()

	// Create validator expecting a specific audience
	issuer := "https://test-issuer.com"
	expectedAudience := "expected-audience"
	validator := NewValidator(server.URL, issuer, expectedAudience)

	// Create token with wrong audience
	claims := jwt.MapClaims{
		"iss": issuer,
		"aud": "wrong-audience",
		"sub": "user123",
		"exp": time.Now().Add(time.Hour).Unix(),
		"iat": time.Now().Unix(),
	}
	tokenString := createTestToken(t, privateKey, kid, claims)

	// Validate token - should fail
	_, err := validator.Validate(tokenString)
	if err == nil {
		t.Fatal("expected error for wrong audience, got nil")
	}

	// Check it contains the expected error
	if !containsError(err, ErrInvalidAudience) {
		t.Errorf("expected ErrInvalidAudience, got: %v", err)
	}
}

func TestValidator_Validate_MissingKid(t *testing.T) {
	// Generate RSA key pair
	privateKey := createTestRSAKeyPair(t)
	publicKey := &privateKey.PublicKey

	// Create mock JWKS server
	server := createMockJWKSServer(t, publicKey, "some-kid")
	defer server.Close()

	// Create validator
	validator := NewValidator(server.URL, "issuer", "audience")

	// Create token without kid in header
	claims := jwt.MapClaims{
		"iss": "issuer",
		"aud": "audience",
		"exp": time.Now().Add(time.Hour).Unix(),
	}
	token := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	// Don't set kid: token.Header["kid"] = "..."

	tokenString, err := token.SignedString(privateKey)
	if err != nil {
		t.Fatalf("failed to sign token: %v", err)
	}

	// Validate token - should fail
	_, err = validator.Validate(tokenString)
	if err == nil {
		t.Fatal("expected error for missing kid, got nil")
	}

	if !errors.Is(err, ErrMissingKid) {
		t.Errorf("expected ErrMissingKid, got: %v", err)
	}
}

func TestValidator_Validate_UnknownKid(t *testing.T) {
	// Generate RSA key pair
	privateKey := createTestRSAKeyPair(t)
	publicKey := &privateKey.PublicKey

	// Create mock JWKS server with a specific kid
	server := createMockJWKSServer(t, publicKey, "known-kid")
	defer server.Close()

	// Create validator
	validator := NewValidator(server.URL, "issuer", "audience")

	// Create token with unknown kid
	claims := jwt.MapClaims{
		"iss": "issuer",
		"aud": "audience",
		"exp": time.Now().Add(time.Hour).Unix(),
	}
	tokenString := createTestToken(t, privateKey, "unknown-kid", claims)

	// Validate token - should fail because kid doesn't match
	_, err := validator.Validate(tokenString)
	if err == nil {
		t.Fatal("expected error for unknown kid, got nil")
	}

	if !containsError(err, ErrInvalidSignature) {
		t.Errorf("expected ErrInvalidSignature, got: %v", err)
	}
}

// containsError checks if err contains the target error using errors.Is or string matching.
func containsError(err, target error) bool {
	if errors.Is(err, target) {
		return true
	}
	// Check if the error message contains the target error message
	return err != nil && target != nil && strings.Contains(err.Error(), target.Error())
}

// createMockSSOServer creates a test server that returns PEM-encoded RSA public keys.
// The server responds to requests at /v1/api/key/{kid}.
//
//nolint:unparam // kid parameter is intentionally parameterized for test flexibility
func createMockSSOServer(t *testing.T, publicKey *rsa.PublicKey, kid string) *httptest.Server {
	t.Helper()

	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		expectedPath := "/v1/api/key/" + kid
		if r.URL.Path != expectedPath {
			w.WriteHeader(http.StatusNotFound)
			return
		}

		// Encode the public key to PEM format
		pubKeyBytes, err := x509.MarshalPKIXPublicKey(publicKey)
		if err != nil {
			t.Errorf("failed to marshal public key: %v", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		pemBlock := &pem.Block{
			Type:  "PUBLIC KEY",
			Bytes: pubKeyBytes,
		}

		w.Header().Set("Content-Type", "application/x-pem-file")
		if err := pem.Encode(w, pemBlock); err != nil {
			t.Errorf("failed to encode PEM: %v", err)
		}
	}))
}
