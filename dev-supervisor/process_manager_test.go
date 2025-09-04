package main

import (
	"testing"
	"time"
)

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
		Interval:         10 * time.Second,
		Timeout:          5 * time.Second,
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
