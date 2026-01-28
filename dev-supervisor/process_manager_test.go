package main

import (
	"net"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// mockConn implements net.Conn for testing
type mockConn struct {
	net.Conn
}

func (m *mockConn) Close() error                       { return nil }
func (m *mockConn) Read(_ []byte) (n int, err error)   { return 0, nil }
func (m *mockConn) Write(b []byte) (n int, err error)  { return len(b), nil }
func (m *mockConn) LocalAddr() net.Addr                { return nil }
func (m *mockConn) RemoteAddr() net.Addr               { return nil }
func (m *mockConn) SetDeadline(_ time.Time) error      { return nil }
func (m *mockConn) SetReadDeadline(_ time.Time) error  { return nil }
func (m *mockConn) SetWriteDeadline(_ time.Time) error { return nil }

func TestProcessManager_NewProcessManager(t *testing.T) {
	logMgr := NewLogManager(100)
	pid1Mgr := NewPID1Manager()

	pm := NewProcessManager(logMgr, pid1Mgr)

	if pm == nil {
		t.Fatal("Expected non-nil ProcessManager")
	}

	if pm.logMgr != logMgr {
		t.Error("Expected logMgr to be set correctly")
	}

	if pm.pid1Mgr != pid1Mgr {
		t.Error("Expected pid1Mgr to be set correctly")
	}

	if pm.healthMon == nil {
		t.Error("Expected healthMon to be initialized")
	}

	status := pm.GetStatus()
	if status.State != ProcessStateStopped {
		t.Errorf("Expected initial state %s, got %s", ProcessStateStopped, status.State)
	}
}

func TestProcessManager_StartProcess(t *testing.T) {
	logMgr := NewLogManager(100)
	pid1Mgr := NewPID1Manager()
	pm := NewProcessManager(logMgr, pid1Mgr)

	tests := []struct {
		name          string
		request       ProcessStartRequest
		expectError   bool
		expectedState ProcessState
	}{
		{
			name: "valid command",
			request: ProcessStartRequest{
				Command:    "echo 'hello'",
				WorkingDir: "/tmp",
				Env:        map[string]string{"TEST": "value"},
			},
			expectError:   false,
			expectedState: ProcessStateRunning,
		},
		{
			name: "empty command",
			request: ProcessStartRequest{
				Command: "",
			},
			expectError:   true,
			expectedState: ProcessStateStopped,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := pm.Start(tt.request)

			if tt.expectError && err == nil {
				t.Error("Expected error but got none")
			}

			if !tt.expectError && err != nil {
				t.Errorf("Expected no error but got: %v", err)
			}

			// Give process time to start
			if !tt.expectError {
				time.Sleep(100 * time.Millisecond)
				status := pm.GetStatus()

				if status.Command != tt.request.Command {
					t.Errorf("Expected command %s, got %s", tt.request.Command, status.Command)
				}

				if status.PID <= 0 {
					t.Error("Expected positive PID")
				}
			}

			// Clean up - stop any running process
			if pm.GetStatus().State == ProcessStateRunning {
				if err := pm.Stop(ProcessStopRequest{Signal: "SIGKILL", Timeout: 1}); err != nil {
					t.Logf("test cleanup: failed to stop process: %v", err)
				}
				time.Sleep(100 * time.Millisecond)
			}
		})
	}
}

func TestProcessManager_StopProcess(t *testing.T) {
	logMgr := NewLogManager(100)
	pid1Mgr := NewPID1Manager()
	pm := NewProcessManager(logMgr, pid1Mgr)

	// Test stopping when no process is running
	err := pm.Stop(ProcessStopRequest{Signal: "SIGTERM", Timeout: 1})
	if err == nil {
		t.Error("Expected error when stopping non-running process")
	}

	// Start a process
	req := ProcessStartRequest{
		Command: "echo 'Process starting...' && sleep 10",
	}

	if err = pm.Start(req); err != nil {
		t.Fatalf("Failed to start process: %v", err)
	}

	time.Sleep(100 * time.Millisecond) // Let process start

	// Stop the process
	stopReq := ProcessStopRequest{
		Signal:  "SIGTERM",
		Timeout: 2,
	}

	err = pm.Stop(stopReq)
	if err != nil {
		// SIGTERM termination is expected behavior, not an error
		if err.Error() != "signal: terminated" {
			t.Errorf("Failed to stop process: %v", err)
		}
	}

	// Wait for process to stop
	time.Sleep(200 * time.Millisecond)

	status := pm.GetStatus()
	if status.State != ProcessStateStopped && status.State != ProcessStateError {
		t.Errorf("Expected process to be stopped, got state: %s", status.State)
	}
}

