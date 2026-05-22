package main

import (
	"context"
	"errors"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/airo-ai-builder/dev-supervisor/internal/logs"
	"github.com/airo-ai-builder/dev-supervisor/internal/process"
	"github.com/airo-ai-builder/dev-supervisor/internal/validation"
)

func newTestTaskManager() *TaskManager {
	logMgr := logs.NewManager(1000)
	var cmdSeq atomic.Uint64
	tm := NewTaskManager(nil, logMgr, &cmdSeq)
	return tm
}

func newTestTaskManagerWithPID1() *TaskManager {
	logMgr := logs.NewManager(1000)
	pid1Mgr := process.NewPID1Manager()
	var cmdSeq atomic.Uint64
	tm := NewTaskManager(pid1Mgr, logMgr, &cmdSeq)
	return tm
}

func TestTaskManager_Submit_ReturnsTaskID(t *testing.T) {
	t.Parallel()
	tm := newTestTaskManager()
	defer tm.Shutdown(context.Background())

	taskID, err := tm.Submit(validation.CommandRequest{
		Command: "echo hello",
		Timeout: 5,
	})
	if err != nil {
		t.Fatalf("Submit failed: %v", err)
	}
	if !strings.HasPrefix(taskID, "task-") {
		t.Errorf("expected task ID prefix 'task-', got %q", taskID)
	}
}

func TestTaskManager_Submit_MonotonicIDs(t *testing.T) {
	t.Parallel()
	tm := newTestTaskManager()
	defer tm.Shutdown(context.Background())

	id1, _ := tm.Submit(validation.CommandRequest{Command: "true", Timeout: 5})
	id2, _ := tm.Submit(validation.CommandRequest{Command: "true", Timeout: 5})

	if id1 == id2 {
		t.Error("expected unique task IDs")
	}
}

func TestTaskManager_Wait_CompletedTask(t *testing.T) {
	t.Parallel()
	tm := newTestTaskManager()
	defer tm.Shutdown(context.Background())

	taskID, err := tm.Submit(validation.CommandRequest{
		Command: "echo done",
		Timeout: 5,
	})
	if err != nil {
		t.Fatalf("Submit failed: %v", err)
	}

	task, err := tm.Wait(taskID, 5*time.Second)
	if err != nil {
		t.Fatalf("Wait failed: %v", err)
	}
	info := task.Info()
	if info.State != TaskStateSucceeded {
		t.Errorf("expected state succeeded, got %s", info.State)
	}
	if info.ExitCode != 0 {
		t.Errorf("expected exit code 0, got %d", info.ExitCode)
	}
}

func TestTaskManager_Wait_DeadlineExceeded(t *testing.T) {
	t.Parallel()
	tm := newTestTaskManager()
	defer tm.Shutdown(context.Background())

	taskID, err := tm.Submit(validation.CommandRequest{
		Command: "sleep 10",
		Timeout: 30,
	})
	if err != nil {
		t.Fatalf("Submit failed: %v", err)
	}

	task, err := tm.Wait(taskID, 100*time.Millisecond)
	if err != nil {
		t.Fatalf("Wait failed: %v", err)
	}
	info := task.Info()
	if info.State != TaskStateRunning {
		t.Errorf("expected state running after deadline, got %s", info.State)
	}
}

func TestTaskManager_Wait_TaskNotFound(t *testing.T) {
	t.Parallel()
	tm := newTestTaskManager()
	defer tm.Shutdown(context.Background())

	_, err := tm.Wait("task-nonexistent", time.Second)
	if !errors.Is(err, ErrTaskNotFound) {
		t.Errorf("expected ErrTaskNotFound, got %v", err)
	}
}

func TestTaskManager_Get(t *testing.T) {
	t.Parallel()
	tm := newTestTaskManager()
	defer tm.Shutdown(context.Background())

	taskID, _ := tm.Submit(validation.CommandRequest{
		Command: "echo get-test",
		Timeout: 5,
	})

	// Wait for completion
	_, _ = tm.Wait(taskID, 5*time.Second)

	task, err := tm.Get(taskID)
	if err != nil {
		t.Fatalf("Get failed: %v", err)
	}
	if task.ID != taskID {
		t.Errorf("expected task ID %s, got %s", taskID, task.ID)
	}
	if task.Command != "echo get-test" {
		t.Errorf("expected command 'echo get-test', got %q", task.Command)
	}
}

