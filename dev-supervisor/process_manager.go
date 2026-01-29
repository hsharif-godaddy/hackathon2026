package main

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"os"
	"os/exec"
	"sync"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/airo-ai-builder/dev-supervisor/internal/config"
)

type ProcessState string

const (
	ProcessStateStopped  ProcessState = "stopped"
	ProcessStateStarting ProcessState = "starting"
	ProcessStateRunning  ProcessState = "running"
	ProcessStateStopping ProcessState = "stopping"
	ProcessStateError    ProcessState = "error"
)

const (
	defaultPortWaitTimeout = 10 * time.Second
	portCheckInterval      = 50 * time.Millisecond
)

// Sentinel errors for process state checks
var (
	ErrAlreadyStarting = errors.New("process is already starting")
	ErrAlreadyRunning  = errors.New("process is already running")
)

type ProcessInfo struct {
	PID       int          `json:"pid"`
	Command   string       `json:"command"`
	State     ProcessState `json:"state"`
	StartTime time.Time    `json:"start_time"`
	ExitCode  *int         `json:"exit_code,omitempty"`
	Error     string       `json:"error,omitempty"`
}

type ProcessStartRequest struct {
	Command    string            `json:"command"`
	Env        map[string]string `json:"env,omitempty"`
	WorkingDir string            `json:"working_dir,omitempty"`
	Ports      []int             `json:"ports,omitempty"` // Explicit port specification
}

type ProcessStopRequest struct {
	Signal  string `json:"signal,omitempty"`
	Timeout int    `json:"timeout,omitempty"`
}

type ProcessRestartRequest struct {
	Graceful bool `json:"graceful,omitempty"`
}

// ManagedProcess represents a single process instance with its own lifecycle
type ManagedProcess struct {
	cmd       *exec.Cmd
	ctx       context.Context
	cancel    context.CancelFunc
	info      ProcessInfo
	infoMu    sync.RWMutex // Protects info field
	startTime time.Time
	config    ProcessStartRequest
	done      chan struct{} // Signals when process cleanup is complete

	// Synchronization for cmd.Wait()
	waitOnce sync.Once
	waitErr  error
	waitDone chan struct{}

	usePID1Wait    bool
	externalWaitCh chan error
}

// isPortAvailable checks if a port is available for binding (i.e., not in use)
func isPortAvailable(port int) bool {
	// Try to bind to 0.0.0.0 (all interfaces) to check if port is truly available
	// This matches how servers typically bind and will fail if anything is using the port
	listener, err := net.Listen("tcp", fmt.Sprintf(":%d", port))
	if err != nil {
		// Can't bind - port is still in use
		return false
	}
	// Successfully bound - port is available, close immediately
	listener.Close()
	return true
}

// waitForPortsAvailable waits for the specified ports to become available
func waitForPortsAvailable(ports []int, timeout time.Duration) error {
	if len(ports) == 0 {
		return nil // No ports to wait for
	}

	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	ticker := time.NewTicker(portCheckInterval)
	defer ticker.Stop()

	slog.Info("waiting for ports to become available", "ports", ports, "timeout", timeout)

	for {
		select {
		case <-ctx.Done():
			return fmt.Errorf("timeout waiting for ports %v to become available after %v", ports, timeout)
		case <-ticker.C:
			allAvailable := true
			for _, port := range ports {
				if !isPortAvailable(port) {
					allAvailable = false
					break
				}
			}
			if allAvailable {
				slog.Info("all ports now available", "ports", ports)
				return nil
			}
		}
	}
}

// ProcessManager manages the current process instance and persistent configuration
type ProcessManager struct {
	mu                    sync.RWMutex
	currentProcess        *ManagedProcess // nil when no process running
	logMgr                *LogManager
	healthMon             *HealthMonitor
	pid1Mgr               *PID1Manager
	portDiscovery         PortDiscovery
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
}

