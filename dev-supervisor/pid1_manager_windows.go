//go:build windows
// +build windows

package main

import (
	"log/slog"
	"os"
	"os/signal"
	"sync"
	"time"
)

type PID1Manager struct {
	mu               sync.RWMutex
	childProcesses   map[int]*os.Process
	signalForwarding bool
	zombieReaping    bool
	shutdownCallback func()
	shutdownTimeout  time.Duration
	isShuttingDown   bool
}

func NewPID1Manager() *PID1Manager {
	return &PID1Manager{
		childProcesses:   make(map[int]*os.Process),
		signalForwarding: false,
		zombieReaping:    false,
		shutdownTimeout:  30 * time.Second,
	}
}

func (pm *PID1Manager) Start(shutdownCallback func()) {
	pm.shutdownCallback = shutdownCallback
	slog.Info("PID1Manager on Windows - limited functionality")
	pm.setupBasicSignalHandling()
}

func (pm *PID1Manager) RegisterChildProcess(process *os.Process) {
	if process == nil {
		return
	}

	pm.mu.Lock()
	defer pm.mu.Unlock()

	pm.childProcesses[process.Pid] = process
	slog.Debug("registered child process", "pid", process.Pid)
}

func (pm *PID1Manager) UnregisterChildProcess(pid int) {
	pm.mu.Lock()
	defer pm.mu.Unlock()

	delete(pm.childProcesses, pid)
	slog.Debug("unregistered child process", "pid", pid)
}

func (pm *PID1Manager) setupBasicSignalHandling() {
	slog.Info("setting up basic signal handling (Windows)")

	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, os.Interrupt)

	go func() {
		sig := <-sigChan
		slog.Info("received signal, initiating shutdown", "signal", sig)
		pm.initiateShutdown()
	}()
}

func (pm *PID1Manager) initiateShutdown() {
	pm.mu.Lock()
	if pm.isShuttingDown {
		pm.mu.Unlock()
		return
	}
	pm.isShuttingDown = true
	pm.mu.Unlock()

	slog.Info("initiating graceful shutdown")

	pm.terminateChildren()

	timeout := time.After(pm.shutdownTimeout)
	ticker := time.NewTicker(1 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-timeout:
			slog.Warn("shutdown timeout exceeded, force killing remaining children")
			pm.forceKillChildren()
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

func (pm *PID1Manager) terminateChildren() {
	pm.mu.RLock()
	defer pm.mu.RUnlock()

	slog.Info("terminating child processes", "child_count", len(pm.childProcesses))

	for pid, process := range pm.childProcesses {
		if err := process.Kill(); err != nil {
			slog.Error("failed to kill child", "pid", pid, "error", err)
		}
	}
}

func (pm *PID1Manager) forceKillChildren() {
	pm.terminateChildren()
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
