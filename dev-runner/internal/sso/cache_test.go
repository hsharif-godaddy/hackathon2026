package sso

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
)

func TestTokenCache_CachesResult(t *testing.T) {
	var serverCalls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n := serverCalls.Add(1)
		if n == 1 {
			json.NewEncoder(w).Encode(DeviceCodeResponse{
				DeviceCode:              "CACHE-DEV",
				VerificationURI: "https://example.com/verify",
				Interval:                1,
				ExpiresIn:               30,
			})
			return
		}
		json.NewEncoder(w).Encode(tokenPollResponse{AccessToken: "cached-jwt"})
	}))
	defer srv.Close()

	cache := NewTokenCache(Config{
		TokenURL: srv.URL + "/token",
		ClientID: "test-client",
		OpenURL:  func(string) error { return nil },
	})

	// First call acquires the token
	token1, err := cache.GetToken(context.Background())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if token1 != "cached-jwt" {
		t.Errorf("expected cached-jwt, got %s", token1)
	}
	callsAfterFirst := serverCalls.Load()

	// Second call should return cached token without hitting server
	token2, err := cache.GetToken(context.Background())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if token2 != "cached-jwt" {
		t.Errorf("expected cached-jwt, got %s", token2)
	}
	if serverCalls.Load() != callsAfterFirst {
		t.Error("second GetToken call should not have hit the server")
	}
}

func TestTokenCache_ContextCancellation(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		json.NewEncoder(w).Encode(DeviceCodeResponse{
			DeviceCode:              "CANCEL-DEV",
			VerificationURI: "https://example.com/verify",
			Interval:                60,
			ExpiresIn:               600,
		})
	}))
	defer srv.Close()

	cache := NewTokenCache(Config{
		TokenURL: srv.URL + "/token",
		ClientID: "test-client",
		OpenURL:  func(string) error { return nil },
	})

	ctx, cancel := context.WithCancel(context.Background())
	cancel() // Cancel immediately

	_, err := cache.GetToken(ctx)
	if err == nil {
		t.Fatal("expected error from cancelled context")
	}
}
