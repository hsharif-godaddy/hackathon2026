// Strangler-fig acceptance harness.
//
// Boots the dev-supervisor under test in one of several modes, all sharing the
// same black-box HTTP test suite. The same tests must pass in every mode —
// that is the safety net for the Go-to-Rust migration.
//
// Mode is selected via the DEV_SUPERVISOR_TEST_HARNESS env var:
//   - inproc   (default) — Go server in this test process, fastest
//   - subproc            — exec the built dev-supervisor binary as a child
//   - strangler          — RESERVED, future PR: Rust listener forwarding to Go subproc
//
// subproc mode requires the binary to exist; build with `make build-supervisor`
// or set DEV_SUPERVISOR_BIN to an absolute path.

package main

import (
	"bytes"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"
)

const (
	testHarnessEnv     = "DEV_SUPERVISOR_TEST_HARNESS"
	harnessModeInproc  = "inproc"
	harnessModeSubproc = "subproc"
)

// serverHandle owns the lifecycle of a dev-supervisor instance under test.
// Each implementation routes through the same code path the production binary
// uses (in-process or as a subprocess) so the same suite validates both.
type serverHandle interface {
	Stop()
}

// bootServer starts the dev-supervisor in the configured harness mode and
// registers cleanup with t. The returned handle's socket is ready when this
// returns.
func bootServer(t *testing.T, socketPath string) serverHandle {
	t.Helper()
	mode := selectHarnessMode(t)
	var (
		h   serverHandle
		err error
	)
	switch mode {
	case harnessModeInproc:
		h, err = startInproc(t, socketPath)
	case harnessModeSubproc:
		h, err = startSubproc(t, socketPath)
	default:
		t.Fatalf("bootServer: mode %q has no startInproc/startSubproc impl", mode)
	}
	if err != nil {
		t.Fatalf("start server (mode=%s): %v", mode, err)
	}
	t.Cleanup(h.Stop)
	return h
}

func selectHarnessMode(t *testing.T) string {
	t.Helper()
	switch m := os.Getenv(testHarnessEnv); m {
	case "", harnessModeInproc:
		return harnessModeInproc
	case harnessModeSubproc:
		return harnessModeSubproc
	default:
		t.Fatalf("unknown %s=%q (want inproc|subproc)", testHarnessEnv, m)
		return ""
	}
}

// --- inproc mode ------------------------------------------------------------

// inprocHandle drives the production Server.StartWithConfig boot path so the
// in-process test path matches the binary's wiring (PID1 callback, peer-sec
// middleware, proxy startup gates).
type inprocHandle struct {
	t          *testing.T
	server     *Server
	serverDone chan error
}

func startInproc(t *testing.T, socketPath string) (*inprocHandle, error) {
	t.Helper()
	server := NewServer()
	cfg := &Config{
		SocketPath:      socketPath,
		ShutdownTimeout: 5 * time.Second,
		ProcessLogging:  true,
	}
	h := &inprocHandle{t: t, server: server, serverDone: make(chan error, 1)}
	go func() { h.serverDone <- server.StartWithConfig(cfg) }()
	if err := server.waitForServerReady(socketPath, false); err != nil {
		server.Shutdown()
		bootErr := <-h.serverDone
		return nil, fmt.Errorf("server failed to become ready: %w (StartWithConfig returned: %w)", err, bootErr)
	}
	return h, nil
}

func (h *inprocHandle) Stop() {
	h.server.procMgr.StopAllProcesses()
	h.server.Shutdown()
	if err := <-h.serverDone; err != nil {
		h.t.Errorf("dev-supervisor inproc StartWithConfig returned error: %v", err)
	}
}

// --- subproc mode -----------------------------------------------------------

// subprocHandle exec's the built dev-supervisor binary so tests exercise the
// real boot path, not just the in-process Server type.
type subprocHandle struct {
	t      *testing.T
	cmd    *exec.Cmd
	stderr *bytes.Buffer
	exited chan struct{}
}

