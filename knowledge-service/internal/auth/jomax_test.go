// Package auth provides JWT authentication for the knowledge service.
package auth

import (
	"crypto/rsa"
	"encoding/base64"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

// Test RSA public key in JWK format wrapped in GoDaddy SSO envelope.
// This matches the RFC 7517 example key (2048-bit RSA).
const testJomaxJWKEnvelope = `{
  "data": {
    "kty": "RSA",
    "kid": "test-kid-1",
    "use": "sig",
    "alg": "RS256",
    "n": "0vx7agoebGcQSuuPiLJXZptN9nndrQmbXEps2aiAFbWhM78LhWx4cbbfAAtVT86zwu1RK7aPFFxuhDR1L6tSoc_BJECPebWKRXjBZCiFV4n3oknjhMstn64tZ_2W-5JsGY4Hc5n9yBXArwl93lqt7_RN5w6Cf0h4QyQ5v-65YGjQR0_FDW2QvzqY368QQMicAtaSqzs8KJZgnYb9c7d0zgdAZHzu6qMQvRL5hajrn1n91CbOpbISD08qNLyrdkt-bFTWhAI4vMQFh6WeZu0fM4lFd2NcRwr3XPksINHaQ-G_xBniIqbw0Ls1jF44-csFCur-kEgU8awapJzKnqDKgw",
    "e": "AQAB"
  }
}`

func TestJomaxKeyClient_GetKey(t *testing.T) {
	// Create test server that serves PEM keys
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Verify the request path includes the kid
		expectedPath := "/v1/api/key/test-kid-1"
		if r.URL.Path != expectedPath {
			t.Errorf("expected path %s, got %s", expectedPath, r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(testJomaxJWKEnvelope))
	}))
	defer server.Close()

	client := NewJomaxKeyClient(server.URL)

	// First call should fetch from server
	key1, err := client.GetKey("test-kid-1")
	if err != nil {
		t.Fatalf("GetKey failed: %v", err)
	}
	if key1 == nil {
		t.Fatal("expected non-nil key")
	}

	// Verify key properties via type assertion
	rsaKey, ok := key1.(*rsa.PublicKey)
	if !ok {
		t.Fatalf("expected *rsa.PublicKey, got %T", key1)
	}
	if rsaKey.E != 65537 {
		t.Errorf("expected exponent 65537, got %d", rsaKey.E)
	}
	if rsaKey.N == nil {
		t.Error("expected non-nil modulus")
	}

	// Second call should use cache (verify by checking same pointer)
	key2, err := client.GetKey("test-kid-1")
	if err != nil {
		t.Fatalf("GetKey (cached) failed: %v", err)
	}
	if key1 != key2 {
		t.Error("expected cached key to be same instance")
	}
}

func TestJomaxKeyClient_GetKey_NotFound(t *testing.T) {
	// Create test server that returns 404 for unknown keys
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer server.Close()

	client := NewJomaxKeyClient(server.URL)

	// Request a key that doesn't exist
	_, err := client.GetKey("nonexistent-key")
	if err == nil {
		t.Fatal("expected error for nonexistent key")
	}
	if !errors.Is(err, ErrJomaxKeyNotFound) {
		t.Errorf("expected ErrJomaxKeyNotFound, got: %v", err)
	}
}

func TestJomaxKeyClient_GetKey_ServerError(t *testing.T) {
	// Create test server that returns an error
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer server.Close()

	client := NewJomaxKeyClient(server.URL)

	_, err := client.GetKey("test-kid-1")
	if err == nil {
		t.Fatal("expected error for server error")
	}
}

