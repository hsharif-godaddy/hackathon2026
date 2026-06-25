package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

// IDPOAuthConfig holds configuration for the IDP OAuth Authorization Code flow.
type IDPOAuthConfig struct {
	Issuer              string // IDP issuer URL (e.g., https://godaddy.okta.com)
	ClientID            string // OAuth client ID
	ClientSecret        string // OAuth client secret
	Scopes              string // Space-separated scopes (e.g., "openid email profile")
	CookieEncryptionKey string // Hex-encoded 32-byte key for AES-GCM cookie encryption (derived from client secret)
}

const (
	// IDPCallbackPath is the fixed path where the IDP redirects after authentication.
	IDPCallbackPath = "/airo/idp/callback"
)

// IDPOAuthHandler handles the OAuth 2.0 Authorization Code flow with PKCE.
type IDPOAuthHandler struct {
	config    IDPOAuthConfig
	encryptor *SessionEncryptor

	// Lazy OIDC discovery — endpoints are resolved on first use and cached.
	// This avoids a fatal boot dependency on IDP availability.
	endpointsMu sync.RWMutex
	endpoints   *IDPEndpoints
}

// IDPEndpoints holds the discovered OIDC endpoints from the IDP.
type IDPEndpoints struct {
	AuthorizationEndpoint string `json:"authorization_endpoint"`
	TokenEndpoint         string `json:"token_endpoint"`
	JWKSUri               string `json:"jwks_uri"`
	UserinfoEndpoint      string `json:"userinfo_endpoint"`
}

// NewIDPOAuthHandler creates a new IDP OAuth handler.
// OIDC endpoint discovery is deferred until the first request (lazy), so a
// transient IDP blip at container boot does not prevent the app from starting.
func NewIDPOAuthHandler(config IDPOAuthConfig) (*IDPOAuthHandler, error) {
	encryptor, err := NewSessionEncryptor(config.CookieEncryptionKey)
	if err != nil {
		return nil, fmt.Errorf("failed to create cookie encryptor: %w", err)
	}

	handler := &IDPOAuthHandler{
		config:    config,
		encryptor: encryptor,
	}

	// Attempt eager discovery (best-effort). If it fails, endpoints will be
	// resolved lazily on the first request.
	endpoints, err := discoverEndpoints(config.Issuer)
	if err != nil {
		slog.Warn("idp.oauth.eager_discovery_failed",
			"issuer", config.Issuer,
			"error", err.Error(),
			"note", "will retry on first request")
	} else {
		handler.endpoints = endpoints
	}

	return handler, nil
}

// GetEncryptor returns the session encryptor for use by the middleware.
func (h *IDPOAuthHandler) GetEncryptor() *SessionEncryptor {
	return h.encryptor
}

// getEndpoints returns the cached OIDC endpoints, performing discovery if needed.
// Retries up to 3 times with exponential backoff on transient failures.
func (h *IDPOAuthHandler) getEndpoints() (*IDPEndpoints, error) {
	h.endpointsMu.RLock()
	if h.endpoints != nil {
		ep := h.endpoints
		h.endpointsMu.RUnlock()
		return ep, nil
	}
	h.endpointsMu.RUnlock()

	h.endpointsMu.Lock()
	defer h.endpointsMu.Unlock()

	// Double-check after acquiring write lock
	if h.endpoints != nil {
		return h.endpoints, nil
	}

	var lastErr error
	for attempt := range 3 {
		endpoints, err := discoverEndpoints(h.config.Issuer)
		if err == nil {
			h.endpoints = endpoints
			return endpoints, nil
		}
		lastErr = err
		backoff := time.Duration(1<<attempt) * 500 * time.Millisecond
		slog.Warn("idp.oauth.discovery_retry",
			"attempt", attempt+1,
			"backoff", backoff,
			"error", err.Error())
		time.Sleep(backoff)
	}
	return nil, fmt.Errorf("OIDC discovery failed after 3 attempts: %w", lastErr)
}

