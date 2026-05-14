//go:build !windows

package process

import (
	"errors"
	"log/slog"
	"os"
	"os/exec"
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

	return pm.registerChildLocked(process, managedProcess)
}

// registerChildLocked inserts the child into the tracking map and starts any
// managed watcher. Caller MUST hold pm.mu.Lock(). Split out of
// RegisterChildProcess so StartAndRegister can hold the lock across cmd.Start()
// and the map insert in a single critical section.
func (pm *PID1Manager) registerChildLocked(process *os.Process, managedProcess ManagedProcess) bool {
	pm.childProcesses[process.Pid] = &childProcessInfo{
		process:        process,
		managedProcess: managedProcess,
	}
	slog.Debug("registered child process", "pid", process.Pid)

	managedLifecycle := pm.ShouldManageChildLifecycle(managedProcess)
	if managedLifecycle {
		pm.startManagedWatcher(process.Pid, managedProcess)
	}

	return managedLifecycle
}

// StartAndRegister runs cmd.Start() atomically with registration in the
// tracking map. Closes the race where the orphan reaper can waitid(2) a
// short-lived child before it has been registered — otherwise cmd.Wait()
// later fails with ECHILD ("waitid: no child processes") because the reaper
// already consumed the exit status.
//
// Holds pm.mu across cmd.Start() and the map insert, which makes the
// reaper's "is this PID tracked?" check (under pm.mu.RLock) wait until the
// PID is either registered or Start() has failed.
//
// managedProcess controls who is responsible for unregistering the PID:
//   - nil (typical one-shot commands): caller MUST call UnregisterChildProcess(pid)
//     after cmd.Wait() returns.
//   - non-nil: registerChildLocked starts a managed watcher that calls
//     UnregisterChildProcess itself when SafeWait returns. Caller MUST NOT
//     also unregister or the map will be touched twice.
//
// Throughput note: holding the write lock across fork(2)+exec(2) serializes
// concurrent StartAndRegister calls. Fine for the current LLM-driven workload
// (low fan-out, ms-scale exec), but worth revisiting if exec concurrency grows
// — fork+exec is not free.
func (pm *PID1Manager) StartAndRegister(cmd *exec.Cmd, managedProcess ManagedProcess) error {
	if cmd == nil {
		slog.Error("pid1.start_and_register.nil_cmd")
		return errors.New("StartAndRegister: nil cmd")
	}

	pm.mu.Lock()
	defer pm.mu.Unlock()

	if err := cmd.Start(); err != nil {
		return err
	}

	pm.registerChildLocked(cmd.Process, managedProcess)
	return nil
}

// UnregisterChildProcess Takes in a Process ID (PID) and removes the process from the list of managed processes.
// It is important to never add additional behavior, such as performing an operation given the PID.
// In the event you were to do so, you'd open up race conditions where the pid has already been cleared by the kernel
// and is possibly being used by a new process.
func (pm *PID1Manager) UnregisterChildProcess(pid int) {
	pm.mu.Lock()
	defer pm.mu.Unlock()

	delete(pm.childProcesses, pid)
	slog.Debug("unregistered child process", "pid", pid)
}

func (pm *PID1Manager) ShouldManageChildLifecycle(managedProcess ManagedProcess) bool {
	return pm.isPID1 && managedProcess != nil
}

func (pm *PID1Manager) startManagedWatcher(pid int, managedProcess ManagedProcess) {
	go func() {
		// Ensure that we always unregister the child process, even in cases of panics.
		defer pm.UnregisterChildProcess(pid)
		err := managedProcess.SafeWait()
		managedProcess.NotifyPID1WaitResult(err)
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
	// Get child count for logging without holding lock during shutdown
	pm.mu.RLock()
	childCount := len(pm.childProcesses)
	pm.mu.RUnlock()

	slog.Info("forwarding signal to child processes", "signal", sig, "child_count", childCount)

	switch sig {
	case syscall.SIGTERM, syscall.SIGINT:
		// Graceful shutdown signals - don't hold lock when calling initiateShutdown
		// as it needs to acquire write lock (prevents deadlock)
		pm.initiateShutdown()

	default:
		// Other signals - forward to children
		// Snapshot children under lock, then forward without holding lock
		children := pm.snapshotChildren()
		pm.forwardSignalToChildrenSnapshot(sig, children)
	}
}

// snapshotChildren creates a copy of the child process list under read lock.
// This allows signal forwarding to proceed without holding locks during blocking operations.
func (pm *PID1Manager) snapshotChildren() []*os.Process {
	pm.mu.RLock()
	defer pm.mu.RUnlock()

	snapshot := make([]*os.Process, 0, len(pm.childProcesses))
	for _, child := range pm.childProcesses {
		snapshot = append(snapshot, child.process)
	}
	return snapshot
}

// forwardSignalToChildrenSnapshot forwards a signal to a snapshot of child processes.
// Does not require holding any locks, safe to call after snapshotChildren().
func (pm *PID1Manager) forwardSignalToChildrenSnapshot(sig os.Signal, children []*os.Process) {
	for _, proc := range children {
		if err := proc.Signal(sig); err != nil {
			slog.Error("failed to send signal to child", "signal", sig, "pid", proc.Pid, "error", err)
		} else {
			slog.Debug("forwarded signal to child", "signal", sig, "pid", proc.Pid)
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
