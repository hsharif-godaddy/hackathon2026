package mhpairo

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

// defaultTimeout is the per-request timeout applied to the shared *http.Client
// when Config.Timeout is zero.
const defaultTimeout = 30 * time.Second

// errorBodyLimit bounds how many bytes of an error response we include in a
// returned error message. Prevents pathological multi-MB HTML error pages
// from bloating logs.
const errorBodyLimit = 512

// HTTPError carries the response status and body preview for a non-2xx
// mhp-airo response. Callers that need to classify retry-worthy errors
// (5xx, 408, 429) versus terminal ones (4xx) can errors.As this and
// inspect Status.
type HTTPError struct {
	OpName  string
	Status  int
	Preview string
}

// Error implements error.
func (e *HTTPError) Error() string {
	return fmt.Sprintf("mhpairo %s: HTTP %d: %s", e.OpName, e.Status, e.Preview)
}

// Config is what main.go passes to New. BaseURL and Auth are required; the
// rest have sensible defaults.
type Config struct {
	// BaseURL is the mhp-airo API root, up to and including "/api/airo/v1".
	// Example prod: "https://mgmt.nstk.net/api/airo/v1".
	// Example local: "http://localhost:4100/api/airo/v1".
	BaseURL string

	// Auth attaches the Authorization header on each outbound request. Pass
	// NoopAuth{} for local-control-plane (AUTH_TYPE=none).
	Auth AuthProvider

	// Timeout is the per-request HTTP timeout. Defaults to 30s when zero.
	Timeout time.Duration

	// Transport overrides the HTTP transport. Primarily for tests; leave nil
	// in production to use http.DefaultTransport.
	Transport http.RoundTripper
}

// Client is a thin wrapper around *http.Client that targets mhp-airo's three
// alloc-management endpoints. All methods take the full
// (subscriptionId, systemId, appId) triple — mhp-airo has no appId-only
// endpoint and stripe-service doesn't resolve the triple server-side.
type Client struct {
	http    *http.Client
	baseURL string
	auth    AuthProvider
}

// New validates cfg and returns a Client ready for use. A zero Timeout is
// filled in with defaultTimeout. BaseURL trailing slashes are stripped so
// callers can pass either "/api/airo/v1" or "/api/airo/v1/" interchangeably.
func New(cfg Config) (*Client, error) {
	if cfg.Auth == nil {
		return nil, errors.New("mhpairo: Auth is required (use NoopAuth{} for local-control-plane)")
	}
	base := strings.TrimRight(cfg.BaseURL, "/")
	if base == "" {
		return nil, errors.New("mhpairo: BaseURL is required")
	}
	// url.Parse is too permissive — it accepts "localhost:4100/api/airo/v1"
	// and other scheme-less inputs without error, deferring failure to the
	// first outbound request. ParseRequestURI requires an absolute URL, and
	// the explicit scheme/host checks rule out the remaining edge cases
	// (file://, http://, etc.).
	u, err := url.ParseRequestURI(base)
	if err != nil {
		return nil, fmt.Errorf("mhpairo: BaseURL %q is not a valid URL: %w", base, err)
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return nil, fmt.Errorf("mhpairo: BaseURL %q must use http or https scheme", base)
	}
	if u.Host == "" {
		return nil, fmt.Errorf("mhpairo: BaseURL %q must include a host", base)
	}
	timeout := cfg.Timeout
	if timeout == 0 {
		timeout = defaultTimeout
	}
	return &Client{
		http: &http.Client{
			Timeout:   timeout,
			Transport: cfg.Transport, // nil is fine; net/http falls back to DefaultTransport
		},
		baseURL: base,
		auth:    cfg.Auth,
	}, nil
}

// SecretOp is one upsert-or-delete operation in a bulk secrets update. Matches
// the shape accepted by mhp-airo's POST .../secrets (and local-control-plane's
// stub, see local-control-plane/internal/api/secrets.go:69).
type SecretOp struct {
	// Type is "upsert" or "delete".
	Type string `json:"type"`

	Secret SecretPayload `json:"secret"`
}

