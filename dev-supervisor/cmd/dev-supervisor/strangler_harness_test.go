// Strangler-fig acceptance harness.
//
// Boots the dev-supervisor under test in one of several modes, all sharing the
// same black-box HTTP test suite. The same tests must pass in every mode —
// that is the safety net for the Go-to-Rust migration.
//
// Mode is selected via the DEV_SUPERVISOR_TEST_HARNESS env var:
//   - inproc    (default) — Go server in this test process, fastest
//   - subproc             — exec the built dev-supervisor binary as a child
//   - strangler           — exec airo-workspace, which binds the public socket
//                           and proxies to the dev-supervisor on an internal
//                           socket. Validates that the proxy is bit-perfect
//                           against the Go-only paths.
//
// subproc/strangler mode require their respective binaries to exist; build
// with `make build` or override paths via DEV_SUPERVISOR_BIN /
// AIRO_WORKSPACE_BIN.

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
	testHarnessEnv       = "DEV_SUPERVISOR_TEST_HARNESS"
	harnessModeInproc    = "inproc"
	harnessModeSubproc   = "subproc"
	harnessModeStrangler = "strangler"
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
	case harnessModeStrangler:
		h, err = startStrangler(t, socketPath)
	default:
		t.Fatalf("bootServer: mode %q has no impl", mode)
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
	case harnessModeStrangler:
		return harnessModeStrangler
	default:
		t.Fatalf("unknown %s=%q (want inproc|subproc|strangler)", testHarnessEnv, m)
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

// --- subproc/strangler shared lifecycle ------------------------------------

// childHandle owns a child binary's lifecycle. Both subproc (dev-supervisor
// only) and strangler (airo-workspace + dev-supervisor) modes use it; they
// differ only in what gets exec'd, which env they pass, and their teardown
// signal target.
//
// Expected exit outcomes that Stop accepts as clean: zero exit code, or
// terminated by the SIGTERM we sent. Anything else — non-zero exit, SIGKILL
// after the deadline, an exit that happened before Stop ran — is a regression
// the harness must surface, regardless of whether stderr captured anything.
type childHandle struct {
	t           *testing.T
	cmd         *exec.Cmd
	stderr      *bytes.Buffer
	exited      chan struct{}
	label       string
	killTimeout time.Duration
	signalGroup bool
}

func startChild(t *testing.T, h *childHandle, socketPath, startErrPrefix string) error {
	t.Helper()
	if err := h.cmd.Start(); err != nil {
		return fmt.Errorf("%s: %w", startErrPrefix, err)
	}
	go func() {
		_ = h.cmd.Wait()
		close(h.exited)
	}()
	if err := waitForSocket(socketPath); err != nil {
		h.Stop()
		return fmt.Errorf("%s not ready: %w (stderr: %s)", h.label, err, h.stderr.String())
	}
	return nil
}

func (h *childHandle) Stop() {
	if h.cmd.Process != nil {
		// signalGroup=true sends to -PID (process group) so a parent like
		// airo-workspace and its dev-supervisor child both shut down at once
		// — faster than letting the parent's 30s graceful-shutdown deadline
		// run before propagation. signalGroup=false targets just the child PID.
		target := h.cmd.Process.Pid
		if h.signalGroup {
			target = -target
		}
		_ = syscall.Kill(target, syscall.SIGTERM)
		select {
		case <-h.exited:
		case <-time.After(h.killTimeout):
			if h.signalGroup {
				_ = syscall.Kill(-h.cmd.Process.Pid, syscall.SIGKILL)
			} else {
				_ = h.cmd.Process.Kill()
			}
			<-h.exited
		}
	}
	state := h.cmd.ProcessState
	if state == nil {
		return
	}
	if state.Success() {
		return
	}
	if ws, ok := state.Sys().(syscall.WaitStatus); ok && ws.Signaled() && ws.Signal() == syscall.SIGTERM {
		return
	}
	h.t.Errorf("%s terminated unexpectedly: %s; stderr:\n%s", h.label, state, h.stderr.String())
}

// --- subproc mode -----------------------------------------------------------

