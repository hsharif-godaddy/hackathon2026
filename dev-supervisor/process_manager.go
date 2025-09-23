package main

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"log/slog"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
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
	defaultPortWaitTimeout = 3 * time.Second
	portCheckInterval     = 50 * time.Millisecond
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
}

// getProcessPorts discovers what ports a process is actually using via /proc/net/tcp
func getProcessPorts(pid int) ([]int, error) {
	if pid <= 0 {
		return nil, fmt.Errorf("invalid PID: %d", pid)
	}
	
	// Read /proc/net/tcp to find listening ports for this process
	tcpFile := "/proc/net/tcp"
	content, err := os.ReadFile(tcpFile)
	if err != nil {
		return nil, fmt.Errorf("failed to read %s: %w", tcpFile, err)
	}
	
	var ports []int
	lines := strings.Split(string(content), "\n")
	
	// Skip header line
	for i, line := range lines {
		if i == 0 || strings.TrimSpace(line) == "" {
			continue
		}
		
		fields := strings.Fields(line)
		if len(fields) < 10 {
			continue
		}
		
		// Check if this entry belongs to our process
		// Field 9 is the inode, we need to check if our PID has this socket
		inode := fields[9]
		if inode == "0" {
			continue
		}
		
		// Check if this process owns this socket by looking in /proc/PID/fd/
		if processOwnsSocket(pid, inode) {
			// Parse the local address (field 1: "address:port" in hex)
			localAddr := fields[1]
			if colonIdx := strings.LastIndex(localAddr, ":"); colonIdx != -1 {
				portHex := localAddr[colonIdx+1:]
				if port, err := strconv.ParseInt(portHex, 16, 32); err == nil && port > 0 {
					ports = append(ports, int(port))
				}
			}
		}
	}
	
	return ports, nil
}

// processOwnsSocket checks if a process owns a socket by examining /proc/PID/fd/
func processOwnsSocket(pid int, inode string) bool {
	fdDir := fmt.Sprintf("/proc/%d/fd", pid)
	entries, err := os.ReadDir(fdDir)
	if err != nil {
		return false
	}
	
	targetLink := fmt.Sprintf("socket:[%s]", inode)
	
	for _, entry := range entries {
		linkPath := filepath.Join(fdDir, entry.Name())
		if target, err := os.Readlink(linkPath); err == nil {
			if target == targetLink {
				return true
			}
		}
	}
	
	return false
}

// isPortAvailable checks if a port is available for binding
func isPortAvailable(port int) bool {
	// Try to bind to the port on both TCP and UDP to ensure it's fully available
	tcpAddr, err := net.ResolveTCPAddr("tcp", fmt.Sprintf(":%d", port))
	if err != nil {
		return false
	}
	
	tcpListener, err := net.ListenTCP("tcp", tcpAddr)
	if err != nil {
		return false
	}
	defer tcpListener.Close()
	
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
	mu                      sync.RWMutex
	currentProcess          *ManagedProcess // nil when no process running
	logMgr                  *LogManager
	healthMon               *HealthMonitor
	pid1Mgr                 *PID1Manager
	restartCount            int
	enableLogging           bool // Control whether to log child process stdout/stderr
	outputToStructuredLog   bool // Control whether to output child process logs to structured logging
}

