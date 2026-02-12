package processmanager

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"maps"
	"sync"
	"sync/atomic"
	"time"

	"github.com/airo-ai-builder/dev-supervisor/internal/config"
	"github.com/airo-ai-builder/dev-supervisor/internal/health"
	"github.com/airo-ai-builder/dev-supervisor/internal/logs"
	"github.com/airo-ai-builder/dev-supervisor/internal/middleware"
	"github.com/airo-ai-builder/dev-supervisor/internal/ports"
	"github.com/airo-ai-builder/dev-supervisor/internal/process"
	"github.com/airo-ai-builder/dev-supervisor/internal/validation"
)

// ProcessManager manages the current process instance and persistent configuration.
type ProcessManager struct {
	mu                    sync.RWMutex
	currentProcess        *ManagedProcess // nil when no process running
	logMgr                logs.Logger
	healthMon             *health.Monitor
	pid1Mgr               *process.PID1Manager
	portDiscovery         ports.Discovery
	restartCount          int
	enableLogging         bool // Control whether to log child process stdout/stderr
	outputToStructuredLog bool // Control whether to output child process logs to structured logging

	// Start-on-request fields
	lastActivityTime      atomic.Value  // stores time.Time
	inFlightRequests      atomic.Int64  // Count of HTTP requests currently being processed
	idleTimeout           time.Duration // Duration of inactivity before auto-stopping
	idleCheckInterval     time.Duration // How often to check for idle timeout
	idleMonitorCancel     context.CancelFunc
	startOnRequestEnabled bool
	activeWebSockets      sync.Map // map[net.Conn]bool - tracks active WS connections

	// Health tracking for idled apps
	// When true, indicates the process was healthy before being idled due to inactivity.
	// Used by health checks to report "healthy" for idled apps instead of "unhealthy".
	wasHealthyBeforeIdle atomic.Bool

	savedStartRequest *validation.ProcessStartRequest // Saved for deferred start

	// State change broadcasting using close-and-replace pattern.
	//
	// Pattern: Close channel on state change, create new one for future waiters.
	//
	// Why this works (memory ordering guarantees):
	// 1. Waiter calls GetStateChangeChan() (acquires RLock) -> gets channel reference
	// 2. Waiter checks process status (synchronizes via RLock in GetStatus)
	// 3. If state is still changing, waiter waits on channel
	// 4. State change calls broadcastStateChangeLocked() (acquires Lock) -> closes channel
	//
	// The RLock in GetStateChangeChan() establishes a happens-before relationship with
	// the Lock in broadcastStateChangeLocked(). This guarantees that if a state change
	// happens after step 1, the waiter will either:
	// - See the new state in step 2 (synchronized read), OR
	// - Have the channel closed in step 4 (waking them to re-check)
	//
	// This prevents missing notifications: we can't miss a state change because the
	// channel read in step 1 synchronizes with the channel close in step 4.
	stateChangeCh chan struct{}
}

func NewProcessManager(logMgr logs.Logger, pid1Mgr *process.PID1Manager) *ProcessManager {
	return &ProcessManager{
		logMgr:                logMgr,
		pid1Mgr:               pid1Mgr,
		portDiscovery:         ports.NewDiscovery(),
		healthMon:             health.NewMonitor(logMgr),
		enableLogging:         true,                               // Default: enable child process logging
		outputToStructuredLog: config.GetProcessLoggingToStdout(), // Default: enable structured logging output, configurable via env
		stateChangeCh:         make(chan struct{}),                // Initialize state change broadcast channel
	}
}

// broadcastStateChangeLocked notifies all waiters that process state has changed.
// MUST be called while holding pm.mu lock (name suffix documents this requirement).
//
// Closes the current channel (waking all waiters) and creates a new one for future waiters.
// The Lock held during this call synchronizes with RLock in GetStateChangeChan(), ensuring
// waiters see either the updated state or get woken by channel close.
func (pm *ProcessManager) broadcastStateChangeLocked() {
	close(pm.stateChangeCh)
	pm.stateChangeCh = make(chan struct{})
}

