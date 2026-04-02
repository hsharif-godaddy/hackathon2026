package toolbridge

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// startHealthyUnixServer creates a mock bridge server that responds to GET /health
// with 200 {"status":"ok"} and returns a running *BridgeProcess-like struct backed
// by the server's socket path. It returns the socket path and a cleanup function.
func startHealthyUnixServer(t *testing.T) (string, func()) {
	t.Helper()
	sockPath := filepath.Join(t.TempDir(), "mock-bridge.sock")

	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = fmt.Fprint(w, `{"status":"ok"}`)
	})

	ln, err := net.Listen("unix", sockPath)
	require.NoError(t, err)

	srv := &http.Server{Handler: mux}
	go func() { _ = srv.Serve(ln) }()

	return sockPath, func() { _ = srv.Close() }
}

// TestBridgeProcess_Healthy_True verifies that Healthy returns true when the
// bridge mock server responds with 200.
func TestBridgeProcess_Healthy_True(t *testing.T) {
	sockPath, cleanup := startHealthyUnixServer(t)
	defer cleanup()

	bp := &BridgeProcess{
		socketPath: sockPath,
		client:     newHTTPClient(sockPath),
		logger:     testLogger(t),
	}

	assert.True(t, bp.Healthy(context.Background()))
}

// TestBridgeProcess_Healthy_False verifies that Healthy returns false when the
// socket does not exist.
func TestBridgeProcess_Healthy_False(t *testing.T) {
	sockPath := filepath.Join(t.TempDir(), "nonexistent.sock")

	bp := &BridgeProcess{
		socketPath: sockPath,
		client:     newHTTPClient(sockPath),
		logger:     testLogger(t),
	}

	assert.False(t, bp.Healthy(context.Background()))
}

// TestBridgeProcess_Healthy_Non200 verifies that a non-200 response is treated
// as unhealthy.
func TestBridgeProcess_Healthy_Non200(t *testing.T) {
	sockPath := filepath.Join(t.TempDir(), "bad-bridge.sock")
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
	})
	ln, err := net.Listen("unix", sockPath)
	require.NoError(t, err)
	srv := &http.Server{Handler: mux}
	go func() { _ = srv.Serve(ln) }()
	t.Cleanup(func() { _ = srv.Close() })

	bp := &BridgeProcess{
		socketPath: sockPath,
		client:     newHTTPClient(sockPath),
		logger:     testLogger(t),
	}

	assert.False(t, bp.Healthy(context.Background()))
}

// TestBridgeProcess_SocketPath verifies the accessor returns the configured path.
func TestBridgeProcess_SocketPath(t *testing.T) {
	bp := &BridgeProcess{socketPath: "/tmp/foo.sock"}
	assert.Equal(t, "/tmp/foo.sock", bp.SocketPath())
}

// TestBridgeProcess_WaitHealthy_Timeout verifies that waitHealthy returns an
// error when the context deadline elapses before the server becomes healthy.
func TestBridgeProcess_WaitHealthy_Timeout(t *testing.T) {
	// Point at a socket that will never exist.
	sockPath := filepath.Join(t.TempDir(), "never.sock")

	bp := &BridgeProcess{
		socketPath: sockPath,
		client:     newHTTPClient(sockPath),
		logger:     testLogger(t),
	}

	ctx, cancel := context.WithTimeout(context.Background(), 150*time.Millisecond)
	defer cancel()

	err := bp.waitHealthy(ctx)
	require.Error(t, err)
	assert.ErrorIs(t, err, context.DeadlineExceeded)
}

// TestBridgeProcess_WaitHealthy_Success verifies that waitHealthy returns nil
// when the server is healthy immediately.
func TestBridgeProcess_WaitHealthy_Success(t *testing.T) {
	sockPath, cleanup := startHealthyUnixServer(t)
	defer cleanup()

	bp := &BridgeProcess{
		socketPath: sockPath,
		client:     newHTTPClient(sockPath),
		logger:     testLogger(t),
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	require.NoError(t, bp.waitHealthy(ctx))
}

// TestStop_Idempotent tests that Stop can be called multiple times without error.
func TestStop_Idempotent(t *testing.T) {
	sockPath := filepath.Join(t.TempDir(), "bridge.sock")

	cmd := makeStubProcess(t)
	bp := &BridgeProcess{
		socketPath: sockPath,
		cmd:        cmd,
		client:     newHTTPClient(sockPath),
		logger:     testLogger(t),
	}

	// First Stop should send SIGTERM and wait.
	err := bp.Stop()
	require.NoError(t, err)

	// Second Stop call must be a no-op (idempotent).
	err = bp.Stop()
	require.NoError(t, err)
}

// makeStubProcess starts a long-running "sleep" process and returns the cmd.
func makeStubProcess(t *testing.T) *exec.Cmd {
	t.Helper()
	cmd := exec.Command("sleep", "60")
	require.NoError(t, cmd.Start())
	return cmd
}

// testLogger returns a slog.Logger that discards output during tests.
func testLogger(_ *testing.T) *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}