// HandleCallback processes the OAuth callback from the IDP.
// It verifies state, exchanges the code for tokens, creates a session, and redirects.
func (h *IDPOAuthHandler) HandleCallback(w http.ResponseWriter, r *http.Request) {
	// Check for error response from IDP
	if errCode := r.URL.Query().Get("error"); errCode != "" {
		errDesc := r.URL.Query().Get("error_description")
		slog.ErrorContext(r.Context(), "idp.oauth.callback_error",
			"error", errCode,
			"description", errDesc)
		http.Error(w, "Authentication failed: "+errDesc, http.StatusForbidden)
		return
	}

	code := r.URL.Query().Get("code")
	state := r.URL.Query().Get("state")

	if code == "" || state == "" {
		slog.WarnContext(r.Context(), "idp.oauth.callback_missing_params",
			"has_code", code != "",
			"has_state", state != "")
		http.Error(w, "Bad Request: missing code or state", http.StatusBadRequest)
		return
	}

	// Read and verify PKCE state from cookie
	pkce := h.encryptor.GetPKCEFromCookie(r)
	if pkce == nil {
		slog.WarnContext(r.Context(), "idp.oauth.callback_no_pkce_cookie")
		http.Error(w, "Bad Request: missing or expired PKCE state", http.StatusBadRequest)
		return
	}

	// Verify state matches (CSRF protection)
	if pkce.State != state {
		slog.WarnContext(r.Context(), "idp.oauth.callback_state_mismatch",
			"expected", pkce.State,
			"received", state)
		http.Error(w, "Forbidden: state mismatch", http.StatusForbidden)
		return
	}

	// Exchange authorization code for tokens.
	// Derive redirect URI from this request's Host — must match what was sent in the
	// authorization request (Okta validates this).
	redirectURI := deriveRedirectURI(r)
	tokenResp, err := h.exchangeCode(r.Context(), code, pkce.CodeVerifier, redirectURI)
	if err != nil {
		slog.ErrorContext(r.Context(), "idp.oauth.token_exchange_failed", "error", err.Error())
		http.Error(w, "Authentication failed: token exchange error", http.StatusInternalServerError)
		return
	}

	// Validate that the IDP returned a usable access token.
	if tokenResp.AccessToken == "" {
		slog.ErrorContext(r.Context(), "idp.oauth.empty_access_token")
		http.Error(w, "Authentication failed: IDP returned empty access token", http.StatusInternalServerError)
		return
	}

	// Clamp expires_in to a safe default when the IDP omits it (optional per RFC 6749).
	// Without this, ExpiresAt == now and GetSessionFromCookie rejects the cookie
	// on the very next request, causing an infinite redirect loop.
	expiresIn := tokenResp.ExpiresIn
	if expiresIn <= 0 {
		expiresIn = 3600
	}

	// Build session from token response.
	// Only store access_token + expiry. ID token is not stored — it's only
	// useful at callback time and adds ~1KB to the cookie (risks exceeding
	// the 4KB browser limit with large Okta tokens).
	session := &IDPSession{
		AccessToken: tokenResp.AccessToken,
		ExpiresAt:   time.Now().Unix() + int64(expiresIn),
	}

	// Set session cookie
	if err := h.encryptor.SetSessionCookie(w, session); err != nil {
		slog.ErrorContext(r.Context(), "idp.oauth.set_session_failed", "error", err.Error())
		http.Error(w, "Internal Server Error", http.StatusInternalServerError)
		return
	}

	// Clear PKCE cookie
	ClearPKCECookie(w)

	// Redirect to original URL with open-redirect protection.
	// RequestURI() is attacker-controlled: a request to https://app//evil.com/
	// yields "//evil.com/" which browsers resolve as scheme-relative to evil.com.
	redirectTo := pkce.OriginalURL
	if redirectTo == "" || !strings.HasPrefix(redirectTo, "/") || strings.HasPrefix(redirectTo, "//") {
		redirectTo = "/"
	}

	slog.InfoContext(r.Context(), "idp.oauth.login_success",
		"redirect_to", redirectTo)

	http.Redirect(w, r, redirectTo, http.StatusFound)
}

// RedirectToIDP initiates the OAuth flow by redirecting the user to the IDP.
func (h *IDPOAuthHandler) RedirectToIDP(w http.ResponseWriter, r *http.Request) {
	// Resolve OIDC endpoints (lazy discovery with retry)
	endpoints, err := h.getEndpoints()
	if err != nil {
		slog.ErrorContext(r.Context(), "idp.oauth.discovery_failed", "error", err.Error())
		http.Error(w, "Service Unavailable: IDP discovery failed", http.StatusServiceUnavailable)
		return
	}

	// Generate PKCE values
	codeVerifier, err := generateCodeVerifier()
	if err != nil {
		slog.ErrorContext(r.Context(), "idp.oauth.generate_verifier_failed", "error", err.Error())
		http.Error(w, "Internal Server Error", http.StatusInternalServerError)
		return
	}
	codeChallenge := deriveCodeChallenge(codeVerifier)

	// Generate state (CSRF token)
	state, err := generateState()
	if err != nil {
		slog.ErrorContext(r.Context(), "idp.oauth.generate_state_failed", "error", err.Error())
		http.Error(w, "Internal Server Error", http.StatusInternalServerError)
		return
	}

	// Store PKCE state in encrypted cookie
	pkce := &IDPPKCEState{
		State:        state,
		CodeVerifier: codeVerifier,
		OriginalURL:  r.URL.RequestURI(),
		CreatedAt:    time.Now().Unix(),
	}
	if err := h.encryptor.SetPKCECookie(w, pkce); err != nil {
		slog.ErrorContext(r.Context(), "idp.oauth.set_pkce_cookie_failed", "error", err.Error())
		http.Error(w, "Internal Server Error", http.StatusInternalServerError)
		return
	}

	// Build authorization URL
	redirectURI := deriveRedirectURI(r)
	params := url.Values{
		"client_id":             {h.config.ClientID},
		"response_type":         {"code"},
		"scope":                 {h.config.Scopes},
		"redirect_uri":          {redirectURI},
		"state":                 {state},
		"code_challenge":        {codeChallenge},
		"code_challenge_method": {"S256"},
	}

	authURL := endpoints.AuthorizationEndpoint + "?" + params.Encode()

	slog.InfoContext(r.Context(), "idp.oauth.redirecting_to_idp",
		"path", r.URL.Path,
		"auth_url", authURL)

	http.Redirect(w, r, authURL, http.StatusFound)
}

