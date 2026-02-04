// Package getty provides a client for interacting with the Getty Images API.
package getty

import (
	"context"
	"errors"
	"net/http"
)

// ErrEmptyToken is returned when creating a BearerTokenAuth with an empty token.
var ErrEmptyToken = errors.New("getty: bearer token cannot be empty")

// AuthProvider is an interface for providing authentication headers to Getty API requests.
// This allows for pluggable authentication strategies (Bearer token for proxy, SSO JWT for direct).
type AuthProvider interface {
	// ApplyAuth adds authentication headers to the request.
	// Returns an error if authentication cannot be applied (e.g., token refresh failure).
	ApplyAuth(ctx context.Context, req *http.Request) error

	// Name returns a human-readable name for logging purposes.
	Name() string
}

// BearerTokenAuth provides authentication using a static Bearer token.
// This is used when calling the airo-builder proxy which accepts Bearer tokens.
type BearerTokenAuth struct {
	token  string
	appKey string
}

// NewBearerTokenAuth creates a new BearerTokenAuth provider.
// token is the Bearer token for Authorization header.
// appKey is the x-app-key header value (identifies the calling application).
// Returns an error if token is empty.
func NewBearerTokenAuth(token, appKey string) (*BearerTokenAuth, error) {
	if token == "" {
		return nil, ErrEmptyToken
	}
	return &BearerTokenAuth{
		token:  token,
		appKey: appKey,
	}, nil
}

// ApplyAuth adds Bearer token authentication headers to the request.
func (a *BearerTokenAuth) ApplyAuth(_ context.Context, req *http.Request) error {
	req.Header.Set("Authorization", "Bearer "+a.token)
	if a.appKey != "" {
		req.Header.Set("x-app-key", a.appKey)
	}
	return nil
}

// Name returns the auth provider name.
func (a *BearerTokenAuth) Name() string {
	return "BearerToken"
}

// SSOJWTAuth provides authentication using GoDaddy SSO JWT tokens.
// This is used when calling the Getty Images proxy directly.
// TODO: Implement this when we want to bypass the airo-builder proxy.
type SSOJWTAuth struct {
	ssoHost  string
	certPath string
	keyPath  string
	appKey   string
	// TODO: Add token caching, refresh logic
}

// NewSSOJWTAuth creates a new SSOJWTAuth provider.
// This is a placeholder for future implementation.
func NewSSOJWTAuth(ssoHost, certPath, keyPath, appKey string) *SSOJWTAuth {
	return &SSOJWTAuth{
		ssoHost:  ssoHost,
		certPath: certPath,
		keyPath:  keyPath,
		appKey:   appKey,
	}
}

// ApplyAuth adds SSO JWT authentication headers to the request.
// TODO: Implement SSO token fetch and caching.
func (a *SSOJWTAuth) ApplyAuth(_ context.Context, req *http.Request) error {
	// TODO: Implement:
	// 1. Check if cached token is still valid
	// 2. If not, use client certs to get new token from SSO
	// 3. Apply "Authorization: sso-jwt <token>" header
	// 4. Apply "x-app-key" header

	// For now, just set the app key header
	if a.appKey != "" {
		req.Header.Set("x-app-key", a.appKey)
	}

	return nil
}

// Name returns the auth provider name.
func (a *SSOJWTAuth) Name() string {
	return "SSOJWT"
}
