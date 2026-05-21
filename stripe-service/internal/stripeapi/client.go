package stripeapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const (
	defaultBaseURL = "https://api.stripe.com"
	defaultTimeout = 30 * time.Second
	// defaultStripeVersion pins the preview API version. Override via
	// Config.StripeVersion or the STRIPE_API_VERSION env var.
	defaultStripeVersion = "2026-04-22.preview"
	errorBodyLimit       = 512
)

// Config is what main.go passes to New. APIKey is required; the rest
// have sensible defaults.
type Config struct {
	// APIKey is the platform sk_live_* / sk_test_*. Required.
	APIKey string

	// BaseURL defaults to https://api.stripe.com when empty. Tests point
	// this at an httptest.Server URL.
	BaseURL string

	// StripeVersion sets the Stripe-Version header. Defaults to
	// defaultStripeVersion when empty.
	StripeVersion string

	// Timeout is the per-request HTTP timeout. Defaults to 30s when zero.
	Timeout time.Duration

	// Transport overrides the HTTP transport. Primarily for tests; leave
	// nil in production to use http.DefaultTransport.
	Transport http.RoundTripper
}

// Client wraps *http.Client and targets Stripe's v2 preview endpoints.
// All methods auth with Config.APIKey (a static Bearer token) and pin
// the Stripe-Version header per Config.StripeVersion.
type Client struct {
	http          *http.Client
	baseURL       string
	apiKey        string
	stripeVersion string
}

// New validates cfg and returns a Client ready for use.
func New(cfg Config) (*Client, error) {
	if cfg.APIKey == "" {
		return nil, errors.New("stripeapi: APIKey is required")
	}

	base := cfg.BaseURL
	if base == "" {
		base = defaultBaseURL
	}
	base = strings.TrimRight(base, "/")
	// Mirror the BaseURL validation we tightened on mhpairo: url.Parse is
	// too permissive (accepts "localhost:80/foo" without error). Require
	// an absolute URL with an http/https scheme and a non-empty host.
	u, err := url.ParseRequestURI(base)
	if err != nil {
		return nil, fmt.Errorf("stripeapi: BaseURL %q is not a valid URL: %w", base, err)
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return nil, fmt.Errorf("stripeapi: BaseURL %q must use http or https scheme", base)
	}
	if u.Host == "" {
		return nil, fmt.Errorf("stripeapi: BaseURL %q must include a host", base)
	}

	stripeVersion := cfg.StripeVersion
	if stripeVersion == "" {
		stripeVersion = defaultStripeVersion
	}

	timeout := cfg.Timeout
	if timeout < 0 {
		return nil, fmt.Errorf("stripeapi: Timeout must be non-negative, got %v", timeout)
	}
	if timeout == 0 {
		timeout = defaultTimeout
	}

	return &Client{
		http: &http.Client{
			Timeout:   timeout,
			Transport: cfg.Transport, // nil is fine; net/http falls back to DefaultTransport
		},
		baseURL:       base,
		apiKey:        cfg.APIKey,
		stripeVersion: stripeVersion,
	}, nil
}

// requestHeaders carries the per-call headers do() must set. Optional
// fields are zero-valued and skipped.
type requestHeaders struct {
	idempotencyKey string // required for v2 mutating endpoints
	stripeContext  string // optional; only apiKeys.create uses it
}

// do marshals body, builds the request, attaches auth + Stripe-Version
// + Idempotency-Key + (optional) Stripe-Context, issues the call, and
// returns the raw response bytes on 2xx or a *StripeError otherwise.
func (c *Client) do(
	ctx context.Context,
	method, path string,
	headers requestHeaders,
	body any,
) ([]byte, error) {
	encoded, err := json.Marshal(body)
	if err != nil {
		return nil, fmt.Errorf("stripeapi %s %s: marshal body: %w", method, path, err)
	}

	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, bytes.NewReader(encoded))
	if err != nil {
		return nil, fmt.Errorf("stripeapi %s %s: build request: %w", method, path, err)
	}
	req.Header.Set("Authorization", "Bearer "+c.apiKey)
	req.Header.Set("Stripe-Version", c.stripeVersion)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	if headers.idempotencyKey != "" {
		req.Header.Set("Idempotency-Key", headers.idempotencyKey)
	}
	if headers.stripeContext != "" {
		req.Header.Set("Stripe-Context", headers.stripeContext)
	}

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("stripeapi %s %s: http do: %w", method, path, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		// Read the entire body — callers need to JSON-decode it. The
		// errorBodyLimit bound is intentionally not applied here; success
		// responses are not adversarial input.
		respBody, readErr := io.ReadAll(resp.Body)
		if readErr != nil {
			return nil, fmt.Errorf("stripeapi %s %s: read response body: %w", method, path, readErr)
		}
		return respBody, nil
	}

	stripeErr := parseStripeError(resp.StatusCode, resp.Body)
	// Drain the rest of the body so net/http can return the connection
	// to the pool. parseStripeError reads only errorBodyLimit+1 bytes;
	// without this drain, HTTP/1.1 keep-alive breaks on every 4xx/5xx —
	// the moments retry traffic spikes and connection reuse matters most.
	// Bound to 1 MiB so a misbehaving server (or a malicious one) can't
	// pin us here.
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 1<<20))
	return nil, stripeErr
}

// parseStripeError reads up to errorBodyLimit+1 bytes of the response
// body and tries to decode Stripe's standard error envelope. Falls back
// to a generic StripeError with the raw prefix when the body is empty
// or non-JSON (e.g. a CDN HTML error page).
func parseStripeError(status int, body io.Reader) error {
	rb, readErr := io.ReadAll(io.LimitReader(body, errorBodyLimit+1))
	preview := string(rb)
	if len(preview) > errorBodyLimit {
		preview = preview[:errorBodyLimit] + "..."
	}
	// A read error on the body is unusual but worth surfacing — without
	// it, callers see "stripe 503: " with no diagnostic. Prepend to
	// preview so log-grepping picks it up; the status code is the
	// load-bearing signal for retry classification, so we don't drop it.
	if readErr != nil {
		preview = fmt.Sprintf("(read error: %v) %s", readErr, preview)
	}

	var envelope struct {
		Error struct {
			Type    string `json:"type"`
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	if jsonErr := json.Unmarshal(rb, &envelope); jsonErr == nil && envelope.Error.Type != "" {
		return &StripeError{
			HTTPStatus: status,
			Type:       envelope.Error.Type,
			Code:       envelope.Error.Code,
			Message:    envelope.Error.Message,
			Raw:        preview,
		}
	}
	return &StripeError{
		HTTPStatus: status,
		Raw:        preview,
	}
}
