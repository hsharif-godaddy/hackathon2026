package sandbox

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"
)

// statusPipeIndex is the ExtraFiles slot AttachStatusPipe uses for the
// airo-sandbox status pipe write end. ReleaseStatusWrite only closes this
// slot so unrelated ExtraFiles added by future code aren't silently closed.
const statusPipeIndex = 0

// WrapCommand returns an exec.Cmd that runs the command inside the airo-sandbox
// binary with the given sandbox spec. The command's environment is built from
// baseEnv with AIRO_SANDBOX_CONFIG injected.
//
// If enabled is false, returns (nil, nil) - caller should fall through to
// direct execution.
func WrapCommand(ctx context.Context, enabled bool, spec Spec, baseEnv []string) (*exec.Cmd, error) {
	if !enabled {
		return nil, nil //nolint:nilnil // nil cmd signals "sandbox disabled, use direct exec"
	}

	env, err := BuildEnv(baseEnv, spec)
	if err != nil {
		return nil, err
	}

	// binaryPath is a package-controlled var (normally /usr/local/bin/airo-sandbox,
	// overridable only via BinaryPathForTesting). No user input reaches exec.Command here.
	// nosemgrep: go.lang.security.audit.dangerous-exec-command.dangerous-exec-command
	cmd := exec.CommandContext(ctx, binaryPath)
	cmd.Dir = spec.WorkDir
	cmd.Env = env

	return cmd, nil
}

// BuildEnv returns a copy of the base environment with AIRO_SANDBOX_CONFIG set.
// Any existing AIRO_SANDBOX_CONFIG is removed first.
//
// Returns an error if the spec cannot be serialized - callers must not fall
// through to unsandboxed execution on error.
func BuildEnv(baseEnv []string, spec Spec) ([]string, error) {
	// Always filter first so we never return stale config on error paths.
	filtered := FilterEnv(baseEnv, "AIRO_SANDBOX_CONFIG")

	configJSON, err := json.Marshal(spec)
	if err != nil {
		return nil, fmt.Errorf("sandbox: failed to marshal config: %w", err)
	}

	return append(filtered, "AIRO_SANDBOX_CONFIG="+string(configJSON)), nil
}

// StatusFd is the file descriptor airo-sandbox uses to report wrapper-level
// failures back to dev-supervisor. The parent passes the write end of a pipe
// as cmd.ExtraFiles[0], which becomes fd 3 in the child. airo-sandbox sets
// FD_CLOEXEC on it at startup, so a successful syscall.Exec auto-closes the
// fd and the sandboxed child never inherits it.
const StatusFd uintptr = 3

// AttachStatusPipe wires a pipe to cmd.ExtraFiles[0] (child fd 3) for reporting
// wrapper-level failures. Returns the parent's read end. Caller workflow:
//
//  1. cmd.Start() — forks the child; both parent and child hold the write end
//  2. ReleaseStatusWrite(cmd) — closes parent's copy so EOF propagates naturally
//  3. ReadFatal(readEnd) — drains the pipe (blocks until child closes or writes+exits)
//  4. readEnd.Close() — release parent's read end
//
// If the child writes nothing, the read returns "" (success path: syscall.Exec +
// FD_CLOEXEC closes the pipe before the real command starts).
func AttachStatusPipe(cmd *exec.Cmd) (*os.File, error) {
	r, w, err := os.Pipe()
	if err != nil {
		return nil, fmt.Errorf("sandbox: create status pipe: %w", err)
	}
	// Grow ExtraFiles up to statusPipeIndex so future callers can keep their own
	// slots without colliding with the status pipe.
	for len(cmd.ExtraFiles) <= statusPipeIndex {
		cmd.ExtraFiles = append(cmd.ExtraFiles, nil)
	}
	cmd.ExtraFiles[statusPipeIndex] = w
	return r, nil
}

// ReleaseStatusWrite closes the parent's copy of the status-pipe write end.
// Must be called immediately after cmd.Start() so that only the child retains
// the write end — otherwise reads on the parent's read end won't see EOF.
// Only the status-pipe slot is touched; other ExtraFiles are left alone.
func ReleaseStatusWrite(cmd *exec.Cmd) {
	if len(cmd.ExtraFiles) <= statusPipeIndex {
		return
	}
	if f := cmd.ExtraFiles[statusPipeIndex]; f != nil {
		_ = f.Close()
		cmd.ExtraFiles[statusPipeIndex] = nil
	}
}

// ReadFatal drains the status pipe and returns any wrapper-failure message
// airo-sandbox wrote. Returns "" on a clean exec (pipe closed by CLOEXEC before
// any data was written).
func ReadFatal(readEnd *os.File) string {
	data, _ := io.ReadAll(readEnd)
	return strings.TrimSpace(string(data))
}

// FilterEnv returns a copy of environ with the named variable removed.
func FilterEnv(environ []string, name string) []string {
	prefix := name + "="
	filtered := make([]string, 0, len(environ))
	for _, entry := range environ {
		if !strings.HasPrefix(entry, prefix) {
			filtered = append(filtered, entry)
		}
	}
	return filtered
}
