package processmanager

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/exec"
	"sync"
	"syscall"
	"time"

	"github.com/airo-ai-builder/dev-supervisor/internal/logs"
	"github.com/airo-ai-builder/dev-supervisor/internal/process"
	"github.com/airo-ai-builder/dev-supervisor/internal/validation"
)

const defaultTmpDir = "/tmp"

// ManagedProcess represents a single process instance with its own lifecycle.
type ManagedProcess struct {
	cmd       *exec.Cmd
	ctx       context.Context
	cancel    context.CancelFunc
	info      ProcessInfo
	infoMu    sync.RWMutex // Protects info field
	startTime time.Time
	config    validation.ProcessStartRequest
	done      chan struct{} // Signals when process cleanup is complete

	// Synchronization for cmd.Wait()
	waitOnce sync.Once
	waitErr  error
	waitDone chan struct{}

	usePID1Wait    bool
	externalWaitCh chan error

	// State change callback
	// Called whenever the process state changes, allowing ProcessManager to broadcast
	onStateChange func()
}

// NewManagedProcess creates a new process instance.
func NewManagedProcess(config validation.ProcessStartRequest) (*ManagedProcess, error) {
	if config.Command == "" {
		return nil, errors.New("command is required")
	}

	ctx, cancel := context.WithCancel(context.Background())
	//nolint:gosec // G204: Command execution is the intended functionality for process management.
	// nosemgrep: go.lang.security.audit.dangerous-exec-command.dangerous-exec-command
	process := exec.CommandContext(ctx, "sh", "-c", config.Command)

	// Set working directory.
	if config.WorkingDir != "" {
		process.Dir = config.WorkingDir
	} else {
		if currentDir, err := os.Getwd(); err == nil {
			process.Dir = currentDir
		} else {
			process.Dir = defaultTmpDir
		}
	}

	// Set environment variables.
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

// Start starts the managed process and begins monitoring it.
func (mp *ManagedProcess) Start(
	logMgr logs.Logger,
	pid1Mgr *process.PID1Manager,
	enableLogging bool,
	outputToStructuredLog bool,
) error {
	// Set up pipes for stdout and stderr.
	stdout, err := mp.cmd.StdoutPipe()
	if err != nil {
		return fmt.Errorf("failed to create stdout pipe: %w", err)
	}

	stderr, err := mp.cmd.StderrPipe()
	if err != nil {
		return fmt.Errorf("failed to create stderr pipe: %w", err)
	}

	// Start the process.
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

	// Register with PID 1 manager before starting the wait goroutine.
	if pid1Mgr != nil {
		mp.usePID1Wait = pid1Mgr.RegisterChildProcess(mp.cmd.Process, mp)
	}

	// Start log streaming if enabled.
	if logMgr != nil && enableLogging {
		go mp.streamLogs(logMgr, stdout, "stdout", outputToStructuredLog)
		go mp.streamLogs(logMgr, stderr, "stderr", outputToStructuredLog)
	}

	// Start wait goroutine.
	go mp.waitForCompletion(pid1Mgr)

	return nil
}

// Stop stops the process with the given signal and timeout.
func (mp *ManagedProcess) Stop(signal string, timeout int) error {
	// Validate and mark stopping under lock, then release before blocking
	mp.infoMu.Lock()

	if mp.cmd == nil || mp.cmd.Process == nil {
		mp.infoMu.Unlock()
		return errors.New("process not initialized")
	}

	if mp.info.State != ProcessStateRunning {
		currentState := mp.info.State
		mp.infoMu.Unlock()
		return fmt.Errorf("process not running (current state: %s)", currentState)
	}

	mp.info.State = ProcessStateStopping
	mp.infoMu.Unlock() // Release lock before blocking operations

	// Parse signal
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

	// Send signal to process (can block on OS scheduling, no lock held)
	if err := mp.cmd.Process.Signal(sig); err != nil {
		return fmt.Errorf("failed to send signal: %w", err)
	}

	// Wait for process to exit with timeout (can block, no lock held)
	done := make(chan error, 1)
	go func() {
		done <- mp.SafeWait()
	}()

	var waitErr error
	select {
	case waitErr = <-done:
		// Process exited gracefully
	case <-time.After(timeoutDuration):
		// Timeout exceeded, force kill
		if err := mp.cmd.Process.Kill(); err != nil {
			return fmt.Errorf("failed to force kill process: %w", err)
		}
		// Wait for kill to complete
		waitErr = <-done
	}

	// Update final state under lock
	mp.infoMu.Lock()
	defer mp.infoMu.Unlock()
	mp.info.State = ProcessStateStopped
	return mp.handleProcessExit(waitErr)
}

// WaitForCompletion waits for the process to complete and returns when cleanup is done.
func (mp *ManagedProcess) WaitForCompletion() {
	<-mp.done
}

// NotifyPID1WaitResult notifies the PID1 manager of wait results.
func (mp *ManagedProcess) NotifyPID1WaitResult(err error) {
	mp.externalWaitCh <- err
}

// GetInfo returns the current process information.
func (mp *ManagedProcess) GetInfo() ProcessInfo {
	mp.infoMu.RLock()
	defer mp.infoMu.RUnlock()
	return mp.info
}

// SafeWait ensures that cmd.Wait() is only called once, even from multiple goroutines.
func (mp *ManagedProcess) SafeWait() error {
	mp.waitOnce.Do(func() {
		mp.waitErr = mp.cmd.Wait()
		close(mp.waitDone)
	})

	<-mp.waitDone
	return mp.waitErr
}

// waitForCompletion handles process completion and cleanup.
func (mp *ManagedProcess) waitForCompletion(pid1Mgr *process.PID1Manager) {
	defer close(mp.done) // Signal completion when this function exits.

	var err error
	if mp.usePID1Wait {
		err = <-mp.externalWaitCh
	} else {
		err = mp.SafeWait()
	}

	mp.infoMu.Lock()
	expected, exitCode := process.IsExpectedSignalExit(err)
	mp.info.ExitCode = exitCode

	if expected {
		mp.info.State = ProcessStateStopped
	} else {
		// Unexpected error - set state to error.
		mp.info.State = ProcessStateError
		if err != nil {
			mp.info.Error = err.Error()
		}
	}
	mp.infoMu.Unlock()

	// Notify ProcessManager of state change in a separate goroutine.
	// NOTE: At this point, no locks are held (mp.infoMu was released above).
	// The callback acquires pm.mu (ProcessManager lock, different struct).
	// The goroutine spawn is defensive programming to ensure the callback
	// can't block this cleanup goroutine, which is important for proper
	// process lifecycle management. This also allows the callback to safely
	// perform any long-running operations without blocking process exit.
	if mp.onStateChange != nil {
		go mp.onStateChange()
	}

	// Unregister from PID 1 manager when we owned the wait.
	if pid1Mgr != nil && !mp.usePID1Wait {
		pid1Mgr.UnregisterChildProcess(mp.cmd.Process.Pid)
	}

	// Cancel context.
	if mp.cancel != nil {
		mp.cancel()
	}
}

// handleProcessExit processes the exit status and logs appropriately.
// Must be called with infoMu locked.
func (mp *ManagedProcess) handleProcessExit(err error) error {
	if err == nil {
		code := 0
		mp.info.ExitCode = &code
		slog.Info("process stopped cleanly",
			slog.GroupAttrs("process_exit",
				slog.Int("exit_code", 0),
				slog.Bool("expected", true),
			),
		)
		return nil
	}

	expected, exitCode := process.IsExpectedSignalExit(err)
	mp.info.ExitCode = exitCode

	if expected {
		mp.logExpectedExit(exitCode)
		return nil
	}

	mp.logUnexpectedExit(exitCode, err)
	mp.info.State = ProcessStateError
	mp.info.Error = err.Error()
	return err
}

// logExpectedExit logs an expected process exit.
func (mp *ManagedProcess) logExpectedExit(exitCode *int) {
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
}

// logUnexpectedExit logs an unexpected process exit.
func (mp *ManagedProcess) logUnexpectedExit(exitCode *int, err error) {
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
}

// streamLogs streams process output to the log manager and optionally to structured logging.
func (mp *ManagedProcess) streamLogs(logMgr logs.Logger, reader io.Reader, source string, outputToStructuredLog bool) {
	// Cache PID and command values once to avoid mutex contention on every log line.
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

		// Always add to LogManager for API access.
		logMgr.AddLog(logs.LogEntry{
			Timestamp: time.Now(),
			Source:    source,
			Message:   line,
		})

		// Optionally output to structured logging for Docker logs.
		if outputToStructuredLog {
			slog.Info("child process output",
				"pid", cachedPID,
				"command", cachedCommand,
				"source", source,
				"message", line)
		}
	}
}
