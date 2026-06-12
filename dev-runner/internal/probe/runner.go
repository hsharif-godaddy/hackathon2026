package probe

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/airo-ai-builder/dev-runner/internal/process"
)

// Runner is a single-shot probe supervisor. Safe for one Start at a time.
// Mirrors internal/e2e.Runner in structure.
type Runner struct {
	// ProbeDir is the absolute path to evals/gosym-probe/.
	ProbeDir string

	// execFn overrides runSubprocess for testing. When non-nil, run() calls
	// this instead of spawning a real subprocess.
	execFn func(ctx context.Context, args RunArgs) (int, error)

	mu     sync.RWMutex
	state  State
	args   RunArgs
	last   *CompletedRun
	cmd    *exec.Cmd
	cancel context.CancelFunc
	done   chan struct{}
	lines  []process.OutputLine
}

const (
	maxLines        = 10000
	shutdownTimeout = 5 * time.Second
)

// runIDRe matches "Starting eval run: <uuid>" printed by the TS eval runner.
var runIDRe = regexp.MustCompile(`Starting eval run:\s+([0-9a-f-]{36})`)

// GetState returns the current runner state.
func (r *Runner) GetState() State {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.state
}

// GetArgs returns the args for the current or most recent run.
func (r *Runner) GetArgs() RunArgs {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.args
}

// LastRun returns the summary of the most recent completed run, or nil.
func (r *Runner) LastRun() *CompletedRun {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.last
}

// GetLines returns a copy of the current output buffer.
func (r *Runner) GetLines() []process.OutputLine {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make([]process.OutputLine, len(r.lines))
	copy(out, r.lines)
	return out
}

// ClearLines drops the output buffer (e.g., before a new run).
func (r *Runner) ClearLines() {
	r.mu.Lock()
	r.lines = r.lines[:0]
	r.mu.Unlock()
}

// Reset transitions back to StateIdle and clears the output buffer.
// Safe to call from Stopped or Errored; no-op when already Idle or Running.
func (r *Runner) Reset() {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.state == StateRunning || r.state == StateIdle {
		return
	}
	r.state = StateIdle
	r.lines = r.lines[:0]
}

// Start launches a probe eval run with the given args. Returns immediately;
// callers observe progress by polling GetLines()/GetState() on each tickMsg.
//
// Returns an error if a run is already in progress.
func (r *Runner) Start(args RunArgs) error {
	r.mu.Lock()
	if r.state == StateRunning {
		r.mu.Unlock()
		return fmt.Errorf("probe: run already in progress")
	}
	r.args = args
	r.lines = r.lines[:0]
	r.setStateLocked(StateRunning)
	ctx, cancel := context.WithCancel(context.Background())
	r.cancel = cancel
	r.done = make(chan struct{})
	r.mu.Unlock()

	go r.run(ctx, args)
	return nil
}

// Stop sends SIGTERM to the process group, waits, then SIGKILL on timeout.
// Idempotent — safe to call when already Stopped.
func (r *Runner) Stop() {
	r.mu.RLock()
	cancel := r.cancel
	cmd := r.cmd
	state := r.state
	done := r.done
	r.mu.RUnlock()

	if state != StateRunning {
		return
	}

	if cancel != nil {
		cancel()
	}
	if cmd != nil && cmd.Process != nil {
		_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGTERM)
	}

	if done != nil {
		select {
		case <-done:
			return
		case <-time.After(shutdownTimeout):
			r.mu.RLock()
			cmd = r.cmd
			r.mu.RUnlock()
			if cmd != nil && cmd.Process != nil {
				_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
			}
			select {
			case <-done:
			case <-time.After(3 * time.Second):
			}
		}
	}
}

// BuildCmdArgs returns the pnpm argv for a given RunArgs. The caller prepends
// "pnpm" as the program name. Exposed for unit testing.
func BuildCmdArgs(args RunArgs) []string {
	switch args.Command {
	case CmdSaveBaseline:
		return buildSaveBaselineArgs(args)
	default:
		return buildEvalArgs(args)
	}
}

