package terminal

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/gdcorp-partners/airo-app-builder/go-agent/internal/supervisor"
	"github.com/gdcorp-partners/airo-app-builder/go-agent/internal/tool"
)

// newTestCommand creates a Command wired to a mock dev-supervisor server.
// It returns the Command, httptest.Server, and a context with scope set.
func newTestCommand(t *testing.T, handler http.HandlerFunc) (*Command, *httptest.Server, context.Context) {
	t.Helper()
	srv := httptest.NewServer(handler)

	factory := supervisor.NewClientFactory()
	addr := "http://" + srv.Listener.Addr().String()
	ctx := tool.TestContextWithSupervisor("/app", addr)

	return NewCommand(factory), srv, ctx
}

func execTerminal(ctx context.Context, t *testing.T, tc tool.Tool, input map[string]any) (string, error) {
	t.Helper()
	data, err := json.Marshal(input)
	require.NoError(t, err)
	var stream tool.BufferedStream
	execErr := tc.Execute(ctx, data, &stream)
	return stream.String(), execErr
}

func TestTerminalSimpleCommand(t *testing.T) {
	tc, srv, ctx := newTestCommand(t, func(w http.ResponseWriter, r *http.Request) {
		var req supervisor.ExecRequest
		assert.NoError(t, json.NewDecoder(r.Body).Decode(&req))
		assert.Equal(t, "echo hello", req.Command)

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(supervisor.ExecResult{
			Command:    req.Command,
			ExitCode:   0,
			Stdout:     "hello\n",
			DurationMs: 5,
		})
	})
	defer srv.Close()

	out, err := execTerminal(ctx, t, tc, map[string]any{"command": "echo hello"})
	require.NoError(t, err)
	assert.Contains(t, out, "hello")
}

func TestTerminalWorkingDir(t *testing.T) {
	tc, srv, ctx := newTestCommand(t, func(w http.ResponseWriter, r *http.Request) {
		var req supervisor.ExecRequest
		assert.NoError(t, json.NewDecoder(r.Body).Decode(&req))
		assert.Equal(t, "/app/sub", req.WorkingDir)

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(supervisor.ExecResult{
			ExitCode: 0,
			Stdout:   "test.txt\n",
		})
	})
	defer srv.Close()

	out, err := execTerminal(ctx, t, tc, map[string]any{
		"command":    "ls",
		"workingDir": "sub/",
	})
	require.NoError(t, err)
	assert.Contains(t, out, "test.txt")
}

func TestTerminalTimeoutConversion(t *testing.T) {
	tc, srv, ctx := newTestCommand(t, func(w http.ResponseWriter, r *http.Request) {
		var req supervisor.ExecRequest
		assert.NoError(t, json.NewDecoder(r.Body).Decode(&req))
		// 5000ms should become 5 seconds
		assert.Equal(t, 5, req.Timeout)

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(supervisor.ExecResult{ExitCode: 0})
	})
	defer srv.Close()

	_, err := execTerminal(ctx, t, tc, map[string]any{
		"command": "echo ok",
		"timeout": 5000,
	})
	require.NoError(t, err)
}

func TestTerminalTimeoutMinimum(t *testing.T) {
	tc, srv, ctx := newTestCommand(t, func(w http.ResponseWriter, r *http.Request) {
		var req supervisor.ExecRequest
		assert.NoError(t, json.NewDecoder(r.Body).Decode(&req))
		// 500ms should become 1 second minimum
		assert.Equal(t, 1, req.Timeout)

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(supervisor.ExecResult{ExitCode: 0})
	})
	defer srv.Close()

	_, err := execTerminal(ctx, t, tc, map[string]any{
		"command": "echo ok",
		"timeout": 500,
	})
	require.NoError(t, err)
}

func TestTerminalCommandTimeout(t *testing.T) {
	tc, srv, ctx := newTestCommand(t, func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(supervisor.ExecResult{
			Command:    "sleep 100",
			ExitCode:   -1,
			TimedOut:   true,
			Error:      "command timed out",
			DurationMs: 30000,
		})
	})
	defer srv.Close()

	_, err := execTerminal(ctx, t, tc, map[string]any{
		"command": "sleep 100",
		"timeout": 500,
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "timed out")
}

func TestTerminalCommandFailure(t *testing.T) {
	tc, srv, ctx := newTestCommand(t, func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(supervisor.ExecResult{
			Command:  "false",
			ExitCode: 1,
			Stderr:   "some error\n",
		})
	})
	defer srv.Close()

	data, _ := json.Marshal(map[string]any{"command": "false"})
	var stream tool.BufferedStream
	err := tc.Execute(ctx, data, &stream)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "exit code 1")
	assert.Contains(t, stream.ErrorString(), "some error")
}

func TestTerminalStderr(t *testing.T) {
	tc, srv, ctx := newTestCommand(t, func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(supervisor.ExecResult{
			ExitCode: 0,
			Stdout:   "out\n",
			Stderr:   "warn\n",
		})
	})
	defer srv.Close()

	data, _ := json.Marshal(map[string]any{"command": "echo out; echo warn >&2"})
	var stream tool.BufferedStream
	err := tc.Execute(ctx, data, &stream)
	require.NoError(t, err)
	assert.Contains(t, stream.String(), "out")
	assert.Contains(t, stream.ErrorString(), "warn")
}

func TestTerminalToolMetadata(t *testing.T) {
	tc := NewCommand(supervisor.NewClientFactory())

	assert.Equal(t, "terminalCommand", tc.Name())
	assert.NotEmpty(t, tc.Description())

	var schema map[string]any
	require.NoError(t, json.Unmarshal(tc.InputSchema(), &schema))
	props := schema["properties"].(map[string]any)
	assert.Contains(t, props, "command")
	assert.Contains(t, props, "workingDir")
	assert.Contains(t, props, "timeout")
}

func TestTerminalEmptyCommand(t *testing.T) {
	tc, srv, ctx := newTestCommand(t, func(http.ResponseWriter, *http.Request) {})
	defer srv.Close()

	_, err := execTerminal(ctx, t, tc, map[string]any{"command": ""})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "command is required")
}

func TestTerminalWorkingDirTraversal(t *testing.T) {
	tc, srv, ctx := newTestCommand(t, func(http.ResponseWriter, *http.Request) {})
	defer srv.Close()

	_, err := execTerminal(ctx, t, tc, map[string]any{
		"command":    "ls",
		"workingDir": "../../../etc",
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "outside app directory")
}

func TestTerminalDefaultTimeout(t *testing.T) {
	tc, srv, ctx := newTestCommand(t, func(w http.ResponseWriter, r *http.Request) {
		var req supervisor.ExecRequest
		assert.NoError(t, json.NewDecoder(r.Body).Decode(&req))
		assert.Equal(t, 30, req.Timeout)

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(supervisor.ExecResult{ExitCode: 0})
	})
	defer srv.Close()

	_, err := execTerminal(ctx, t, tc, map[string]any{"command": "echo ok"})
	require.NoError(t, err)
}

func TestTerminalMissingScope(t *testing.T) {
	tc := NewCommand(supervisor.NewClientFactory())

	var stream tool.BufferedStream
	data, _ := json.Marshal(map[string]any{"command": "echo test"})
	err := tc.Execute(context.Background(), data, &stream)
	require.ErrorIs(t, err, tool.ErrNoScope)
}