func TestProcessManager_RestartProcess(t *testing.T) {
	logMgr := NewLogManager(100)
	pid1Mgr := NewPID1Manager()
	pm := NewProcessManager(logMgr, pid1Mgr)

	// Test restart with no previous command
	err := pm.Restart(ProcessRestartRequest{Graceful: true})
	if err == nil {
		t.Error("Expected error when restarting with no previous command")
	}

	// Start a process first
	req := ProcessStartRequest{
		Command:    "echo 'Process starting for restart test...' && exec sleep 10",
		WorkingDir: "/tmp", // Explicit working directory
	}

	if err = pm.Start(req); err != nil {
		t.Fatalf("Failed to start process: %v", err)
	}

	time.Sleep(100 * time.Millisecond)
	originalPID := pm.GetStatus().PID

	// Restart the process
	err = pm.Restart(ProcessRestartRequest{Graceful: true})
	if err != nil {
		// SIGTERM termination during restart is expected behavior, not an error
		if err.Error() != "failed to stop process for restart: signal: terminated" {
			t.Errorf("Failed to restart process: %v", err)
		}
	}

	// Check status immediately after restart
	immediateStatus := pm.GetStatus()
	t.Logf("Status immediately after restart: State=%s, PID=%d, Error=%s", immediateStatus.State, immediateStatus.PID, immediateStatus.Error)

	// Wait and check status multiple times to see if it stabilizes
	for i := 0; i < 5; i++ {
		time.Sleep(200 * time.Millisecond)
		status := pm.GetStatus()
		t.Logf("Status check %d: State=%s, PID=%d, Error=%s", i+1, status.State, status.PID, status.Error)

		if status.State == ProcessStateRunning {
			break
		}
	}

	finalStatus := pm.GetStatus()
	if finalStatus.State != ProcessStateRunning {
		t.Errorf("Expected process to be running after restart, got: %s (error: %s)", finalStatus.State, finalStatus.Error)
	}

	// PID should be different (new process)
	if finalStatus.State == ProcessStateRunning && finalStatus.PID == originalPID {
		t.Error("Expected different PID after restart")
	} else if finalStatus.State == ProcessStateRunning {
		t.Logf("Restart successful: old PID %d, new PID %d", originalPID, finalStatus.PID)
	}

	// Clean up
	if err := pm.Stop(ProcessStopRequest{Signal: "SIGKILL", Timeout: 1}); err != nil {
		t.Logf("test cleanup: failed to stop process: %v", err)
	}
}

func TestProcessManager_ConfigureHealthCheck(t *testing.T) {
	logMgr := NewLogManager(100)
	pid1Mgr := NewPID1Manager()
	pm := NewProcessManager(logMgr, pid1Mgr)

	healthCheck := &HealthCheck{
		Type:             HealthCheckTypeCommand,
		Command:          "echo 'healthy'",
		Interval:         Duration(10 * time.Second),
		Timeout:          Duration(5 * time.Second),
		SuccessThreshold: 1,
		FailureThreshold: 3,
	}

	restartPolicy := &RestartPolicy{
		Enabled:     true,
		MaxRestarts: 5,
	}

	// Configure health check
	pm.ConfigureHealthCheck(healthCheck, restartPolicy)

	// Get health status
	status := pm.GetHealthStatus()
	if status.Status != HealthStatusDisabled {
		t.Logf("Health status: %s (expected disabled when no process running)", status.Status)
	}

	// Get restart stats
	stats := pm.GetRestartStats()
	if stats == nil {
		t.Error("Expected non-nil restart stats")
	}

	if totalRestarts, exists := stats["total_restarts"]; !exists || totalRestarts != 0 {
		t.Error("Expected total_restarts to be 0 initially")
	}
}

func TestProcessManager_EnableStartOnRequest(t *testing.T) {
	logMgr := NewLogManager(100)
	pid1Mgr := NewPID1Manager()
	pm := NewProcessManager(logMgr, pid1Mgr)

	idleTimeout := 5 * time.Second
	checkInterval := 1 * time.Second

	pm.EnableStartOnRequest(idleTimeout, checkInterval)

	assert.True(t, pm.IsStartOnRequestEnabled(), "startOnRequestEnabled should be true")
	assert.Equal(t, idleTimeout, pm.GetIdleTimeout(), "idleTimeout should match")
	assert.Equal(t, checkInterval, pm.GetIdleCheckInterval(), "idleCheckInterval should match")
	assert.NotNil(t, pm.lastActivityTime.Load(), "lastActivityTime should be initialized")

	// Clean up
	pm.StopIdleMonitor()
}