func buildEvalArgs(args RunArgs) []string {
	cmd := []string{"run", "eval"}

	// Graduate flags subsume --scenario/--suite; they carry the target name.
	if args.Graduate {
		switch t := args.Target.(type) {
		case ScenarioTarget:
			cmd = append(cmd, "--graduate", t.Name)
		case SuiteTarget:
			cmd = append(cmd, "--graduate-suite", t.Name)
		}
	} else {
		switch t := args.Target.(type) {
		case ScenarioTarget:
			cmd = append(cmd, "--scenario", t.Name)
		case SuiteTarget:
			cmd = append(cmd, "--suite", t.Name)
		}
	}

	if args.Trials > 0 {
		cmd = append(cmd, "--trials", strconv.Itoa(args.Trials))
	}
	if args.Concurrency > 0 {
		cmd = append(cmd, "--concurrency", strconv.Itoa(args.Concurrency))
	}
	if args.CaptureConcurrency > 0 {
		cmd = append(cmd, "--capture-concurrency", strconv.Itoa(args.CaptureConcurrency))
	}
	if args.MaxRoutes > 0 {
		cmd = append(cmd, "--max-routes", strconv.Itoa(args.MaxRoutes))
	}
	if args.MaxTurns > 0 {
		cmd = append(cmd, "--max-turns", strconv.Itoa(args.MaxTurns))
	}
	if args.Env != "" {
		cmd = append(cmd, "--env", args.Env)
	}
	if args.ParallelSuites {
		cmd = append(cmd, "--fan-out")
	}
	if args.SkipBaseline {
		cmd = append(cmd, "--skip-baseline")
	}
	if args.Stability != "" {
		cmd = append(cmd, "--stability", args.Stability)
	}

	return cmd
}

func buildSaveBaselineArgs(args RunArgs) []string {
	cmd := []string{"run", "save-baseline", args.RunID}
	if t, ok := args.Target.(SuiteTarget); ok {
		cmd = append(cmd, "--suite", t.Name)
	}
	return cmd
}

// parseRunID scans output lines for the "Starting eval run: <uuid>" pattern and
// returns the UUID, or "" if not found.
func parseRunID(lines []process.OutputLine) string {
	for _, l := range lines {
		if m := runIDRe.FindStringSubmatch(l.Text); len(m) == 2 {
			return m[1]
		}
	}
	return ""
}

func (r *Runner) run(ctx context.Context, args RunArgs) {
	defer close(r.done)

	startAt := time.Now()
	exitCode, finalErr := r.execCmd(ctx, args)

	if ctx.Err() != nil {
		// User cancelled
		r.mu.Lock()
		r.appendLineLocked(process.OutputLine{Text: "─── stopped by user ───", Time: time.Now()})
		r.last = &CompletedRun{Args: args, StartAt: startAt, EndAt: time.Now(), ExitCode: exitCode}
		r.setStateLocked(StateStopped)
		r.mu.Unlock()
		return
	}

	if exitCode != 0 || finalErr != nil {
		r.mu.Lock()
		footer := fmt.Sprintf("─── exited with code %d ───", exitCode)
		if finalErr != nil {
			footer = fmt.Sprintf("─── process error: %v ───", finalErr)
		}
		r.appendLineLocked(process.OutputLine{Text: footer, IsError: true, Time: time.Now()})
		r.last = &CompletedRun{Args: args, StartAt: startAt, EndAt: time.Now(), ExitCode: exitCode, Err: finalErr}
		r.setStateLocked(StateErrored)
		r.mu.Unlock()
		return
	}

	// Eval succeeded. If SaveBaseline is requested, chain the save-baseline run.
	if args.SaveBaseline {
		runID := parseRunID(r.GetLines())
		if runID == "" {
			r.mu.Lock()
			r.appendLineLocked(process.OutputLine{
				Text:    "─── could not parse run ID for save-baseline ───",
				IsError: true,
				Time:    time.Now(),
			})
			r.last = &CompletedRun{Args: args, StartAt: startAt, EndAt: time.Now(), ExitCode: 0}
			r.setStateLocked(StateStopped)
			r.mu.Unlock()
			return
		}

		r.appendLine(process.OutputLine{
			Text: fmt.Sprintf("─── eval complete — saving baseline for run %s ───", runID),
			Time: time.Now(),
		})

		saveArgs := RunArgs{
			Command: CmdSaveBaseline,
			RunID:   runID,
			Target:  args.Target,
		}
		saveExit, saveErr := r.execCmd(ctx, saveArgs)

		endAt := time.Now()
		r.mu.Lock()
		if ctx.Err() != nil {
			r.appendLineLocked(process.OutputLine{Text: "─── stopped by user ───", Time: endAt})
			r.last = &CompletedRun{Args: args, StartAt: startAt, EndAt: endAt, ParsedRunID: runID}
			r.setStateLocked(StateStopped)
		} else if saveExit != 0 || saveErr != nil {
			footer := fmt.Sprintf("─── save-baseline exited with code %d ───", saveExit)
			if saveErr != nil {
				footer = fmt.Sprintf("─── save-baseline error: %v ───", saveErr)
			}
			r.appendLineLocked(process.OutputLine{Text: footer, IsError: true, Time: endAt})
			r.last = &CompletedRun{Args: args, StartAt: startAt, EndAt: endAt, ExitCode: saveExit, Err: saveErr, ParsedRunID: runID}
			r.setStateLocked(StateErrored)
		} else {
			r.appendLineLocked(process.OutputLine{Text: "─── baseline saved ───", Time: endAt})
			r.last = &CompletedRun{Args: args, StartAt: startAt, EndAt: endAt, ParsedRunID: runID}
			r.setStateLocked(StateStopped)
		}
		r.mu.Unlock()
		return
	}

	// No chaining — just report success.
	endAt := time.Now()
	r.mu.Lock()
	r.appendLineLocked(process.OutputLine{Text: "─── exit code 0 ───", Time: endAt})
	r.last = &CompletedRun{Args: args, StartAt: startAt, EndAt: endAt, ExitCode: 0}
	r.setStateLocked(StateStopped)
	r.mu.Unlock()
}

