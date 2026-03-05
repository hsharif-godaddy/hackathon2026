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

const jwkCacheDuration = 24 * time.Hour

var ErrKeyNotFound = errors.New("jwks: key not found")

type JWK struct {
	Kty string `json:"kty"`
	Use string `json:"use"`
	Kid string `json:"kid"`
	Alg string `json:"alg"`
	N   string `json:"n"`
	E   string `json:"e"`
}

type JWKS struct {
	Keys []JWK `json:"keys"`
}

type cachedKey struct {
	key       *rsa.PublicKey
	expiresAt time.Time
}

type JWKSClient struct {
	url        string
	httpClient *http.Client
	cache      map[string]*cachedKey
	mu         sync.RWMutex
}

func NewJWKSClient(url string) *JWKSClient {
	return &JWKSClient{
		url:        url,
		httpClient: &http.Client{Timeout: 10 * time.Second},
		cache:      make(map[string]*cachedKey),
	}
}

func (c *JWKSClient) GetKey(kid string) (*rsa.PublicKey, error) {
	c.mu.RLock()
	cached, ok := c.cache[kid]
	c.mu.RUnlock()

	if ok && time.Now().Before(cached.expiresAt) {
		return cached.key, nil
	}

	return c.fetchAndCacheKey(kid)
}

func (c *JWKSClient) fetchAndCacheKey(kid string) (*rsa.PublicKey, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	if cached, ok := c.cache[kid]; ok && time.Now().Before(cached.expiresAt) {
		return cached.key, nil
	}

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

	for _, jwk := range jwks.Keys {
		if jwk.Kid == kid {
			key, err := jwkToRSAPublicKey(jwk)
			if err != nil {
				return nil, fmt.Errorf("jwks: failed to convert key: %w", err)
			}

			c.cache[kid] = &cachedKey{
				key:       key,
				expiresAt: time.Now().Add(jwkCacheDuration),
			}

			return key, nil
		}
	}

	return nil, ErrKeyNotFound
}

func jwkToRSAPublicKey(jwk JWK) (*rsa.PublicKey, error) {
	if jwk.Kty != "RSA" {
		return nil, fmt.Errorf("unsupported key type: %s", jwk.Kty)
	}

	nBytes, err := base64.RawURLEncoding.DecodeString(jwk.N)
	if err != nil {
		return nil, fmt.Errorf("failed to decode modulus: %w", err)
	}
	n := new(big.Int).SetBytes(nBytes)

	eBytes, err := base64.RawURLEncoding.DecodeString(jwk.E)
	if err != nil {
		return nil, fmt.Errorf("failed to decode exponent: %w", err)
	}
	e := new(big.Int).SetBytes(eBytes)

	if !e.IsInt64() || e.Int64() > int64(math.MaxInt) {
		return nil, errors.New("exponent too large")
	}

	return &rsa.PublicKey{
		N: n,
		E: int(e.Int64()),
	}, nil
}