// tokenResponse represents the IDP's /token endpoint response.
type tokenResponse struct {
	AccessToken  string `json:"access_token"`
	IDToken      string `json:"id_token"`
	TokenType    string `json:"token_type"`
	ExpiresIn    int    `json:"expires_in"`
	RefreshToken string `json:"refresh_token,omitempty"`
	Scope        string `json:"scope,omitempty"`
}

// exchangeCode exchanges the authorization code for tokens at the IDP's token endpoint.
func (h *IDPOAuthHandler) exchangeCode(
	ctx context.Context,
	code, codeVerifier, redirectURI string,
) (*tokenResponse, error) {
	endpoints, err := h.getEndpoints()
	if err != nil {
		return nil, fmt.Errorf("failed to resolve OIDC endpoints: %w", err)
	}

	data := url.Values{
		"grant_type":    {"authorization_code"},
		"code":          {code},
		"redirect_uri":  {redirectURI},
		"client_id":     {h.config.ClientID},
		"client_secret": {h.config.ClientSecret},
		"code_verifier": {codeVerifier},
	}

	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(
		ctx, http.MethodPost, endpoints.TokenEndpoint, strings.NewReader(data.Encode()),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create token request: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("token request failed: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read token response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		slog.ErrorContext(ctx, "idp.oauth.token_endpoint_error",
			"status", resp.StatusCode,
			"body", string(body))
		return nil, fmt.Errorf("token endpoint returned %d", resp.StatusCode)
	}

	var tokenResp tokenResponse
	if err := json.Unmarshal(body, &tokenResp); err != nil {
		return nil, fmt.Errorf("failed to parse token response: %w", err)
	}

	return &tokenResp, nil
}

// discoverEndpoints fetches OIDC endpoints from the issuer's well-known configuration.
func discoverEndpoints(issuer string) (*IDPEndpoints, error) {
	wellKnownURL := strings.TrimRight(issuer, "/") + "/.well-known/openid-configuration"

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, wellKnownURL, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create discovery request: %w", err)
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("OIDC discovery request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("OIDC discovery returned %d", resp.StatusCode)
	}

	var endpoints IDPEndpoints
	if err := json.NewDecoder(resp.Body).Decode(&endpoints); err != nil {
		return nil, fmt.Errorf("failed to parse OIDC discovery response: %w", err)
	}

	if endpoints.AuthorizationEndpoint == "" || endpoints.TokenEndpoint == "" {
		return nil, errors.New("OIDC discovery missing required endpoints")
	}

	slog.Info("idp.oauth.endpoints_discovered",
		"issuer", issuer,
		"authorization_endpoint", endpoints.AuthorizationEndpoint,
		"token_endpoint", endpoints.TokenEndpoint,
		"jwks_uri", endpoints.JWKSUri)

	return &endpoints, nil
}

// generateCodeVerifier creates a cryptographically random PKCE code_verifier.
// Returns a 43-character base64url-encoded string (32 random bytes).
func generateCodeVerifier() (string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}

// deriveCodeChallenge computes the S256 code_challenge from a code_verifier.
func deriveCodeChallenge(verifier string) string {
	h := sha256.Sum256([]byte(verifier))
	return base64.RawURLEncoding.EncodeToString(h[:])
}

// generateState creates a cryptographically random state parameter (CSRF token).
func generateState() (string, error) {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf), nil
}

// deriveRedirectURI constructs the OAuth redirect URI from the inbound request's
// Host header. This is the design-doc approach (§3.5.1): dev-supervisor owns the
// redirect URI, deriving it per-request so custom domains work without config changes.
// The scheme is always https because dev-supervisor terminates TLS.
func deriveRedirectURI(r *http.Request) string {
	return "https://" + r.Host + IDPCallbackPath
}
