package auth_test

import (
	"crypto/rand"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"math/big"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/airo-ai-builder/dev-supervisor/internal/auth"
)

// TestConcurrentSingleflightDifferentKids verifies that concurrent requests for different
// key IDs share the same JWKS fetch (only one HTTP request)
func TestConcurrentSingleflightDifferentKids(t *testing.T) {
	// Track number of HTTP requests
	var fetchCount atomic.Int32

	// Generate test keys
	kid1Key := mustGenerateRSAKey(t)
	kid2Key := mustGenerateRSAKey(t)
	kid3Key := mustGenerateRSAKey(t)

	// Create test server that serves JWKS
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		fetchCount.Add(1)

		// Simulate realistic fetch delay
		time.Sleep(50 * time.Millisecond)

		jwks := auth.JWKSResponse{
			Keys: []auth.JWK{
				mustRSAKeyToJWK(t, kid1Key, "kid1"),
				mustRSAKeyToJWK(t, kid2Key, "kid2"),
				mustRSAKeyToJWK(t, kid3Key, "kid3"),
			},
		}

		w.Header().Set("Cache-Control", "max-age=300")
		if err := json.NewEncoder(w).Encode(jwks); err != nil {
			t.Logf("failed to encode JWKS: %v", err)
		}
	}))
	defer server.Close()

	// Create JWKS client
	client := auth.NewJWKSClient(server.URL, 5*time.Minute, false)

	// Launch concurrent requests for different kids
	var wg sync.WaitGroup
	concurrency := 100
	results := make(map[string]*rsa.PublicKey)
	resultsMu := sync.Mutex{}
	errors := make([]error, 0)
	errorsMu := sync.Mutex{}

	kids := []string{"kid1", "kid2", "kid3"}

	for i := range concurrency {
		wg.Add(1)
		kid := kids[i%len(kids)] // Distribute requests across kids

		go func(kid string) {
			defer wg.Done()

			key, err := client.GetPublicKey(kid)
			if err != nil {
				errorsMu.Lock()
				errors = append(errors, err)
				errorsMu.Unlock()
				return
			}

			resultsMu.Lock()
			results[kid] = key
			resultsMu.Unlock()
		}(kid)
	}

	wg.Wait()

	// Verify no errors occurred
	if len(errors) > 0 {
		t.Fatalf("expected no errors, got %d errors: %v", len(errors), errors[0])
	}

	// Verify all three keys were retrieved
	if len(results) != 3 {
		t.Errorf("expected 3 unique keys, got %d", len(results))
	}

	// Verify singleflight worked - should only have 1 HTTP request despite 100 concurrent requests
	count := fetchCount.Load()
	if count != 1 {
		t.Errorf("expected 1 HTTP fetch (singleflight deduplication), got %d", count)
	}

	// Verify keys are correct
	if results["kid1"] == nil || results["kid1"].N.Cmp(kid1Key.N) != 0 {
		t.Error("kid1 key does not match expected value")
	}
	if results["kid2"] == nil || results["kid2"].N.Cmp(kid2Key.N) != 0 {
		t.Error("kid2 key does not match expected value")
	}
	if results["kid3"] == nil || results["kid3"].N.Cmp(kid3Key.N) != 0 {
		t.Error("kid3 key does not match expected value")
	}
}

// TestSingleflightCacheHitAfterWait verifies that when one goroutine populates the cache,
// other waiting goroutines receive the cached result (cache-hit-after-wait path)
func TestSingleflightCacheHitAfterWait(t *testing.T) {
	var fetchCount atomic.Int32

	// Generate test keys
	kid1Key := mustGenerateRSAKey(t)
	kid2Key := mustGenerateRSAKey(t)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		fetchCount.Add(1)

		// Simulate slow fetch to ensure goroutines wait
		time.Sleep(100 * time.Millisecond)

		jwks := auth.JWKSResponse{
			Keys: []auth.JWK{
				mustRSAKeyToJWK(t, kid1Key, "kid1"),
				mustRSAKeyToJWK(t, kid2Key, "kid2"),
			},
		}

		w.Header().Set("Cache-Control", "max-age=300")
		if err := json.NewEncoder(w).Encode(jwks); err != nil {
			t.Logf("failed to encode JWKS: %v", err)
		}
	}))
	defer server.Close()

	client := auth.NewJWKSClient(server.URL, 5*time.Minute, false)

	// Launch concurrent requests
	var wg sync.WaitGroup
	concurrency := 50
	successCount := atomic.Int32{}

	for i := range concurrency {
		wg.Add(1)
		kid := "kid1"
		if i%2 == 0 {
			kid = "kid2"
		}

		go func(kid string) {
			defer wg.Done()

			key, err := client.GetPublicKey(kid)
			if err != nil {
				t.Logf("failed to get public key for %s: %v", kid, err)
				return
			}

			if key != nil {
				successCount.Add(1)
			}
		}(kid)
	}

	wg.Wait()

	// All requests should succeed
	if successCount.Load() != int32(concurrency) {
		t.Errorf("expected %d successful requests, got %d", concurrency, successCount.Load())
	}

	// Should only fetch once
	if fetchCount.Load() != 1 {
		t.Errorf("expected 1 fetch, got %d", fetchCount.Load())
	}
}

