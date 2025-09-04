package main

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/exec"
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

// ProcessManager manages the current process instance and persistent configuration
type ProcessManager struct {
	mu             sync.RWMutex
	currentProcess *ManagedProcess // nil when no process running
	logMgr         *LogManager
	healthMon      *HealthMonitor
	pid1Mgr        *PID1Manager
	restartCount   int
}

func NewProcessManager(logMgr *LogManager, pid1Mgr *PID1Manager) *ProcessManager {
	return &ProcessManager{
		logMgr:    logMgr,
		pid1Mgr:   pid1Mgr,
		healthMon: NewHealthMonitor(logMgr),
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
func (mp *ManagedProcess) Start(logMgr *LogManager, pid1Mgr *PID1Manager) error {
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

	// Start log streaming
	if logMgr != nil {
		go mp.streamLogs(logMgr, stdout, "stdout")
		go mp.streamLogs(logMgr, stderr, "stderr")
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

// streamLogs streams process output to the log manager
func (mp *ManagedProcess) streamLogs(logMgr *LogManager, reader io.Reader, source string) {
	scanner := bufio.NewScanner(reader)
	for scanner.Scan() {
		line := scanner.Text()
		logMgr.AddLog(LogEntry{
			Timestamp: time.Now(),
			Source:    source,
			Message:   line,
		})
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
	if err := managedProcess.Start(pm.logMgr, pm.pid1Mgr); err != nil {
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
	}

	// Create and start a completely new managed process with the same config
	managedProcess, err := NewManagedProcess(config)
	if err != nil {
		return err
	}

	if err := managedProcess.Start(pm.logMgr, pm.pid1Mgr); err != nil {
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
