package supervisor

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
)

// Sentinel errors returned by the post helper based on HTTP status codes.
var (
	ErrNotFound         = errors.New("not found")
	ErrPermissionDenied = errors.New("permission denied")
	ErrValidation       = errors.New("validation failed")
	ErrTooLarge         = errors.New("request too large")
)

// ExecRequest is the request body for POST /exec.
type ExecRequest struct {
	Command    string `json:"command"`
	Timeout    int    `json:"timeout,omitempty"`
	WorkingDir string `json:"working_dir,omitempty"`
}

// ExecResult is the response body from POST /exec.
type ExecResult struct {
	Command    string `json:"command"`
	ExitCode   int    `json:"exit_code"`
	Stdout     string `json:"stdout"`
	Stderr     string `json:"stderr"`
	DurationMs int64  `json:"duration_ms"`
	TimedOut   bool   `json:"timed_out"`
	Error      string `json:"error,omitempty"`
}

// Client communicates with the dev-supervisor HTTP API.
type Client struct {
	http *http.Client
}

// NewClient creates a client that connects to dev-supervisor via a Unix socket.
func NewClient(socketPath string) *Client {
	return &Client{
		http: &http.Client{
			Transport: &http.Transport{
				DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
					var d net.Dialer
					return d.DialContext(ctx, "unix", socketPath)
				},
			},
		},
	}
}

// NewHTTPClient creates a client that connects to dev-supervisor via HTTP/TCP.
// This is used for Mac development where Unix domain sockets have issues with Docker.
func NewHTTPClient(baseURL string) *Client {
	return &Client{
		http: &http.Client{
			Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
				req.URL.Scheme = "http"
				req.URL.Host = baseURL
				return http.DefaultTransport.RoundTrip(req)
			}),
		},
	}
}

// NewTestClient creates a client that routes requests to an httptest.Server.
// This is for use in tests across packages.
func NewTestClient(srv *httptest.Server) *Client {
	return &Client{
		http: &http.Client{
			Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
				req.URL.Scheme = "http"
				req.URL.Host = srv.Listener.Addr().String()
				return http.DefaultTransport.RoundTrip(req)
			}),
		},
	}
}

// roundTripFunc is an adapter that allows using a plain function as an http.RoundTripper.
// It is used internally to redirect requests to test servers or TCP-based supervisors.
type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return f(req)
}

// apiError is the JSON error body returned by the supervisor on non-200 responses.
type apiError struct {
	Error   string `json:"error"`
	Message string `json:"message"`
}

// post sends a JSON POST request to the supervisor and decodes the JSON response.
// Pass nil for resp when the endpoint returns only {"status":"ok"}.
func (c *Client) post(ctx context.Context, path string, req, resp any) error {
	body, err := json.Marshal(req)
	if err != nil {
		return fmt.Errorf("marshaling request: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(
		ctx, http.MethodPost, "http://supervisor"+path, bytes.NewReader(body),
	)
	if err != nil {
		return fmt.Errorf("creating request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")

	httpResp, err := c.http.Do(httpReq)
	if err != nil {
		return fmt.Errorf("executing request: %w", err)
	}
	defer httpResp.Body.Close()

	respBody, err := io.ReadAll(httpResp.Body)
	if err != nil {
		return fmt.Errorf("reading response: %w", err)
	}

	if httpResp.StatusCode != http.StatusOK {
		return classifyError(httpResp.StatusCode, respBody)
	}

	if resp != nil {
		if err := json.Unmarshal(respBody, resp); err != nil {
			return fmt.Errorf("decoding response: %w", err)
		}
	}

	return nil
}

// classifyError maps HTTP status codes to typed sentinel errors.
func classifyError(status int, body []byte) error {
	var ae apiError
	_ = json.Unmarshal(body, &ae) // best-effort parse

	msg := ae.Message
	if msg == "" {
		msg = string(body)
	}

	switch status {
	case http.StatusNotFound:
		return fmt.Errorf("%w: %s", ErrNotFound, msg)
	case http.StatusForbidden:
		return fmt.Errorf("%w: %s", ErrPermissionDenied, msg)
	case http.StatusBadRequest:
		return fmt.Errorf("%w: %s", ErrValidation, msg)
	case http.StatusRequestEntityTooLarge:
		return fmt.Errorf("%w: %s", ErrTooLarge, msg)
	default:
		return fmt.Errorf("supervisor returned status %d: %s", status, msg)
	}
}

// Exec runs a command via POST /exec and returns the result.
func (c *Client) Exec(ctx context.Context, req ExecRequest) (*ExecResult, error) {
	var result ExecResult
	if err := c.post(ctx, "/exec", req, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

// Health checks the dev-supervisor health endpoint.
func (c *Client) Health(ctx context.Context) error {
	httpReq, err := http.NewRequestWithContext(
		ctx, http.MethodGet, "http://supervisor/health", nil,
	)
	if err != nil {
		return fmt.Errorf("creating request: %w", err)
	}

	resp, err := c.http.Do(httpReq)
	if err != nil {
		return fmt.Errorf("health check failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("health check returned status %d", resp.StatusCode)
	}

	return nil
}
