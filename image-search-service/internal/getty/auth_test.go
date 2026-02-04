// Package getty provides a client for interacting with the Getty Images API.
package getty

import (
	"context"
	"errors"
	"net/http"
	"testing"
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
	auth := NewSSOJWTAuth("sso.example.com", "/cert.pem", "/key.pem", "app-key")
	if auth.Name() != "SSOJWT" {
		t.Errorf("expected 'SSOJWT', got '%s'", auth.Name())
	}
}

func TestSSOJWTAuth_ApplyAuth_SetsAppKey(t *testing.T) {
	auth := NewSSOJWTAuth("sso.example.com", "/cert.pem", "/key.pem", "test-app-key")

	req, _ := http.NewRequest(http.MethodGet, "https://example.com", nil)
	err := auth.ApplyAuth(context.Background(), req)
	if err != nil {
		t.Fatalf("ApplyAuth failed: %v", err)
	}

	// SSO JWT auth should at least set the app key (full JWT impl is TODO)
	appKeyHeader := req.Header.Get("X-App-Key")
	if appKeyHeader != "test-app-key" {
		t.Errorf("expected 'test-app-key', got '%s'", appKeyHeader)
	}
}
