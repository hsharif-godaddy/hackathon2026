// Package getty provides a client for interacting with the Getty Images API
// with built-in rate limiting and concurrency control.
package getty

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"time"

	"github.com/airo-ai-builder/image-search-service/internal/config"
	"github.com/airo-ai-builder/image-search-service/internal/ratelimit"
)

// Client provides methods for searching and retrieving images from Getty API.
type Client struct {
	httpClient *http.Client
	baseURL    string
	auth       AuthProvider
	limiter    *ratelimit.Limiter
}

// New creates a new Getty API client with the provided configuration.
// Uses BearerTokenAuth by default (for airo-builder proxy).
// Returns an error if the Getty token is not configured.
func New(cfg *config.Config) (*Client, error) {
	auth, err := NewBearerTokenAuth(cfg.GettyToken, cfg.GettyXAppKey)
	if err != nil {
		return nil, fmt.Errorf("getty client: %w", err)
	}
	slog.Info("getty.client.init", "authProvider", auth.Name(), "baseURL", cfg.GettyUpstream)

	return &Client{
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
		baseURL: cfg.GettyUpstream,
		auth:    auth,
		limiter: ratelimit.New(cfg.GettyConcurrency, cfg.GettyRateLimitRPS),
	}, nil
}

// NewWithAuth creates a new Getty API client with a custom auth provider.
// Use this when you need a different authentication strategy (e.g., SSO JWT).
func NewWithAuth(cfg *config.Config, auth AuthProvider) *Client {
	slog.Info("getty.client.init", "authProvider", auth.Name(), "baseURL", cfg.GettyUpstream)

	return &Client{
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
		baseURL: cfg.GettyUpstream,
		auth:    auth,
		limiter: ratelimit.New(cfg.GettyConcurrency, cfg.GettyRateLimitRPS),
	}
}

// SearchWithOptions searches for images using the full set of SearchOptions.
// Returns a SearchResponse containing results, facets, and related searches.
func (c *Client) SearchWithOptions(ctx context.Context, opts *SearchOptions) (*SearchResponse, error) {
	if c.limiter != nil {
		if err := c.limiter.Acquire(ctx); err != nil {
			return nil, fmt.Errorf("failed to acquire rate limit: %w", err)
		}
		defer c.limiter.Release()
	}

	searchURL := BuildSearchURL(c.baseURL, opts)
	slog.Debug("getty.search.request", "url", searchURL, "phrase", opts.Phrase)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, searchURL, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	// Apply authentication
	err = c.auth.ApplyAuth(ctx, req)
	if err != nil {
		return nil, fmt.Errorf("failed to apply auth: %w", err)
	}
	req.Header.Set("Accept", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to execute request: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		slog.Error("getty.search.error", "status", resp.StatusCode, "body", string(body))
		return nil, fmt.Errorf("getty API returned status %d: %s", resp.StatusCode, string(body))
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response body: %w", err)
	}

	var response SearchResponse
	if err := json.Unmarshal(body, &response); err != nil {
		return nil, fmt.Errorf("failed to unmarshal response: %w", err)
	}

	slog.Debug("getty.search.response", "resultCount", response.ResultCount, "imagesReturned", len(response.Images))
	return &response, nil
}

// Search searches for images matching the query and returns up to count results.
// This is a simplified wrapper around SearchWithOptions for backward compatibility.
func (c *Client) Search(ctx context.Context, query string, count int) ([]ImageResult, error) {
	opts := &SearchOptions{
		Phrase:   query,
		PageSize: count,
	}

	resp, err := c.SearchWithOptions(ctx, opts)
	if err != nil {
		return nil, err
	}

	return resp.Images, nil
}

// GetByID retrieves a single image by its Getty ID.
// Note: This uses the proxy's search endpoint with an ID filter since
// the proxy doesn't expose the direct image endpoint.
func (c *Client) GetByID(ctx context.Context, gettyID string) (*ImageResult, error) {
	if c.limiter != nil {
		if err := c.limiter.Acquire(ctx); err != nil {
			return nil, fmt.Errorf("failed to acquire rate limit: %w", err)
		}
		defer c.limiter.Release()
	}

	// Use search endpoint with ID since proxy doesn't expose direct image endpoint.
	// Build URL via SearchOptions/BuildSearchURL to ensure safety defaults are applied.
	searchOpts := &SearchOptions{
		Phrase:   gettyID,
		PageSize: 1,
	}
	imageURL := BuildSearchURL(c.baseURL, searchOpts)
	slog.Debug("getty.getbyid.request", "gettyID", gettyID)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, imageURL, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	// Apply authentication
	err = c.auth.ApplyAuth(ctx, req)
	if err != nil {
		return nil, fmt.Errorf("failed to apply auth: %w", err)
	}
	req.Header.Set("Accept", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to execute request: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode == http.StatusNotFound {
		return nil, nil
	}

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		slog.Error("getty.getbyid.error", "status", resp.StatusCode, "body", string(body))
		return nil, fmt.Errorf("getty API returned status %d: %s", resp.StatusCode, string(body))
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response body: %w", err)
	}

	var response SearchResponse
	if err := json.Unmarshal(body, &response); err != nil {
		return nil, fmt.Errorf("failed to unmarshal response: %w", err)
	}

	if len(response.Images) == 0 {
		return nil, nil
	}

	slog.Debug("getty.getbyid.response", "found", true, "id", response.Images[0].ID)
	return &response.Images[0], nil
}

// Stats returns the current rate limiter statistics.
// busy is the number of currently active requests.
// available is the number of slots available for new requests.
func (c *Client) Stats() (busy int, available int) {
	if c.limiter == nil {
		return 0, 0
	}
	return c.limiter.Stats()
}
