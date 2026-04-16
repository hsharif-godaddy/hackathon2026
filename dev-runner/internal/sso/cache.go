package sso

import (
	"context"
	"sync"
)

// TokenCache allows multiple fixers to share a single device code flow result.
// The first caller performs the flow; subsequent callers get the cached token.
type TokenCache struct {
	mu    sync.Mutex
	token string
	cfg   Config
}

// NewTokenCache creates a cache that will use the given config when acquiring a token.
func NewTokenCache(cfg Config) *TokenCache {
	return &TokenCache{cfg: cfg}
}

// GetToken returns the cached token if available, otherwise performs the
// device code flow to acquire one.
func (c *TokenCache) GetToken(ctx context.Context) (string, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.token != "" {
		return c.token, nil
	}

	token, err := AcquireToken(ctx, c.cfg)
	if err != nil {
		return "", err
	}
	c.token = token
	return token, nil
}