func TestProcessManager_UpdateActivity(t *testing.T) {
	logMgr := NewLogManager(100)
	pid1Mgr := NewPID1Manager()
	pm := NewProcessManager(logMgr, pid1Mgr)

	pm.EnableStartOnRequest(5*time.Second, 1*time.Second)

	// Get initial activity time
	initialTime, ok := pm.lastActivityTime.Load().(time.Time)
	require.True(t, ok, "should be able to load activity time")

	// Wait a bit to ensure time difference
	time.Sleep(10 * time.Millisecond)

	// Update activity
	pm.UpdateActivity()

	// Verify activity time was updated
	updatedTime, ok := pm.lastActivityTime.Load().(time.Time)
	require.True(t, ok, "should be able to load updated activity time")
	assert.True(t, updatedTime.After(initialTime), "lastActivityTime should be updated to a later time")

	// Clean up
	pm.StopIdleMonitor()
}

func TestProcessManager_WebSocketTracking(t *testing.T) {
	logMgr := NewLogManager(100)
	pid1Mgr := NewPID1Manager()
	pm := NewProcessManager(logMgr, pid1Mgr)

	pm.EnableStartOnRequest(5*time.Second, 1*time.Second)

	// Create mock connections
	conn1 := &mockConn{}
	conn2 := &mockConn{}

	// Register WebSocket connections
	pm.RegisterWebSocket(conn1)
	pm.RegisterWebSocket(conn2)

	// Verify connections are tracked
	count := 0
	pm.activeWebSockets.Range(func(_, _ any) bool {
		count++
		return true
	})
	assert.Equal(t, 2, count, "should have 2 active WebSocket connections")

	// Unregister one connection
	pm.UnregisterWebSocket(conn1)

	// Verify only one connection remains
	count = 0
	pm.activeWebSockets.Range(func(_, _ any) bool {
		count++
		return true
	})
	assert.Equal(t, 1, count, "should have 1 active WebSocket connection after unregister")

	// Clean up
	pm.StopIdleMonitor()
}

func TestProcessManager_IdleStopWithWebSocket(t *testing.T) {
	logMgr := NewLogManager(100)
	pid1Mgr := NewPID1Manager()
	pm := NewProcessManager(logMgr, pid1Mgr)

	// Start a long-running process
	req := ProcessStartRequest{
		Command: "sleep 30",
	}

	require.NoError(t, pm.Start(req), "should start process")
	time.Sleep(100 * time.Millisecond) // Let process start

	// Enable start-on-request with very short timeout for testing
	pm.EnableStartOnRequest(500*time.Millisecond, 100*time.Millisecond)

	// Register a WebSocket connection
	conn := &mockConn{}
	pm.RegisterWebSocket(conn)

	// Wait longer than idle timeout
	time.Sleep(1 * time.Second)

	// Process should still be running because WebSocket is active
	status := pm.GetStatus()
	assert.Equal(t, ProcessStateRunning, status.State, "process should still be running with active WebSocket")

	// Unregister WebSocket
	pm.UnregisterWebSocket(conn)

	// Wait for idle check to trigger
	time.Sleep(1 * time.Second)

	// Now process should be stopped (or error if it was killed)
	status = pm.GetStatus()
	assert.Contains(t, []ProcessState{ProcessStateStopped, ProcessStateStopping, ProcessStateError}, status.State,
		"process should be stopped after WebSocket closed")

	// Clean up
	pm.StopIdleMonitor()
	if status.State == ProcessStateRunning {
		//nolint:errcheck // Test cleanup, error not critical
		pm.Stop(ProcessStopRequest{Signal: "SIGKILL", Timeout: 1})
	}
}

func TestProcessManager_GetStartRequest(t *testing.T) {
	logMgr := NewLogManager(100)
	pid1Mgr := NewPID1Manager()
	pm := NewProcessManager(logMgr, pid1Mgr)

	// Test when no process has been started
	req := pm.GetStartRequest()
	assert.Nil(t, req, "should return nil when no process has been started")

	// Start a process
	startReq := ProcessStartRequest{
		Command:    "sleep 5",
		WorkingDir: "/tmp",
		Env:        map[string]string{"TEST": "value"},
	}

	require.NoError(t, pm.Start(startReq), "should start process")
	time.Sleep(100 * time.Millisecond)

	// Get start request
	req = pm.GetStartRequest()
	require.NotNil(t, req, "should return start request after starting process")
	assert.Equal(t, startReq.Command, req.Command, "command should match")
	assert.Equal(t, startReq.WorkingDir, req.WorkingDir, "working dir should match")

	// Clean up
	//nolint:errcheck // Test cleanup, error not critical
	pm.Stop(ProcessStopRequest{Signal: "SIGKILL", Timeout: 1})
}

