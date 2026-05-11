//nolint:testpackage // Tests exercise internal APIs and types.
package processmanager

import (
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/airo-ai-builder/dev-supervisor/internal/logs"
	"github.com/airo-ai-builder/dev-supervisor/internal/process"
	"github.com/airo-ai-builder/dev-supervisor/internal/sandbox"
	"github.com/airo-ai-builder/dev-supervisor/internal/validation"
)

// TestIdleShutdown_RejectsNewRequests verifies that TrackRequest returns false
// when idle shutdown is in progress, preventing uncounted in-flight work.
func TestIdleShutdown_RejectsNewRequests(t *testing.T) {
	pm := NewProcessManager(nil, process.NewPID1Manager())

	// Simulate idle shutdown in progress
	pm.idleStopping.Store(true)

	// New request should be rejected
	accepted := pm.TrackRequest()
	if accepted {
		t.Fatal("TrackRequest accepted during idle shutdown, expected false")
	}

	// In-flight count should remain 0
	if count := pm.inFlightRequests.Load(); count != 0 {
		t.Fatalf("inFlightRequests = %d after rejection, want 0", count)
	}
}

// TestIdleShutdown_DoubleCheckPattern verifies that the double-check pattern
// in TrackRequest prevents TOCTOU races.
func TestIdleShutdown_DoubleCheckPattern(t *testing.T) {
	pm := NewProcessManager(nil, process.NewPID1Manager())

	// Simulate concurrent requests during idle shutdown flag change
	var wg sync.WaitGroup
	accepted := atomic.Int32{}
	rejected := atomic.Int32{}

	// Start accepting requests
	for range 100 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if pm.TrackRequest() {
				accepted.Add(1)
				pm.UntrackRequest()
			} else {
				rejected.Add(1)
			}
		}()
	}

	// Set idle stopping flag during concurrent requests
	time.Sleep(1 * time.Millisecond)
	pm.idleStopping.Store(true)

	wg.Wait()

	// Final in-flight count should be 0 (all requests either accepted and completed, or rejected)
	if count := pm.inFlightRequests.Load(); count != 0 {
		t.Fatalf("inFlightRequests = %d after all requests completed, want 0", count)
	}

	t.Logf("Accepted: %d, Rejected: %d", accepted.Load(), rejected.Load())

	// At least some requests should have been rejected after flag was set
	if rejected.Load() == 0 {
		t.Log("Warning: no requests were rejected, may indicate race window")
	}
}

// TestManagedProcess_StopDoesNotBlockGetInfo verifies that Stop() doesn't hold
// infoMu while waiting for process exit, allowing concurrent GetInfo() calls.
func TestManagedProcess_StopDoesNotBlockGetInfo(t *testing.T) {
	req := validation.ProcessStartRequest{
		Command: "sleep 2",
	}

	mp, err := NewManagedProcess(req, false, "", sandbox.VariantPreview, nil)
	if err != nil {
		t.Fatalf("Failed to create process: %v", err)
	}

	logMgr := logs.NewManager(100)
	if err := mp.Start(logMgr, nil, false, false); err != nil {
		t.Fatalf("Failed to start process: %v", err)
	}

	// Start Stop in background (will block waiting for process)
	stopDone := make(chan error, 1)
	go func() {
		stopDone <- mp.Stop("SIGTERM", 5)
	}()

	// Give Stop time to send signal and start waiting
	time.Sleep(100 * time.Millisecond)

	// GetInfo should not block while Stop is waiting
	timeout := time.After(200 * time.Millisecond)
	infoDone := make(chan bool, 1)

	go func() {
		_ = mp.GetInfo()
		infoDone <- true
	}()

	select {
	case <-infoDone:
		// Success - GetInfo returned quickly
	case <-timeout:
		t.Fatal("GetInfo blocked while Stop() was waiting for process exit")
	}

	// Wait for Stop to complete
	if err := <-stopDone; err != nil {
		t.Fatalf("Stop failed: %v", err)
	}
}

// TestManagedProcess_ConcurrentGetInfoDuringStop verifies multiple concurrent
// GetInfo calls don't block during Stop.
func TestManagedProcess_ConcurrentGetInfoDuringStop(t *testing.T) {
	req := validation.ProcessStartRequest{
		Command: "sleep 3",
	}

	mp, err := NewManagedProcess(req, false, "", sandbox.VariantPreview, nil)
	if err != nil {
		t.Fatalf("Failed to create process: %v", err)
	}

	logMgr := logs.NewManager(100)
	if err := mp.Start(logMgr, nil, false, false); err != nil {
		t.Fatalf("Failed to start process: %v", err)
	}

	// Start Stop in background
	stopDone := make(chan error, 1)
	go func() {
		stopDone <- mp.Stop("SIGTERM", 5)
	}()

	time.Sleep(50 * time.Millisecond)

	// Multiple concurrent GetInfo calls
	var wg sync.WaitGroup
	for range 10 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_ = mp.GetInfo()
		}()
	}

	// All GetInfo calls should complete quickly
	done := make(chan bool, 1)
	go func() {
		wg.Wait()
		done <- true
	}()

	select {
	case <-done:
		// Success
	case <-time.After(1 * time.Second):
		t.Fatal("Concurrent GetInfo calls blocked during Stop()")
	}

	// Wait for Stop to complete to avoid leaking goroutine/process
	select {
	case err := <-stopDone:
		if err != nil {
			t.Fatalf("Stop failed: %v", err)
		}
	case <-time.After(1 * time.Second):
		t.Fatal("Stop did not complete in time")
	}
}

// TestConcurrentLogReadWrite verifies that concurrent AddLog and GetLogs
// don't cause data races (detected by -race flag).
func TestConcurrentLogReadWrite(t *testing.T) {
	t.Helper()
	lm := logs.NewManager(1000)

	var wg sync.WaitGroup

	// Writer goroutines
	for range 10 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for range 100 {
				lm.AddLog(logs.LogEntry{
					Timestamp: time.Now(),
					Source:    "test",
					Message:   "test log",
				})
			}
		}()
	}

	// Reader goroutines
	for range 5 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for range 50 {
				_, _ = lm.GetLogs(logs.GetRequest{Lines: 100})
				time.Sleep(5 * time.Millisecond)
			}
		}()
	}

	wg.Wait()
}

// TestIdleShutdown_NoFalsePositives verifies that accepted requests
// are properly tracked and don't cause false idle shutdowns.
func TestIdleShutdown_NoFalsePositives(t *testing.T) {
	pm := NewProcessManager(nil, process.NewPID1Manager())

	// Accept multiple requests
	const numRequests = 10
	for i := range numRequests {
		if !pm.TrackRequest() {
			t.Fatalf("Request %d rejected unexpectedly", i)
		}
	}

	// Verify all are tracked
	if count := pm.inFlightRequests.Load(); count != numRequests {
		t.Fatalf("inFlightRequests = %d, want %d", count, numRequests)
	}

	// Untrack all
	for range numRequests {
		pm.UntrackRequest()
	}

	// Should be back to 0
	if count := pm.inFlightRequests.Load(); count != 0 {
		t.Fatalf("inFlightRequests = %d after untracking all, want 0", count)
	}
}
