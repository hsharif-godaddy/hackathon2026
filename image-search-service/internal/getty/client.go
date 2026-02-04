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
	"net/url"
	"strconv"
	"time"

	"github.com/airo-ai-builder/image-search-service/internal/config"
	"github.com/airo-ai-builder/image-search-service/internal/ratelimit"
)

// SearchResult represents a single image result from Getty API.
type SearchResult struct {
	GettyID   string
	Title     string
	Caption   string
	Width     int
	Height    int
	Thumbnail string
	Preview   string
}

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

// Search searches for images matching the query and returns up to count results.
func (c *Client) Search(ctx context.Context, query string, count int) ([]SearchResult, error) {
	if err := c.limiter.Acquire(ctx); err != nil {
		return nil, fmt.Errorf("failed to acquire rate limit: %w", err)
	}
	defer c.limiter.Release()

	searchURL := buildSearchURL(c.baseURL, query, count)

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
		return nil, fmt.Errorf("getty API returned status %d: %s", resp.StatusCode, string(body))
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response body: %w", err)
	}

	return parseSearchResponse(body)
}

// GetByID retrieves a single image by its Getty ID.
// Note: This uses the proxy's search endpoint with an ID filter since
// the proxy doesn't expose the direct image endpoint.
func (c *Client) GetByID(ctx context.Context, gettyID string) (*SearchResult, error) {
	if err := c.limiter.Acquire(ctx); err != nil {
		return nil, fmt.Errorf("failed to acquire rate limit: %w", err)
	}
	defer c.limiter.Release()

	// Use search endpoint with ID since proxy doesn't expose direct image endpoint
	imageURL := fmt.Sprintf("%s/v1/search?phrase=%s&pageSize=1", c.baseURL, url.QueryEscape(gettyID))

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
		return nil, fmt.Errorf("getty API returned status %d: %s", resp.StatusCode, string(body))
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response body: %w", err)
	}

	return parseSingleImageResponse(body)
}

// Stats returns the current rate limiter statistics.
// busy is the number of currently active requests.
// available is the number of slots available for new requests.
func (c *Client) Stats() (busy int, available int) {
	return c.limiter.Stats()
}

// buildSearchURL constructs the Getty proxy search URL with query parameters.
// Note: Uses /v1/search endpoint which is the proxy's endpoint, not direct Getty API.
func buildSearchURL(baseURL, query string, count int) string {
	u, err := url.Parse(baseURL)
	if err != nil {
		return ""
	}

	// Use the proxy's /v1/search endpoint (not Getty's /v3/search/images/creative)
	u.Path = "/v1/search"

	q := u.Query()
	q.Set("phrase", query)
	q.Set("pageSize", strconv.Itoa(count))
	u.RawQuery = q.Encode()

	return u.String()
}

// Getty API response structures

type gettySearchResponse struct {
	ResultCount int          `json:"result_count"`
	Images      []gettyImage `json:"images"`
}

type gettyImage struct {
	ID            string             `json:"id"`
	Title         string             `json:"title"`
	Caption       string             `json:"caption"`
	DisplaySizes  []gettyDisplaySize `json:"display_sizes"`
	MaxDimensions gettyDimensions    `json:"max_dimensions"`
}

type gettyDisplaySize struct {
	Name string `json:"name"`
	URI  string `json:"uri"`
}

type gettyDimensions struct {
	Width  int `json:"width"`
	Height int `json:"height"`
}

// parseSearchResponse parses a Getty API search response into SearchResults.
func parseSearchResponse(data []byte) ([]SearchResult, error) {
	var response gettySearchResponse
	if err := json.Unmarshal(data, &response); err != nil {
		return nil, fmt.Errorf("failed to unmarshal response: %w", err)
	}

	results := make([]SearchResult, 0, len(response.Images))
	for _, img := range response.Images {
		result := convertGettyImage(img)
		results = append(results, result)
	}

	return results, nil
}

// parseSingleImageResponse parses a Getty API single image response.
func parseSingleImageResponse(data []byte) (*SearchResult, error) {
	// Getty's single image endpoint returns the image directly in an "images" array
	var response struct {
		Images []gettyImage `json:"images"`
	}
	if err := json.Unmarshal(data, &response); err != nil {
		return nil, fmt.Errorf("failed to unmarshal response: %w", err)
	}

	if len(response.Images) == 0 {
		return nil, nil
	}

	result := convertGettyImage(response.Images[0])
	return &result, nil
}

// convertGettyImage converts a Getty API image to a SearchResult.
func convertGettyImage(img gettyImage) SearchResult {
	result := SearchResult{
		GettyID: img.ID,
		Title:   img.Title,
		Caption: img.Caption,
		Width:   img.MaxDimensions.Width,
		Height:  img.MaxDimensions.Height,
	}

	// Extract thumbnail and preview URLs from display sizes
	for _, ds := range img.DisplaySizes {
		switch ds.Name {
		case "thumb":
			result.Thumbnail = ds.URI
		case "preview":
			result.Preview = ds.URI
		case "comp":
			// Use comp as preview if preview not available
			if result.Preview == "" {
				result.Preview = ds.URI
			}
		}
	}

	return result
}