func startSubproc(t *testing.T, socketPath string) (*subprocHandle, error) {
	t.Helper()
	binPath := devSupervisorBinaryPath(t)
	stderr := &bytes.Buffer{}
	cmd := exec.Command(binPath, "--socket", socketPath)
	cmd.Env = childEnv()
	cmd.Stderr = stderr
	// Own process group so SIGTERM in Stop only hits the child.
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}

	h := &subprocHandle{t: t, cmd: cmd, stderr: stderr, exited: make(chan struct{})}
	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("start dev-supervisor binary: %w", err)
	}
	go func() {
		_ = cmd.Wait()
		close(h.exited)
	}()
	if err := waitForSocket(socketPath); err != nil {
		h.Stop()
		return nil, fmt.Errorf("subproc not ready: %w (stderr: %s)", err, stderr.String())
	}
	return h, nil
}

func (h *subprocHandle) Stop() {
	if h.cmd.Process != nil {
		_ = h.cmd.Process.Signal(syscall.SIGTERM)
		select {
		case <-h.exited:
		case <-time.After(10 * time.Second):
			_ = h.cmd.Process.Kill()
			<-h.exited
		}
	}
	state := h.cmd.ProcessState
	if state == nil {
		return
	}
	// Expected outcomes: clean exit (Success), or signaled by the SIGTERM we
	// sent. Anything else — non-zero exit, SIGKILL after our 10s deadline, an
	// exit that happened before Stop ran — is a regression the harness must
	// surface, regardless of whether stderr captured anything.
	if state.Success() {
		return
	}
	if ws, ok := state.Sys().(syscall.WaitStatus); ok && ws.Signaled() && ws.Signal() == syscall.SIGTERM {
		return
	}
	h.t.Errorf("dev-supervisor subproc terminated unexpectedly: %s; stderr:\n%s", state, h.stderr.String())
}

// childEnv returns the inherited environment minus the harness-mode var, so a
// subproc child can't accidentally route on it.
func childEnv() []string {
	parent := os.Environ()
	out := make([]string, 0, len(parent))
	prefix := testHarnessEnv + "="
	for _, kv := range parent {
		if strings.HasPrefix(kv, prefix) {
			continue
		}
		out = append(out, kv)
	}
	return out
}

// waitForSocket polls the unix socket until net.Dial succeeds or the deadline
// expires. Mirrors Server.waitForServerReady for a process we don't have a
// Server pointer to.
func waitForSocket(socketPath string) error {
	deadline := time.Now().Add(15 * time.Second)
	for time.Now().Before(deadline) {
		conn, err := net.Dial("unix", socketPath)
		if err == nil {
			_ = conn.Close()
			return nil
		}
		time.Sleep(50 * time.Millisecond)
	}
	return fmt.Errorf("socket %s did not become ready within timeout", socketPath)
}

// devSupervisorBinaryPath resolves the dev-supervisor binary used in subproc
// mode. Falls back to dist/dev-supervisor relative to the dev-supervisor
// directory; override with DEV_SUPERVISOR_BIN.
func devSupervisorBinaryPath(t *testing.T) string {
	t.Helper()
	if v := os.Getenv("DEV_SUPERVISOR_BIN"); v != "" {
		if _, err := os.Stat(v); err != nil {
			t.Fatalf("DEV_SUPERVISOR_BIN=%s not usable: %v", v, err)
		}
		return v
	}
	// Test binaries run with cwd = package dir (cmd/dev-supervisor); the build
	// output lives at ../../dist/dev-supervisor.
	candidate, err := filepath.Abs(filepath.Join("..", "..", "dist", "dev-supervisor"))
	if err != nil {
		t.Fatalf("resolve binary path: %v", err)
	}
	if _, err := os.Stat(candidate); err != nil {
		t.Fatalf(
			"dev-supervisor binary not found at %s; run `make build-supervisor` or set DEV_SUPERVISOR_BIN",
			candidate,
		)
	}
	return candidate
}
