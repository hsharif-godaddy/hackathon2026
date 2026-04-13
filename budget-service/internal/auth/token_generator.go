package auth

import (
	"fmt"
	"log/slog"
	"strings"
	"sync"

	gdauth "github.com/gdcorp-identity/gd-auth-lib/go/gd_auth_lib"
)

// TokenGenerator generates AWS IAM tokens for outbound webhook requests.
// It wraps gd-auth-lib's GenerateIamToken with health checking support.
type TokenGenerator struct {
	client *Client
	config *gdauth.AwsIamTokenClientConfig

	// Health tracking
	mu      sync.RWMutex
	healthy bool
	lastErr error
}

// NewTokenGenerator creates a token generator for webhook authentication.
// Requires InitClient() to have been called first.
// Returns error if client is not initialized or initial token generation fails.
// This ensures the service fails fast at startup if token generation is not working.
func NewTokenGenerator() (*TokenGenerator, error) {
	client := GetClient()
	if client == nil {
		return nil, fmt.Errorf("gd-auth client not initialized: call InitClient() first")
	}

	// NewAwsIamTokenClientConfig requires host without protocol
	ssoHost := strings.TrimPrefix(strings.TrimPrefix(client.SSOHost, "https://"), "http://")
	config := gdauth.NewAwsIamTokenClientConfig(ssoHost)
	config.RefreshMin = 45.0 // Refresh 15 min before 1-hour expiry

	g := &TokenGenerator{
		client:  client,
		config:  config,
		healthy: false,
	}

	// Validate token generation works at startup (fail fast)
	if _, err := g.GetToken(); err != nil {
		return nil, fmt.Errorf("initial token generation failed: %w", err)
	}
	g.healthy = true

	slog.Info("auth.token_generator.init", "ssoHost", client.SSOHost)
	return g, nil
}

// GetToken returns a valid AWS IAM token.
// gd-auth-lib handles caching and refresh internally.
func (g *TokenGenerator) GetToken() (string, error) {
	token, err := g.client.GDAuth.GenerateIamToken(g.config)

	g.mu.Lock()
	if err != nil {
		g.healthy = false
		g.lastErr = err
	} else {
		g.healthy = true
		g.lastErr = nil
	}
	g.mu.Unlock()

	return token, err
}

// Healthy returns true if token generation is working.
func (g *TokenGenerator) Healthy() bool {
	g.mu.RLock()
	defer g.mu.RUnlock()
	return g.healthy
}

// LastError returns the last token generation error, if any.
func (g *TokenGenerator) LastError() error {
	g.mu.RLock()
	defer g.mu.RUnlock()
	return g.lastErr
}
