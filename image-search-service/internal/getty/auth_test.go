// Package getty provides a client for interacting with the Getty Images API.
package getty

import (
	"context"
	"errors"
	"net/http"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

func TestBearerTokenAuth_ApplyAuth(t *testing.T) {
	auth, err := NewBearerTokenAuth("test-token", "test-app-key")
	if err != nil {
		t.Fatalf("NewBearerTokenAuth failed: %v", err)
	}

	req, _ := http.NewRequest(http.MethodGet, "https://example.com", nil)
	err = auth.ApplyAuth(context.Background(), req)
	if err != nil {
		t.Fatalf("ApplyAuth failed: %v", err)
	}

	authHeader := req.Header.Get("Authorization")
	if authHeader != "Bearer test-token" {
		t.Errorf("expected 'Bearer test-token', got '%s'", authHeader)
	}

	appKeyHeader := req.Header.Get("X-App-Key")
	if appKeyHeader != "test-app-key" {
		t.Errorf("expected 'test-app-key', got '%s'", appKeyHeader)
	}
}

func TestBearerTokenAuth_EmptyToken_ReturnsError(t *testing.T) {
	_, err := NewBearerTokenAuth("", "test-app-key")
	if err == nil {
		t.Error("expected error for empty token, got nil")
	}
	if !errors.Is(err, ErrEmptyToken) {
		t.Errorf("expected ErrEmptyToken, got %v", err)
	}
}

func TestBearerTokenAuth_ApplyAuth_EmptyAppKey(t *testing.T) {
	auth, err := NewBearerTokenAuth("test-token", "")
	if err != nil {
		t.Fatalf("NewBearerTokenAuth failed: %v", err)
	}

	req, _ := http.NewRequest(http.MethodGet, "https://example.com", nil)
	err = auth.ApplyAuth(context.Background(), req)
	if err != nil {
		t.Fatalf("ApplyAuth failed: %v", err)
	}

	// Should set Authorization header
	authHeader := req.Header.Get("Authorization")
	if authHeader != "Bearer test-token" {
		t.Errorf("expected 'Bearer test-token', got '%s'", authHeader)
	}

	// Should not set X-App-Key if empty
	appKeyHeader := req.Header.Get("X-App-Key")
	if appKeyHeader != "" {
		t.Errorf("expected empty X-App-Key header, got '%s'", appKeyHeader)
	}
}

func TestBearerTokenAuth_Name(t *testing.T) {
	auth, err := NewBearerTokenAuth("token", "app-key")
	if err != nil {
		t.Fatalf("NewBearerTokenAuth failed: %v", err)
	}
	if auth.Name() != "BearerToken" {
		t.Errorf("expected 'BearerToken', got '%s'", auth.Name())
	}
}

func TestSSOJWTAuth_Name(t *testing.T) {
	// NewSSOJWTAuth requires real cert files; test Name() via a minimal struct
	auth := &SSOJWTAuth{appKey: "app-key"}
	if auth.Name() != "SSOJWT" {
		t.Errorf("expected 'SSOJWT', got '%s'", auth.Name())
	}
}

func TestSSOJWTAuth_MissingCertPaths(t *testing.T) {
	_, err := NewSSOJWTAuth("sso.example.com", "", "", "app-key")
	if err == nil {
		t.Error("expected error for empty cert paths, got nil")
	}
}

func TestExtractJWTExpiry_ValidToken(t *testing.T) {
	// Create a token with known expiry
	claims := jwt.RegisteredClaims{
		ExpiresAt: jwt.NewNumericDate(time.Date(2030, 1, 1, 0, 0, 0, 0, time.UTC)),
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tokenString, err := token.SignedString([]byte("test-secret"))
	if err != nil {
		t.Fatalf("failed to create test token: %v", err)
	}

	expiry := extractJWTExpiry(tokenString)
	expected := time.Date(2030, 1, 1, 0, 0, 0, 0, time.UTC)
	if !expiry.Equal(expected) {
		t.Errorf("expected expiry %v, got %v", expected, expiry)
	}
}

func TestExtractJWTExpiry_InvalidToken_FallsBack(t *testing.T) {
	before := time.Now().Add(50 * time.Minute)
	expiry := extractJWTExpiry("not-a-jwt")
	after := time.Now().Add(70 * time.Minute)

	if expiry.Before(before) || expiry.After(after) {
		t.Errorf("expected fallback expiry ~1h from now, got %v", expiry)
	}
}