func TestProcessManager_StopIdleMonitor(t *testing.T) {
	logMgr := NewLogManager(100)
	pid1Mgr := NewPID1Manager()
	pm := NewProcessManager(logMgr, pid1Mgr)

	pm.EnableStartOnRequest(5*time.Second, 100*time.Millisecond)

	// Verify monitor is running
	assert.True(t, pm.IsIdleMonitorRunning(), "idle monitor should be running")

	// Stop the monitor
	pm.StopIdleMonitor()

	// Verify monitor is stopped
	assert.False(t, pm.IsIdleMonitorRunning(), "idle monitor should be stopped")

	// Calling again should be safe
	pm.StopIdleMonitor()
}

// TestProcessManager_IdleMonitorRestartsAfterAutoStart tests that idle monitoring
// restarts correctly after an auto-start cycle
func TestProcessManager_IdleMonitorRestartsAfterAutoStart(t *testing.T) {
	logMgr := NewLogManager(100)
	pid1Mgr := NewPID1Manager()
	pm := NewProcessManager(logMgr, pid1Mgr)

	// Start a long-running process
	req := ProcessStartRequest{
		Command:    "sleep 30",
		WorkingDir: "/tmp",
	}
	require.NoError(t, pm.Start(req), "should start process")
	time.Sleep(100 * time.Millisecond) // Let process start

	// Enable start-on-request with very short timeout for testing
	pm.EnableStartOnRequest(500*time.Millisecond, 100*time.Millisecond)

	// Verify idle monitor is running
	require.True(t, pm.IsIdleMonitorRunning(), "idle monitor should be running after EnableStartOnRequest")

	// Wait for idle timeout to trigger (first stop)
	time.Sleep(800 * time.Millisecond)

	// Process should have been stopped by idle timeout
	status := pm.GetStatus()
	assert.Equal(t, ProcessStateStopped, status.State, "process should be stopped after idle timeout")
	assert.False(t, pm.IsIdleMonitorRunning(), "idle monitor should be canceled after stop")

	// Simulate auto-start by calling Start() again (this is what handleAutoStart does)
	req2 := ProcessStartRequest{
		Command:    "sleep 30",
		WorkingDir: "/tmp",
	}
	require.NoError(t, pm.Start(req2), "should restart process")
	time.Sleep(100 * time.Millisecond) // Let process start

	// CRITICAL: Verify idle monitor was restarted (this is the bug fix)
	require.True(t, pm.IsIdleMonitorRunning(), "idle monitor should be restarted after auto-start")

	// Verify process is running
	status = pm.GetStatus()
	assert.Equal(t, ProcessStateRunning, status.State, "process should be running after auto-start")

	// Wait for idle timeout to trigger again (second stop - this is what failed before the fix)
	time.Sleep(800 * time.Millisecond)

	// Process should have been stopped by idle timeout AGAIN
	status = pm.GetStatus()
	assert.Equal(t, ProcessStateStopped, status.State, "process should be stopped after second idle timeout")

	// Clean up
	pm.StopIdleMonitor()
}

// TestProcessManager_IdleMonitorRestartsAfterRestart tests that idle monitoring
// restarts properly after a manual restart operation
func TestProcessManager_IdleMonitorRestartsAfterRestart(t *testing.T) {
	logMgr := NewLogManager(100)
	pid1Mgr := NewPID1Manager()
	pm := NewProcessManager(logMgr, pid1Mgr)

	// Start a long-running process
	req := ProcessStartRequest{
		Command:    "sleep 30",
		WorkingDir: "/tmp",
	}
	require.NoError(t, pm.Start(req), "should start process")
	time.Sleep(100 * time.Millisecond) // Let process start

	// Enable start-on-request
	pm.EnableStartOnRequest(500*time.Millisecond, 100*time.Millisecond)
	require.True(t, pm.IsIdleMonitorRunning(), "idle monitor should be running")

	// Perform a manual restart
	err := pm.Restart(ProcessRestartRequest{Graceful: true})
	require.NoError(t, err, "restart should succeed")
	time.Sleep(100 * time.Millisecond) // Let process restart

	// Verify idle monitor was restarted after manual restart
	require.True(t, pm.IsIdleMonitorRunning(), "idle monitor should be restarted after manual restart")

	// Verify process is running
	status := pm.GetStatus()
	assert.Equal(t, ProcessStateRunning, status.State, "process should be running after restart")

	// Wait for idle timeout to trigger
	time.Sleep(800 * time.Millisecond)

	// Process should have been stopped by idle timeout
	status = pm.GetStatus()
	assert.Equal(t, ProcessStateStopped, status.State, "process should be stopped after idle timeout")

	// Clean up
	pm.StopIdleMonitor()
}