// GetStateChangeChan returns the current state change channel for waiting.
//
// Callers MUST follow this pattern to avoid missing notifications:
// 1. Call GetStateChangeChan() to get channel reference
// 2. Check process status via GetStatus()
// 3. If status requires waiting, wait on channel from step 1
//
// The RLock here synchronizes with Lock in broadcastStateChangeLocked(), guaranteeing
// that state changes are never missed (see stateChangeCh field documentation for details).
func (pm *ProcessManager) GetStateChangeChan() <-chan struct{} {
	pm.mu.RLock()
	defer pm.mu.RUnlock()
	return pm.stateChangeCh
}

func (pm *ProcessManager) Start(req validation.ProcessStartRequest) error {
	pm.mu.Lock()
	defer pm.mu.Unlock()

	// Check if we already have a running process
	if pm.currentProcess != nil {
		status := pm.currentProcess.GetInfo()
		if status.State == ProcessStateRunning {
			return ErrAlreadyRunning
		}
		if status.State == ProcessStateStarting {
			return ErrAlreadyStarting
		}
	}

	// Clear the "was healthy before idle" flag on start
	// It will be re-evaluated on the next idle stop
	pm.wasHealthyBeforeIdle.Store(false)

	// Create new managed process
	managedProcess, err := NewManagedProcess(req)
	if err != nil {
		return err
	}

	// Set state change callback to broadcast state changes
	pm.attachStateChangeBroadcast(managedProcess)

	// Start the managed process
	if err := managedProcess.Start(pm.logMgr, pm.pid1Mgr, pm.enableLogging, pm.outputToStructuredLog); err != nil {
		return err
	}

	// Replace current process
	pm.currentProcess = managedProcess

	// Broadcast state change to wake up any waiters
	pm.broadcastStateChangeLocked()

	// Start health monitoring if configured
	pm.healthMon.Start(func() error {
		return pm.restartProcess()
	})

	// Restart idle monitoring if start-on-request is enabled and monitor is not running
	if pm.startOnRequestEnabled && pm.idleMonitorCancel == nil {
		ctx, cancel := context.WithCancel(context.Background())
		pm.idleMonitorCancel = cancel
		pm.UpdateActivity() // Reset activity timer
		go pm.idleMonitorLoop(ctx, pm.idleCheckInterval)
		slog.Debug("idle_monitor.restarted_on_process_start")
	}

	return nil
}

func (pm *ProcessManager) Stop(req ProcessStopRequest) error {
	pm.mu.Lock()
	defer pm.mu.Unlock()

	if pm.currentProcess == nil {
		return errors.New("no process is running")
	}

	status := pm.currentProcess.GetInfo()
	if status.State != ProcessStateRunning {
		return fmt.Errorf("process is not running (current state: %s)", status.State)
	}

	// Clear the "was healthy before idle" flag on explicit stop
	// This is not an idle stop, so the app should report unhealthy
	pm.wasHealthyBeforeIdle.Store(false)

	// Stop idle monitoring if enabled
	// Note: We check and cancel within the lock to prevent race conditions
	// The idle monitor goroutine will exit cleanly when context is canceled
	if pm.idleMonitorCancel != nil {
		pm.idleMonitorCancel()
		pm.idleMonitorCancel = nil
		slog.Debug("idle_monitor.stopped_on_process_stop")
	}

	// Stop health monitoring
	pm.healthMon.Stop()

	// Stop the managed process
	err := pm.currentProcess.Stop(req.Signal, req.Timeout)

	// Broadcast state change to wake up any waiters
	pm.broadcastStateChangeLocked()

	return err
}

