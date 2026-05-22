package main

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/airo-ai-builder/dev-supervisor/internal/logs"
	"github.com/airo-ai-builder/dev-supervisor/internal/process"
	"github.com/airo-ai-builder/dev-supervisor/internal/sandbox"
	"github.com/airo-ai-builder/dev-supervisor/internal/validation"
)

const (
	defaultMaxAsyncTasks = 32
	defaultReapTTL       = 1 * time.Hour
	maxTaskTimeout       = 3600

	taskCancelGracePeriod = 5 * time.Second

	taskOutputMaxLines   = 1000
	taskOutputMaxLineLen = 4096
	taskReaperInterval   = 1 * time.Minute
)

type TaskState string

const (
	TaskStateQueued    TaskState = "queued"
	TaskStateRunning   TaskState = "running"
	TaskStateSucceeded TaskState = "succeeded"
	TaskStateFailed    TaskState = "failed"
	TaskStateCanceled  TaskState = "canceled"
	TaskStateTimedOut  TaskState = "timed_out"
)

type TaskOutputBuffer struct {
	mu    sync.Mutex
	lines []string
}

func (b *TaskOutputBuffer) addLines(raw string) {
	if raw == "" {
		return
	}
	b.mu.Lock()
	defer b.mu.Unlock()

	for line := range strings.SplitSeq(strings.TrimRight(raw, "\n"), "\n") {
		if len(line) > taskOutputMaxLineLen {
			line = line[:taskOutputMaxLineLen] + "…"
		}
		b.lines = append(b.lines, line)
		if len(b.lines) > taskOutputMaxLines {
			b.lines = b.lines[1:]
		}
	}
}

type streamWriter struct {
	buf       *TaskOutputBuffer
	logMgr    *logs.Manager
	commandID uint64
	partial   []byte
}

func (w *streamWriter) Write(p []byte) (int, error) {
	w.partial = append(w.partial, p...)
	for {
		idx := bytes.IndexByte(w.partial, '\n')
		if idx < 0 {
			break
		}
		line := string(w.partial[:idx])
		w.partial = w.partial[idx+1:]
		w.addLine(line)
	}
	return len(p), nil
}

func (w *streamWriter) flush() {
	if len(w.partial) == 0 {
		return
	}
	line := string(w.partial)
	w.partial = nil
	w.addLine(line)
}

func (w *streamWriter) addLine(line string) {
	if len(line) > taskOutputMaxLineLen {
		line = line[:taskOutputMaxLineLen] + "…"
	}
	w.buf.mu.Lock()
	w.buf.lines = append(w.buf.lines, line)
	if len(w.buf.lines) > taskOutputMaxLines {
		w.buf.lines = w.buf.lines[1:]
	}
	w.buf.mu.Unlock()

	if w.logMgr != nil {
		w.logMgr.AddLog(logs.LogEntry{
			Timestamp: time.Now(),
			Source:    execLogSource,
			Message:   line,
			CommandID: w.commandID,
		})
	}
}

func (b *TaskOutputBuffer) getLines(since int, maxLines int) ([]string, int) {
	b.mu.Lock()
	defer b.mu.Unlock()

	if since >= len(b.lines) {
		return nil, len(b.lines)
	}
	end := len(b.lines)
	if maxLines > 0 && since+maxLines < end {
		end = since + maxLines
	}
	result := make([]string, end-since)
	copy(result, b.lines[since:end])
	return result, end
}