func TestJomaxKeyClient_GetKey_InvalidResponse(t *testing.T) {
	// Create test server that returns invalid JWK data
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"data": "not-a-valid-jwk"}`))
	}))
	defer server.Close()

	client := NewJomaxKeyClient(server.URL)

	_, err := client.GetKey("test-kid-1")
	if err == nil {
		t.Fatal("expected error for invalid JWK response")
	}
}

func TestJomaxKeyClient_GetKey_InvalidKid(t *testing.T) {
	client := NewJomaxKeyClient("https://sso.example.com")

	tests := []struct {
		name string
		kid  string
	}{
		{"empty kid", ""},
		{"path traversal", "../../../etc/passwd"},
		{"url encoded", "key%2F..%2F..%2Fetc"},
		{"special chars", "key<script>alert(1)</script>"},
		{"spaces", "key with spaces"},
		{"newlines", "key\nwith\nnewlines"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := client.GetKey(tt.kid)
			if err == nil {
				t.Error("expected error for invalid kid")
			}
			if !errors.Is(err, ErrInvalidKid) {
				t.Errorf("expected ErrInvalidKid, got: %v", err)
			}
		})
	}
}

// createTokenWithoutKid creates a JWT-like token without a kid in the header for testing.
func createTokenWithoutKid() string {
	// Build a minimal JWT structure without kid: {"alg":"RS256","typ":"JWT"}.{"sub":"test"}.fakesig
	header := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"RS256","typ":"JWT"}`))
	payload := base64.RawURLEncoding.EncodeToString([]byte(`{"sub":"test"}`))
	return header + "." + payload + ".fakesig"
}

func TestJomaxValidator_Validate(t *testing.T) {
	// Create test server for key fetching
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(testJomaxJWKEnvelope))
	}))
	defer server.Close()

	validator := NewJomaxValidator(server.URL)

	tests := []struct {
		name        string
		token       string
		wantErr     error
		errContains string
	}{
		{
			name:    "empty token",
			token:   "",
			wantErr: ErrInvalidToken,
		},
		{
			name:    "invalid token format - not a JWT",
			token:   "not-a-jwt",
			wantErr: ErrInvalidToken,
		},
		{
			name:    "invalid token format - malformed segments",
			token:   "header.payload",
			wantErr: ErrInvalidToken,
		},
		{
			name:    "token missing kid in header",
			token:   createTokenWithoutKid(),
			wantErr: ErrMissingKid,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := validator.Validate(tt.token)
			if err == nil {
				t.Fatal("expected error, got nil")
			}
			if !errors.Is(err, tt.wantErr) {
				t.Errorf("expected error %v, got %v", tt.wantErr, err)
			}
		})
	}
}

func TestDetectTokenType(t *testing.T) {
	tests := []struct {
		name     string
		claims   map[string]any
		expected string
	}{
		{
			name:     "airo-app token - iss claim matches",
			claims:   map[string]any{"iss": TokenTypeAiroApp},
			expected: TokenTypeAiroApp,
		},
		{
			name:     "jomax token - has per claim",
			claims:   map[string]any{"per": true, "iss": "some-issuer"},
			expected: TokenTypeJomax,
		},
		{
			name:     "jomax token - has shopperId claim",
			claims:   map[string]any{"shopperId": "123456", "iss": "some-issuer"},
			expected: TokenTypeJomax,
		},
		{
			name:     "jomax token - has both per and shopperId",
			claims:   map[string]any{"per": true, "shopperId": "123456"},
			expected: TokenTypeJomax,
		},
		{
			name:     "unknown token - no identifying claims",
			claims:   map[string]any{"sub": "user123", "iss": "other-issuer"},
			expected: TokenTypeUnknown,
		},
		{
			name:     "unknown token - empty claims",
			claims:   map[string]any{},
			expected: TokenTypeUnknown,
		},
		{
			name:     "airo-app takes precedence over jomax claims",
			claims:   map[string]any{"iss": TokenTypeAiroApp, "per": true, "shopperId": "123"},
			expected: TokenTypeAiroApp,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := detectTokenTypeFromClaims(tt.claims)
			if result != tt.expected {
				t.Errorf("detectTokenTypeFromClaims() = %v, want %v", result, tt.expected)
			}
		})
	}
}