// stopForIdle stops the process due to idle timeout and sets wasHealthyBeforeIdle.
// This is an internal method used by checkIdleAndStop. It sets the "was healthy before idle"
// flag on successful stop, allowing health checks to report "healthy" for idled apps.
// The flag is set while holding the lock to prevent race conditions with concurrent Start().
func (pm *ProcessManager) stopForIdle() error {
	pm.mu.Lock()
	defer pm.mu.Unlock()

	if pm.currentProcess == nil {
		return errors.New("no process is running")
	}

	status := pm.currentProcess.GetInfo()
	if status.State != ProcessStateRunning {
		return fmt.Errorf("process is not running (current state: %s)", status.State)
	}

	// Stop idle monitoring if enabled
	if pm.idleMonitorCancel != nil {
		pm.idleMonitorCancel()
		pm.idleMonitorCancel = nil
		slog.Debug("idle_monitor.stopped_on_idle_stop")
	}

	// Stop health monitoring
	pm.healthMon.Stop()

	// Stop the managed process
	err := pm.currentProcess.Stop("SIGTERM", 30)
	if err == nil {
		// Set wasHealthyBeforeIdle ONLY on successful stop, while still holding the lock.
		// This prevents race conditions where a concurrent Start() could set the flag to false
		// after we release the lock but before we set it to true.
		// Note: We assume a running process is healthy. If the health monitor is configured
		// and the process was unhealthy, the health monitor would have restarted the process
		// before idle timeout triggers.
		pm.wasHealthyBeforeIdle.Store(true)
	}

	// Broadcast state change to wake up any waiters
	pm.broadcastStateChangeLocked()

	return err
}

func (pm *ProcessManager) Restart(req ProcessRestartRequest) error {
	pm.mu.Lock()
	defer pm.mu.Unlock()

	// Check if we have a current process to get config from
	if pm.currentProcess == nil {
		slog.Error("restart failed: no process to restart",
			"restart_count", pm.restartCount)
		return errors.New("no previous process to restart")
	}

	// Clear the "was healthy before idle" flag on restart
	// A restart is not an idle stop, so we reset the state
	pm.wasHealthyBeforeIdle.Store(false)

	currentStatus := pm.currentProcess.GetInfo()
	slog.Info("restarting process",
		"graceful", req.Graceful,
		"old_pid", currentStatus.PID,
		"command", currentStatus.Command)

	// Get the configuration from the current process
	config := pm.currentProcess.config

	// Get ports using the safest approach: explicit config first, then runtime discovery
	ports := pm.discoverProcessPorts(config)

	// Stop current process if running (recheck status)
	if currentStatus.State == ProcessStateRunning {
		if err := pm.stopProcessForRestart(req, currentStatus, ports); err != nil {
			return err
		}
	}

	// Create and start a completely new managed process with the same config
	slog.Info("starting new process", "command", config.Command, "working_dir", config.WorkingDir)

	managedProcess, err := NewManagedProcess(config)
	if err != nil {
		return err
	}

	// Set state change callback to broadcast state changes
	pm.attachStateChangeBroadcast(managedProcess)

	if err := managedProcess.Start(pm.logMgr, pm.pid1Mgr, pm.enableLogging, pm.outputToStructuredLog); err != nil {
		slog.Error("failed to start new process", "error", err)
		return err
	}

	// Replace current process
	pm.currentProcess = managedProcess
	pm.restartCount++

	newInfo := managedProcess.GetInfo()
	slog.Info("restart completed",
		"new_pid", newInfo.PID,
		"command", config.Command,
		"working_dir", config.WorkingDir,
		"restart_count", pm.restartCount)

	// Broadcast state change to wake up any waiters
	pm.broadcastStateChangeLocked()

	// Start health monitoring again if configured
	pm.healthMon.Start(func() error {
		return pm.restartProcess()
	})

	// Restart idle monitoring if start-on-request is enabled
	if pm.startOnRequestEnabled && pm.idleMonitorCancel == nil {
		ctx, cancel := context.WithCancel(context.Background())
		pm.idleMonitorCancel = cancel
		pm.UpdateActivity() // Reset activity timer
		go pm.idleMonitorLoop(ctx, pm.idleCheckInterval)
		slog.Debug("idle_monitor.restarted_after_restart")
	}

	return nil
}

func (pm *ProcessManager) GetStatus() ProcessInfo {
	pm.mu.RLock()
	defer pm.mu.RUnlock()

	if pm.currentProcess == nil {
		return ProcessInfo{
			State: ProcessStateStopped,
		}
	}

	return pm.currentProcess.GetInfo()
}

