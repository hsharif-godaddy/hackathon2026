//go:build !windows

//nolint:testpackage // Tests exercise internal APIs and types.
package process

import (
	"os/exec"
	"testing"
)

// TestPID1Manager_StartAndRegister_TracksBeforeStartReturns verifies that the
// child is present in the tracking map as soon as StartAndRegister returns.
// The PID must not be observable to the reaper as "untracked" at any point
// after the kernel has created it.
func TestPID1Manager_StartAndRegister_TracksBeforeStartReturns(t *testing.T) {
	pm := NewPID1Manager()

	// sleep 5 keeps the child alive long enough for us to assert tracking
	// and then explicitly reap.
	cmd := exec.Command("sleep", "5")

	if err := pm.StartAndRegister(cmd, nil); err != nil {
		t.Fatalf("StartAndRegister failed: %v", err)
	}
	pid := cmd.Process.Pid

	if !pm.IsChildProcessTracked(pid) {
		t.Fatalf("pid %d not tracked immediately after StartAndRegister returned", pid)
	}

	if err := cmd.Process.Kill(); err != nil {
		t.Fatalf("kill child: %v", err)
	}
	// SIGKILL produces a non-nil error; we don't assert on it.
	_ = cmd.Wait()
	pm.UnregisterChildProcess(pid)

	if pm.IsChildProcessTracked(pid) {
		t.Fatalf("pid %d still tracked after UnregisterChildProcess", pid)
	}
}

// TestPID1Manager_StartAndRegister_DoesNotRegisterOnStartFailure verifies that
// when cmd.Start() fails (e.g. executable missing), nothing is inserted into
// the tracking map.
func TestPID1Manager_StartAndRegister_DoesNotRegisterOnStartFailure(t *testing.T) {
	pm := NewPID1Manager()

	cmd := exec.Command("/definitely/does/not/exist/airo-never-real")

	if err := pm.StartAndRegister(cmd, nil); err == nil {
		t.Fatal("expected StartAndRegister to surface cmd.Start() error for missing binary")
	}

	if pm.GetChildProcessCount() != 0 {
		t.Fatalf("expected zero tracked processes after failed Start, got %d", pm.GetChildProcessCount())
	}
}

// TestPID1Manager_StartAndRegister_NilCmd guards against accidental nil
// dereference in the helper.
func TestPID1Manager_StartAndRegister_NilCmd(t *testing.T) {
	pm := NewPID1Manager()
	if err := pm.StartAndRegister(nil, nil); err == nil {
		t.Fatal("expected error for nil cmd, got nil")
	}
	if pm.GetChildProcessCount() != 0 {
		t.Fatalf("expected zero tracked processes, got %d", pm.GetChildProcessCount())
	}
}