// SecretPayload is the inner shape of a SecretOp. Name+Variants+SystemManaged
// are required on both upsert and delete; Value is required on upsert only
// (use json:omitempty so delete ops don't send an empty "value": "").
type SecretPayload struct {
	Name          string   `json:"name"`
	Value         string   `json:"value,omitempty"`
	Variants      []string `json:"variants"`
	SystemManaged bool     `json:"systemManaged"`
}

// AppUpdate is the body of PATCH .../apps/:appId. Both fields are optional;
// omit whichever the caller doesn't want to change.
type AppUpdate struct {
	Status    string            `json:"status,omitempty"`
	Variables map[string]string `json:"variables,omitempty"`
}

// UpdateSecrets issues POST .../apps/:appId/secrets with the given bulk
// operations. Returns nil on 2xx; otherwise a wrapped error including the
// status code and a truncated response-body prefix.
//
// WorkflowName is hard-coded to "airo-app-secrets" to match what the BFF
// sends (see app/src/lib/mgmt-airo/client.ts updateSecrets).
func (c *Client) UpdateSecrets(ctx context.Context, subID, sysID, appID string, ops []SecretOp) error {
	body := struct {
		Operations   []SecretOp `json:"operations"`
		WorkflowName string     `json:"workflowName"`
	}{
		Operations:   ops,
		WorkflowName: "airo-app-secrets",
	}
	return c.do(ctx, http.MethodPost,
		c.appSubpath(subID, sysID, appID, "secrets"),
		body, "update-secrets")
}

// UpdateApp issues PATCH .../apps/:appId with the given status/variables.
// Either field can be zero-valued and will be omitted via json:omitempty.
func (c *Client) UpdateApp(ctx context.Context, subID, sysID, appID string, update AppUpdate) error {
	return c.do(ctx, http.MethodPatch,
		c.appPath(subID, sysID, appID),
		update, "update-app")
}

// ReloadApp issues POST .../apps/:appId/reload with an empty JSON body.
// mhp-airo uses this to re-issue the alloc secrets into the running
// containers after a secrets change.
func (c *Client) ReloadApp(ctx context.Context, subID, sysID, appID string) error {
	return c.do(ctx, http.MethodPost,
		c.appSubpath(subID, sysID, appID, "reload"),
		struct{}{}, "reload-app")
}

// appPath builds the PATCH .../apps/:appId URL.
func (c *Client) appPath(subID, sysID, appID string) string {
	return fmt.Sprintf("%s/subscriptions/%s/systems/%s/apps/%s",
		c.baseURL,
		url.PathEscape(subID), url.PathEscape(sysID), url.PathEscape(appID))
}

// appSubpath builds URLs like .../apps/:appId/secrets or .../apps/:appId/reload.
func (c *Client) appSubpath(subID, sysID, appID, leaf string) string {
	return c.appPath(subID, sysID, appID) + "/" + leaf
}

// do marshals body, builds the request, calls ApplyAuth, issues the HTTP
// request, and returns nil on 2xx or a descriptive error otherwise.
// opName ("update-secrets", etc.) is used in error-message prefixes for
// easier log-grepping at the call site.
func (c *Client) do(ctx context.Context, method, rawURL string, body any, opName string) error {
	encoded, err := json.Marshal(body)
	if err != nil {
		return fmt.Errorf("mhpairo %s: marshal body: %w", opName, err)
	}

	req, err := http.NewRequestWithContext(ctx, method, rawURL, bytes.NewReader(encoded))
	if err != nil {
		return fmt.Errorf("mhpairo %s: build request: %w", opName, err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	if err := c.auth.ApplyAuth(ctx, req); err != nil {
		return fmt.Errorf("mhpairo %s: attach auth: %w", opName, err)
	}

	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("mhpairo %s: http do: %w", opName, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		// Drain so net/http's connection pool can reuse the underlying TCP
		// connection. Bounded so a misbehaving server can't pin us here.
		_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, errorBodyLimit))
		return nil
	}

	// Read a bounded prefix of the body for the error message. Ignore read
	// errors — we're already in the error path and the status code is the
	// load-bearing signal.
	rb, _ := io.ReadAll(io.LimitReader(resp.Body, errorBodyLimit+1))
	preview := string(rb)
	if len(preview) > errorBodyLimit {
		preview = preview[:errorBodyLimit] + "…"
	}
	return &HTTPError{OpName: opName, Status: resp.StatusCode, Preview: preview}
}