type Task struct {
	// Immutable after creation — no lock needed.
	ID         string `json:"task_id"`
	Command    string `json:"command"`
	WorkingDir string `json:"working_dir,omitempty"`
	Timeout    int    `json:"timeout"`
	CommandID  uint64 `json:"command_id"`
	cancel     context.CancelFunc

	// Mutable fields — protected by mu.
	mu              sync.RWMutex
	State           TaskState `json:"state"`
	ExitCode        int       `json:"exit_code"`
	Error           string    `json:"error,omitempty"`
	TimedOut        bool      `json:"timed_out"`
	StartedAt       time.Time `json:"started_at,omitzero"`
	FinishedAt      time.Time `json:"finished_at,omitzero"`
	ExecutionTimeMs int64     `json:"execution_time_ms"`

	// done is closed exactly once on completion; safe for concurrent select.
	done   chan struct{}
	stdout *TaskOutputBuffer
	stderr *TaskOutputBuffer
}

type TaskInfo struct {
	ID              string
	Command         string
	WorkingDir      string
	Timeout         int
	CommandID       uint64
	State           TaskState
	ExitCode        int
	Error           string
	TimedOut        bool
	StartedAt       time.Time
	FinishedAt      time.Time
	ExecutionTimeMs int64
}

func (t *Task) Info() TaskInfo {
	t.mu.RLock()
	defer t.mu.RUnlock()
	return TaskInfo{
		ID:              t.ID,
		Command:         t.Command,
		WorkingDir:      t.WorkingDir,
		Timeout:         t.Timeout,
		CommandID:       t.CommandID,
		State:           t.State,
		ExitCode:        t.ExitCode,
		Error:           t.Error,
		TimedOut:        t.TimedOut,
		StartedAt:       t.StartedAt,
		FinishedAt:      t.FinishedAt,
		ExecutionTimeMs: t.ExecutionTimeMs,
	}
}

type TaskManagerConfig struct {
	MaxAsyncTasks    int
	ReapTTL          time.Duration
	SandboxEnabled   bool
	SharedStorageDir string
	DefaultWorkDir   string
}

type TaskManager struct {
	mu       sync.RWMutex
	tasks    map[string]*Task
	seq      atomic.Uint64
	cmdSeq   *atomic.Uint64
	pid1Mgr  *process.PID1Manager
	logMgr   *logs.Manager
	config   TaskManagerConfig
	running  atomic.Int32
	stopOnce sync.Once
	stopCh   chan struct{}
}

func loadTaskManagerConfig() TaskManagerConfig {
	defaultDir, err := os.Getwd()
	if err != nil {
		slog.Warn("task_manager.config.getwd_failed", "err", err)
		defaultDir = "/tmp"
	}

	cfg := TaskManagerConfig{
		MaxAsyncTasks:  defaultMaxAsyncTasks,
		ReapTTL:        defaultReapTTL,
		DefaultWorkDir: defaultDir,
	}

	if v := os.Getenv("AIRO_MAX_ASYNC_TASKS"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			cfg.MaxAsyncTasks = n
		} else {
			slog.Warn("task_manager.config.invalid_max_async_tasks", "value", v)
		}
	}

	if v := os.Getenv("AIRO_TASK_REAP_TTL"); v != "" {
		if d, err := time.ParseDuration(v); err == nil && d > 0 {
			cfg.ReapTTL = d
		} else {
			slog.Warn("task_manager.config.invalid_reap_ttl", "value", v)
		}
	}

	return cfg
}

func NewTaskManager(pid1Mgr *process.PID1Manager, logMgr *logs.Manager, cmdSeq *atomic.Uint64) *TaskManager {
	cfg := loadTaskManagerConfig()
	tm := &TaskManager{
		tasks:   make(map[string]*Task),
		pid1Mgr: pid1Mgr,
		logMgr:  logMgr,
		cmdSeq:  cmdSeq,
		config:  cfg,
		stopCh:  make(chan struct{}),
	}

	go tm.reaper()

	slog.Info("task_manager.started",
		"max_async_tasks", cfg.MaxAsyncTasks,
		"reap_ttl", cfg.ReapTTL.String(),
	)

	return tm
}

func (tm *TaskManager) SetSandboxEnabled(enabled bool) {
	tm.config.SandboxEnabled = enabled
}

