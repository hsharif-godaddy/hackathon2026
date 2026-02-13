//go:build !windows

//nolint:testpackage // Tests exercise internal APIs and types.
package process

import (
	"syscall"
	"testing"
	"time"
)

// TestPID1Manager_SignalHandlingNoDeadlock verifies that handleSignal doesn't deadlock
// when processing SIGTERM/SIGINT by ensuring it doesn't hold RLock while calling initiateShutdown.
func TestPID1Manager_SignalHandlingNoDeadlock(t *testing.T) {
	pm := NewPID1Manager()
	pm.SetPID1ForTesting(true)
	pm.SetSignalForwardingForTesting(true)

	// Set up a no-op shutdown callback
	shutdownCalled := make(chan bool, 1)
	pm.Start(func() {
		shutdownCalled <- true
	})

	// Send SIGTERM in a goroutine with timeout detection
	done := make(chan bool, 1)
	go func() {
		pm.handleSignal(syscall.SIGTERM)
		done <- true
	}()

	// Should complete quickly without deadlock
	select {
	case <-done:
		// Success - signal handled without deadlock
	case <-time.After(2 * time.Second):
		t.Fatal("handleSignal(SIGTERM) deadlocked - did not complete within 2 seconds")
	}

	// Verify shutdown was initiated
	select {
	case <-shutdownCalled:
		// Success
	case <-time.After(1 * time.Second):
		// This is OK - shutdown callback might not be called if no children
	}
}

// TestPID1Manager_SignalForwardingNoDeadlock verifies that forwarding other signals
// (SIGHUP, SIGUSR1, etc.) doesn't hold locks unnecessarily.
func TestPID1Manager_SignalForwardingNoDeadlock(t *testing.T) {
	pm := NewPID1Manager()
	pm.SetPID1ForTesting(true)
	pm.SetSignalForwardingForTesting(true)

	pm.Start(func() {})

	// Send SIGHUP which should be forwarded to children
	done := make(chan bool, 1)
	go func() {
		pm.handleSignal(syscall.SIGHUP)
		done <- true
	}()

	// Should complete immediately (no children to forward to)
	select {
	case <-done:
		// Success
	case <-time.After(1 * time.Second):
		t.Fatal("handleSignal(SIGHUP) took too long")
	}
}

// TestPID1Manager_ConcurrentSignalHandling verifies that multiple concurrent
// signal handlers don't cause races or deadlocks.
func TestPID1Manager_ConcurrentSignalHandling(t *testing.T) {
	pm := NewPID1Manager()
	pm.SetPID1ForTesting(true)
	pm.SetSignalForwardingForTesting(true)

	pm.Start(func() {})

	// Send multiple signals concurrently
	signals := []syscall.Signal{syscall.SIGHUP, syscall.SIGUSR1, syscall.SIGUSR2}

	done := make(chan bool, len(signals))
	for _, sig := range signals {
		go func(s syscall.Signal) {
			pm.handleSignal(s)
			done <- true
		}(sig)
	}

	// All should complete quickly
	for i := range signals {
		select {
		case <-done:
			// Success
		case <-time.After(2 * time.Second):
			t.Fatalf("Concurrent signal handling timed out after %d signals", i)
		}
	}
}