func NewProcessManager(logMgr *LogManager, pid1Mgr *PID1Manager) *ProcessManager {
	return &ProcessManager{
		logMgr:                logMgr,
		pid1Mgr:               pid1Mgr,
		portDiscovery:         NewPortDiscovery(),
		healthMon:             NewHealthMonitor(logMgr),
		enableLogging:         true,                               // Default: enable child process logging
		outputToStructuredLog: config.GetProcessLoggingToStdout(), // Default: enable structured logging output, configurable via env
	}
}

// NewManagedProcess creates a new process instance
func NewManagedProcess(config ProcessStartRequest) (*ManagedProcess, error) {
	if config.Command == "" {
		return nil, fmt.Errorf("command is required")
	}

	ctx, cancel := context.WithCancel(context.Background())
	//nolint:gosec // G204: Command execution is the intended functionality for process management
	// nosemgrep: go.lang.security.audit.dangerous-exec-command.dangerous-exec-command
	process := exec.CommandContext(ctx, "sh", "-c", config.Command)

	// Set working directory
	if config.WorkingDir != "" {
		process.Dir = config.WorkingDir
	} else {
		if currentDir, err := os.Getwd(); err == nil {
			process.Dir = currentDir
		} else {
			process.Dir = defaultTmpDir
		}
	}

	// Set environment variables
	env := os.Environ()
	for key, value := range config.Env {
		env = append(env, fmt.Sprintf("%s=%s", key, value))
	}
	process.Env = env

	return &ManagedProcess{
		cmd:       process,
		ctx:       ctx,
		cancel:    cancel,
		config:    config,
		startTime: time.Now(),
		info: ProcessInfo{
			Command:   config.Command,
			State:     ProcessStateStarting,
			StartTime: time.Now(),
		},
		done:           make(chan struct{}),
		waitDone:       make(chan struct{}),
		externalWaitCh: make(chan error, 1),
	}, nil
}

// Start starts the managed process and begins monitoring it
func (mp *ManagedProcess) Start(logMgr *LogManager, pid1Mgr *PID1Manager, enableLogging bool, outputToStructuredLog bool) error {
	// Set up pipes for stdout and stderr
	stdout, err := mp.cmd.StdoutPipe()
	if err != nil {
		return fmt.Errorf("failed to create stdout pipe: %w", err)
	}

	stderr, err := mp.cmd.StderrPipe()
	if err != nil {
		return fmt.Errorf("failed to create stderr pipe: %w", err)
	}

	// Start the process
	if err := mp.cmd.Start(); err != nil {
		mp.infoMu.Lock()
		mp.info.State = ProcessStateError
		mp.info.Error = err.Error()
		mp.infoMu.Unlock()
		return fmt.Errorf("failed to start process: %w", err)
	}

	mp.infoMu.Lock()
	mp.info.PID = mp.cmd.Process.Pid
	mp.info.State = ProcessStateRunning
	mp.infoMu.Unlock()

	// Register with PID 1 manager (may take ownership of Wait())
	if pid1Mgr != nil {
		mp.usePID1Wait = pid1Mgr.RegisterChildProcess(mp.cmd.Process, mp)
	}

	// Start log streaming if enabled
	if logMgr != nil && enableLogging {
		go mp.streamLogs(logMgr, stdout, "stdout", outputToStructuredLog)
		go mp.streamLogs(logMgr, stderr, "stderr", outputToStructuredLog)
	}

	// Wait for process completion in background
	go mp.waitForCompletion(pid1Mgr)

	return nil
}