func (pm *ProcessManager) restartProcess() error {
	// Use the public Restart method with graceful shutdown
	return pm.Restart(ProcessRestartRequest{Graceful: true})
}

func (pm *ProcessManager) ConfigureHealthCheck(healthCheck *health.HealthCheck, restartPolicy *health.RestartPolicy) {
	pm.mu.Lock()
	defer pm.mu.Unlock()
	pm.healthMon.Configure(healthCheck, restartPolicy)
}

func (pm *ProcessManager) GetHealthStatus() health.HealthResult {
	return pm.healthMon.GetStatus()
}

func (pm *ProcessManager) GetRestartStats() map[string]any {
	pm.mu.RLock()
	defer pm.mu.RUnlock()

	stats := pm.healthMon.GetRestartStats()
	stats["manual_restarts"] = pm.restartCount
	return stats
}

func (pm *ProcessManager) StopAllProcesses() {
	pm.mu.Lock()

	// Stop idle monitor if running
	if pm.idleMonitorCancel != nil {
		pm.idleMonitorCancel()
		pm.idleMonitorCancel = nil
	}

	if pm.currentProcess == nil {
		pm.mu.Unlock()
		return
	}

	status := pm.currentProcess.GetInfo()
	if status.State != ProcessStateRunning {
		pm.mu.Unlock()
		return
	}

	// Stop health monitoring first
	pm.healthMon.Stop()

	// Get a reference to the process before unlocking
	process := pm.currentProcess

	// Unlock BEFORE calling Stop() to prevent deadlock
	// The Stop() method already handles waiting with timeout
	pm.mu.Unlock()

	// Stop the current process with SIGTERM and 10 second timeout
	stopReq := ProcessStopRequest{
		Signal:  "SIGTERM",
		Timeout: 10,
	}
	if err := process.Stop(stopReq.Signal, stopReq.Timeout); err != nil {
		slog.Error("failed to stop process during cleanup", "error", err, "signal", stopReq.Signal)
	}

	// Broadcast state change after stop completes
	pm.mu.Lock()
	pm.broadcastStateChangeLocked()
	pm.mu.Unlock()

	// The Stop() method already waits with timeout, so no need to call WaitForCompletion()
	// which could block indefinitely. The process will clean up asynchronously.
}

// attachStateChangeBroadcast sets up the state change callback for a managed process.
// Centralizes the callback wiring to ensure consistent locking behavior.
func (pm *ProcessManager) attachStateChangeBroadcast(mp *ManagedProcess) {
	mp.onStateChange = func() {
		pm.mu.Lock()
		defer pm.mu.Unlock()
		pm.broadcastStateChangeLocked()
	}
}

// GetStartRequest returns the current process start request for auto-restart.
// Priority: 1) Running process config, 2) Saved start request, 3) nil
// Returns a defensive copy to prevent caller mutation.
func (pm *ProcessManager) GetStartRequest() *validation.ProcessStartRequest {
	pm.mu.RLock()
	defer pm.mu.RUnlock()

	var source *validation.ProcessStartRequest

	// Priority 1: Running process config (takes precedence)
	if pm.currentProcess != nil {
		source = &pm.currentProcess.config
	} else if pm.savedStartRequest != nil {
		// Priority 2: Saved start request (deferred start mode)
		source = pm.savedStartRequest
	} else {
		return nil
	}

	// Return defensive copy to prevent caller mutation
	envCopy := make(map[string]string, len(source.Env))
	maps.Copy(envCopy, source.Env)

	return &validation.ProcessStartRequest{
		Command:    source.Command,
		Env:        envCopy,
		WorkingDir: source.WorkingDir,
		Ports:      append([]int{}, source.Ports...),
	}
}

