package main

import (
	"github.com/airo-ai-builder/dev-supervisor/internal/logs"
	"github.com/airo-ai-builder/dev-supervisor/internal/process"
	"github.com/airo-ai-builder/dev-supervisor/internal/processmanager"
)

type ProcessManager = processmanager.ProcessManager
type ProcessInfo = processmanager.ProcessInfo
type ProcessStopRequest = processmanager.ProcessStopRequest
type ProcessRestartRequest = processmanager.ProcessRestartRequest
type ProcessState = processmanager.ProcessState

const (
	ProcessStateStopped  = processmanager.ProcessStateStopped
	ProcessStateStarting = processmanager.ProcessStateStarting
	ProcessStateRunning  = processmanager.ProcessStateRunning
	ProcessStateStopping = processmanager.ProcessStateStopping
	ProcessStateError    = processmanager.ProcessStateError
)

var (
	ErrAlreadyStarting = processmanager.ErrAlreadyStarting
	ErrAlreadyRunning  = processmanager.ErrAlreadyRunning
)

func NewProcessManager(logMgr logs.Logger, pid1Mgr *process.PID1Manager) *ProcessManager {
	return processmanager.NewProcessManager(logMgr, pid1Mgr)
}