// execCmd delegates to execFn when set (tests), otherwise to runSubprocess.
func (r *Runner) execCmd(ctx context.Context, args RunArgs) (int, error) {
	if r.execFn != nil {
		return r.execFn(ctx, args)
	}
	return r.runSubprocess(ctx, args)
}

// runSubprocess spawns a single pnpm subprocess and streams its output into the
// ring buffer. Returns (exitCode, error) — exitCode 0 with nil error = success.
func (r *Runner) runSubprocess(ctx context.Context, args RunArgs) (int, error) {
	pnpmArgs := BuildCmdArgs(args)
	cmd := exec.CommandContext(ctx, "pnpm", pnpmArgs...) //nolint:gosec // hardcoded program; args assembled from validated inputs
	cmd.Dir = r.ProbeDir
	cmd.Env = append(os.Environ(), "FORCE_COLOR=1", "FORCE_PROGRESS=1", "TERM=xterm-256color")
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}

	r.appendLine(process.OutputLine{
		Text: fmt.Sprintf("$ pnpm %s", strings.Join(pnpmArgs, " ")),
		Time: time.Now(),
	})

	stdoutPipe, err := cmd.StdoutPipe()
	if err != nil {
		r.appendLine(process.OutputLine{Text: fmt.Sprintf("Failed to start: %v", err), IsError: true, Time: time.Now()})
		return 1, err
	}
	stderrPipe, err := cmd.StderrPipe()
	if err != nil {
		_ = stdoutPipe.Close()
		r.appendLine(process.OutputLine{Text: fmt.Sprintf("Failed to start: %v", err), IsError: true, Time: time.Now()})
		return 1, err
	}

	r.mu.Lock()
	if err := cmd.Start(); err != nil {
		_ = stdoutPipe.Close()
		_ = stderrPipe.Close()
		r.appendLineLocked(process.OutputLine{Text: fmt.Sprintf("Failed to start: %v", err), IsError: true, Time: time.Now()})
		r.mu.Unlock()
		return 1, err
	}
	r.cmd = cmd
	r.mu.Unlock()

	var wg sync.WaitGroup
	readPipe := func(rd io.Reader) {
		defer wg.Done()
		sc := bufio.NewScanner(rd)
		sc.Split(scanLinesOrCR)
		for sc.Scan() {
			text := sc.Text()
			if text != "" {
				r.appendLine(process.OutputLine{Text: text, Time: time.Now()})
			}
		}
		if err := sc.Err(); err != nil {
			r.appendLine(process.OutputLine{
				Text:    fmt.Sprintf("[pipe error: %v]", err),
				IsError: true,
				Time:    time.Now(),
			})
		}
	}
	wg.Add(2)
	go readPipe(stdoutPipe)
	go readPipe(stderrPipe)
	wg.Wait()

	exitErr := cmd.Wait()

	r.mu.Lock()
	r.cmd = nil
	r.mu.Unlock()

	if exitErr != nil {
		if ee, ok := exitErr.(*exec.ExitError); ok {
			return ee.ExitCode(), nil
		}
		return 1, exitErr
	}
	return 0, nil
}

func (r *Runner) appendLine(line process.OutputLine) {
	r.mu.Lock()
	r.appendLineLocked(line)
	r.mu.Unlock()
}

func (r *Runner) appendLineLocked(line process.OutputLine) {
	if len(r.lines) >= maxLines {
		drop := maxLines / 10
		if drop < 1 {
			drop = 1
		}
		r.lines = r.lines[drop:]
	}
	r.lines = append(r.lines, line)
}

func (r *Runner) setStateLocked(s State) {
	r.state = s
}

// scanLinesOrCR is a bufio.SplitFunc that splits on \n, \r\n, or bare \r.
// This allows progress bar output (which uses \r without \n) to appear
// immediately in the TUI rather than buffering until a \n arrives.
func scanLinesOrCR(data []byte, atEOF bool) (advance int, token []byte, err error) {
	if atEOF && len(data) == 0 {
		return 0, nil, nil
	}
	for i, b := range data {
		if b == '\n' {
			return i + 1, data[:i], nil
		}
		if b == '\r' {
			// \r\n counts as one line ending
			if i+1 < len(data) && data[i+1] == '\n' {
				return i + 2, data[:i], nil
			}
			return i + 1, data[:i], nil
		}
	}
	if atEOF {
		return len(data), data, nil
	}
	return 0, nil, nil
}
