//go:build linux && amd64

//nolint:testpackage // Tests exercise internal APIs and types.
package process

import (
	"errors"
	"os"
	"os/exec"
	"strings"
	"syscall"
	"testing"
)

// reaperRaceTestEnv re-runs the test body in an isolated subprocess so other
// tests in this package that leak orphan-reaper goroutines (concurrency_test.go
// calls pm.Start() with no Stop) cannot consume our short-lived children's
// exit statuses and produce false ECHILDs unrelated to the fix.
const reaperRaceTestEnv = "AIRO_REAPER_RACE_TEST_CHILD"

// TestPID1Manager_StartAndRegister_BeatsReaperForShortLivedChild verifies the
// race fix against the real orphan reaper goroutine: many short-lived children
// are run via StartAndRegister, and cmd.Wait() must never return ECHILD.
//
// Pre-fix (plain cmd.Start() then RegisterChildProcess()), the window between
// Start returning and the map insert lets the reaper observe the PID as
// untracked, run waitid(WEXITED) on it, and consume the exit status before
// cmd.Wait() runs. Post-fix, StartAndRegister holds pm.mu across both, so the
// reaper's RLock blocks until registration is complete and it backs off via
// the trackedProcessBackoffDelay path.
//
// We run a large iteration count to make the race extremely likely to surface
// if reintroduced; on a passing build, every iteration completes cleanly.
//
// Runs in an isolated subprocess so leaked reapers from sibling tests (see
// concurrency_test.go, which has no Stop API) don't reap our children.
func TestPID1Manager_StartAndRegister_BeatsReaperForShortLivedChild(t *testing.T) {
	if os.Getenv(reaperRaceTestEnv) == "1" {
		runReaperRaceLoop(t)
		return
	}

	// Retry on ECHILD: leaked reapers from sibling tests in this package
	// (concurrency_test.go starts reapers that have no Stop API) can race
	// cmd.Wait() at the wrapper level too — they see the subprocess as an
	// untracked child and reap it. That is a test-isolation artifact, not the
	// production race the inner loop is testing. A real regression of the
	// production fix surfaces inside the subprocess and propagates as a test
	// failure (non-empty output, non-ECHILD exit), which we detect distinctly.
	const maxAttempts = 3
	var lastOut []byte
	var lastErr error
	for attempt := 1; attempt <= maxAttempts; attempt++ {
		cmd := exec.Command(os.Args[0],
			"-test.run=^TestPID1Manager_StartAndRegister_BeatsReaperForShortLivedChild$",
			"-test.v",
			"-test.count=1",
		)
		cmd.Env = append(os.Environ(), reaperRaceTestEnv+"=1")
		out, err := cmd.CombinedOutput()
		if err == nil {
			return
		}
		lastOut = out
		lastErr = err
		if !strings.Contains(err.Error(), "no child processes") {
			break
		}
	}
	t.Fatalf("isolated subprocess failed after %d attempts: %v\n%s", maxAttempts, lastErr, lastOut)
}

func runReaperRaceLoop(t *testing.T) {
	const iterations = 300

	pm := NewPID1Manager()
	pm.SetSignalForwardingForTesting(false) // Don't install SIGTERM/etc handlers.
	pm.SetPID1ForTesting(true)
	pm.Start(nil) // Starts the orphan reaper goroutine.

	for i := range iterations {
		// "true" exits in microseconds — the worst case for the reaper race.
		cmd := exec.Command("true")

		if err := pm.StartAndRegister(cmd, nil); err != nil {
			t.Fatalf("iter %d: StartAndRegister failed: %v", i, err)
		}
		pid := cmd.Process.Pid

		err := cmd.Wait()
		pm.UnregisterChildProcess(pid)

		if err != nil {
			// ECHILD ("no child processes") is the reaper-race signature; flag it
			// distinctly so a future regression is easy to diagnose.
			if errors.Is(err, syscall.ECHILD) || strings.Contains(err.Error(), "no child processes") {
				t.Fatalf("iter %d: cmd.Wait() returned ECHILD — reaper race regressed: %v", i, err)
			}
			t.Fatalf("iter %d: cmd.Wait() failed: %v", i, err)
		}
	}
}
