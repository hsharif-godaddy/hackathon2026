//go:build !windows

package process

import (
	"log/slog"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"
)

type PID1Manager struct {
	mu               sync.RWMutex
	childProcesses   map[int]*childProcessInfo
	signalForwarding bool
	shutdownCallback func()
	shutdownTimeout  time.Duration
	isShuttingDown   bool
	isPID1           bool
}

func NewPID1Manager() *PID1Manager {
	return &PID1Manager{
		childProcesses:   make(map[int]*childProcessInfo),
		signalForwarding: true,
		shutdownTimeout:  30 * time.Second,
		isPID1:           os.Getpid() == 1,
	}
}

func (pm *PID1Manager) Start(shutdownCallback func()) {
	pm.shutdownCallback = shutdownCallback

	// Only enable PID 1 behavior if we are actually PID 1
	if pm.isPID1 {
		slog.Info("running as PID 1, enabling init process behavior")

		// Setup signal forwarding
		if pm.signalForwarding {
			pm.setupSignalForwarding()
		}

		pm.startOrphanReaper()
	} else {
		slog.Info("PID 1 behavior disabled", "pid", os.Getpid())
		// Still setup basic signal handling for graceful shutdown
		pm.setupBasicSignalHandling()
	}
}

func (pm *PID1Manager) RegisterChildProcess(process *os.Process, managedProcess ManagedProcess) bool {
	if process == nil {
		return false
	}

	pm.mu.Lock()
	defer pm.mu.Unlock()

	pm.childProcesses[process.Pid] = &childProcessInfo{
		process:        process,
		managedProcess: managedProcess,
	}
	slog.Debug("registered child process", "pid", process.Pid)

	managedLifecycle := pm.shouldManageChildLifecycle(managedProcess)
	if managedLifecycle {
		pm.startManagedWatcher(process.Pid, managedProcess)
	}

	return managedLifecycle
}

func (pm *PID1Manager) UnregisterChildProcess(pid int) {
	pm.mu.Lock()
	defer pm.mu.Unlock()

	delete(pm.childProcesses, pid)
	slog.Debug("unregistered child process", "pid", pid)
}

func (pm *PID1Manager) shouldManageChildLifecycle(managedProcess ManagedProcess) bool {
	return pm.isPID1 && managedProcess != nil
}

func (pm *PID1Manager) startManagedWatcher(pid int, managedProcess ManagedProcess) {
	go func() {
		err := managedProcess.SafeWait()
		managedProcess.NotifyPID1WaitResult(err)
		pm.UnregisterChildProcess(pid)
	}()
}

func (pm *PID1Manager) setupSignalForwarding() {
	slog.Info("setting up signal forwarding for PID 1")

	// Signals to forward to children
	signals := []os.Signal{
		syscall.SIGTERM,
		syscall.SIGINT,
		syscall.SIGUSR1,
		syscall.SIGUSR2,
		syscall.SIGHUP,
	}

	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, signals...)

	go func() {
		for sig := range sigChan {
			pm.handleSignal(sig)
		}
	}()
}

func (pm *PID1Manager) setupBasicSignalHandling() {
	slog.Info("setting up basic signal handling")

	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGTERM, syscall.SIGINT)

	go func() {
		sig := <-sigChan
		slog.Info("received signal, initiating shutdown", "signal", sig)
		pm.initiateShutdown()
	}()
}

func (pm *PID1Manager) handleSignal(sig os.Signal) {
	pm.mu.RLock()
	defer pm.mu.RUnlock()

	slog.Info("forwarding signal to child processes", "signal", sig, "child_count", len(pm.childProcesses))

	switch sig {
	case syscall.SIGTERM, syscall.SIGINT:
		// Graceful shutdown signals
		pm.initiateShutdown()

	case syscall.SIGHUP:
		// Reload signal - forward to children
		pm.forwardSignalToChildren(sig)

	case syscall.SIGUSR1, syscall.SIGUSR2:
		// User-defined signals - forward to children
		pm.forwardSignalToChildren(sig)

	default:
		// Forward unknown signals
		pm.forwardSignalToChildren(sig)
	}
}

func (pm *PID1Manager) forwardSignalToChildren(sig os.Signal) {
	for pid, child := range pm.childProcesses {
		if err := child.process.Signal(sig); err != nil {
			slog.Error("failed to send signal to child", "signal", sig, "pid", pid, "error", err)
		} else {
			slog.Debug("forwarded signal to child", "signal", sig, "pid", pid)
		}
	}
}

func (pm *PID1Manager) initiateShutdown() {
	pm.mu.Lock()
	if pm.isShuttingDown {
		pm.mu.Unlock()
		return // Already shutting down
	}
	pm.isShuttingDown = true
	pm.mu.Unlock()

	slog.Info("initiating graceful shutdown")

	// Send SIGTERM to all children first
	pm.terminateChildren(syscall.SIGTERM)

	// Wait for children to exit gracefully
	timeout := time.After(pm.shutdownTimeout)
	ticker := time.NewTicker(1 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-timeout:
			slog.Warn("shutdown timeout exceeded, force killing remaining children")
			pm.terminateChildren(syscall.SIGKILL)
			pm.callShutdownCallback()
			return

		case <-ticker.C:
			pm.mu.RLock()
			remaining := len(pm.childProcesses)
			pm.mu.RUnlock()

			if remaining == 0 {
				slog.Info("all child processes have exited")
				pm.callShutdownCallback()
				return
			}

			slog.Info("waiting for child processes to exit", "remaining_count", remaining)
		}
	}
}

func (pm *PID1Manager) terminateChildren(sig os.Signal) {
	pm.mu.RLock()
	defer pm.mu.RUnlock()

	slog.Info("sending signal to child processes", "signal", sig, "child_count", len(pm.childProcesses))

	for pid, child := range pm.childProcesses {
		if err := child.process.Signal(sig); err != nil {
			slog.Error("failed to send signal to child", "signal", sig, "pid", pid, "error", err)
		}
	}
}

func (pm *PID1Manager) callShutdownCallback() {
	if pm.shutdownCallback != nil {
		pm.shutdownCallback()
	}
}

func (pm *PID1Manager) SetShutdownTimeout(timeout time.Duration) {
	pm.mu.Lock()
	defer pm.mu.Unlock()
	pm.shutdownTimeout = timeout
}

func (pm *PID1Manager) GetChildProcessCount() int {
	pm.mu.RLock()
	defer pm.mu.RUnlock()
	return len(pm.childProcesses)
}

func (pm *PID1Manager) IsShuttingDown() bool {
	pm.mu.RLock()
	defer pm.mu.RUnlock()
	return pm.isShuttingDown
}

// SetPID1ForTesting allows tests to override the isPID1 detection.
// This should only be used in tests to simulate PID 1 behavior.
func (pm *PID1Manager) SetPID1ForTesting(isPID1 bool) {
	pm.mu.Lock()
	defer pm.mu.Unlock()
	pm.isPID1 = isPID1
}

// SetSignalForwardingForTesting allows tests to override signal forwarding behavior.
// This should only be used in tests.
func (pm *PID1Manager) SetSignalForwardingForTesting(enabled bool) {
	pm.mu.Lock()
	defer pm.mu.Unlock()
	pm.signalForwarding = enabled
}

// IsChildProcessTracked returns true if the given PID is tracked by the manager.
// This is primarily useful for testing.
func (pm *PID1Manager) IsChildProcessTracked(pid int) bool {
	pm.mu.RLock()
	defer pm.mu.RUnlock()
	_, tracked := pm.childProcesses[pid]
	return tracked
}