// Stop gracefully stops the managed process
func (mp *ManagedProcess) Stop(signal string, timeout int) error {
	mp.infoMu.Lock()
	if mp.info.State != ProcessStateRunning {
		currentState := mp.info.State
		mp.infoMu.Unlock()
		return fmt.Errorf("process is not running (current state: %s)", currentState)
	}

	mp.info.State = ProcessStateStopping
	mp.infoMu.Unlock()

	sig := syscall.SIGTERM
	if signal != "" {
		switch signal {
		case "SIGTERM":
			sig = syscall.SIGTERM
		case "SIGINT":
			sig = syscall.SIGINT
		case "SIGKILL":
			sig = syscall.SIGKILL
		default:
			return fmt.Errorf("unsupported signal: %s", signal)
		}
	}

	timeoutDuration := 30 * time.Second
	if timeout > 0 {
		timeoutDuration = time.Duration(timeout) * time.Second
	}

	// Send signal to process
	if err := mp.cmd.Process.Signal(sig); err != nil {
		return fmt.Errorf("failed to send signal: %w", err)
	}

	// Wait for process to exit with timeout
	done := make(chan error, 1)
	go func() {
		done <- mp.safeWait()
	}()

	select {
	case err := <-done:
		// For gracefully terminated processes, we don't treat the signal as an error
		mp.infoMu.Lock()
		defer mp.infoMu.Unlock()

		mp.info.State = ProcessStateStopped
		if err != nil {
			expected, exitCode := isExpectedSignalExit(err)
			mp.info.ExitCode = exitCode

			// Log the exit status
			if expected {
				if exitCode != nil {
					slog.Info("process stopped",
						slog.GroupAttrs("process_exit",
							slog.Int("exit_code", *exitCode),
							slog.Bool("expected", true),
						),
					)
				} else {
					slog.Info("process stopped",
						slog.GroupAttrs("process_exit",
							slog.Bool("expected", true),
							slog.String("note", "no exit code available"),
						),
					)
				}
			} else {
				if exitCode != nil {
					slog.Warn("process stopped with unexpected exit code",
						slog.GroupAttrs("process_exit",
							slog.Int("exit_code", *exitCode),
							slog.Bool("expected", false),
						),
						slog.String("error", err.Error()),
					)
				} else {
					slog.Warn("process stopped with unexpected error",
						slog.GroupAttrs("process_exit",
							slog.Bool("expected", false),
						),
						slog.String("error", err.Error()),
					)
				}
				mp.info.State = ProcessStateError
				mp.info.Error = err.Error()
				return err
			}
		} else {
			code := 0
			mp.info.ExitCode = &code
			slog.Info("process stopped cleanly",
				slog.GroupAttrs("process_exit",
					slog.Int("exit_code", 0),
					slog.Bool("expected", true),
				),
			)
		}
		return nil
	case <-time.After(timeoutDuration):
		// Force kill if timeout exceeded
		if err := mp.cmd.Process.Kill(); err != nil {
			return fmt.Errorf("failed to force kill process: %w", err)
		}
		mp.infoMu.Lock()
		defer mp.infoMu.Unlock()
		mp.info.State = ProcessStateStopped
		return nil
	}
}

// WaitForCompletion waits for the process to complete and returns when cleanup is done
func (mp *ManagedProcess) WaitForCompletion() {
	<-mp.done
}

func (mp *ManagedProcess) notifyPID1WaitResult(err error) {
	mp.externalWaitCh <- err
}

// GetInfo returns the current process information
func (mp *ManagedProcess) GetInfo() ProcessInfo {
	mp.infoMu.RLock()
	defer mp.infoMu.RUnlock()
	return mp.info
}

// safeWait ensures that cmd.Wait() is only called once, even from multiple goroutines
func (mp *ManagedProcess) safeWait() error {
	mp.waitOnce.Do(func() {
		mp.waitErr = mp.cmd.Wait()
		close(mp.waitDone)
	})

	// Wait for the Wait() call to complete if it's happening in another goroutine
	<-mp.waitDone
	return mp.waitErr
}

// waitForCompletion handles process completion and cleanup
func (mp *ManagedProcess) waitForCompletion(pid1Mgr *PID1Manager) {
	defer close(mp.done) // Signal completion when this function exits

	var err error
	if mp.usePID1Wait {
		err = <-mp.externalWaitCh
	} else {
		err = mp.safeWait()
	}

	mp.infoMu.Lock()
	expected, exitCode := isExpectedSignalExit(err)
	mp.info.ExitCode = exitCode

	if expected {
		mp.info.State = ProcessStateStopped
	} else {
		// Unexpected error - set state to error
		mp.info.State = ProcessStateError
		if err != nil {
			mp.info.Error = err.Error()
		}
	}
	mp.infoMu.Unlock()

	// Unregister from PID 1 manager when we owned the wait. For PID 1-managed
	// processes the manager's watcher handles removal after safeWait returns.
	if pid1Mgr != nil && !mp.usePID1Wait {
		pid1Mgr.UnregisterChildProcess(mp.cmd.Process.Pid)
	}

	// Cancel context
	if mp.cancel != nil {
		mp.cancel()
	}
}

