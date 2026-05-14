//go:build !windows

//nolint:testpackage // Test reads unexported fields to capture the leader pgid.
package processmanager

import (
	"fmt"
	"os"
	"path/filepath"
	"syscall"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/airo-ai-builder/dev-supervisor/internal/logs"
	"github.com/airo-ai-builder/dev-supervisor/internal/process"
	"github.com/airo-ai-builder/dev-supervisor/internal/validation"
)

// TestProcessManager_StopDrainsGroupSurvivors covers the failure mode flagged
// in PR #3622: the shell/group leader exits cleanly on the initial SIGTERM
// while a backgrounded child traps that signal and survives. Pre-fix,
// cmd.Wait() returned for the leader and Stop reported success, leaving the
// survivor reparented to PID 1 and still holding any ports/fds it had open.
//
// The repro:
//   - background `sh` child traps SIGTERM, writes its own pid to a file,
//     then loops so even when its `sleep` child receives SIGTERM and dies
//     the survivor itself stays alive. A nested `sh -c` is used (rather than
//     a `( ... )` subshell) so that `$$` resolves to the survivor's own pid;
//     in dash and friends, `$$` inside `( ... )` returns the parent shell's
//     pid, not the subshell's.
//   - leader `exec sleep 0.5` replaces the parent shell with a short sleep
//     so the leader exits on its own well before Stop's timeout, hitting
//     the success branch of Stop's select where the leak used to surface.
//
// After Stop returns the survivor's pid must be gone.
func TestProcessManager_StopDrainsGroupSurvivors(t *testing.T) {
	pidFile := filepath.Join(t.TempDir(), "survivor.pid")

	pm := NewProcessManager(logs.NewManager(100), process.NewPID1Manager())

	cmd := fmt.Sprintf(
		`sh -c 'trap "" TERM; echo $$ > %s; while :; do sleep 30; done' & exec sleep 0.5`,
		pidFile,
	)
	require.NoError(t, pm.Start(validation.ProcessStartRequest{Command: cmd}))

	survivorPid := waitForPidFile(t, pidFile, 2*time.Second)
	require.NoError(t, syscall.Kill(survivorPid, 0),
		"survivor pid %d not alive before Stop", survivorPid)

	// Timeout is generously longer than sleep 0.5 so the leader exits on its
	// own and we hit the success branch of Stop's select.
	err := pm.Stop(ProcessStopRequest{Signal: "SIGTERM", Timeout: 5})
	if err != nil && err.Error() != "signal: terminated" {
		t.Fatalf("Stop returned unexpected error: %v", err)
	}

	require.Eventually(t, func() bool {
		return syscall.Kill(survivorPid, 0) == syscall.ESRCH
	}, time.Second, 20*time.Millisecond,
		"survivor pid %d still alive after Stop returned — group drain regressed",
		survivorPid)
}

func waitForPidFile(t *testing.T, path string, timeout time.Duration) int {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		data, err := os.ReadFile(path)
		if err == nil && len(data) > 0 {
			var pid int
			if _, scanErr := fmt.Sscanf(string(data), "%d", &pid); scanErr == nil && pid > 0 {
				return pid
			}
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("survivor never wrote pid to %s within %s", path, timeout)
	return 0
}
