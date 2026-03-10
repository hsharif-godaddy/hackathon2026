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
//
// Lock Ordering (CRITICAL - to prevent deadlocks):
//  1. lifecycleMu must be acquired BEFORE mu when both are needed
//  2. Never acquire lifecycleMu while holding mu
//  3. Release mu before blocking operations, but keep lifecycleMu held
//
// Example correct pattern:
//
//	pm.lifecycleMu.Lock()
//	pm.mu.Lock()
//	// ... read/write shared state
//	pm.mu.Unlock()
//	// ... blocking operation (process start/stop, port waits)
//	pm.mu.Lock()
//	// ... update state
//	pm.mu.Unlock()
//	pm.lifecycleMu.Unlock()
type ProcessManager struct {
	lifecycleMu           sync.Mutex      // Serializes Start/Stop/Restart operations
	mu                    sync.RWMutex    // Protects shared state
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

	idleStopping atomic.Bool // Guards against stop-in-progress

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

	// Deferred setup fields (mode-based conditional startup)
	deferredSetupScript   string                          // Path to setup script to run on first request
	deferredSetupTimeout  time.Duration                   // Timeout for deferred setup script
	deferredSetupRequest  *validation.ProcessStartRequest // Start request to use after deferred setup
	deferredSetupExecuted atomic.Bool                     // True if deferred setup has been executed
	deferredSetupMutex    sync.Mutex                      // Protects deferred setup execution (idempotency)
	deferredSetupRunning  atomic.Bool                     // True while setup script is executing
	deferredSetupError    atomic.Value                    // stores string; empty = no error
}

// SetupStatus represents the current state of setup script configuration and execution.
type SetupStatus struct {
	SetupConfigured bool    `json:"setup_configured"`
	SetupDeferred   bool    `json:"setup_deferred"`
	SetupExecuted   bool    `json:"setup_executed"`
	SetupRunning    bool    `json:"setup_running"`
	SetupError      *string `json:"setup_error"`
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
	pm.lifecycleMu.Lock()
	defer pm.lifecycleMu.Unlock() // Serialize lifecycle ops

	return pm.startLocked(req)
}

// startLocked is the core start implementation. Caller MUST hold lifecycleMu.
func (pm *ProcessManager) startLocked(req validation.ProcessStartRequest) error {
	pm.mu.Lock()
	// Check if we already have a running process
	if pm.currentProcess != nil {
		status := pm.currentProcess.GetInfo()
		if status.State == ProcessStateRunning {
			pm.mu.Unlock()
			return ErrAlreadyRunning
		}
		if status.State == ProcessStateStarting {
			pm.mu.Unlock()
			return ErrAlreadyStarting
		}
	}

	// Clear the "was healthy before idle" flag on start
	// It will be re-evaluated on the next idle stop
	pm.wasHealthyBeforeIdle.Store(false)

	// Copy logging config to avoid data race with SetProcessLogging/SetStructuredLogging
	enableLogging := pm.enableLogging
	outputToStructuredLog := pm.outputToStructuredLog
	pm.mu.Unlock() // UNLOCK pm.mu before blocking

	// Blocking operations (no pm.mu, but lifecycleMu still held)
	managedProcess, err := NewManagedProcess(req)
	if err != nil {
		return err
	}

	// Set state change callback to broadcast state changes
	pm.attachStateChangeBroadcast(managedProcess)

	// Start the managed process
	if err := managedProcess.Start(pm.logMgr, pm.pid1Mgr, enableLogging, outputToStructuredLog); err != nil {
		return err
	}

	// Re-lock pm.mu for state update
	pm.mu.Lock()
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
	pm.mu.Unlock()

	return nil
}

