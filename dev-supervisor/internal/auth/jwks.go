package auth

import (
	"context"
	"crypto/rsa"
	"crypto/tls"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"math/big"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"golang.org/x/sync/singleflight"
)

// JWK represents a JSON Web Key (RFC 7517)
type JWK struct {
	Kty string `json:"kty"` // Key type (RSA)
	Kid string `json:"kid"` // Key ID
	Use string `json:"use"` // Public key use (sig for signature)
	Alg string `json:"alg"` // Algorithm (RS256)
	N   string `json:"n"`   // RSA modulus (base64url encoded)
	E   string `json:"e"`   // RSA exponent (base64url encoded)
}

// JWKSResponse represents the standard RFC 7517 JWKS response
// This is the format returned by builder's /.well-known/jwks.json endpoint
type JWKSResponse struct {
	Keys []JWK `json:"keys"` // Array of JSON Web Keys
}

// cachedKey stores a parsed RSA public key with expiration and stale times
// Supports stale-while-revalidate: serve stale keys after expiration while refreshing in background
type cachedKey struct {
	publicKey  *rsa.PublicKey
	expiresAt  time.Time // Hard expiration (max-age)
	staleUntil time.Time // Serve stale until this time (max-age + stale-while-revalidate)
}

// JWKSClient fetches and caches public keys from standard RFC 7517 JWKS endpoint
// Expects standard JWKS URL (e.g., https://local.gasket.dev-godaddy.com:8443/.well-known/jwks.json)
type JWKSClient struct {
	mu              sync.RWMutex
	jwksURL         string
	cache           map[string]cachedKey // kid -> cached key
	cacheTTL        time.Duration
	httpClient      *http.Client
	group           singleflight.Group // Deduplicates concurrent JWKS fetches
	refreshInFlight bool               // Background refresh in progress (global, not per-key)
}

// NewJWKSClient creates a new JWKS client
func NewJWKSClient(jwksURL string, cacheTTL time.Duration, skipTLSVerify bool) *JWKSClient {
	if cacheTTL == 0 {
		cacheTTL = 5 * time.Minute
	}

	// Create HTTP client with optional TLS verification skip
	httpClient := &http.Client{
		Timeout: 10 * time.Second,
	}

	// Configure TLS settings if skip verification is enabled (local dev only)
	if skipTLSVerify {
		httpClient.Transport = &http.Transport{
			TLSClientConfig: &tls.Config{
				InsecureSkipVerify: true, // #nosec G402 - Only used in local dev with self-signed certs
			},
		}
		slog.Warn("jwks.client.tls_skip_enabled",
			"message", "TLS certificate verification disabled for JWKS client (local dev only)",
			"jwksURL", jwksURL)
	}

	return &JWKSClient{
		jwksURL:    jwksURL,
		cache:      make(map[string]cachedKey),
		cacheTTL:   cacheTTL,
		httpClient: httpClient,
	}
}