func TestTaskManager_Get_NotFound(t *testing.T) {
	t.Parallel()
	tm := newTestTaskManager()
	defer tm.Shutdown(context.Background())

	_, err := tm.Get("task-missing")
	if !errors.Is(err, ErrTaskNotFound) {
		t.Errorf("expected ErrTaskNotFound, got %v", err)
	}
}

func TestTaskManager_Output(t *testing.T) {
	t.Parallel()
	tm := newTestTaskManager()
	defer tm.Shutdown(context.Background())

	taskID, _ := tm.Submit(validation.CommandRequest{
		Command: "echo hello-output",
		Timeout: 5,
	})

	_, _ = tm.Wait(taskID, 5*time.Second)

	out, err := tm.Output(taskID, 0, 0, 0)
	if err != nil {
		t.Fatalf("Output failed: %v", err)
	}
	if !strings.Contains(out.Stdout, "hello-output") {
		t.Errorf("expected stdout to contain 'hello-output', got %q", out.Stdout)
	}
	if !out.Complete {
		t.Error("expected complete=true for finished task")
	}
}

func TestTaskManager_Output_NotFound(t *testing.T) {
	t.Parallel()
	tm := newTestTaskManager()
	defer tm.Shutdown(context.Background())

	_, err := tm.Output("task-nope", 0, 0, 0)
	if !errors.Is(err, ErrTaskNotFound) {
		t.Errorf("expected ErrTaskNotFound, got %v", err)
	}
}

func TestTaskManager_Cancel(t *testing.T) {
	t.Parallel()
	tm := newTestTaskManager()
	defer tm.Shutdown(context.Background())

	taskID, _ := tm.Submit(validation.CommandRequest{
		Command: "sleep 30",
		Timeout: 60,
	})

	// Give it a moment to start
	time.Sleep(50 * time.Millisecond)

	state, err := tm.Cancel(taskID)
	if err != nil {
		t.Fatalf("Cancel failed: %v", err)
	}
	if state != cancelResultCanceled {
		t.Errorf("expected 'canceled', got %q", state)
	}
}

func TestTaskManager_Cancel_AlreadyFinished(t *testing.T) {
	t.Parallel()
	tm := newTestTaskManager()
	defer tm.Shutdown(context.Background())

	taskID, _ := tm.Submit(validation.CommandRequest{
		Command: "true",
		Timeout: 5,
	})

	_, _ = tm.Wait(taskID, 5*time.Second)

	state, err := tm.Cancel(taskID)
	if err != nil {
		t.Fatalf("Cancel failed: %v", err)
	}
	if state != cancelResultAlreadyFinished {
		t.Errorf("expected 'already_finished', got %q", state)
	}
}

func TestTaskManager_Cancel_NotFound(t *testing.T) {
	t.Parallel()
	tm := newTestTaskManager()
	defer tm.Shutdown(context.Background())

	_, err := tm.Cancel("task-missing")
	if !errors.Is(err, ErrTaskNotFound) {
		t.Errorf("expected ErrTaskNotFound, got %v", err)
	}
}

func TestTaskManager_NonZeroExit(t *testing.T) {
	t.Parallel()
	tm := newTestTaskManager()
	defer tm.Shutdown(context.Background())

	taskID, _ := tm.Submit(validation.CommandRequest{
		Command: "exit 42",
		Timeout: 5,
	})

	task, _ := tm.Wait(taskID, 5*time.Second)
	info := task.Info()
	if info.State != TaskStateFailed {
		t.Errorf("expected state failed, got %s", info.State)
	}
	if info.ExitCode != 42 {
		t.Errorf("expected exit code 42, got %d", info.ExitCode)
	}
}

func TestTaskManager_Timeout(t *testing.T) {
	t.Parallel()
	tm := newTestTaskManager()
	defer tm.Shutdown(context.Background())

	taskID, _ := tm.Submit(validation.CommandRequest{
		Command: "sleep 10",
		Timeout: 1,
	})

	task, _ := tm.Wait(taskID, 3*time.Second)
	info := task.Info()
	if info.State != TaskStateTimedOut {
		t.Errorf("expected state timed_out, got %s", info.State)
	}
	if !info.TimedOut {
		t.Error("expected TimedOut=true")
	}
}

