// Package getty provides a client for interacting with the Getty Images API.
package getty

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
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
		req.Header.Set("X-App-Key", a.appKey)
	}
	return nil
}

// Name returns the auth provider name.
func (a *BearerTokenAuth) Name() string {
	return "BearerToken"
}

// tokenRefreshMargin is how early before expiry we refresh the token.
const tokenRefreshMargin = 60 * time.Second

// ssoTokenResponse is the JSON response from the SSO token endpoint.
type ssoTokenResponse struct {
	Type    string `json:"type"`
	Code    int    `json:"code"`
	Message string `json:"message"`
	Data    string `json:"data"`
}

// SSOJWTAuth provides authentication using GoDaddy SSO JWT tokens obtained
// via client certificate authentication. It caches tokens and refreshes
// them before expiry.
type SSOJWTAuth struct {
	ssoHost    string
	certPath   string
	keyPath    string
	appKey     string
	httpClient *http.Client

	mu        sync.Mutex
	token     string
	expiresAt time.Time
}

// NewSSOJWTAuth creates a new SSOJWTAuth provider.
// ssoHost is the SSO hostname (e.g. "sso.godaddy.com").
// certPath and keyPath are paths to the client TLS certificate and key files.
// appKey is the x-app-key header value.
func NewSSOJWTAuth(ssoHost, certPath, keyPath, appKey string) (*SSOJWTAuth, error) {
	if certPath == "" || keyPath == "" {
		return nil, errors.New("getty: SSO JWT auth requires cert and key paths")
	}

	cert, err := tls.LoadX509KeyPair(certPath, keyPath)
	if err != nil {
		return nil, fmt.Errorf("getty: failed to load client cert/key: %w", err)
	}

	tlsConfig := &tls.Config{
		Certificates:  []tls.Certificate{cert},
		MinVersion:    tls.VersionTLS12,
		Renegotiation: tls.RenegotiateOnceAsClient,
	}

	return &SSOJWTAuth{
		ssoHost:  ssoHost,
		certPath: certPath,
		keyPath:  keyPath,
		appKey:   appKey,
		httpClient: &http.Client{
			Timeout: 10 * time.Second,
			Transport: &http.Transport{
				TLSClientConfig: tlsConfig,
			},
		},
	}, nil
}

// ApplyAuth fetches (or reuses a cached) SSO JWT token and applies it to the request.
func (a *SSOJWTAuth) ApplyAuth(ctx context.Context, req *http.Request) error {
	token, err := a.getToken(ctx)
	if err != nil {
		return fmt.Errorf("getty: SSO JWT token fetch failed: %w", err)
	}

	req.Header.Set("Authorization", "sso-jwt "+token)
	if a.appKey != "" {
		req.Header.Set("X-App-Key", a.appKey)
	}
	return nil
}

// Name returns the auth provider name.
func (a *SSOJWTAuth) Name() string {
	return "SSOJWT"
}

// getToken returns a valid cached token or fetches a new one.
func (a *SSOJWTAuth) getToken(ctx context.Context) (string, error) {
	a.mu.Lock()
	defer a.mu.Unlock()

	if a.token != "" && time.Now().Before(a.expiresAt.Add(-tokenRefreshMargin)) {
		return a.token, nil
	}

	token, expiresAt, err := a.fetchToken(ctx)
	if err != nil {
		return "", err
	}

	a.token = token
	a.expiresAt = expiresAt

	slog.Info("getty.auth.sso.tokenRefresh", "expiresAt", expiresAt.Format(time.RFC3339))
	return token, nil
}

// fetchToken exchanges client certs for an SSO JWT token.
func (a *SSOJWTAuth) fetchToken(ctx context.Context) (string, time.Time, error) {
	url := fmt.Sprintf("https://%s/secure/api/token", a.ssoHost)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, strings.NewReader("realm=cert"))
	if err != nil {
		return "", time.Time{}, fmt.Errorf("failed to create SSO request: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := a.httpClient.Do(req)
	if err != nil {
		return "", time.Time{}, fmt.Errorf("SSO request failed: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", time.Time{}, fmt.Errorf("failed to read SSO response: %w", err)
	}

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		return "", time.Time{}, fmt.Errorf("SSO returned status %d: %s", resp.StatusCode, string(body))
	}

	var tokenResp ssoTokenResponse
	if err := json.Unmarshal(body, &tokenResp); err != nil {
		return "", time.Time{}, fmt.Errorf("failed to parse SSO response: %w", err)
	}

	if tokenResp.Code != 1 || tokenResp.Data == "" {
		return "", time.Time{}, fmt.Errorf("SSO token exchange failed: code=%d message=%s", tokenResp.Code, tokenResp.Message)
	}

	expiresAt := extractJWTExpiry(tokenResp.Data)

	return tokenResp.Data, expiresAt, nil
}

// extractJWTExpiry parses the JWT exp claim without validating the signature.
// Falls back to 1 hour from now if parsing fails.
func extractJWTExpiry(tokenString string) time.Time {
	parser := jwt.NewParser(jwt.WithoutClaimsValidation())
	claims := &jwt.RegisteredClaims{}

	// Parse without verification — we only need the exp claim
	_, _, err := parser.ParseUnverified(tokenString, claims)
	if err == nil && claims.ExpiresAt != nil {
		return claims.ExpiresAt.Time
	}

	// Fallback: assume 1 hour validity
	return time.Now().Add(1 * time.Hour)
}