// GetPublicKey fetches a public key by key ID, using cache when available
// Implements stale-while-revalidate: serves stale keys after expiration while refreshing in background
func (c *JWKSClient) GetPublicKey(kid string) (*rsa.PublicKey, error) {
	now := time.Now()

	// Check cache first (fast path)
	c.mu.RLock()
	cached, found := c.cache[kid]
	c.mu.RUnlock()

	// Cache hit - key is fresh
	if found && now.Before(cached.expiresAt) {
		slog.Debug("jwks.key.cache_hit", "kid", kid)
		return cached.publicKey, nil
	}

	// Key is stale but within stale-while-revalidate window
	if found && now.Before(cached.staleUntil) {
		slog.Debug("jwks.key.stale_hit", "kid", kid,
			"expired_ago", now.Sub(cached.expiresAt).Seconds())

		// Trigger background refresh and serve stale key immediately
		c.triggerBackgroundRefreshIfNeeded(kid)
		return cached.publicKey, nil
	}

	// Cache miss or fully expired - blocking fetch required
	if found {
		slog.Debug("jwks.key.expired", "kid", kid,
			"expired_ago", now.Sub(cached.staleUntil).Seconds())
	} else {
		slog.Debug("jwks.key.cache_miss", "kid", kid)
	}

	// Use singleflight to deduplicate concurrent fetches
	// Key is jwksURL (not kid) because:
	// 1. One fetch returns ALL keys from the JWKS endpoint (not just one)
	// 2. Multiple concurrent requests for different kids can share the same fetch
	// 3. If we keyed by kid, requests for kid1 and kid2 would fetch separately (wasteful)
	result, err, shared := c.group.Do(c.jwksURL, func() (any, error) {
		// Double-check cache inside singleflight (another goroutine may have filled it)
		// Return ALL fresh keys to satisfy all concurrent waiters (different kids may be waiting)
		c.mu.RLock()
		now := time.Now()
		allFreshKeys := make(map[string]*rsa.PublicKey)
		hasFreshKeys := false
		for k, v := range c.cache {
			if now.Before(v.expiresAt) {
				allFreshKeys[k] = v.publicKey
				hasFreshKeys = true
			}
		}
		c.mu.RUnlock()

		if hasFreshKeys {
			slog.Debug("jwks.key.cache_hit_after_wait", "kid", kid, "keyCount", len(allFreshKeys))
			return allFreshKeys, nil
		}

		// Fetch all keys
		return c.fetchAndCacheAllKeys()
	})

	if err != nil {
		return nil, err
	}

	if shared {
		slog.Debug("jwks.fetch.shared", "kid", kid, "jwksURL", c.jwksURL)
	}

	// Result should be map of all keys - extract the one we need
	keysMap, ok := result.(map[string]*rsa.PublicKey)
	if !ok {
		return nil, errors.New("internal error: singleflight returned unexpected type")
	}

	publicKey, found := keysMap[kid]
	if !found {
		return nil, fmt.Errorf("key with kid '%s' not found in fetched JWKS", kid)
	}

	return publicKey, nil
}

