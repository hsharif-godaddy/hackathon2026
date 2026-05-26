//go:build linux && (amd64 || arm64)

//nolint:testpackage // Tests exercise internal APIs and types.
package process

import (
	"errors"
	"os/exec"
	"strings"
	"syscall"
	"testing"
)

// TestPID1Manager_StartAndRegister_BeatsReaperForShortLivedChild verifies the
// race fix against the real orphan reaper goroutine: many short-lived children
// are run via StartAndRegister, and cmd.Wait() must never return ECHILD.
//
// Pre-fix (plain cmd.Start() then RegisterChildProcess()), the window between
// Start returning and the map insert lets the reaper observe the PID as
// untracked, run waitid(WEXITED) on it, and consume the exit status before
// cmd.Wait() runs. Post-fix, StartAndRegister holds pm.mu across both, so the
// reaper's RLock blocks until registration is complete.
//
// We run a large iteration count to make the race extremely likely to surface
// if reintroduced; on a passing build, every iteration completes cleanly.
func TestPID1Manager_StartAndRegister_BeatsReaperForShortLivedChild(t *testing.T) {
	const iterations = 300

	pm := NewPID1Manager()
	t.Cleanup(pm.Stop)
	pm.SetSignalForwardingForTesting(false)
	pm.SetPID1ForTesting(true)
	pm.Start(nil)

	for i := range iterations {
		cmd := exec.Command("true")

		if err := pm.StartAndRegister(cmd, nil); err != nil {
			t.Fatalf("iter %d: StartAndRegister failed: %v", i, err)
		}
		pid := cmd.Process.Pid

		err := cmd.Wait()
		pm.UnregisterChildProcess(pid)

		if err != nil {
			if errors.Is(err, syscall.ECHILD) || strings.Contains(err.Error(), "no child processes") {
				t.Fatalf("iter %d: cmd.Wait() returned ECHILD — reaper race regressed: %v", i, err)
			}
			t.Fatalf("iter %d: cmd.Wait() failed: %v", i, err)
		}
	}
}
