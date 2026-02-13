//nolint:testpackage // Tests exercise internal APIs and types.
package health

import (
	"testing"
	"time"
)

// TestHealthMonitor_NoRestartAfterStop verifies that restarts don't fire
// after Stop() is called, even during backoff delays.
func TestHealthMonitor_NoRestartAfterStop(t *testing.T) {
	restarted := make(chan bool, 1)
	onRestart := func() error {
		restarted <- true
		return nil
	}

	monitor := NewMonitor(nil)

	// Configure with short backoff for testing
	restartPolicy := &RestartPolicy{
		Enabled:           true,
		MaxRestarts:       5,
		RestartWindow:     Duration(5 * time.Minute),
		BackoffMultiplier: 2.0,
		InitialDelay:      Duration(500 * time.Millisecond),
		MaxBackoff:        Duration(5 * time.Minute),
	}

	healthCheck := &HealthCheck{
		Type:             HealthCheckTypeCommand,
		Command:          "exit 1", // Always fails
		Interval:         Duration(100 * time.Millisecond),
		Timeout:          Duration(1 * time.Second),
		FailureThreshold: 1, // Trigger restart immediately
		SuccessThreshold: 1,
	}

	monitor.Configure(healthCheck, restartPolicy)
	monitor.Start(onRestart)

	// Let health check fail and queue a restart
	time.Sleep(200 * time.Millisecond)

	// Stop monitor during backoff delay (before restart fires)
	monitor.Stop()

	// Ensure no restart after Stop
	select {
	case <-restarted:
		t.Fatal("restart fired after Stop() was called")
	case <-time.After(1 * time.Second):
		// Success - no restart occurred
	}
}

// TestHealthMonitor_ContextCancellationDuringBackoff verifies that context
// cancellation during backoff prevents restart.
func TestHealthMonitor_ContextCancellationDuringBackoff(t *testing.T) {
	restartCount := 0
	onRestart := func() error {
		restartCount++
		return nil
	}

	monitor := NewMonitor(nil)

	restartPolicy := &RestartPolicy{
		Enabled:           true,
		MaxRestarts:       10,
		RestartWindow:     Duration(5 * time.Minute),
		BackoffMultiplier: 1.5,
		InitialDelay:      Duration(300 * time.Millisecond),
		MaxBackoff:        Duration(5 * time.Minute),
	}

	healthCheck := &HealthCheck{
		Type:             HealthCheckTypeCommand,
		Command:          "exit 1",
		Interval:         Duration(100 * time.Millisecond),
		Timeout:          Duration(1 * time.Second),
		FailureThreshold: 1,
		SuccessThreshold: 1,
	}

	monitor.Configure(healthCheck, restartPolicy)
	monitor.Start(onRestart)

	// Let it queue a restart
	time.Sleep(200 * time.Millisecond)

	// Stop during backoff
	monitor.Stop()

	// Wait longer than backoff would take
	time.Sleep(600 * time.Millisecond)

	// Restart count should be 0 (cancelled during backoff)
	if restartCount > 0 {
		t.Fatalf("restart fired %d times after Stop(), expected 0", restartCount)
	}
}

// TestHealthMonitor_MultipleStartStopCycles verifies that Start/Stop cycles
// with proper delays work correctly.
func TestHealthMonitor_MultipleStartStopCycles(t *testing.T) {
	t.Helper()
	monitor := NewMonitor(nil)

	healthCheck := &HealthCheck{
		Type:             HealthCheckTypeCommand,
		Command:          "true",
		Interval:         Duration(100 * time.Millisecond),
		Timeout:          Duration(1 * time.Second),
		FailureThreshold: 3,
		SuccessThreshold: 1,
	}

	monitor.Configure(healthCheck, nil)

	// Test a few Start/Stop cycles with proper cleanup delays
	// (Rapid cycling without delays causes restartCh field races)
	for range 3 {
		monitor.Start(func() error { return nil })
		time.Sleep(150 * time.Millisecond) // Let monitor fully start
		monitor.Stop()
		time.Sleep(150 * time.Millisecond) // Let goroutines fully exit
	}
}

// TestHealthMonitor_EnabledFlagDuringRestart verifies that checking enabled
// flag after backoff prevents restart.
func TestHealthMonitor_EnabledFlagDuringRestart(t *testing.T) {
	restartAttempts := 0
	monitor := NewMonitor(nil)

	restartPolicy := &RestartPolicy{
		Enabled:           true,
		MaxRestarts:       5,
		RestartWindow:     Duration(1 * time.Minute),
		InitialDelay:      Duration(200 * time.Millisecond),
		BackoffMultiplier: 2.0,
		MaxBackoff:        Duration(5 * time.Minute),
	}

	healthCheck := &HealthCheck{
		Type:             HealthCheckTypeCommand,
		Command:          "exit 1",
		Interval:         Duration(50 * time.Millisecond),
		Timeout:          Duration(1 * time.Second),
		FailureThreshold: 1,
		SuccessThreshold: 1,
	}

	monitor.Configure(healthCheck, restartPolicy)
	monitor.Start(func() error {
		restartAttempts++
		return nil
	})

	// Let health check fail
	time.Sleep(100 * time.Millisecond)

	// Stop after failure but before backoff completes
	time.Sleep(50 * time.Millisecond)
	monitor.Stop()

	// Wait for backoff to complete
	time.Sleep(300 * time.Millisecond)

	// Should not have restarted
	if restartAttempts > 0 {
		t.Fatalf("restart attempted %d times after Stop(), expected 0", restartAttempts)
	}
}