func TestTaskManager_EnvForwarding(t *testing.T) {
	t.Parallel()
	tm := newTestTaskManager()
	defer tm.Shutdown(context.Background())

	taskID, _ := tm.Submit(validation.CommandRequest{
		Command: "echo $TASK_TEST_VAR",
		Timeout: 5,
		Env:     map[string]string{"TASK_TEST_VAR": "from_task_env"},
	})

	_, _ = tm.Wait(taskID, 5*time.Second)

	out, _ := tm.Output(taskID, 0, 0, 0)
	if !strings.Contains(out.Stdout, "from_task_env") {
		t.Errorf("expected stdout to contain 'from_task_env', got %q", out.Stdout)
	}
}

func TestTaskManager_ConcurrencyLimit(t *testing.T) {
	// Cannot use t.Parallel() with t.Setenv
	logMgr := logs.NewManager(100)
	var cmdSeq atomic.Uint64

	t.Setenv("AIRO_MAX_ASYNC_TASKS", "2")
	tm := NewTaskManager(nil, logMgr, &cmdSeq)
	defer tm.Shutdown(context.Background())

	// Fill to capacity
	_, err1 := tm.Submit(validation.CommandRequest{Command: "sleep 10", Timeout: 30})
	_, err2 := tm.Submit(validation.CommandRequest{Command: "sleep 10", Timeout: 30})
	if err1 != nil || err2 != nil {
		t.Fatalf("first two submits should succeed: %v, %v", err1, err2)
	}

	// Give tasks a moment to register as running
	time.Sleep(50 * time.Millisecond)

	// Third should be rejected
	_, err3 := tm.Submit(validation.CommandRequest{Command: "sleep 10", Timeout: 30})
	if !errors.Is(err3, ErrTooManyTasks) {
		t.Errorf("expected ErrTooManyTasks, got %v", err3)
	}
}

func TestTaskManager_Stderr(t *testing.T) {
	t.Parallel()
	tm := newTestTaskManager()
	defer tm.Shutdown(context.Background())

	taskID, _ := tm.Submit(validation.CommandRequest{
		Command: "echo error-line >&2",
		Timeout: 5,
	})

	_, _ = tm.Wait(taskID, 5*time.Second)

	out, _ := tm.Output(taskID, 0, 0, 0)
	if !strings.Contains(out.Stderr, "error-line") {
		t.Errorf("expected stderr to contain 'error-line', got %q", out.Stderr)
	}
}

func TestTaskManager_PID1Integration(t *testing.T) {
	t.Parallel()
	tm := newTestTaskManagerWithPID1()
	defer tm.Shutdown(context.Background())

	taskID, _ := tm.Submit(validation.CommandRequest{
		Command: "echo pid1-test",
		Timeout: 5,
	})

	task, _ := tm.Wait(taskID, 5*time.Second)
	info := task.Info()
	if info.State != TaskStateSucceeded {
		t.Errorf("expected succeeded with PID1 manager, got %s (error: %s)", info.State, info.Error)
	}
}

func TestTaskManager_Shutdown_CancelsRunning(t *testing.T) {
	t.Parallel()
	tm := newTestTaskManager()

	taskID, _ := tm.Submit(validation.CommandRequest{
		Command: "sleep 60",
		Timeout: 120,
	})

	// Give it a moment to start
	time.Sleep(50 * time.Millisecond)

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	tm.Shutdown(ctx)

	task, _ := tm.Get(taskID)
	info := task.Info()
	if info.State == TaskStateRunning || info.State == TaskStateQueued {
		t.Errorf("expected terminal state after shutdown, got %s", info.State)
	}
}

func TestTaskManager_CommandID_Monotonic(t *testing.T) {
	t.Parallel()
	tm := newTestTaskManager()
	defer tm.Shutdown(context.Background())

	id1, _ := tm.Submit(validation.CommandRequest{Command: "true", Timeout: 5})
	id2, _ := tm.Submit(validation.CommandRequest{Command: "true", Timeout: 5})

	_, _ = tm.Wait(id1, 5*time.Second)
	_, _ = tm.Wait(id2, 5*time.Second)

	t1, _ := tm.Get(id1)
	t2, _ := tm.Get(id2)

	if t2.CommandID <= t1.CommandID {
		t.Errorf("expected monotonic command IDs: %d <= %d", t2.CommandID, t1.CommandID)
	}
}