func (tm *TaskManager) SetSharedStorageDir(dir string) {
	tm.config.SharedStorageDir = dir
}

func (tm *TaskManager) nextID() string {
	n := tm.seq.Add(1)
	return fmt.Sprintf("task-%d", n)
}

func (tm *TaskManager) Submit(req validation.CommandRequest) (string, error) {
	for {
		cur := tm.running.Load()
		if int(cur) >= tm.config.MaxAsyncTasks {
			return "", ErrTooManyTasks
		}
		if tm.running.CompareAndSwap(cur, cur+1) {
			break
		}
	}

	timeout := 30
	if req.Timeout > 0 {
		timeout = req.Timeout
	}
	if timeout > maxTaskTimeout {
		timeout = maxTaskTimeout
	}

	workDir := tm.config.DefaultWorkDir
	if req.WorkingDir != "" {
		workDir = req.WorkingDir
	}

	cmdID := tm.cmdSeq.Add(1)
	taskID := tm.nextID()

	timeoutDuration := time.Duration(timeout) * time.Second
	ctx, cancel := context.WithTimeout(context.Background(), timeoutDuration)

	task := &Task{
		ID:         taskID,
		Command:    req.Command,
		WorkingDir: workDir,
		State:      TaskStateQueued,
		Timeout:    timeout,
		CommandID:  cmdID,
		cancel:     cancel,
		done:       make(chan struct{}),
		stdout:     &TaskOutputBuffer{},
		stderr:     &TaskOutputBuffer{},
	}

	tm.mu.Lock()
	tm.tasks[taskID] = task
	tm.mu.Unlock()

	go tm.run(ctx, task, req)

	return taskID, nil
}

func (tm *TaskManager) run(ctx context.Context, task *Task, req validation.CommandRequest) {
	defer tm.running.Add(-1)
	defer task.cancel()

	task.mu.Lock()
	task.State = TaskStateRunning
	task.StartedAt = time.Now()
	task.mu.Unlock()

	childEnv := mergeEnv(os.Environ(), req.Env)

	spec := sandbox.BuildExecProfile(tm.config.SharedStorageDir, req.Command, task.WorkingDir)
	sandboxCmd, sandboxErr := sandbox.WrapCommand(ctx, tm.config.SandboxEnabled, spec, childEnv)
	if sandboxErr != nil {
		tm.finishTask(task, TaskStateFailed, -1, sandboxErr.Error())
		return
	}

	var cmd *exec.Cmd
	if sandboxCmd != nil {
		cmd = sandboxCmd
	} else {
		//nolint:gosec // G204: Command execution is the intended functionality
		// nosemgrep: go.lang.security.audit.dangerous-exec-command.dangerous-exec-command
		cmd = exec.CommandContext(ctx, "sh", "-c", req.Command)
		cmd.Dir = task.WorkingDir
		cmd.Env = childEnv
	}

	// WaitDelay ensures cmd.Wait() returns promptly after the process is killed,
	// even if orphan children hold stdout/stderr pipe FDs open.
	cmd.WaitDelay = 500 * time.Millisecond

	var statusRead *os.File
	if sandboxCmd != nil {
		var pipeErr error
		statusRead, pipeErr = sandbox.AttachStatusPipe(cmd)
		if pipeErr != nil {
			tm.finishTask(task, TaskStateFailed, -1, pipeErr.Error())
			return
		}
	}

	stdoutW := &streamWriter{buf: task.stdout, logMgr: tm.logMgr, commandID: task.CommandID}
	stderrW := &streamWriter{buf: task.stderr, logMgr: tm.logMgr, commandID: task.CommandID}
	cmd.Stdout = stdoutW
	cmd.Stderr = stderrW

	slog.DebugContext(ctx, "task_manager.run.start",
		"task_id", task.ID,
		"command_id", task.CommandID,
		"command_preview", commandLogPreview(req.Command),
		"timeout_seconds", task.Timeout,
		"working_dir", task.WorkingDir,
	)

	var err error
	if tm.pid1Mgr != nil {
		err = tm.pid1Mgr.StartAndRegister(cmd, nil)
	} else {
		err = cmd.Start()
	}

	if err != nil {
		if statusRead != nil {
			_ = statusRead.Close()
			sandbox.ReleaseStatusWrite(cmd)
		}
		tm.finishTask(task, TaskStateFailed, -1, err.Error())
		return
	}

	defer func() {
		if tm.pid1Mgr != nil && cmd.Process != nil {
			tm.pid1Mgr.UnregisterChildProcess(cmd.Process.Pid)
		}
	}()

	var sandboxFatal string
	if statusRead == nil {
		err = cmd.Wait()
	} else {
		sandbox.ReleaseStatusWrite(cmd)
		fatalCh := make(chan string, 1)
		go func() {
			fatalCh <- sandbox.ReadFatal(statusRead)
			_ = statusRead.Close()
		}()
		err = cmd.Wait()
		sandboxFatal = <-fatalCh
	}

	stdoutW.flush()
	stderrW.flush()

	if ctx.Err() == context.DeadlineExceeded {
		tm.finishTask(task, TaskStateTimedOut, -1, "command timed out")
		return
	}

	if sandboxFatal != "" {
		tm.finishTask(task, TaskStateFailed, -1, "sandbox wrapper failed: "+sandboxFatal)
		return
	}

	exitCode := 0
	if err != nil {
		var exitError *exec.ExitError
		if errors.As(err, &exitError) {
			exitCode = exitError.ExitCode()
		} else {
			tm.finishTask(task, TaskStateFailed, -1, err.Error())
			return
		}
	}

	if exitCode == 0 {
		tm.finishTask(task, TaskStateSucceeded, 0, "")
	} else {
		tm.finishTask(task, TaskStateFailed, exitCode, "")
	}
}

