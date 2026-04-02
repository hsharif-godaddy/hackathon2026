package toolbridge

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sync/atomic"
	"syscall"
	"time"
)

// BridgeProcess manages the lifecycle of the TypeScript bridge subprocess.
type BridgeProcess struct {
	socketPath string
	cmd        *exec.Cmd
	client     *http.Client
	logger     *slog.Logger
	stopped    atomic.Bool
}

// BridgeProcessConfig holds configuration for starting the bridge.
type BridgeProcessConfig struct {
	// BridgeDir is the directory containing the ts-bridge package.
	// The process is started by running "npx tsx src/server.ts" from this directory.
	BridgeDir string

	// SocketPath is the Unix socket path for the bridge to listen on.
	// If empty, defaults to a temp file in os.TempDir().
	SocketPath string

	// Env is additional environment variables to pass to the bridge process.
	// TS_BRIDGE_SOCKET_PATH is always set automatically.
	Env []string

	// StartTimeout is how long to wait for the bridge to become healthy.
	// Defaults to 30 seconds.
	StartTimeout time.Duration

	// Logger for lifecycle events. If nil, uses slog.Default().
	Logger *slog.Logger
}

// Start spawns the TS bridge process and waits for it to become healthy.
// Returns an error if the process fails to start or doesn't become healthy
// within the configured timeout.
func Start(ctx context.Context, cfg BridgeProcessConfig) (*BridgeProcess, error) {
	logger := cfg.Logger
	if logger == nil {
		logger = slog.Default()
	}

	socketPath := cfg.SocketPath
	if socketPath == "" {
		socketPath = filepath.Join(os.TempDir(), fmt.Sprintf("ts-bridge-%d.sock", os.Getpid()))
	}

	startTimeout := cfg.StartTimeout
	if startTimeout == 0 {
		startTimeout = 30 * time.Second
	}

	// Use exec.Command (not CommandContext) so the bridge lifecycle is
	// managed entirely by Stop(). Resolve tsx from node_modules/.bin to
	// avoid npx's per-invocation package resolution overhead.
	tsxBin := filepath.Join(cfg.BridgeDir, "node_modules", ".bin", "tsx")
	cmd := exec.Command(tsxBin, "src/server.ts") //nolint:noctx // lifecycle managed by Stop()
	cmd.Dir = cfg.BridgeDir

	// Build the subprocess environment: inherit current env, add user extras,
	// then always set TS_BRIDGE_SOCKET_PATH.
	env := os.Environ()
	env = append(env, cfg.Env...)
	env = append(env, "TS_BRIDGE_SOCKET_PATH="+socketPath)
	cmd.Env = env

	// Pipe stdout and stderr through the logger.
	stdoutPipe, err := cmd.StdoutPipe()
	if err != nil {
		return nil, fmt.Errorf("creating stdout pipe: %w", err)
	}
	stderrPipe, err := cmd.StderrPipe()
	if err != nil {
		return nil, fmt.Errorf("creating stderr pipe: %w", err)
	}

	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("starting ts-bridge process: %w", err)
	}

	bp := &BridgeProcess{
		socketPath: socketPath,
		cmd:        cmd,
		client:     newHTTPClient(socketPath),
		logger:     logger,
	}

	// Stream stdout/stderr to logger in background goroutines.
	go bp.pipeToLogger(stdoutPipe, "stdout")
	go bp.pipeToLogger(stderrPipe, "stderr")

	logger.InfoContext(ctx, "toolbridge.process.starting", "socketPath", socketPath, "pid", cmd.Process.Pid)

	// Poll /health until healthy or timeout.
	healthCtx, cancel := context.WithTimeout(ctx, startTimeout)
	defer cancel()

	if err := bp.waitHealthy(healthCtx); err != nil {
		// Best-effort cleanup: kill the process since it never became healthy.
		_ = cmd.Process.Kill()
		_ = cmd.Wait()
		return nil, fmt.Errorf("ts-bridge did not become healthy: %w", err)
	}

	logger.InfoContext(ctx, "toolbridge.process.ready", "socketPath", socketPath, "pid", cmd.Process.Pid)
	return bp, nil
}

// Stop sends SIGTERM to the bridge process and waits for it to exit.
// If it doesn't exit within 5 seconds, sends SIGKILL.
func (p *BridgeProcess) Stop() error {
	if p.stopped.Swap(true) {
		// Already stopped; no-op.
		return nil
	}

	p.logger.Info("toolbridge.process.stopping", "pid", p.cmd.Process.Pid)

	if err := p.cmd.Process.Signal(syscall.SIGTERM); err != nil {
		// If signal fails (e.g. process already exited), attempt kill anyway.
		p.logger.Warn("toolbridge.process.sigterm.failed", "err", err)
	}

	// Wait up to 5 seconds for graceful shutdown.
	done := make(chan error, 1)
	go func() { done <- p.cmd.Wait() }()

	select {
	case err := <-done:
		p.logger.Info("toolbridge.process.stopped")
		if err != nil {
			// Non-zero exit after SIGTERM is expected; don't surface it as an error.
			p.logger.Debug("toolbridge.process.exit", "err", err)
		}
		return nil
	case <-time.After(5 * time.Second):
		p.logger.Warn("toolbridge.process.kill", "reason", "graceful shutdown timeout")
		if err := p.cmd.Process.Kill(); err != nil {
			return fmt.Errorf("killing ts-bridge process: %w", err)
		}
		<-done
		return nil
	}
}

// SocketPath returns the Unix socket path the bridge is listening on.
func (p *BridgeProcess) SocketPath() string {
	return p.socketPath
}

// Healthy checks if the bridge is responding to health checks.
func (p *BridgeProcess) Healthy(ctx context.Context) bool {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "http://ts-bridge/health", nil)
	if err != nil {
		return false
	}
	resp, err := p.client.Do(req)
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	return resp.StatusCode == http.StatusOK
}

// waitHealthy polls /health with exponential backoff until healthy or ctx is done.
func (p *BridgeProcess) waitHealthy(ctx context.Context) error {
	backoff := 50 * time.Millisecond
	const maxBackoff = 2 * time.Second

	for {
		if p.Healthy(ctx) {
			return nil
		}

		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(backoff):
			backoff *= 2
			if backoff > maxBackoff {
				backoff = maxBackoff
			}
		}
	}
}

// pipeToLogger reads lines from r and writes them to the logger with the given stream label.
func (p *BridgeProcess) pipeToLogger(r io.Reader, stream string) {
	const maxLineSize = 1024 * 1024 // 1 MiB — handles long stack traces / JSON blobs.
	scanner := bufio.NewScanner(r)
	scanner.Buffer(make([]byte, 0, maxLineSize), maxLineSize)
	for scanner.Scan() {
		p.logger.Debug("toolbridge.process.output", "stream", stream, "line", scanner.Text())
	}
	if err := scanner.Err(); err != nil {
		p.logger.Warn("toolbridge.process.output.error", "stream", stream, "err", err)
	}
}
