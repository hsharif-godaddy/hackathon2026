package supervisor

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func newTestServer(handler http.HandlerFunc) (*httptest.Server, *Client) {
	srv := httptest.NewServer(handler)
	client := NewTestClient(srv)
	return srv, client
}

func TestExecSuccess(t *testing.T) {
	t.Parallel()
	srv, client := newTestServer(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "/exec", r.URL.Path)
		assert.Equal(t, http.MethodPost, r.Method)

		var req ExecRequest
		assert.NoError(t, json.NewDecoder(r.Body).Decode(&req))
		assert.Equal(t, "echo hello", req.Command)
		assert.Equal(t, 30, req.Timeout)
		assert.Equal(t, "preview/", req.WorkingDir)

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(ExecResult{
			Command:    "echo hello",
			ExitCode:   0,
			Stdout:     "hello\n",
			Stderr:     "",
			DurationMs: 5,
		})
	})
	defer srv.Close()

	result, err := client.Exec(context.Background(), ExecRequest{
		Command:    "echo hello",
		Timeout:    30,
		WorkingDir: "preview/",
	})
	require.NoError(t, err)
	assert.Equal(t, 0, result.ExitCode)
	assert.Equal(t, "hello\n", result.Stdout)
	assert.Equal(t, int64(5), result.DurationMs)
}

func TestExecCommandFailure(t *testing.T) {
	t.Parallel()
	srv, client := newTestServer(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(ExecResult{
			Command:    "false",
			ExitCode:   1,
			Stderr:     "",
			DurationMs: 2,
		})
	})
	defer srv.Close()

	result, err := client.Exec(context.Background(), ExecRequest{Command: "false"})
	require.NoError(t, err)
	assert.Equal(t, 1, result.ExitCode)
}

func TestExecTimeout(t *testing.T) {
	t.Parallel()
	// The mock server responds immediately — this test does NOT actually wait for a timeout.
	// It just verifies we correctly parse a timeout response from dev-supervisor.
	srv, client := newTestServer(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(ExecResult{
			Command:    "sleep 100",
			ExitCode:   -1,
			TimedOut:   true,
			Error:      "command timed out",
			DurationMs: 30000,
		})
	})
	defer srv.Close()

	result, err := client.Exec(context.Background(), ExecRequest{
		Command: "sleep 100",
		Timeout: 5,
	})
	require.NoError(t, err)
	assert.True(t, result.TimedOut)
	assert.Equal(t, -1, result.ExitCode)
	assert.Equal(t, "command timed out", result.Error)
}

func TestExecHTTPError(t *testing.T) {
	t.Parallel()
	srv, client := newTestServer(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		w.Write([]byte(`{"error":"invalid command"}`))
	})
	defer srv.Close()

	_, err := client.Exec(context.Background(), ExecRequest{Command: ""})
	require.Error(t, err)
	assert.ErrorIs(t, err, ErrValidation)
}

func TestHealthSuccess(t *testing.T) {
	t.Parallel()
	srv, client := newTestServer(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/health" {
			w.WriteHeader(http.StatusOK)
			w.Write([]byte(`{"status":"ok"}`))
			return
		}
		w.WriteHeader(http.StatusNotFound)
	})
	defer srv.Close()

	err := client.Health(context.Background())
	require.NoError(t, err)
}

func TestHealthFailure(t *testing.T) {
	t.Parallel()
	srv, client := newTestServer(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
	})
	defer srv.Close()

	err := client.Health(context.Background())
	require.Error(t, err)
	assert.Contains(t, err.Error(), "status 503")
}

func TestExecContextCancellation(t *testing.T) {
	t.Parallel()
	srv, client := newTestServer(func(_ http.ResponseWriter, _ *http.Request) {
		// This handler will never complete because context is cancelled
		select {}
	})
	defer srv.Close()

	ctx, cancel := context.WithCancel(context.Background())
	cancel() // Cancel immediately

	_, err := client.Exec(ctx, ExecRequest{Command: "echo hello"})
	require.Error(t, err)
}