func TestTaskOutputBuffer_AddAndGet(t *testing.T) {
	t.Parallel()
	buf := &TaskOutputBuffer{}

	buf.addLines("line1\nline2\nline3\n")

	lines, next := buf.getLines(0, 0)
	if len(lines) != 3 {
		t.Errorf("expected 3 lines, got %d", len(lines))
	}
	if next != 3 {
		t.Errorf("expected next=3, got %d", next)
	}
	if lines[0] != "line1" || lines[1] != "line2" || lines[2] != "line3" {
		t.Errorf("unexpected lines: %v", lines)
	}
}

func TestTaskOutputBuffer_Since(t *testing.T) {
	t.Parallel()
	buf := &TaskOutputBuffer{}

	buf.addLines("a\nb\nc\nd\n")

	lines, next := buf.getLines(2, 0)
	if len(lines) != 2 {
		t.Errorf("expected 2 lines from offset 2, got %d", len(lines))
	}
	if next != 4 {
		t.Errorf("expected next=4, got %d", next)
	}
	if lines[0] != "c" {
		t.Errorf("expected 'c' at index 0, got %q", lines[0])
	}
}

func TestTaskOutputBuffer_Max(t *testing.T) {
	t.Parallel()
	buf := &TaskOutputBuffer{}

	buf.addLines("1\n2\n3\n4\n5\n")

	lines, next := buf.getLines(0, 2)
	if len(lines) != 2 {
		t.Errorf("expected 2 lines with max=2, got %d", len(lines))
	}
	if next != 2 {
		t.Errorf("expected next=2, got %d", next)
	}
}

func TestTaskOutputBuffer_TruncatesLongLines(t *testing.T) {
	t.Parallel()
	buf := &TaskOutputBuffer{}

	longLine := strings.Repeat("x", 5000)
	buf.addLines(longLine + "\n")

	lines, _ := buf.getLines(0, 0)
	if len(lines) != 1 {
		t.Fatalf("expected 1 line, got %d", len(lines))
	}
	if len(lines[0]) > taskOutputMaxLineLen+4 {
		t.Errorf("expected line to be truncated, got length %d", len(lines[0]))
	}
}

func TestTaskOutputBuffer_CapsAtMaxLines(t *testing.T) {
	t.Parallel()
	buf := &TaskOutputBuffer{}

	var sb strings.Builder
	for i := range taskOutputMaxLines + 100 {
		sb.WriteString("line-")
		sb.WriteString(strings.Repeat("x", 5))
		_ = i
		sb.WriteString("\n")
	}
	buf.addLines(sb.String())

	lines, _ := buf.getLines(0, 0)
	if len(lines) > taskOutputMaxLines {
		t.Errorf("expected max %d lines, got %d", taskOutputMaxLines, len(lines))
	}
}

func TestTaskManager_Cancel_DuringCompletion(t *testing.T) {
	t.Parallel()
	tm := newTestTaskManager()
	defer tm.Shutdown(context.Background())

	taskID, _ := tm.Submit(validation.CommandRequest{
		Command: "true",
		Timeout: 5,
	})

	// Wait for it to finish
	_, _ = tm.Wait(taskID, 5*time.Second)

	// Cancel after completion should not clobber the succeeded state
	state, err := tm.Cancel(taskID)
	if err != nil {
		t.Fatalf("Cancel failed: %v", err)
	}
	if state != cancelResultAlreadyFinished {
		t.Errorf("expected 'already_finished', got %q", state)
	}

	task, _ := tm.Get(taskID)
	info := task.Info()
	if info.State != TaskStateSucceeded {
		t.Errorf("Cancel clobbered terminal state: expected succeeded, got %s", info.State)
	}
}