// TestProcessManager_EnableStartOnRequestTwice tests that calling EnableStartOnRequest
// multiple times doesn't leak goroutines
func TestProcessManager_EnableStartOnRequestTwice(t *testing.T) {
	logMgr := NewLogManager(100)
	pid1Mgr := NewPID1Manager()
	pm := NewProcessManager(logMgr, pid1Mgr)

	// Enable start-on-request first time
	pm.EnableStartOnRequest(5*time.Second, 1*time.Second)
	require.True(t, pm.IsIdleMonitorRunning(), "first idle monitor should be running")
	assert.Equal(t, 5*time.Second, pm.GetIdleTimeout(), "first idle timeout should be set")

	// Enable start-on-request again (should cancel old and create new)
	pm.EnableStartOnRequest(10*time.Second, 2*time.Second)
	require.True(t, pm.IsIdleMonitorRunning(), "second idle monitor should be running")

	// Verify settings were updated (this proves old monitor was canceled and new one created)
	assert.Equal(t, 10*time.Second, pm.GetIdleTimeout(), "idle timeout should be updated")
	assert.Equal(t, 2*time.Second, pm.GetIdleCheckInterval(), "check interval should be updated")

	// Clean up
	pm.StopIdleMonitor()
}

// TestProcessManager_InFlightRequestsBlockIdle tests that in-flight requests prevent idle shutdown
func TestProcessManager_InFlightRequestsBlockIdle(t *testing.T) {
	logMgr := NewLogManager(100)
	pid1Mgr := NewPID1Manager()
	pm := NewProcessManager(logMgr, pid1Mgr)

	// Start a long-running process
	req := ProcessStartRequest{
		Command:    "sleep 30",
		WorkingDir: "/tmp",
	}
	require.NoError(t, pm.Start(req), "should start process")
	time.Sleep(100 * time.Millisecond) // Let process start

	// Enable start-on-request with short timeout for testing
	pm.EnableStartOnRequest(500*time.Millisecond, 100*time.Millisecond)

	// Simulate an in-flight request
	pm.TrackRequest()

	// Wait longer than idle timeout
	time.Sleep(800 * time.Millisecond)

	// Process should still be running because of in-flight request
	status := pm.GetStatus()
	assert.Equal(t, ProcessStateRunning, status.State, "process should still be running with in-flight request")

	// Complete the request (UntrackRequest updates activity, but that's expected)
	// After completion, idle timeout should start fresh from the completion time
	pm.UntrackRequest()

	// Wait for idle timeout to trigger
	time.Sleep(800 * time.Millisecond)

	// Process should now be stopped (idle timeout elapsed since completion)
	status = pm.GetStatus()
	assert.Equal(t, ProcessStateStopped, status.State, "process should be stopped after request completes and idle timeout")

	// Cleanup
	pm.StopIdleMonitor()
}

// TestProcessManager_HealthCheckDoesNotPreventIdle tests that health checks don't keep app alive
func TestProcessManager_HealthCheckDoesNotPreventIdle(t *testing.T) {
	logMgr := NewLogManager(100)
	pid1Mgr := NewPID1Manager()
	pm := NewProcessManager(logMgr, pid1Mgr)

	// Start a long-running process
	req := ProcessStartRequest{
		Command:    "sleep 30",
		WorkingDir: "/tmp",
	}
	require.NoError(t, pm.Start(req), "should start process")
	time.Sleep(100 * time.Millisecond)

	// Enable start-on-request with short timeout
	pm.EnableStartOnRequest(500*time.Millisecond, 100*time.Millisecond)

	// Simulate periodic health checks (don't call UpdateActivity - middleware handles this)
	// In real scenario, health checks increment/decrement counter but don't update activity
	for i := 0; i < 5; i++ {
		pm.TrackRequest()
		pm.inFlightRequests.Add(-1) // Complete without updating activity
		time.Sleep(100 * time.Millisecond)
	}

	// Wait for idle timeout
	time.Sleep(400 * time.Millisecond)

	// Process should be stopped despite health checks
	status := pm.GetStatus()
	assert.Equal(t, ProcessStateStopped, status.State, "process should be stopped despite health checks")

	pm.StopIdleMonitor()
}
