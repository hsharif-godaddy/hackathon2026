// Package auth provides JWT authentication for the image search service.
package auth

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

// Test JWKS with a valid RSA key.
// Generated with: openssl genrsa 2048 | openssl rsa -pubout
// Then converted to JWK format.
var testJWKS = JWKS{
	Keys: []JWK{
		{
			Kty: "RSA",
			Use: "sig",
			Kid: "test-key-1",
			Alg: "RS256",
			// These are base64url-encoded values for a test RSA key
			// N = modulus, E = exponent (65537 = AQAB in base64url)
			N: "0vx7agoebGcQSuuPiLJXZptN9nndrQmbXEps2aiAFbWhM78LhWx4cbbfAAtVT86zwu1RK7aPFFxuhDR1L6tSoc_BJECPebWKRXjBZCiFV4n3oknjhMstn64tZ_2W-5JsGY4Hc5n9yBXArwl93lqt7_RN5w6Cf0h4QyQ5v-65YGjQR0_FDW2QvzqY368QQMicAtaSqzs8KJZgnYb9c7d0zgdAZHzu6qMQvRL5hajrn1n91CbOpbISD08qNLyrdkt-bFTWhAI4vMQFh6WeZu0fM4lFd2NcRwr3XPksINHaQ-G_xBniIqbw0Ls1jF44-csFCur-kEgU8awapJzKnqDKgw",
			E: "AQAB",
		},
	},
}

func TestJWKSClient_GetKey(t *testing.T) {
	// Create test server that serves JWKS
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(testJWKS)
	}))
	defer server.Close()

	client := NewJWKSClient(server.URL)

	// First call should fetch from server
	key1, err := client.GetKey("test-key-1")
	if err != nil {
		t.Fatalf("GetKey failed: %v", err)
	}
	if key1 == nil {
		t.Fatal("expected non-nil key")
	}

	// Verify key properties
	if key1.E != 65537 {
		t.Errorf("expected exponent 65537, got %d", key1.E)
	}
	if key1.N == nil {
		t.Error("expected non-nil modulus")
	}

	// Second call should use cache (verify by checking same pointer)
	key2, err := client.GetKey("test-key-1")
	if err != nil {
		t.Fatalf("GetKey (cached) failed: %v", err)
	}
	if key1 != key2 {
		t.Error("expected cached key to be same instance")
	}
}

func TestJWKSClient_GetKey_NotFound(t *testing.T) {
	// Create test server that serves JWKS
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(testJWKS)
	}))
	defer server.Close()

	client := NewJWKSClient(server.URL)

	// Request a key that doesn't exist
	_, err := client.GetKey("nonexistent-key")
	if err == nil {
		t.Fatal("expected error for nonexistent key")
	}
	if !errors.Is(err, ErrKeyNotFound) {
		t.Errorf("expected ErrKeyNotFound, got: %v", err)
	}
}

func TestJWKSClient_GetKey_ServerError(t *testing.T) {
	// Create test server that returns an error
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer server.Close()

	client := NewJWKSClient(server.URL)

	_, err := client.GetKey("test-key-1")
	if err == nil {
		t.Fatal("expected error for server error")
	}
}

func TestJWKSClient_GetKey_InvalidJSON(t *testing.T) {
	// Create test server that returns invalid JSON
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte("not valid json"))
	}))
	defer server.Close()

	client := NewJWKSClient(server.URL)

	_, err := client.GetKey("test-key-1")
	if err == nil {
		t.Fatal("expected error for invalid JSON")
	}
}

func TestJwkToRSAPublicKey_UnsupportedKeyType(t *testing.T) {
	jwk := JWK{
		Kty: "EC",
		Kid: "ec-key",
	}

	_, err := jwkToRSAPublicKey(jwk)
	if err == nil {
		t.Fatal("expected error for unsupported key type")
	}
}

func TestJwkToRSAPublicKey_InvalidModulus(t *testing.T) {
	jwk := JWK{
		Kty: "RSA",
		Kid: "bad-key",
		N:   "not-valid-base64!@#$",
		E:   "AQAB",
	}

	_, err := jwkToRSAPublicKey(jwk)
	if err == nil {
		t.Fatal("expected error for invalid modulus")
	}
}

func TestJwkToRSAPublicKey_InvalidExponent(t *testing.T) {
	jwk := JWK{
		Kty: "RSA",
		Kid: "bad-key",
		N:   "0vx7agoebGcQSuuPiLJXZptN9nndrQmbXEps2aiAFbWhM78LhWx4cbbfAAtVT86zwu1RK7aPFFxuhDR1L6tSoc_BJECPebWKRXjBZCiFV4n3oknjhMstn64tZ_2W-5JsGY4Hc5n9yBXArwl93lqt7_RN5w6Cf0h4QyQ5v-65YGjQR0_FDW2QvzqY368QQMicAtaSqzs8KJZgnYb9c7d0zgdAZHzu6qMQvRL5hajrn1n91CbOpbISD08qNLyrdkt-bFTWhAI4vMQFh6WeZu0fM4lFd2NcRwr3XPksINHaQ-G_xBniIqbw0Ls1jF44-csFCur-kEgU8awapJzKnqDKgw",
		E:   "not-valid-base64!@#$",
	}

	_, err := jwkToRSAPublicKey(jwk)
	if err == nil {
		t.Fatal("expected error for invalid exponent")
	}
}
