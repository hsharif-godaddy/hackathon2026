package auth

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"sync"
	"time"
)

// ShareValidator validates share tokens by calling the agents API
// Includes a thread-safe cache to minimize API calls
type ShareValidator struct {
	agentsBaseURL string
	httpClient    *http.Client
	cache         *ShareTokenCache
}

// ShareTokenCache provides thread-safe caching of validated share tokens
type ShareTokenCache struct {
	mu     sync.RWMutex
	tokens map[string]CachedShareToken
}

// CachedShareToken represents a cached share token with its metadata
type CachedShareToken struct {
	AppID     string
	ExpiresAt time.Time
	CachedAt  time.Time
}

// ShareValidationResponse is the response from the agents validation endpoint
type ShareValidationResponse struct {
	Valid     bool   `json:"valid"`
	AppID     string `json:"appId,omitempty"`
	ExpiresAt int64  `json:"expiresAt,omitempty"` // Unix timestamp in milliseconds
	Reason    string `json:"reason,omitempty"`
}

// NewShareValidator creates a new share token validator
func NewShareValidator(agentsBaseURL string) *ShareValidator {
	return &ShareValidator{
		agentsBaseURL: agentsBaseURL,
		httpClient: &http.Client{
			Timeout: 5 * time.Second,
		},
		cache: &ShareTokenCache{
			tokens: make(map[string]CachedShareToken),
		},
	}
}

// ValidateToken validates a share token by checking cache first, then calling agents API
// Returns (valid, appID, error)
func (v *ShareValidator) ValidateToken(token string) (bool, string, error) {
	// Check cache first
	if cached, found := v.cache.Get(token); found {
		if time.Now().Before(cached.ExpiresAt) {
			slog.Debug("share.token.cache_hit",
				"share_token", token,
				"app_id", cached.AppID,
				"expires_at", cached.ExpiresAt)
			return true, cached.AppID, nil
		}
		// Expired, remove from cache
		v.cache.Delete(token)
		slog.Debug("share.token.cache_expired",
			"share_token", token,
			"expires_at", cached.ExpiresAt)
	}

	// Call agents API
	// Escape token to prevent path injection attacks
	escapedToken := url.PathEscape(token)
	apiURL := fmt.Sprintf("%s/api/share/validate/%s", v.agentsBaseURL, escapedToken)

	slog.Debug("share.token.api_call",
		"share_token", token,
		"url", apiURL)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, apiURL, nil)
	if err != nil {
		slog.Error("share.token.request_creation_error",
			"share_token", token,
			"error", err.Error())
		return false, "", fmt.Errorf("failed to create validation request: %w", err)
	}

	resp, err := v.httpClient.Do(req)
	if err != nil {
		slog.Error("share.token.api_error",
			"share_token", token,
			"error", err.Error())
		return false, "", fmt.Errorf("failed to validate share token: %w", err)
	}
	defer resp.Body.Close()

	// Check HTTP status before decoding
	// Non-2xx responses indicate availability issues, not invalid tokens
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		slog.Error("share.token.api_unavailable",
			"share_token", token,
			"status_code", resp.StatusCode)
		return false, "", fmt.Errorf("agents API returned non-2xx status: %d", resp.StatusCode)
	}

	var result ShareValidationResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		slog.Error("share.token.decode_error",
			"share_token", token,
			"error", err.Error())
		return false, "", fmt.Errorf("failed to decode validation response: %w", err)
	}

	if !result.Valid {
		slog.Debug("share.token.invalid",
			"share_token", token,
			"reason", result.Reason)
		return false, "", nil
	}

	// Cache valid token
	expiresAt := time.UnixMilli(result.ExpiresAt)
	v.cache.Set(token, CachedShareToken{
		AppID:     result.AppID,
		ExpiresAt: expiresAt,
		CachedAt:  time.Now(),
	})

	slog.Info("share.token.validated",
		"share_token", token,
		"app_id", result.AppID,
		"expires_at", expiresAt)

	return true, result.AppID, nil
}

// GetTokenExpiration returns the expiration time of a cached token
// Returns zero time if token is not cached
func (v *ShareValidator) GetTokenExpiration(token string) time.Time {
	if cached, found := v.cache.Get(token); found {
		return cached.ExpiresAt
	}
	return time.Time{} // Zero value
}

// Cache methods

// Get retrieves a cached share token (thread-safe)
func (c *ShareTokenCache) Get(token string) (CachedShareToken, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	cached, found := c.tokens[token]
	return cached, found
}

// Set stores a share token in cache (thread-safe)
func (c *ShareTokenCache) Set(token string, cached CachedShareToken) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.tokens[token] = cached
}

// Delete removes a share token from cache (thread-safe)
func (c *ShareTokenCache) Delete(token string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	delete(c.tokens, token)
}

// Size returns the number of cached tokens (thread-safe)
func (c *ShareTokenCache) Size() int {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return len(c.tokens)
}

// Clear removes all cached tokens (thread-safe)
func (c *ShareTokenCache) Clear() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.tokens = make(map[string]CachedShareToken)
}
