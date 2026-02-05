// Package auth provides JWT authentication for the image search service.
package auth

import (
	"context"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"math/big"
	"net/http"
	"sync"
	"time"
)

// Cache duration for JWK keys (30 days).
const jwkCacheDuration = 30 * 24 * time.Hour

// ErrKeyNotFound is returned when a key with the specified kid is not found in the JWKS.
var ErrKeyNotFound = errors.New("jwks: key not found")

// JWK represents a JSON Web Key as defined in RFC 7517.
type JWK struct {
	Kty string `json:"kty"` // Key type (e.g., "RSA")
	Use string `json:"use"` // Key use (e.g., "sig")
	Kid string `json:"kid"` // Key ID
	Alg string `json:"alg"` // Algorithm (e.g., "RS256")
	N   string `json:"n"`   // RSA modulus (base64url-encoded)
	E   string `json:"e"`   // RSA exponent (base64url-encoded)
}

// JWKS represents a JSON Web Key Set as defined in RFC 7517.
type JWKS struct {
	Keys []JWK `json:"keys"`
}

// cachedKey holds a cached RSA public key with its expiration time.
type cachedKey struct {
	key       *rsa.PublicKey
	expiresAt time.Time
}

// JWKSClient fetches and caches JWK keys from a JWKS endpoint.
type JWKSClient struct {
	url        string
	httpClient *http.Client
	cache      map[string]*cachedKey
	mu         sync.RWMutex
}

// NewJWKSClient creates a new JWKS client that fetches keys from the given URL.
func NewJWKSClient(url string) *JWKSClient {
	return &JWKSClient{
		url:        url,
		httpClient: &http.Client{Timeout: 10 * time.Second},
		cache:      make(map[string]*cachedKey),
	}
}

// GetKey retrieves the RSA public key for the given key ID.
// It first checks the cache and only fetches from the JWKS endpoint if not cached or expired.
func (c *JWKSClient) GetKey(kid string) (*rsa.PublicKey, error) {
	// Check cache with read lock
	c.mu.RLock()
	cached, ok := c.cache[kid]
	c.mu.RUnlock()

	if ok && time.Now().Before(cached.expiresAt) {
		return cached.key, nil
	}

	// Cache miss or expired - fetch and cache the key
	return c.fetchAndCacheKey(kid)
}

// fetchAndCacheKey fetches the JWKS and caches the key with the given kid.
// Uses double-check locking to prevent concurrent fetches for the same key.
func (c *JWKSClient) fetchAndCacheKey(kid string) (*rsa.PublicKey, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	// Double-check: another goroutine may have fetched while we waited for the lock
	if cached, ok := c.cache[kid]; ok && time.Now().Before(cached.expiresAt) {
		return cached.key, nil
	}

	// Fetch JWKS from endpoint
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.url, nil)
	if err != nil {
		return nil, fmt.Errorf("jwks: failed to create request: %w", err)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("jwks: failed to fetch: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("jwks: unexpected status code: %d", resp.StatusCode)
	}

	var jwks JWKS
	if err := json.NewDecoder(resp.Body).Decode(&jwks); err != nil {
		return nil, fmt.Errorf("jwks: failed to decode response: %w", err)
	}

	// Find the key with matching kid
	for _, jwk := range jwks.Keys {
		if jwk.Kid == kid {
			key, err := jwkToRSAPublicKey(jwk)
			if err != nil {
				return nil, fmt.Errorf("jwks: failed to convert key: %w", err)
			}

			// Cache the key
			c.cache[kid] = &cachedKey{
				key:       key,
				expiresAt: time.Now().Add(jwkCacheDuration),
			}

			return key, nil
		}
	}

	return nil, ErrKeyNotFound
}

// jwkToRSAPublicKey converts a JWK to an RSA public key.
// The N and E fields are base64url-encoded big integers.
func jwkToRSAPublicKey(jwk JWK) (*rsa.PublicKey, error) {
	if jwk.Kty != "RSA" {
		return nil, fmt.Errorf("unsupported key type: %s", jwk.Kty)
	}

	// Decode modulus (N)
	nBytes, err := base64.RawURLEncoding.DecodeString(jwk.N)
	if err != nil {
		return nil, fmt.Errorf("failed to decode modulus: %w", err)
	}
	n := new(big.Int).SetBytes(nBytes)

	// Decode exponent (E)
	eBytes, err := base64.RawURLEncoding.DecodeString(jwk.E)
	if err != nil {
		return nil, fmt.Errorf("failed to decode exponent: %w", err)
	}
	e := new(big.Int).SetBytes(eBytes)

	// Verify exponent fits in an int (standard RSA exponents are small, typically 65537)
	if !e.IsInt64() || e.Int64() > int64(math.MaxInt) {
		return nil, errors.New("exponent too large")
	}

	return &rsa.PublicKey{
		N: n,
		E: int(e.Int64()),
	}, nil
}