func TestTaskManager_Cancel_Immediate(t *testing.T) {
	t.Parallel()
	tm := newTestTaskManager()
	defer tm.Shutdown(context.Background())

	taskID, _ := tm.Submit(validation.CommandRequest{
		Command: "sleep 30",
		Timeout: 60,
	})

	// Cancel immediately — should work even before run goroutine starts
	state, err := tm.Cancel(taskID)
	if err != nil {
		t.Fatalf("Cancel failed: %v", err)
	}
	if state != cancelResultCanceled {
		t.Errorf("expected 'canceled', got %q", state)
	}
}

func TestTaskManager_Reaper(t *testing.T) {
	// Cannot use t.Parallel() with t.Setenv
	logMgr := logs.NewManager(100)
	var cmdSeq atomic.Uint64

	t.Setenv("AIRO_TASK_REAP_TTL", "50ms")
	tm := NewTaskManager(nil, logMgr, &cmdSeq)
	defer tm.Shutdown(context.Background())

	taskID, _ := tm.Submit(validation.CommandRequest{
		Command: "true",
		Timeout: 5,
	})

	// Wait for completion
	_, _ = tm.Wait(taskID, 5*time.Second)

	// Verify task exists
	_, err := tm.Get(taskID)
	if err != nil {
		t.Fatalf("task should exist immediately after completion: %v", err)
	}

	// Wait for reaper to run (interval is 1 min but TTL is 50ms)
	// Force reap manually
	time.Sleep(60 * time.Millisecond)
	tm.reapCompleted()

	// Task should be gone
	_, err = tm.Get(taskID)
	if !errors.Is(err, ErrTaskNotFound) {
		t.Errorf("expected ErrTaskNotFound after reap, got %v", err)
	}
}

func TestTaskManager_Reaper_KeepsRunning(t *testing.T) {
	// Cannot use t.Parallel() with t.Setenv
	logMgr := logs.NewManager(100)
	var cmdSeq atomic.Uint64

	t.Setenv("AIRO_TASK_REAP_TTL", "50ms")
	tm := NewTaskManager(nil, logMgr, &cmdSeq)
	defer tm.Shutdown(context.Background())

	taskID, _ := tm.Submit(validation.CommandRequest{
		Command: "sleep 10",
		Timeout: 30,
	})

	time.Sleep(60 * time.Millisecond)
	tm.reapCompleted()

	// Running task should NOT be reaped
	_, err := tm.Get(taskID)
	if err != nil {
		t.Errorf("running task should not be reaped: %v", err)
	}
}

func TestTaskManager_StreamingOutput(t *testing.T) {
	t.Parallel()
	tm := newTestTaskManager()
	defer tm.Shutdown(context.Background())

	taskID, _ := tm.Submit(validation.CommandRequest{
		Command: "echo line1; sleep 0.1; echo line2",
		Timeout: 5,
	})

	// Give it a moment to start and produce first line
	time.Sleep(200 * time.Millisecond)

	// Output should be available before task completes
	out, _ := tm.Output(taskID, 0, 0, 0)
	if out.Stdout == "" {
		// On fast machines the task might have completed already
		_, _ = tm.Wait(taskID, 5*time.Second)
		out, _ = tm.Output(taskID, 0, 0, 0)
	}
	if !strings.Contains(out.Stdout, "line1") {
		t.Errorf("expected streaming stdout to contain 'line1', got %q", out.Stdout)
	}
}

func TestTaskManager_CapacityAtomic(t *testing.T) {
	// Cannot use t.Parallel() with t.Setenv
	logMgr := logs.NewManager(100)
	var cmdSeq atomic.Uint64

	t.Setenv("AIRO_MAX_ASYNC_TASKS", "5")
	tm := NewTaskManager(nil, logMgr, &cmdSeq)
	defer tm.Shutdown(context.Background())

	// Submit exactly 5 tasks
	for i := range 5 {
		_, err := tm.Submit(validation.CommandRequest{Command: "sleep 5", Timeout: 10})
		if err != nil {
			t.Fatalf("task %d should succeed: %v", i, err)
		}
	}

	time.Sleep(50 * time.Millisecond)

	// 6th should fail
	_, err := tm.Submit(validation.CommandRequest{Command: "sleep 5", Timeout: 10})
	if !errors.Is(err, ErrTooManyTasks) {
		t.Errorf("expected ErrTooManyTasks, got %v", err)
	}
}
