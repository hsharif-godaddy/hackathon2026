package hosting

import (
	"context"
	"crypto/tls"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"
)

// certTokenRefreshMargin is how early before expiry to refresh the cached
// SSO JWT. Mirrors image-search-service/internal/getty/auth.go.
const certTokenRefreshMargin = 60 * time.Second

// certTokenFallbackTTL is the assumed validity if extracting the exp claim
// from the issued JWT fails. SSO JWTs are typically valid ~1 hour.
const certTokenFallbackTTL = 1 * time.Hour

// ssoTokenResponse is the SSO /secure/api/token JSON envelope. `Data` carries
// the JWT on success.
type ssoTokenResponse struct {
	Type    string `json:"type"`
	Code    int    `json:"code"`
	Message string `json:"message"`
	Data    string `json:"data"`
}

// CertSSOAuth attaches an `Authorization: sso-jwt <token>` header by
// exchanging a TLS client cert for an SSO JWT and caching it until expiry.
//
// The frontdoor `cert` gd-jwt-type filter accepts JWTs minted by SSO after a
// client-cert handshake. The CN of the cert is the caller identity hosting
// uses for caller-allowlist checks; rotate the cert when revoking the
// service identity.
type CertSSOAuth struct {
	ssoHost    string
	httpClient *http.Client

	mu        sync.Mutex
	token     string
	expiresAt time.Time
}

// NewCertSSOAuth parses cert+key PEM bytes and returns a provider that mints
// SSO JWTs on demand. Cert and key are passed as PEM bytes (the contents,
// not file paths) because Katana exposes secrets only as env vars — there
// is no file-mount option. ssoHost must be the bare hostname (protocol and
// trailing slashes are stripped).
func NewCertSSOAuth(ssoHost string, certPEM, keyPEM []byte) (*CertSSOAuth, error) {
	host := strings.TrimSpace(ssoHost)
	host = strings.TrimPrefix(strings.TrimPrefix(host, "https://"), "http://")
	host = strings.TrimRight(host, "/")
	if host == "" {
		return nil, errors.New("hosting: SSO host is required")
	}
	if len(certPEM) == 0 || len(keyPEM) == 0 {
		return nil, errors.New("hosting: cert auth requires both cert and key PEM contents")
	}
	cert, err := tls.X509KeyPair(certPEM, keyPEM)
	if err != nil {
		return nil, fmt.Errorf("hosting: parse cert keypair: %w", err)
	}
	return &CertSSOAuth{
		ssoHost: host,
		httpClient: &http.Client{
			Timeout: 10 * time.Second,
			Transport: &http.Transport{
				TLSClientConfig: &tls.Config{
					Certificates:  []tls.Certificate{cert},
					MinVersion:    tls.VersionTLS12,
					Renegotiation: tls.RenegotiateOnceAsClient,
				},
			},
		},
	}, nil
}

// ApplyAuth mints (or returns the cached) SSO JWT and sets the Authorization
// header. The frontdoor `cert` filter expects the `sso-jwt` scheme — NOT
// `Bearer`, which is what `awsiam` JWTs use.
func (a *CertSSOAuth) ApplyAuth(ctx context.Context, req *http.Request) error {
	token, err := a.getToken(ctx)
	if err != nil {
		return fmt.Errorf("hosting: mint cert SSO token: %w", err)
	}
	req.Header.Set("Authorization", "sso-jwt "+token)
	return nil
}

// Name returns the provider name.
func (*CertSSOAuth) Name() string { return "cert" }

// getToken returns the cached token if still fresh, otherwise refreshes.
func (a *CertSSOAuth) getToken(ctx context.Context) (string, error) {
	a.mu.Lock()
	defer a.mu.Unlock()

	if a.token != "" && time.Now().Before(a.expiresAt.Add(-certTokenRefreshMargin)) {
		return a.token, nil
	}

	token, expiresAt, err := a.fetchToken(ctx)
	if err != nil {
		slog.Warn("stripe_service.hosting.cert_auth.token_refresh_failed",
			"ssoHost", a.ssoHost, "error", err.Error())
		return "", err
	}
	a.token = token
	a.expiresAt = expiresAt

	slog.Info("stripe_service.hosting.cert_auth.token_refresh",
		"expiresAt", expiresAt.Format(time.RFC3339))
	return token, nil
}

// fetchToken POSTs `realm=cert` to SSO with the cert presented in the TLS
// handshake (configured on a.httpClient.Transport.TLSClientConfig).
func (a *CertSSOAuth) fetchToken(ctx context.Context) (string, time.Time, error) {
	url := fmt.Sprintf("https://%s/secure/api/token", a.ssoHost)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, strings.NewReader("realm=cert"))
	if err != nil {
		return "", time.Time{}, fmt.Errorf("build SSO request: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := a.httpClient.Do(req)
	if err != nil {
		return "", time.Time{}, fmt.Errorf("SSO request failed: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", time.Time{}, fmt.Errorf("read SSO response: %w", err)
	}
	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		return "", time.Time{}, fmt.Errorf("SSO returned status %d: %s", resp.StatusCode, string(body))
	}

	var tokenResp ssoTokenResponse
	if err := json.Unmarshal(body, &tokenResp); err != nil {
		return "", time.Time{}, fmt.Errorf("parse SSO response: %w", err)
	}
	if tokenResp.Code != 1 || tokenResp.Data == "" {
		return "", time.Time{}, fmt.Errorf("SSO token exchange failed: code=%d message=%s", tokenResp.Code, tokenResp.Message)
	}
	return tokenResp.Data, extractJWTExpiry(tokenResp.Data), nil
}

// extractJWTExpiry reads the `exp` claim from a JWT payload without
// verifying the signature. The SSO that issued the token is trusted; we
// only need the expiry to drive cache refresh. Falls back to a 1h TTL if
// the JWT is malformed or the claim is missing — the worst case is one
// extra refresh per hour.
func extractJWTExpiry(token string) time.Time {
	fallback := time.Now().Add(certTokenFallbackTTL)
	parts := strings.Split(token, ".")
	if len(parts) < 2 {
		return fallback
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return fallback
	}
	var claims struct {
		Exp int64 `json:"exp"`
	}
	if err := json.Unmarshal(payload, &claims); err != nil || claims.Exp == 0 {
		return fallback
	}
	return time.Unix(claims.Exp, 0)
}