func (tm *TaskManager) finishTask(task *Task, state TaskState, exitCode int, errMsg string) {
	task.mu.Lock()
	task.State = state
	task.ExitCode = exitCode
	task.Error = errMsg
	task.FinishedAt = time.Now()
	task.TimedOut = state == TaskStateTimedOut
	if !task.StartedAt.IsZero() {
		task.ExecutionTimeMs = task.FinishedAt.Sub(task.StartedAt).Milliseconds()
	}
	execTimeMs := task.ExecutionTimeMs
	task.mu.Unlock()

	close(task.done)

	slog.Debug("task_manager.run.finished",
		"task_id", task.ID,
		"command_id", task.CommandID,
		"state", string(state),
		"exit_code", exitCode,
		"execution_time_ms", execTimeMs,
	)
}

func (tm *TaskManager) Wait(taskID string, deadline time.Duration) (*Task, error) {
	tm.mu.RLock()
	task, ok := tm.tasks[taskID]
	tm.mu.RUnlock()

	if !ok {
		return nil, ErrTaskNotFound
	}

	if deadline <= 0 {
		return task, nil
	}

	timer := time.NewTimer(deadline)
	defer timer.Stop()

	select {
	case <-task.done:
		return task, nil
	case <-timer.C:
		return task, nil
	}
}

func (tm *TaskManager) Get(taskID string) (*Task, error) {
	tm.mu.RLock()
	task, ok := tm.tasks[taskID]
	tm.mu.RUnlock()

	if !ok {
		return nil, ErrTaskNotFound
	}
	return task, nil
}

type TaskOutput struct {
	Stdout           string `json:"stdout"`
	Stderr           string `json:"stderr"`
	NextOffset       int    `json:"next_offset"`
	NextStderrOffset int    `json:"next_stderr_offset"`
	Complete         bool   `json:"complete"`
}