// streamLogs streams process output to the log manager and optionally to structured logging
func (mp *ManagedProcess) streamLogs(logMgr *LogManager, reader io.Reader, source string, outputToStructuredLog bool) {
	// Cache PID and command values once to avoid mutex contention on every log line
	var cachedPID int
	var cachedCommand string
	if outputToStructuredLog {
		mp.infoMu.RLock()
		cachedPID = mp.info.PID
		cachedCommand = mp.config.Command
		mp.infoMu.RUnlock()
	}

	scanner := bufio.NewScanner(reader)
	for scanner.Scan() {
		line := scanner.Text()

		// Always add to LogManager for API access
		logMgr.AddLog(LogEntry{
			Timestamp: time.Now(),
			Source:    source,
			Message:   line,
		})

		// Optionally output to structured logging for Docker logs
		if outputToStructuredLog {
			slog.Info("child process output",
				"pid", cachedPID,
				"command", cachedCommand,
				"source", source,
				"message", line)
		}
	}
}

func (pm *ProcessManager) Start(req ProcessStartRequest) error {
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

	// Create new managed process
	managedProcess, err := NewManagedProcess(req)
	if err != nil {
		return err
	}

	// Start the managed process
	if err := managedProcess.Start(pm.logMgr, pm.pid1Mgr, pm.enableLogging, pm.outputToStructuredLog); err != nil {
		return err
	}

	// Replace current process
	pm.currentProcess = managedProcess

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
		return fmt.Errorf("no process is running")
	}

	status := pm.currentProcess.GetInfo()
	if status.State != ProcessStateRunning {
		return fmt.Errorf("process is not running (current state: %s)", status.State)
	}

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
	return pm.currentProcess.Stop(req.Signal, req.Timeout)
}