func (pm *ProcessManager) Stop(req ProcessStopRequest) error {
	pm.lifecycleMu.Lock()
	defer pm.lifecycleMu.Unlock() // Serialize lifecycle ops

	pm.mu.Lock()
	if pm.currentProcess == nil {
		pm.mu.Unlock()
		return errors.New("no process is running")
	}

	status := pm.currentProcess.GetInfo()
	if status.State != ProcessStateRunning {
		pm.mu.Unlock()
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

	process := pm.currentProcess
	pm.mu.Unlock() // UNLOCK pm.mu before blocking

	// Stop the managed process (blocking operation, no pm.mu held)
	err := process.Stop(req.Signal, req.Timeout)

	// Re-lock pm.mu for state update
	pm.mu.Lock()
	// Broadcast state change to wake up any waiters
	pm.broadcastStateChangeLocked()
	pm.mu.Unlock()

	return err
}

// stopForIdle stops the process due to idle timeout and sets wasHealthyBeforeIdle.
// This is an internal method used by checkIdleAndStop. It sets the "was healthy before idle"
// flag on successful stop, allowing health checks to report "healthy" for idled apps.
// The flag is set while holding the lock to prevent race conditions with concurrent Start().
func (pm *ProcessManager) stopForIdle() error {
	// Acquire lifecycleMu to serialize with explicit Stop/Restart operations
	pm.lifecycleMu.Lock()
	defer pm.lifecycleMu.Unlock()

	pm.mu.Lock()
	if pm.currentProcess == nil {
		pm.mu.Unlock()
		return errors.New("no process is running")
	}

	status := pm.currentProcess.GetInfo()
	if status.State != ProcessStateRunning {
		pm.mu.Unlock()
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

	process := pm.currentProcess
	pm.mu.Unlock() // UNLOCK pm.mu before blocking

	// Stop the managed process (blocking operation, no pm.mu held)
	err := process.Stop("SIGTERM", 30)

	// Re-lock pm.mu for state update
	pm.mu.Lock()
	if err == nil {
		// Set wasHealthyBeforeIdle ONLY on successful stop, while holding the lock.
		// This prevents race conditions where a concurrent Start() could set the flag to false
		// after we release the lock but before we set it to true.
		// Note: We assume a running process is healthy. If the health monitor is configured
		// and the process was unhealthy, the health monitor would have restarted the process
		// before idle timeout triggers.
		pm.wasHealthyBeforeIdle.Store(true)
	}

	// Broadcast state change to wake up any waiters
	pm.broadcastStateChangeLocked()
	pm.mu.Unlock()

	return err
}

func (pm *ProcessManager) Restart(req ProcessRestartRequest) error {
	pm.lifecycleMu.Lock()
	defer pm.lifecycleMu.Unlock() // Serialize lifecycle ops

	pm.mu.Lock()
	// Check if we have a current process to get config from.
	// Invariant: currentProcess is never set back to nil after a Stop() — stopped processes
	// retain their ManagedProcess reference. So nil here means no process was ever started
	// (e.g., deferred setup mode where the first HTTP request hasn't arrived yet).
	if pm.currentProcess == nil {
		pm.mu.Unlock()
		// No process ever started — fall back to running deferred setup (if pending)
		// and starting the process from saved configuration.
		return pm.restartFallbackToStart()
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

	// Copy logging config to avoid data race with SetProcessLogging/SetStructuredLogging
	enableLogging := pm.enableLogging
	outputToStructuredLog := pm.outputToStructuredLog
	pm.mu.Unlock() // UNLOCK pm.mu before blocking

	// Stop current process if running (blocking operation, no pm.mu held)
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

	if err := managedProcess.Start(pm.logMgr, pm.pid1Mgr, enableLogging, outputToStructuredLog); err != nil {
		slog.Error("failed to start new process", "error", err)
		return err
	}

	// Re-lock pm.mu for state update
	pm.mu.Lock()
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
	pm.mu.Unlock()

	return nil
}

// restartFallbackToStart handles the case where Restart() is called but no process
// has ever been started. This occurs when deferred setup is configured and the process
// was never triggered (e.g., no HTTP request arrived before the agent called serverRestart).
//
// Caller MUST hold lifecycleMu. This method executes deferred setup if pending,
// retrieves the saved start configuration, and starts the process.
func (pm *ProcessManager) restartFallbackToStart() error {
	// Execute deferred setup if configured and not yet run
	if pm.HasDeferredSetup() {
		slog.Info("restart.executing_deferred_setup",
			"reason", "restart called before first HTTP request")
		if err := pm.ExecuteDeferredSetup(); err != nil {
			return fmt.Errorf("restart: deferred setup failed: %w", err)
		}
	}

	// Get start configuration. After ExecuteDeferredSetup() succeeds, it moves
	// deferredSetupRequest → savedStartRequest, which GetStartRequest() returns.
	startReq := pm.GetStartRequest()
	if startReq == nil {
		slog.Error("restart.no_start_config",
			"restart_count", pm.restartCount)
		return errors.New("no previous process to restart and no start configuration available")
	}

	slog.Info("restart.fallback_to_start",
		"command", startReq.Command,
		"working_dir", startReq.WorkingDir)

	if err := pm.startLocked(*startReq); err != nil {
		return err
	}

	// Increment restartCount for monitoring consistency — this path still
	// represents a user-initiated Restart() call, even though no prior process existed.
	pm.mu.Lock()
	pm.restartCount++
	newInfo := pm.currentProcess.GetInfo()
	slog.Info("restart.fallback_to_start.completed",
		"new_pid", newInfo.PID,
		"command", startReq.Command,
		"working_dir", startReq.WorkingDir,
		"restart_count", pm.restartCount)
	pm.mu.Unlock()

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
	// Acquire lifecycleMu to serialize with other lifecycle operations
	pm.lifecycleMu.Lock()
	defer pm.lifecycleMu.Unlock()

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

// SetDeferredSetup saves setup script and start request for deferred execution on first HTTP request.
// This is used for restart scenarios where setup (file restoration + npm install) should be deferred
// until the first request arrives to minimize resource usage.
func (pm *ProcessManager) SetDeferredSetup(
	setupScript string,
	timeout time.Duration,
	req validation.ProcessStartRequest,
) {
	pm.mu.Lock()
	defer pm.mu.Unlock()

	// Deep copy start request to prevent external mutation
	envCopy := make(map[string]string, len(req.Env))
	maps.Copy(envCopy, req.Env)

	pm.deferredSetupScript = setupScript
	pm.deferredSetupTimeout = timeout
	pm.deferredSetupRequest = &validation.ProcessStartRequest{
		Command:    req.Command,
		Env:        envCopy,
		WorkingDir: req.WorkingDir,
		Ports:      append([]int{}, req.Ports...),
	}
	pm.deferredSetupExecuted.Store(false)

	slog.Info("process.deferred_setup.configured",
		"setup_script", setupScript,
		"timeout", timeout,
		"command", req.Command)
}

// HasDeferredSetup returns true if deferred setup is configured and not yet executed.
func (pm *ProcessManager) HasDeferredSetup() bool {
	pm.mu.RLock()
	defer pm.mu.RUnlock()

	return pm.deferredSetupScript != "" && !pm.deferredSetupExecuted.Load()
}

// GetSetupStatus returns a best-effort snapshot of the current setup configuration and execution state.
// SetupDeferred means "configured but not yet successfully completed" — it remains true while
// setup is actively running (check SetupRunning to distinguish pending vs in-progress).
//
// Note: executed/running/error are atomics written under deferredSetupMutex, not pm.mu,
// so this snapshot can be momentarily stale — acceptable for a status-polling endpoint.
func (pm *ProcessManager) GetSetupStatus() SetupStatus {
	pm.mu.RLock()
	configured := pm.deferredSetupScript != ""
	pm.mu.RUnlock()

	executed := pm.deferredSetupExecuted.Load()

	running := pm.deferredSetupRunning.Load()
	status := SetupStatus{
		SetupConfigured: configured,
		SetupDeferred:   configured && !executed,
		SetupExecuted:   executed,
		SetupRunning:    running,
	}

	if errVal, ok := pm.deferredSetupError.Load().(string); ok && errVal != "" {
		status.SetupError = &errVal
	}

	return status
}

// ExecuteDeferredSetup executes the deferred setup script if configured and not yet executed.
// This is called by the HTTP proxy on the first request to complete setup before starting the process.
// Execution is idempotent - concurrent calls will block and only one will execute the setup.
// If the mutex cannot be acquired within 5 minutes, the request fails to prevent indefinite blocking.
func (pm *ProcessManager) ExecuteDeferredSetup() error {
	// Check if deferred setup is configured (without holding lock)
	pm.mu.RLock()
	setupScript := pm.deferredSetupScript
	timeout := pm.deferredSetupTimeout
	pm.mu.RUnlock()

	if setupScript == "" {
		return errors.New("no deferred setup configured")
	}

	// Acquire mutex for idempotent execution with timeout to prevent indefinite blocking.
	// Use TryLock with timeout instead of goroutine+channel to avoid goroutine leaks.
	// If another goroutine is running setup and it hangs catastrophically (e.g., unkillable
	// zombie process), we want subsequent requests to fail gracefully rather than block forever.
	deadline := time.Now().Add(5 * time.Minute)
	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()

	for {
		if pm.deferredSetupMutex.TryLock() {
			defer pm.deferredSetupMutex.Unlock()
			break // Got the lock
		}

		if time.Now().After(deadline) {
			slog.Error("process.deferred_setup.mutex_timeout", "setup_script", setupScript, "timeout", "5m")
			return errors.New("timed out waiting for deferred setup mutex (another request may be stuck)")
		}

		<-ticker.C // Wait before trying again
	}

	// Check if already executed (within mutex for proper synchronization)
	if pm.deferredSetupExecuted.Load() {
		slog.Debug("process.deferred_setup.already_executed", "setup_script", setupScript)
		return nil
	}

	// Execute setup script
	slog.Info("process.deferred_setup.executing", "setup_script", setupScript, "timeout", timeout)
	pm.deferredSetupRunning.Store(true)
	pm.deferredSetupError.Store("") // Clear previous error
	defer pm.deferredSetupRunning.Store(false)

	if err := RunSetupScriptInternal(setupScript, timeout, pm.pid1Mgr); err != nil {
		pm.deferredSetupError.Store(err.Error())
		slog.Error("process.deferred_setup.failed", "setup_script", setupScript, "error", err)
		return fmt.Errorf("deferred setup failed: %w", err)
	}

	// Mark as executed
	pm.deferredSetupExecuted.Store(true)
	slog.Info("process.deferred_setup.completed", "setup_script", setupScript)

	// Save start request for process start (move from deferred to saved)
	pm.mu.Lock()
	if pm.deferredSetupRequest != nil {
		pm.savedStartRequest = pm.deferredSetupRequest
		slog.Info("process.start_request.saved",
			"command", pm.savedStartRequest.Command,
			"working_dir", pm.savedStartRequest.WorkingDir)
	}
	pm.mu.Unlock()

	return nil
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
// Caller must hold lifecycleMu but must NOT hold pm.mu (method will acquire it as needed)
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

	// Acquire pm.mu to access shared fields
	pm.mu.Lock()
	// Stop idle monitoring if enabled
	if pm.idleMonitorCancel != nil {
		pm.idleMonitorCancel()
		pm.idleMonitorCancel = nil
		slog.Debug("idle_monitor.stopped_on_restart")
	}

	// Stop health monitoring
	pm.healthMon.Stop()

	// Snapshot process reference before unlocking
	process := pm.currentProcess
	pm.mu.Unlock()

	// Stop the current process (blocking operation, no pm.mu held)
	if err := process.Stop(stopReq.Signal, stopReq.Timeout); err != nil {
		return fmt.Errorf("failed to stop process for restart: %w", err)
	}

	// Wait for the process to fully stop
	process.WaitForCompletion()

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