// SetStartRequest saves a start request for deferred startup
func (pm *ProcessManager) SetStartRequest(req validation.ProcessStartRequest) {
	pm.mu.Lock()
	defer pm.mu.Unlock()

	// Deep copy to prevent external mutation
	envCopy := make(map[string]string, len(req.Env))
	maps.Copy(envCopy, req.Env)

	pm.savedStartRequest = &validation.ProcessStartRequest{
		Command:    req.Command,
		Env:        envCopy,
		WorkingDir: req.WorkingDir,
		Ports:      append([]int{}, req.Ports...),
	}

	slog.Info("process.start_request.saved",
		"command", req.Command,
		"working_dir", req.WorkingDir)
}

// SetProcessLogging enables or disables child process stdout/stderr logging
func (pm *ProcessManager) SetProcessLogging(enabled bool) {
	pm.mu.Lock()
	defer pm.mu.Unlock()
	pm.enableLogging = enabled
}

// GetProcessLogging returns the current process logging configuration
func (pm *ProcessManager) GetProcessLogging() bool {
	pm.mu.RLock()
	defer pm.mu.RUnlock()
	return pm.enableLogging
}

// SetStructuredLogging enables or disables child process output to structured logging
func (pm *ProcessManager) SetStructuredLogging(enabled bool) {
	pm.mu.Lock()
	defer pm.mu.Unlock()
	pm.outputToStructuredLog = enabled
}

// GetStructuredLogging returns the current structured logging configuration
func (pm *ProcessManager) GetStructuredLogging() bool {
	pm.mu.RLock()
	defer pm.mu.RUnlock()
	return pm.outputToStructuredLog
}

func (pm *ProcessManager) discoverProcessPorts(config validation.ProcessStartRequest) []int {
	// Option 1: Use explicitly configured ports (safest)
	if len(config.Ports) > 0 {
		slog.Info("using explicitly configured ports", "ports", config.Ports)
		return config.Ports
	}

	// Option 2: Runtime discovery via /proc/net/tcp (safer than command parsing)
	processInfo := pm.currentProcess.GetInfo()
	if processInfo.PID <= 0 {
		return nil
	}

	ports, err := pm.portDiscovery.GetProcessPorts(processInfo.PID)
	if err != nil {
		slog.Warn("failed to discover process ports", "pid", processInfo.PID, "error", err)
		return nil
	}

	if len(ports) > 0 {
		slog.Info("discovered ports in use by process", "pid", processInfo.PID, "ports", ports)
	}
	return ports
}

// stopProcessForRestart stops the current process in preparation for restart
func (pm *ProcessManager) stopProcessForRestart(
	req ProcessRestartRequest, currentStatus ProcessInfo, ports []int,
) error {
	stopReq := ProcessStopRequest{
		Signal:  "SIGTERM",
		Timeout: 30,
	}
	if !req.Graceful {
		stopReq.Signal = "SIGKILL"
		stopReq.Timeout = 5
	}

	slog.Info("stopping process",
		"signal", stopReq.Signal,
		"timeout_seconds", stopReq.Timeout,
		"pid", currentStatus.PID)

	// Stop idle monitoring if enabled
	if pm.idleMonitorCancel != nil {
		pm.idleMonitorCancel()
		pm.idleMonitorCancel = nil
		slog.Debug("idle_monitor.stopped_on_restart")
	}

	// Stop health monitoring
	pm.healthMon.Stop()

	// Stop the current process
	if err := pm.currentProcess.Stop(stopReq.Signal, stopReq.Timeout); err != nil {
		return fmt.Errorf("failed to stop process for restart: %w", err)
	}

	// Wait for the process to fully stop
	pm.currentProcess.WaitForCompletion()

	// Wait for ports to become available after process termination
	// This prevents "address already in use" errors during restart
	if len(ports) > 0 {
		if err := waitForPortsAvailable(ports, defaultPortWaitTimeout); err != nil {
			slog.Warn("port availability timeout during restart", "ports", ports, "error", err)
			// Continue with restart despite port wait timeout - the new process start will fail if ports are still in use
		}
	}

	return nil
}

// Compile-time interface verification
// Ensures ProcessManager implements middleware.WebSocketTracker interface
var _ middleware.WebSocketTracker = (*ProcessManager)(nil)
