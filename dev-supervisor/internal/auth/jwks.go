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
	"sync"
	"time"
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

// cachedKey stores a parsed RSA public key with its expiration time
type cachedKey struct {
	publicKey *rsa.PublicKey
	expiresAt time.Time
}

// JWKSClient fetches and caches public keys from standard RFC 7517 JWKS endpoint
// Expects standard JWKS URL (e.g., https://local.gasket.dev-godaddy.com:8443/.well-known/jwks.json)
type JWKSClient struct {
	mu         sync.RWMutex
	jwksURL    string
	cache      map[string]cachedKey // kid -> cached key
	cacheTTL   time.Duration
	httpClient *http.Client
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
func (c *JWKSClient) GetPublicKey(kid string) (*rsa.PublicKey, error) {
	// Check cache first
	c.mu.RLock()
	cached, found := c.cache[kid]
	c.mu.RUnlock()

	if found && time.Now().Before(cached.expiresAt) {
		slog.Debug("jwks.key.cache_hit", "kid", kid)
		return cached.publicKey, nil
	}

	// Cache miss or expired - fetch from JWKS endpoint
	slog.Debug("jwks.key.cache_miss", "kid", kid)
	return c.fetchAndCacheKey(kid)
}

// fetchAndCacheKey fetches JWKS from standard RFC 7517 endpoint and extracts key by ID
// Fetches all keys from JWKS endpoint and finds the one matching the requested kid
func (c *JWKSClient) fetchAndCacheKey(kid string) (*rsa.PublicKey, error) {
	slog.Debug("jwks.fetch.standard", "kid", kid, "url", c.jwksURL)

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

	// Log raw response for debugging (truncated if too large)
	bodyPreview := string(bodyBytes)
	if len(bodyPreview) > 500 {
		bodyPreview = bodyPreview[:500] + "..."
	}
	slog.Debug("jwks.response.raw",
		"kid", kid,
		"bodyPreview", bodyPreview)

	// Parse standard RFC 7517 JWKS response
	var response JWKSResponse
	if decodeErr := json.Unmarshal(bodyBytes, &response); decodeErr != nil {
		slog.Error("jwks.parse.error",
			"error", decodeErr,
			"url", c.jwksURL,
			"body", bodyPreview)
		return nil, fmt.Errorf("failed to parse JWKS response: %w", decodeErr)
	}

	// Find the key with matching kid
	var targetJWK *JWK
	for i := range response.Keys {
		if response.Keys[i].Kid == kid {
			targetJWK = &response.Keys[i]
			break
		}
	}

	if targetJWK == nil {
		slog.Error("jwks.key.not_found",
			"kid", kid,
			"availableKeys", len(response.Keys),
			"url", c.jwksURL)
		return nil, fmt.Errorf("key with kid '%s' not found in JWKS (found %d keys)", kid, len(response.Keys))
	}

	// Log parsed JWK for debugging
	slog.Debug("jwks.key.parsed",
		"kid", targetJWK.Kid,
		"kty", targetJWK.Kty,
		"use", targetJWK.Use,
		"alg", targetJWK.Alg)

	// Convert JWK to RSA public key
	publicKey, err := c.jwkToRSAPublicKey(targetJWK)
	if err != nil {
		return nil, err
	}

	// Cache the key
	c.mu.Lock()
	c.cache[kid] = cachedKey{
		publicKey: publicKey,
		expiresAt: time.Now().Add(c.cacheTTL),
	}
	c.mu.Unlock()

	slog.Info("jwks.key.fetched",
		"kid", kid,
		"jwksURL", c.jwksURL,
		"totalKeys", len(response.Keys),
		"cacheTTL", c.cacheTTL)

	return publicKey, nil
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

	// Validate exponent fits in int range to prevent overflow
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

// ClearCache removes all cached keys (useful for key rotation)
func (c *JWKSClient) ClearCache() {
	c.mu.Lock()
	defer c.mu.Unlock()

	c.cache = make(map[string]cachedKey)
	slog.Info("jwks.cache.cleared")
}