func (tm *TaskManager) Output(taskID string, since int, sinceStderr int, maxLines int) (*TaskOutput, error) {
	tm.mu.RLock()
	task, ok := tm.tasks[taskID]
	tm.mu.RUnlock()

	if !ok {
		return nil, ErrTaskNotFound
	}

	stdoutLines, nextStdout := task.stdout.getLines(since, maxLines)
	stderrLines, nextStderr := task.stderr.getLines(sinceStderr, maxLines)

	task.mu.RLock()
	complete := isTaskTerminal(task.State)
	task.mu.RUnlock()

	return &TaskOutput{
		Stdout:           strings.Join(stdoutLines, "\n"),
		Stderr:           strings.Join(stderrLines, "\n"),
		NextOffset:       nextStdout,
		NextStderrOffset: nextStderr,
		Complete:         complete,
	}, nil
}

func (tm *TaskManager) Cancel(taskID string) (string, error) {
	tm.mu.RLock()
	task, ok := tm.tasks[taskID]
	tm.mu.RUnlock()

	if !ok {
		return "", ErrTaskNotFound
	}

	task.mu.RLock()
	terminal := isTaskTerminal(task.State)
	task.mu.RUnlock()

	if terminal {
		return cancelResultAlreadyFinished, nil
	}

	task.cancel()

	timer := time.NewTimer(taskCancelGracePeriod)
	defer timer.Stop()

	select {
	case <-task.done:
	case <-timer.C:
	}

	task.mu.Lock()
	if !isTaskTerminal(task.State) {
		task.State = TaskStateCanceled
	}
	task.mu.Unlock()

	return cancelResultCanceled, nil
}

func (tm *TaskManager) Shutdown(ctx context.Context) {
	tm.stopOnce.Do(func() {
		close(tm.stopCh)
	})

	if ctx == nil {
		ctx = context.Background()
	}

	tm.mu.RLock()
	var running []*Task
	for _, t := range tm.tasks {
		t.mu.RLock()
		terminal := isTaskTerminal(t.State)
		t.mu.RUnlock()
		if !terminal {
			running = append(running, t)
		}
	}
	tm.mu.RUnlock()

	for _, t := range running {
		t.cancel()
	}

	deadline := time.After(taskCancelGracePeriod)
	drained := 0
	for _, t := range running {
		select {
		case <-t.done:
			drained++
		case <-deadline:
			slog.WarnContext(ctx, "task_manager.shutdown.grace_exceeded",
				"abandoned_tasks", len(running)-drained,
			)
			return
		case <-ctx.Done():
			slog.WarnContext(ctx, "task_manager.shutdown.context_canceled",
				"abandoned_tasks", len(running)-drained,
			)
			return
		}
	}
}

func (tm *TaskManager) reaper() {
	ticker := time.NewTicker(taskReaperInterval)
	defer ticker.Stop()

	for {
		select {
		case <-tm.stopCh:
			return
		case <-ticker.C:
			tm.reapCompleted()
		}
	}
}

func (tm *TaskManager) reapCompleted() {
	now := time.Now()
	tm.mu.Lock()
	defer tm.mu.Unlock()

	for id, task := range tm.tasks {
		task.mu.RLock()
		terminal := isTaskTerminal(task.State)
		finishedAt := task.FinishedAt
		task.mu.RUnlock()
		if !terminal {
			continue
		}
		if now.Sub(finishedAt) > tm.config.ReapTTL {
			delete(tm.tasks, id)
		}
	}
}

func isTaskTerminal(s TaskState) bool {
	switch s {
	case TaskStateSucceeded, TaskStateFailed, TaskStateCanceled, TaskStateTimedOut:
		return true
	case TaskStateQueued, TaskStateRunning:
		return false
	}
	return false
}

const (
	cancelResultCanceled        = "canceled"
	cancelResultAlreadyFinished = "already_finished"
)

// Sentinel errors
var (
	ErrTaskNotFound = errors.New("task not found")
	ErrTooManyTasks = errors.New("too many concurrent tasks")
)