// fetchAndCacheAllKeys fetches JWKS from standard RFC 7517 endpoint and caches ALL keys
// Returns map of kid -> public key for all keys in the response
func (c *JWKSClient) fetchAndCacheAllKeys() (map[string]*rsa.PublicKey, error) {
	slog.Debug("jwks.fetch.standard", "url", c.jwksURL)

	// Create context with timeout for the HTTP request
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	// Fetch JWKS with context
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.jwksURL, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create JWKS request: %w", err)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		slog.Error("jwks.fetch.error",
			"error", err,
			"url", c.jwksURL)
		return nil, fmt.Errorf("failed to fetch JWKS: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		slog.Error("jwks.fetch.bad_status",
			"status", resp.StatusCode,
			"url", c.jwksURL)
		return nil, fmt.Errorf("JWKS endpoint returned status %d", resp.StatusCode)
	}

	// Read response body
	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		slog.Error("jwks.read.error",
			"error", err,
			"url", c.jwksURL)
		return nil, fmt.Errorf("failed to read JWKS response: %w", err)
	}

	// Parse Cache-Control header for stale-while-revalidate
	cacheControl := resp.Header.Get("Cache-Control")
	maxAge, staleWhileRevalidate := parseCacheControl(cacheControl)

	slog.Debug("jwks.response.received",
		"size_bytes", len(bodyBytes),
		"cache_control", cacheControl,
		"max_age", maxAge,
		"stale_while_revalidate", staleWhileRevalidate)

	// Parse standard RFC 7517 JWKS response
	var response JWKSResponse
	if decodeErr := json.Unmarshal(bodyBytes, &response); decodeErr != nil {
		slog.Error("jwks.parse.error",
			"error", decodeErr,
			"url", c.jwksURL,
			"size_bytes", len(bodyBytes))
		return nil, fmt.Errorf("failed to parse JWKS response: %w", decodeErr)
	}

	// Convert ALL keys to RSA public keys
	// Do conversion without holding lock to reduce contention
	keysMap := make(map[string]*rsa.PublicKey)
	var keyIDs []string

	for i := range response.Keys {
		jwk := &response.Keys[i]
		keyIDs = append(keyIDs, jwk.Kid)

		// Convert JWK to RSA public key
		publicKey, err := c.jwkToRSAPublicKey(jwk)
		if err != nil {
			slog.Warn("jwks.key.conversion.failed",
				"kid", jwk.Kid,
				"error", err.Error())
			continue
		}

		keysMap[jwk.Kid] = publicKey

		slog.Debug("jwks.key.parsed",
			"kid", jwk.Kid,
			"kty", jwk.Kty,
			"use", jwk.Use,
			"alg", jwk.Alg)
	}

	// Honor max-age=0 explicitly (means don't cache)
	// Skip caching to avoid creating immediately-expired entries that trigger constant refresh
	if maxAge == 0 {
		slog.Debug("jwks.cache.disabled",
			"reason", "max-age=0",
			"keyCount", len(keysMap))
		return keysMap, nil
	}

	// Determine cache TTL from Cache-Control or use default
	cacheTTL := c.cacheTTL
	if maxAge > 0 {
		cacheTTL = time.Duration(maxAge) * time.Second
	}

	// Calculate stale-while-revalidate window
	staleWindow := time.Duration(0)
	if staleWhileRevalidate > 0 {
		staleWindow = time.Duration(staleWhileRevalidate) * time.Second
	}

	now := time.Now()
	expiresAt := now.Add(cacheTTL)
	staleUntil := expiresAt.Add(staleWindow)

	// Now acquire lock and update cache atomically
	// Evict keys not present in new JWKS (key rotation)
	c.mu.Lock()
	defer c.mu.Unlock()

	// Build set of key IDs from JWKS response (for eviction check)
	// Use raw keyIDs list, not keysMap, to avoid evicting keys that failed to parse
	keyIDSet := make(map[string]struct{})
	for _, kid := range keyIDs {
		keyIDSet[kid] = struct{}{}
	}

	// Track keys to remove (keys in cache but not in JWKS response)
	// Don't remove keys that are still in JWKS but failed to parse (transient error)
	var removedKeys []string
	for kid := range c.cache {
		if _, exists := keyIDSet[kid]; !exists {
			removedKeys = append(removedKeys, kid)
		}
	}

	// Remove rotated-out keys
	for _, kid := range removedKeys {
		delete(c.cache, kid)
	}

	// Update cache with new keys
	successCount := 0
	for kid, publicKey := range keysMap {
		c.cache[kid] = cachedKey{
			publicKey:  publicKey,
			expiresAt:  expiresAt,
			staleUntil: staleUntil,
		}
		successCount++
	}

	slog.Info("jwks.keys.fetched",
		"jwksURL", c.jwksURL,
		"totalKeys", len(response.Keys),
		"cachedKeys", successCount,
		"removedKeys", len(removedKeys),
		"keyIDs", keyIDs,
		"cacheTTL", cacheTTL,
		"staleWhileRevalidate", staleWindow)

	return keysMap, nil
}

