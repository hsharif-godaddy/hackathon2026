// Package process provides process management functionality including PID 1 init system
// behavior, orphan process reaping, and exit code interpretation.
//
// This package handles:
//   - Signal forwarding to child processes
//   - Graceful shutdown orchestration
//   - Zombie process reaping (Linux)
//   - Exit code interpretation across platforms
package process

import "os"

// ManagedProcess represents a process managed by the process manager.
// This interface allows PID1Manager to interact with managed processes
// without depending on the main package's concrete implementation.
type ManagedProcess interface {
	SafeWait() error
	NotifyPID1WaitResult(error)
}

// childProcessInfo tracks a registered child process and its managed state
type childProcessInfo struct {
	process        *os.Process
	managedProcess ManagedProcess
	isProcessGroup bool // true when the child was started with Setpgid=true (pid == pgid)
}
