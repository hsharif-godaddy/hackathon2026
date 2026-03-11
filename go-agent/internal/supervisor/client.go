package supervisor

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
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

// Exec runs a command via POST /exec and returns the result.
func (c *Client) Exec(ctx context.Context, req ExecRequest) (*ExecResult, error) {
	body, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("marshaling request: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(
		ctx, http.MethodPost, "http://supervisor/exec", bytes.NewReader(body),
	)
	if err != nil {
		return nil, fmt.Errorf("creating request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := c.http.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("executing request: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("reading response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf(
			"supervisor returned status %d: %s", resp.StatusCode, string(respBody),
		)
	}

	var result ExecResult
	if err := json.Unmarshal(respBody, &result); err != nil {
		return nil, fmt.Errorf("decoding response: %w", err)
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
