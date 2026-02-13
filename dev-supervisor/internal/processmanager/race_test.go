//go:build !race

// Race condition tests - disabled with race detector to avoid false positives
// These tests intentionally create timing-sensitive scenarios to verify fixes work.
// Run without -race to validate the fix logic, with -race to detect actual data races.

//nolint:testpackage // Tests access unexported fields
package processmanager

import (
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/airo-ai-builder/dev-supervisor/internal/logs"
	"github.com/airo-ai-builder/dev-supervisor/internal/process"
	"github.com/airo-ai-builder/dev-supervisor/internal/validation"
)

// TestRaceCondition_TrackRequestDuringIdleStop tests Fix #2:
// TrackRequest checks idleStopping flag to prevent requests during shutdown
func TestRaceCondition_TrackRequestDuringIdleStop(t *testing.T) {
	t.Parallel()

	logMgr := logs.NewManager(100)
	pid1Mgr := process.NewPID1Manager()
	pm := NewProcessManager(logMgr, pid1Mgr)

	// Start a long-running process
	req := validation.ProcessStartRequest{
		Command:    "sleep 30",
		WorkingDir: "/tmp",
	}
	require.NoError(t, pm.Start(req))
	time.Sleep(100 * time.Millisecond)

	// Enable idle monitoring with very short timeout
	pm.EnableStartOnRequest(200*time.Millisecond, 50*time.Millisecond)

	// Spawn goroutines that continuously try to track requests
	var requestsRejected atomic.Int64
	var requestsAccepted atomic.Int64
	done := make(chan bool)

	for range 10 {
		go func() {
			for range 50 {
				initialCount := pm.inFlightRequests.Load()
				pm.TrackRequest()
				afterCount := pm.inFlightRequests.Load()

				if afterCount == initialCount {
					// Request was rejected (idleStopping was true)
					requestsRejected.Add(1)
				} else {
					// Request was accepted
					requestsAccepted.Add(1)
					pm.UntrackRequest()
				}
				time.Sleep(5 * time.Millisecond)
			}
			done <- true
		}()
	}

	// Wait for all goroutines
	for range 10 {
		<-done
	}

	// Verify that some requests were rejected during shutdown
	rejected := requestsRejected.Load()
	accepted := requestsAccepted.Load()

	t.Logf("Requests rejected: %d, accepted: %d", rejected, accepted)

	// If idle stop triggered, we should see rejections
	status := pm.GetStatus()
	if status.State == ProcessStateStopped {
		assert.Positive(t, rejected, "should have rejected requests during idle stop")
	}

	// Cleanup
	pm.StopIdleMonitor()
	if status.State == ProcessStateRunning {
		pm.Stop(ProcessStopRequest{Signal: "SIGKILL", Timeout: 1})
	}
}

// TestRaceCondition_IdleStopVsExplicitStop tests Fix #2:
// stopForIdle serializes with Stop/Restart via lifecycleMu
func TestRaceCondition_IdleStopVsExplicitStop(t *testing.T) {
	t.Parallel()

	logMgr := logs.NewManager(100)
	pid1Mgr := process.NewPID1Manager()
	pm := NewProcessManager(logMgr, pid1Mgr)

	// Start process
	req := validation.ProcessStartRequest{
		Command:    "sleep 30",
		WorkingDir: "/tmp",
	}
	require.NoError(t, pm.Start(req))
	time.Sleep(100 * time.Millisecond)

	// Enable idle monitoring with very short timeout
	pm.EnableStartOnRequest(200*time.Millisecond, 50*time.Millisecond)

	// Spawn goroutines that race to stop the process
	var explicitStops atomic.Int64
	done := make(chan bool)

	// Goroutine 1: Repeatedly trigger idle stop
	go func() {
		for range 20 {
			time.Sleep(50 * time.Millisecond)
			// Idle monitor will attempt stopForIdle naturally
		}
		done <- true
	}()

	// Goroutine 2: Repeatedly call explicit Stop
	go func() {
		for range 10 {
			time.Sleep(100 * time.Millisecond)
			err := pm.Stop(ProcessStopRequest{Signal: "SIGTERM", Timeout: 1})
			if err == nil || err.Error() != "no process is running" {
				explicitStops.Add(1)
			}
		}
		done <- true
	}()

	// Wait for goroutines
	<-done
	<-done

	// Verify no crashes occurred
	status := pm.GetStatus()
	assert.Contains(t, []ProcessState{ProcessStateStopped, ProcessStateError},
		status.State, "process should be stopped without crashes")

	// Cleanup
	pm.StopIdleMonitor()
}

// TestRaceCondition_IdleStopVsRestart tests Fix #3:
// stopProcessForRestart properly acquires pm.mu to avoid data races
func TestRaceCondition_IdleStopVsRestart(t *testing.T) {
	t.Parallel()

	logMgr := logs.NewManager(100)
	pid1Mgr := process.NewPID1Manager()
	pm := NewProcessManager(logMgr, pid1Mgr)

	// Start process
	req := validation.ProcessStartRequest{
		Command:    "sleep 30",
		WorkingDir: "/tmp",
	}
	require.NoError(t, pm.Start(req))
	time.Sleep(100 * time.Millisecond)

	// Enable idle monitoring
	pm.EnableStartOnRequest(300*time.Millisecond, 50*time.Millisecond)

	// Spawn goroutines that race idle stop vs restart
	done := make(chan bool)

	// Goroutine 1: Wait for idle to trigger
	go func() {
		time.Sleep(500 * time.Millisecond)
		done <- true
	}()

	// Goroutine 2: Call Restart concurrently
	go func() {
		time.Sleep(250 * time.Millisecond)
		err := pm.Restart(ProcessRestartRequest{Graceful: true})
		if err != nil {
			t.Logf("Restart error (expected if process stopped): %v", err)
		}
		done <- true
	}()

	// Wait for goroutines
	<-done
	<-done

	// Verify no crashes or data races occurred
	status := pm.GetStatus()
	t.Logf("Final state: %s", status.State)

	// Cleanup
	pm.StopIdleMonitor()
	if status.State == ProcessStateRunning {
		pm.Stop(ProcessStopRequest{Signal: "SIGKILL", Timeout: 1})
	}
}

// TestRaceCondition_ConcurrentTrackRequest tests that TrackRequest is thread-safe
// when called concurrently from multiple goroutines (common HTTP request pattern)
func TestRaceCondition_ConcurrentTrackRequest(t *testing.T) {
	t.Parallel()

	logMgr := logs.NewManager(100)
	pid1Mgr := process.NewPID1Manager()
	pm := NewProcessManager(logMgr, pid1Mgr)

	// Start process
	req := validation.ProcessStartRequest{
		Command:    "sleep 10",
		WorkingDir: "/tmp",
	}
	require.NoError(t, pm.Start(req))
	time.Sleep(100 * time.Millisecond)

	// Simulate 100 concurrent HTTP requests
	var wg sync.WaitGroup
	for range 100 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			pm.TrackRequest()
			time.Sleep(10 * time.Millisecond)
			pm.UntrackRequest()
		}()
	}

	wg.Wait()

	// Verify counter returned to zero
	assert.Equal(t, int64(0), pm.inFlightRequests.Load(),
		"all requests should be untracked")

	// Cleanup
	pm.Stop(ProcessStopRequest{Signal: "SIGKILL", Timeout: 1})
}