// TestSingleflightErrorPropagation verifies that fetch errors are properly propagated
// to all waiting goroutines
func TestSingleflightErrorPropagation(t *testing.T) {
	var fetchCount atomic.Int32

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		fetchCount.Add(1)
		// Return error status
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer server.Close()

	client := auth.NewJWKSClient(server.URL, 5*time.Minute, false)

	// Launch concurrent requests
	var wg sync.WaitGroup
	concurrency := 20
	errorCount := atomic.Int32{}

	for range concurrency {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := client.GetPublicKey("kid1")
			if err != nil {
				errorCount.Add(1)
			}
		}()
	}

	wg.Wait()

	// All requests should receive error
	if errorCount.Load() != int32(concurrency) {
		t.Errorf("expected %d errors, got %d", concurrency, errorCount.Load())
	}

	// Should only fetch once (singleflight deduplication even for errors)
	if fetchCount.Load() != 1 {
		t.Errorf("expected 1 fetch, got %d", fetchCount.Load())
	}
}

// TestSingleflightWithExpiredCache verifies behavior when cache is expired and
// concurrent requests trigger a fresh fetch
func TestSingleflightWithExpiredCache(t *testing.T) {
	var fetchCount atomic.Int32

	kid1Key := mustGenerateRSAKey(t)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		fetchCount.Add(1)

		jwks := auth.JWKSResponse{
			Keys: []auth.JWK{
				mustRSAKeyToJWK(t, kid1Key, "kid1"),
			},
		}

		// Very short TTL for testing expiration
		w.Header().Set("Cache-Control", "max-age=0")
		if err := json.NewEncoder(w).Encode(jwks); err != nil {
			t.Logf("failed to encode JWKS: %v", err)
		}
	}))
	defer server.Close()

	client := auth.NewJWKSClient(server.URL, 5*time.Minute, false)

	// Prime cache
	_, err := client.GetPublicKey("kid1")
	if err != nil {
		t.Fatalf("initial fetch failed: %v", err)
	}

	initialFetchCount := fetchCount.Load()

	// Wait for cache to expire (max-age=0 means don't cache)
	time.Sleep(10 * time.Millisecond)

	// Launch concurrent requests after expiration
	var wg sync.WaitGroup
	concurrency := 30

	for range concurrency {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := client.GetPublicKey("kid1")
			if err != nil {
				t.Logf("concurrent fetch failed: %v", err)
			}
		}()
	}

	wg.Wait()

	// Should have additional fetches (since max-age=0 disables caching)
	finalFetchCount := fetchCount.Load()
	if finalFetchCount <= initialFetchCount {
		t.Errorf("expected additional fetches after expiration, got initial=%d final=%d",
			initialFetchCount, finalFetchCount)
	}
}

// TestSingleflightKeyNotFound verifies behavior when requested kid is not in JWKS
func TestSingleflightKeyNotFound(t *testing.T) {
	kid1Key := mustGenerateRSAKey(t)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		jwks := auth.JWKSResponse{
			Keys: []auth.JWK{
				mustRSAKeyToJWK(t, kid1Key, "kid1"),
			},
		}

		w.Header().Set("Cache-Control", "max-age=300")
		if err := json.NewEncoder(w).Encode(jwks); err != nil {
			t.Logf("failed to encode JWKS: %v", err)
		}
	}))
	defer server.Close()

	client := auth.NewJWKSClient(server.URL, 5*time.Minute, false)

	// Launch concurrent requests for non-existent key
	var wg sync.WaitGroup
	concurrency := 20
	errorCount := atomic.Int32{}

	for range concurrency {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := client.GetPublicKey("nonexistent")
			if err != nil {
				errorCount.Add(1)
			}
		}()
	}

	wg.Wait()

	// All requests should receive "key not found" error
	if errorCount.Load() != int32(concurrency) {
		t.Errorf("expected %d errors, got %d", concurrency, errorCount.Load())
	}
}

// Helper functions

// mustGenerateRSAKey generates an RSA key pair for testing
func mustGenerateRSAKey(t *testing.T) *rsa.PrivateKey {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("failed to generate RSA key: %v", err)
	}
	return key
}

// mustRSAKeyToJWK converts an RSA private key to JWK format
func mustRSAKeyToJWK(t *testing.T, key *rsa.PrivateKey, kid string) auth.JWK {
	t.Helper()

	// Encode modulus (n) and exponent (e) as base64url
	n := base64.RawURLEncoding.EncodeToString(key.N.Bytes())
	e := base64.RawURLEncoding.EncodeToString(big.NewInt(int64(key.E)).Bytes())

	return auth.JWK{
		Kty: "RSA",
		Kid: kid,
		Use: "sig",
		Alg: "RS256",
		N:   n,
		E:   e,
	}
}