func (pm *ProcessManager) Restart(req ProcessRestartRequest) error {
	pm.mu.Lock()
	defer pm.mu.Unlock()

	// Check if we have a current process to get config from
	if pm.currentProcess == nil {
		slog.Error("restart failed: no process to restart",
			"restart_count", pm.restartCount)
		return fmt.Errorf("no previous process to restart")
	}

	currentStatus := pm.currentProcess.GetInfo()
	slog.Info("restarting process",
		"graceful", req.Graceful,
		"old_pid", currentStatus.PID,
		"command", currentStatus.Command)

	// Get the configuration from the current process
	config := pm.currentProcess.config

	// Get ports using the safest approach: explicit config first, then runtime discovery
	var ports []int

	// Option 1: Use explicitly configured ports (safest)
	if len(config.Ports) > 0 {
		ports = config.Ports
		slog.Info("using explicitly configured ports", "ports", ports)
	} else {
		// Option 2: Runtime discovery via /proc/net/tcp (safer than command parsing)
		processInfo := pm.currentProcess.GetInfo()
		if processInfo.PID > 0 {
			var err error
			ports, err = pm.portDiscovery.GetProcessPorts(processInfo.PID)
			if err != nil {
				slog.Warn("failed to discover process ports", "pid", processInfo.PID, "error", err)
				// No ports to wait for - continue with restart
				ports = nil
			} else if len(ports) > 0 {
				slog.Info("discovered ports in use by process", "pid", processInfo.PID, "ports", ports)
			}
		}
	}

	// Stop current process if running (recheck status)
	if currentStatus.State == ProcessStateRunning {
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
	}

	// Create and start a completely new managed process with the same config
	slog.Info("starting new process", "command", config.Command, "working_dir", config.WorkingDir)

	managedProcess, err := NewManagedProcess(config)
	if err != nil {
		return err
	}

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

func (pm *ProcessManager) ConfigureHealthCheck(healthCheck *HealthCheck, restartPolicy *RestartPolicy) {
	pm.mu.Lock()
	defer pm.mu.Unlock()
	pm.healthMon.Configure(healthCheck, restartPolicy)
}

func (pm *ProcessManager) GetHealthStatus() HealthResult {
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

	// The Stop() method already waits with timeout, so no need to call WaitForCompletion()
	// which could block indefinitely. The process will clean up asynchronously.
}

// GetStartRequest returns the current process start request for auto-restart
func (pm *ProcessManager) GetStartRequest() *ProcessStartRequest {
	pm.mu.RLock()
	defer pm.mu.RUnlock()

	if pm.currentProcess != nil {
		return &pm.currentProcess.config
	}

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

// EnableStartOnRequest enables start-on-request functionality with idle monitoring
// Parameters must satisfy: idleTimeout > 0, checkInterval > 0, checkInterval < idleTimeout
func (pm *ProcessManager) EnableStartOnRequest(idleTimeout, checkInterval time.Duration) {
	pm.mu.Lock()
	defer pm.mu.Unlock()

	// Validate parameters
	if idleTimeout <= 0 {
		slog.Error("start_on_request.invalid_idle_timeout",
			"idle_timeout", idleTimeout,
			"message", "idle timeout must be positive")
		return
	}
	if checkInterval <= 0 {
		slog.Error("start_on_request.invalid_check_interval",
			"check_interval", checkInterval,
			"message", "check interval must be positive")
		return
	}
	if checkInterval >= idleTimeout {
		slog.Warn("start_on_request.check_interval_too_large",
			"check_interval", checkInterval,
			"idle_timeout", idleTimeout,
			"message", "check interval should be less than idle timeout for efficient detection")
		// Continue anyway - not a fatal error
	}

	// Cancel existing monitor if running (defensive - shouldn't happen in practice)
	if pm.idleMonitorCancel != nil {
		slog.Warn("start_on_request.already_enabled", "message", "canceling existing monitor")
		pm.idleMonitorCancel()
		pm.idleMonitorCancel = nil
	}

	pm.startOnRequestEnabled = true
	pm.idleTimeout = idleTimeout
	pm.idleCheckInterval = checkInterval
	pm.UpdateActivity() // Initialize to now

	ctx, cancel := context.WithCancel(context.Background())
	pm.idleMonitorCancel = cancel

	slog.Info("start_on_request.enabled",
		"idle_timeout", idleTimeout,
		"check_interval", checkInterval)

	go pm.idleMonitorLoop(ctx, checkInterval)
}

// UpdateActivity updates the last activity timestamp
func (pm *ProcessManager) UpdateActivity() {
	pm.lastActivityTime.Store(time.Now())
}

// TrackRequest increments the in-flight request counter
// Acquires mutex to coordinate with idle shutdown checks
func (pm *ProcessManager) TrackRequest() {
	pm.mu.Lock()
	pm.inFlightRequests.Add(1)
	pm.mu.Unlock()
}

// UntrackRequest decrements the in-flight request counter and updates activity
func (pm *ProcessManager) UntrackRequest() {
	pm.inFlightRequests.Add(-1)
	pm.UpdateActivity()
}

// RegisterWebSocket registers an active WebSocket connection
func (pm *ProcessManager) RegisterWebSocket(conn net.Conn) {
	pm.activeWebSockets.Store(conn, true)
	slog.Debug("websocket.registered", "remote_addr", conn.RemoteAddr())
}

// UnregisterWebSocket unregisters a WebSocket connection when it closes
func (pm *ProcessManager) UnregisterWebSocket(conn net.Conn) {
	pm.activeWebSockets.Delete(conn)
	slog.Debug("websocket.unregistered", "remote_addr", conn.RemoteAddr())
}

// IsIdleMonitorRunning returns true if the idle monitor is currently running
func (pm *ProcessManager) IsIdleMonitorRunning() bool {
	pm.mu.RLock()
	defer pm.mu.RUnlock()
	return pm.idleMonitorCancel != nil
}

// GetIdleTimeout returns the configured idle timeout duration
func (pm *ProcessManager) GetIdleTimeout() time.Duration {
	pm.mu.RLock()
	defer pm.mu.RUnlock()
	return pm.idleTimeout
}

// GetIdleCheckInterval returns the configured idle check interval duration
func (pm *ProcessManager) GetIdleCheckInterval() time.Duration {
	pm.mu.RLock()
	defer pm.mu.RUnlock()
	return pm.idleCheckInterval
}

// IsStartOnRequestEnabled returns true if start-on-request is enabled
func (pm *ProcessManager) IsStartOnRequestEnabled() bool {
	pm.mu.RLock()
	defer pm.mu.RUnlock()
	return pm.startOnRequestEnabled
}

// StopIdleMonitor stops the idle monitoring goroutine
func (pm *ProcessManager) StopIdleMonitor() {
	pm.mu.Lock()
	defer pm.mu.Unlock()

	if pm.idleMonitorCancel != nil {
		pm.idleMonitorCancel()
		pm.idleMonitorCancel = nil
		slog.Info("idle_monitor.stopped")
	}
}

// idleMonitorLoop periodically checks for idle timeout and stops the process
func (pm *ProcessManager) idleMonitorLoop(ctx context.Context, checkInterval time.Duration) {
	ticker := time.NewTicker(checkInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			pm.checkIdleAndStop()
		}
	}
}

// checkIdleAndStop checks if the process has been idle too long and stops it
// This function is called periodically by the idle monitor goroutine
func (pm *ProcessManager) checkIdleAndStop() {
	status := pm.GetStatus()
	if status.State != ProcessStateRunning {
		return // Already stopped
	}

	// Check WebSocket connections and idle time atomically to prevent race conditions
	// where a WebSocket connects between the check and the stop call
	pm.mu.Lock()

	// Check if any WebSocket connections are active
	hasActiveWS := false
	pm.activeWebSockets.Range(func(_, _ any) bool {
		hasActiveWS = true
		return false // stop iteration
	})

	// Check if any HTTP requests are in-flight
	inFlight := pm.inFlightRequests.Load()

	if hasActiveWS || inFlight > 0 {
		pm.mu.Unlock()
		slog.Debug("idle.check.has_active_connections",
			"websockets", hasActiveWS,
			"in_flight_requests", inFlight)
		return // Don't stop if WebSockets or requests are active
	}

	// Check idle duration while still holding the lock
	lastActivity, ok := pm.lastActivityTime.Load().(time.Time)
	if !ok {
		pm.mu.Unlock()
		slog.Error("idle.check.type_assertion_failed")
		return
	}
	idleDuration := time.Since(lastActivity)

	if idleDuration <= pm.idleTimeout {
		pm.mu.Unlock()
		return // Not idle long enough
	}

	// Final re-check immediately before stopping to catch late arrivals
	// This prevents race where request starts after initial check but before Stop()
	finalWSCheck := false
	pm.activeWebSockets.Range(func(_, _ any) bool {
		finalWSCheck = true
		return false
	})
	finalInFlight := pm.inFlightRequests.Load()

	if finalWSCheck || finalInFlight > 0 {
		pm.mu.Unlock()
		slog.Debug("idle.check.late_arrival_detected",
			"websockets", finalWSCheck,
			"in_flight_requests", finalInFlight)
		return // New activity arrived, abort shutdown
	}

	// Process is idle and no active connections - proceed with stop
	slog.Info("idle.stopping",
		"idle_duration", idleDuration,
		"threshold", pm.idleTimeout,
		"pid", status.PID)

	// Release lock before calling Stop() to avoid deadlock (Stop acquires the same lock)
	pm.mu.Unlock()

	err := pm.Stop(ProcessStopRequest{
		Signal:  "SIGTERM",
		Timeout: 30,
	})

	if err != nil {
		slog.Error("idle.stop_failed",
			"error", err,
			"pid", status.PID,
			"idle_duration", idleDuration)
	} else {
		slog.Info("idle.stopped",
			"pid", status.PID,
			"uptime", time.Since(status.StartTime))
	}
}