// jwkToRSAPublicKey converts a JWK to an RSA public key
func (c *JWKSClient) jwkToRSAPublicKey(jwk *JWK) (*rsa.PublicKey, error) {
	// Validate key type
	if jwk.Kty != "RSA" {
		return nil, fmt.Errorf("unsupported key type: %s (expected RSA)", jwk.Kty)
	}

	// Decode base64url-encoded modulus (n)
	nBytes, err := base64.RawURLEncoding.DecodeString(jwk.N)
	if err != nil {
		slog.Error("jwks.decode.modulus_error",
			"error", err,
			"kid", jwk.Kid)
		return nil, fmt.Errorf("failed to decode modulus: %w", err)
	}

	// Decode base64url-encoded exponent (e)
	eBytes, err := base64.RawURLEncoding.DecodeString(jwk.E)
	if err != nil {
		slog.Error("jwks.decode.exponent_error",
			"error", err,
			"kid", jwk.Kid)
		return nil, fmt.Errorf("failed to decode exponent: %w", err)
	}

	// Convert bytes to big integers
	n := new(big.Int).SetBytes(nBytes)
	e := new(big.Int).SetBytes(eBytes)

	// Validate exponent fits in int64 range (required before Int64() call)
	if !e.IsInt64() {
		slog.Error("jwks.decode.exponent_overflow",
			"exponent", e.String(),
			"kid", jwk.Kid)
		return nil, errors.New("RSA exponent too large for int64")
	}

	// Validate exponent fits in platform int range to prevent overflow
	eInt64 := e.Int64()
	const maxInt = int64(^uint(0) >> 1)
	if eInt64 > maxInt || eInt64 < -maxInt-1 {
		slog.Error("jwks.decode.exponent_overflow",
			"exponent", eInt64,
			"kid", jwk.Kid)
		return nil, errors.New("RSA exponent too large for int type")
	}

	// Create RSA public key
	publicKey := &rsa.PublicKey{
		N: n,
		E: int(eInt64),
	}

	return publicKey, nil
}

// triggerBackgroundRefreshIfNeeded starts a background refresh if not already running
// Uses client-level flag and singleflight to prevent multiple concurrent refreshes
// Note: Refresh failures are logged but non-fatal - stale keys continue to be served
func (c *JWKSClient) triggerBackgroundRefreshIfNeeded(kid string) {
	c.mu.Lock()
	if c.refreshInFlight {
		c.mu.Unlock()
		slog.Debug("jwks.background_refresh.already_running", "kid", kid)
		return
	}
	c.refreshInFlight = true
	c.mu.Unlock()

	// Start background refresh (non-blocking)
	go func() {
		slog.Debug("jwks.background_refresh.started", "kid", kid)
		_, err, _ := c.group.Do(c.jwksURL, func() (any, error) {
			return c.fetchAndCacheAllKeys()
		})

		// Clear flag when done (regardless of success/failure)
		c.mu.Lock()
		c.refreshInFlight = false
		c.mu.Unlock()

		if err != nil {
			slog.Warn("jwks.background_refresh.failed",
				"kid", kid,
				"error", err.Error())
		} else {
			slog.Debug("jwks.background_refresh.completed", "kid", kid)
		}
	}()
}

// parseCacheControl parses Cache-Control header and extracts max-age and stale-while-revalidate
// Returns (maxAge, staleWhileRevalidate) in seconds, or (-1, -1) if not found
// Note: max-age=0 is valid and different from missing
func parseCacheControl(cacheControl string) (int, int) {
	if cacheControl == "" {
		return -1, -1
	}

	maxAge := -1
	staleWhileRevalidate := -1

	// Split by comma and parse directives
	for directive := range strings.SplitSeq(cacheControl, ",") {
		directive = strings.TrimSpace(directive)

		// Parse max-age=N
		if valueStr, found := strings.CutPrefix(directive, "max-age="); found {
			if value, err := strconv.Atoi(valueStr); err == nil {
				maxAge = value
			}
		}

		// Parse stale-while-revalidate=N
		if valueStr, found := strings.CutPrefix(directive, "stale-while-revalidate="); found {
			if value, err := strconv.Atoi(valueStr); err == nil {
				staleWhileRevalidate = value
			}
		}
	}

	return maxAge, staleWhileRevalidate
}

// ClearCache removes all cached keys (useful for key rotation)
func (c *JWKSClient) ClearCache() {
	c.mu.Lock()
	defer c.mu.Unlock()

	c.cache = make(map[string]cachedKey)
	slog.Info("jwks.cache.cleared")
}