func NewProcessManager(logMgr *LogManager, pid1Mgr *PID1Manager) *ProcessManager {
	return &ProcessManager{
		logMgr:                logMgr,
		pid1Mgr:               pid1Mgr,
		healthMon:             NewHealthMonitor(logMgr),
		enableLogging:         true,                         // Default: enable child process logging
		outputToStructuredLog: getProcessLoggingToStdout(), // Default: enable structured logging output, configurable via env
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
		done:     make(chan struct{}),
		waitDone: make(chan struct{}),
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

	// Register with PID 1 manager
	if pid1Mgr != nil {
		pid1Mgr.RegisterChildProcess(mp.cmd.Process)
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
		mp.info.State = ProcessStateStopped
		if err != nil {
			// Store the exit information but don't treat it as an error
			if exitError, ok := err.(*exec.ExitError); ok {
				code := exitError.ExitCode()
				mp.info.ExitCode = &code
			}
			// Only return the error if it's not a signal-based termination
			if !strings.Contains(err.Error(), "signal:") {
				mp.info.State = ProcessStateError
				mp.info.Error = err.Error()
				mp.infoMu.Unlock()
				return err
			}
		} else {
			code := 0
			mp.info.ExitCode = &code
		}
		mp.infoMu.Unlock()
		return nil
	case <-time.After(timeoutDuration):
		// Force kill if timeout exceeded
		if err := mp.cmd.Process.Kill(); err != nil {
			return fmt.Errorf("failed to force kill process: %w", err)
		}
		mp.infoMu.Lock()
		mp.info.State = ProcessStateStopped
		mp.infoMu.Unlock()
		return nil
	}
}

// WaitForCompletion waits for the process to complete and returns when cleanup is done
func (mp *ManagedProcess) WaitForCompletion() {
	<-mp.done
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

	err := mp.safeWait()

	mp.infoMu.Lock()
	if err != nil {
		mp.info.State = ProcessStateError
		mp.info.Error = err.Error()
		if exitError, ok := err.(*exec.ExitError); ok {
			code := exitError.ExitCode()
			mp.info.ExitCode = &code
		}
	} else {
		mp.info.State = ProcessStateStopped
		code := 0
		mp.info.ExitCode = &code
	}
	mp.infoMu.Unlock()

	// Unregister from PID 1 manager
	if pid1Mgr != nil {
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
		if status.State == ProcessStateRunning || status.State == ProcessStateStarting {
			return fmt.Errorf("process is already %s", status.State)
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
		return fmt.Errorf("no previous process to restart")
	}

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
			ports, err = getProcessPorts(processInfo.PID)
			if err != nil {
				slog.Warn("failed to discover process ports", "pid", processInfo.PID, "error", err)
				// No ports to wait for - continue with restart
				ports = nil
			} else if len(ports) > 0 {
				slog.Info("discovered ports in use by process", "pid", processInfo.PID, "ports", ports)
			}
		}
	}

	// Stop current process if running
	currentStatus := pm.currentProcess.GetInfo()
	if currentStatus.State == ProcessStateRunning {
		stopReq := ProcessStopRequest{
			Signal:  "SIGTERM",
			Timeout: 30,
		}
		if !req.Graceful {
			stopReq.Signal = "SIGKILL"
			stopReq.Timeout = 5
		}

		// Stop health monitoring first
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
	managedProcess, err := NewManagedProcess(config)
	if err != nil {
		return err
	}

	if err := managedProcess.Start(pm.logMgr, pm.pid1Mgr, pm.enableLogging, pm.outputToStructuredLog); err != nil {
		return err
	}

	// Replace current process
	pm.currentProcess = managedProcess
	pm.restartCount++

	// Start health monitoring again if configured
	pm.healthMon.Start(func() error {
		return pm.restartProcess()
	})

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

func (pm *ProcessManager) GetRestartStats() map[string]interface{} {
	pm.mu.RLock()
	defer pm.mu.RUnlock()

	stats := pm.healthMon.GetRestartStats()
	stats["manual_restarts"] = pm.restartCount
	return stats
}

func (pm *ProcessManager) StopAllProcesses() {
	pm.mu.Lock()
	defer pm.mu.Unlock()

	if pm.currentProcess != nil {
		status := pm.currentProcess.GetInfo()
		if status.State == ProcessStateRunning {
			// Stop health monitoring first
			pm.healthMon.Stop()

			// Stop the current process with SIGTERM and 10 second timeout
			stopReq := ProcessStopRequest{
				Signal:  "SIGTERM",
				Timeout: 10,
			}
			if err := pm.currentProcess.Stop(stopReq.Signal, stopReq.Timeout); err != nil {
				slog.Error("failed to stop process during cleanup", "error", err, "signal", stopReq.Signal)
			}

			// Wait for the process to fully stop
			pm.currentProcess.WaitForCompletion()
		}
	}
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