// subproc exec's the built dev-supervisor binary so tests exercise the real
// boot path, not just the in-process Server type.
func startSubproc(t *testing.T, socketPath string) (*childHandle, error) {
	t.Helper()
	stderr := &bytes.Buffer{}
	cmd := exec.Command(devSupervisorBinaryPath(t), "--socket", socketPath)
	cmd.Env = childEnv()
	cmd.Stderr = stderr
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}

	h := &childHandle{
		t:           t,
		cmd:         cmd,
		stderr:      stderr,
		exited:      make(chan struct{}),
		label:       "dev-supervisor subproc",
		killTimeout: 10 * time.Second,
	}
	if err := startChild(t, h, socketPath, "start dev-supervisor binary"); err != nil {
		return nil, err
	}
	return h, nil
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
	return resolveBinary(t, "DEV_SUPERVISOR_BIN", "dev-supervisor", "make build-supervisor")
}

// airoWorkspaceBinaryPath resolves the airo-workspace binary used in strangler
// mode. Falls back to dist/airo-workspace; override with AIRO_WORKSPACE_BIN.
func airoWorkspaceBinaryPath(t *testing.T) string {
	t.Helper()
	return resolveBinary(t, "AIRO_WORKSPACE_BIN", "airo-workspace", "make build-airo-workspace")
}

func resolveBinary(t *testing.T, envVar, binName, buildHint string) string {
	t.Helper()
	if v := os.Getenv(envVar); v != "" {
		if _, err := os.Stat(v); err != nil {
			t.Fatalf("%s=%s not usable: %v", envVar, v, err)
		}
		return v
	}
	// Test binaries run with cwd = package dir (cmd/dev-supervisor); the build
	// output lives at ../../dist/<bin>.
	candidate, err := filepath.Abs(filepath.Join("..", "..", "dist", binName))
	if err != nil {
		t.Fatalf("resolve binary path: %v", err)
	}
	if _, err := os.Stat(candidate); err != nil {
		t.Fatalf("%s not found at %s; run `%s` or set %s",
			binName, candidate, buildHint, envVar)
	}
	return candidate
}

// --- strangler mode ---------------------------------------------------------

// strangler exec's airo-workspace with the dev-supervisor binary as its
// child. airo-workspace binds the public socket; the Go child binds an
// internal socket the proxy forwards to. Validates the cross-process boundary
// in the topology that production will run.
func startStrangler(t *testing.T, socketPath string) (*childHandle, error) {
	t.Helper()
	// The internal socket is per-test (in the same temp dir as the public one)
	// so parallel test runs don't collide on /tmp/supervisor/internal.sock.
	internalSocket := filepath.Join(filepath.Dir(socketPath), "internal.sock")

	stderr := &bytes.Buffer{}
	// airo-workspace is invoked with the dev-supervisor binary as its child;
	// no --socket flag is passed because airo-workspace overrides the child's
	// socket env to the internal path.
	cmd := exec.Command(airoWorkspaceBinaryPath(t), devSupervisorBinaryPath(t))
	cmd.Env = append(childEnv(),
		// Proxy is opt-in; without this airo-workspace just exec's
		// dev-supervisor with no path injection. The whole point of the
		// strangler harness is to exercise the proxy path, so turn it on.
		"AIRO_WORKSPACE_PROXY=1",
		"AIRO_PUBLIC_SOCKET_PATH="+socketPath,
		"AIRO_INTERNAL_SOCKET_PATH="+internalSocket,
		// The Go child reads DEV_SUPERVISOR_SOCKET_PATH; clear any inherited
		// value so airo-workspace's injected env is the only source.
		"DEV_SUPERVISOR_SOCKET_PATH=",
		"AIRO_SUPERVISOR_SOCKET_PATH=",
	)
	cmd.Stderr = stderr
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}

	h := &childHandle{
		t:           t,
		cmd:         cmd,
		stderr:      stderr,
		exited:      make(chan struct{}),
		label:       "airo-workspace strangler",
		killTimeout: 15 * time.Second,
		signalGroup: true,
	}
	if err := startChild(t, h, socketPath, "start airo-workspace"); err != nil {
		return nil, err
	}
	return h, nil
}
