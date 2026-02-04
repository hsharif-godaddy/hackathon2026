package processmanager

import (
	"errors"
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

// Sentinel errors for process state checks.
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

type ProcessStopRequest struct {
	Signal  string `json:"signal,omitempty"`
	Timeout int    `json:"timeout,omitempty"`
}

type ProcessRestartRequest struct {
	Graceful bool `json:"graceful,omitempty"`
}
