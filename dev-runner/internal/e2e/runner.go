// Package e2e supervises one-shot Playwright runs from inside the TUI.
//
// Unlike internal/process which manages long-running services restarted by the
// user, an E2E run is a single invocation of ./scripts/e2e.sh that exits when
// the test set finishes. Output is buffered into an internal ring of
// process.OutputLine; the TUI polls GetLines() on its periodic tick to render
// stream output (matching how internal/process is consumed).
package e2e

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"regexp"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/airo-ai-builder/dev-runner/internal/process"
)

// State mirrors process.State for runner lifecycle, but stays in this package
// so the TUI doesn't conflate a one-shot run with a supervised service.
type State int

const (
	StateIdle State = iota
	StateRunning
	StateStopped
	StateErrored
)

func (s State) String() string {
	switch s {
	case StateIdle:
		return "Idle"
	case StateRunning:
		return "Running"
	case StateStopped:
		return "Stopped"
	case StateErrored:
		return "Errored"
	default:
		return "Unknown"
	}
}

// Args describes a single E2E invocation. TestNames are matched against
// Playwright test titles via the -g grep flag.
type Args struct {
	Project   string   // "e2e" or "regression"
	Env       string   // local | dev | pre-test | test | prod
	TestNames []string // empty => no -g filter (run whole project)
}

// Run summarises a completed run. Held by Runner so the TUI can render the
// "─── exit code N ───" footer after the process exits.
type Run struct {
	Args     Args
	StartAt  time.Time
	EndAt    time.Time
	ExitCode int
	Err      error
}

// Runner is a single-shot Playwright supervisor. Safe for one Start at a time.
type Runner struct {
	ProjectRoot string

	mu     sync.RWMutex
	state  State
	args   Args
	last   *Run
	cmd    *exec.Cmd
	cancel context.CancelFunc
	done   chan struct{}
	lines  []process.OutputLine
}

const (
	maxLines        = 10000
	shutdownTimeout = 5 * time.Second
)

// GetState returns the current runner state.
func (r *Runner) GetState() State {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.state
}

// GetArgs returns the args for the current or most recent run.
func (r *Runner) GetArgs() Args {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.args
}

// LastRun returns the summary of the most recent completed run, or nil.
func (r *Runner) LastRun() *Run {
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

// Start launches a Playwright run with the given args. Returns immediately;
// callers observe progress by polling GetLines()/GetState() (the TUI does
// this on each tickMsg via refreshPanes).
//
// Errors out if a run is already in progress. To replace a run, call Stop()
// and wait for the state to settle to Stopped/Errored before calling Start.
func (r *Runner) Start(args Args) error {
	r.mu.Lock()
	if r.state == StateRunning {
		r.mu.Unlock()
		return fmt.Errorf("e2e: run already in progress")
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

// Stop sends SIGTERM to the process group, waits for the runner to settle,
// then SIGKILL on timeout. Idempotent — safe to call when already Stopped.
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

// BuildScriptArgs returns the argv for ./scripts/e2e.sh given a set of test
// names. Exposed so the TUI can show the user the command before running, and
// for unit testing the regex escaping logic.
//
// --headed is always passed: the dev-runner TUI is a developer-facing tool, so
// the visible browser is usually what the user wants. Headless runs belong on
// CI where Playwright is invoked directly without going through this runner.
func BuildScriptArgs(args Args) []string {
	cmdArgs := []string{
		"--env=" + args.Env,
		"--project=" + args.Project,
		"--headed",
	}
	if len(args.TestNames) > 0 {
		quoted := make([]string, 0, len(args.TestNames))
		for _, name := range args.TestNames {
			n := strings.TrimSpace(name)
			if n == "" {
				continue
			}
			quoted = append(quoted, regexp.QuoteMeta(n))
		}
		if len(quoted) > 0 {
			cmdArgs = append(cmdArgs, "-g", strings.Join(quoted, "|"))
		}
	}
	return cmdArgs
}

// ListTests runs `pnpm exec playwright test --list --reporter=line` for a
// project and returns the parsed test titles. Lines from `--list` look like:
//
//	[e2e] › tests/e2e/critical-path.spec.ts:14:5 › critical path > creates an app
//
// We strip the leading "[project]" tag and the "file:line:col" segment and
// return the human-readable title remainder.
func ListTests(ctx context.Context, projectRoot, project string) ([]string, error) {
	cmd := exec.CommandContext(ctx, "pnpm", "exec", "playwright", "test", "--list", "--reporter=line", "--project="+project) //nolint:gosec // hardcoded args; project is a fixed allowlist
	cmd.Dir = projectRoot
	cmd.Env = os.Environ()
	out, err := cmd.CombinedOutput()
	if err != nil {
		return nil, fmt.Errorf("playwright list: %w (output: %s)", err, strings.TrimSpace(string(out)))
	}
	return parseTestList(string(out)), nil
}

// listLineRe matches a single line of `playwright test --list` output and
// captures the test title remainder after `<file>:<line>:<col> ›`.
var listLineRe = regexp.MustCompile(`(?m)^\s*\[[^\]]+\][^›]*›\s+\S+:\d+:\d+\s+›\s+(.+?)\s*$`)

func parseTestList(output string) []string {
	matches := listLineRe.FindAllStringSubmatch(output, -1)
	seen := make(map[string]struct{}, len(matches))
	titles := make([]string, 0, len(matches))
	for _, m := range matches {
		title := strings.TrimSpace(m[1])
		if title == "" {
			continue
		}
		if _, dup := seen[title]; dup {
			continue
		}
		seen[title] = struct{}{}
		titles = append(titles, title)
	}
	return titles
}

func (r *Runner) run(ctx context.Context, args Args) {
	defer close(r.done)

	scriptArgs := BuildScriptArgs(args)
	cmd := exec.CommandContext(ctx, "./scripts/e2e.sh", scriptArgs...) //nolint:gosec // hardcoded script path; args constructed from validated allowlist
	cmd.Dir = r.ProjectRoot
	cmd.Env = append(os.Environ(), "FORCE_COLOR=1", "TERM=xterm-256color")
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}

	stdoutPipe, err := cmd.StdoutPipe()
	if err != nil {
		r.failStart(args, fmt.Errorf("stdout pipe: %w", err))
		return
	}
	stderrPipe, err := cmd.StderrPipe()
	if err != nil {
		r.failStart(args, fmt.Errorf("stderr pipe: %w", err))
		return
	}

	r.appendLine(process.OutputLine{
		Text: fmt.Sprintf("$ ./scripts/e2e.sh %s", strings.Join(scriptArgs, " ")),
		Time: time.Now(),
	})

	startAt := time.Now()
	r.mu.Lock()
	if err := cmd.Start(); err != nil {
		// cmd.Start() failure leaves the pipes open; cmd.Wait() (which would
		// normally close them) is never called. Close them explicitly so we
		// don't leak file descriptors until GC.
		_ = stdoutPipe.Close()
		_ = stderrPipe.Close()
		r.appendLineLocked(process.OutputLine{
			Text:    fmt.Sprintf("Failed to start: %v", err),
			IsError: true,
			Time:    time.Now(),
		})
		r.last = &Run{Args: args, StartAt: startAt, EndAt: time.Now(), Err: err}
		r.setStateLocked(StateErrored)
		r.mu.Unlock()
		return
	}
	r.cmd = cmd
	r.mu.Unlock()

	var wg sync.WaitGroup
	readPipe := func(rd io.Reader) {
		defer wg.Done()
		br := bufio.NewReader(rd)
		for {
			line, err := br.ReadString('\n')
			if line != "" {
				line = strings.TrimRight(line, "\r\n")
				r.appendLine(process.OutputLine{Text: line, Time: time.Now()})
			}
			if err != nil {
				// EOF is the normal end-of-stream when the subprocess exits.
				// Other errors (e.g., io.ErrClosedPipe when SIGKILL breaks the
				// pipe mid-output) silently swallowed the tail of Playwright
				// output before — surface them so the user can see why output
				// is truncated.
				if !errors.Is(err, io.EOF) {
					r.appendLine(process.OutputLine{
						Text:    fmt.Sprintf("[pipe error: %v]", err),
						IsError: true,
						Time:    time.Now(),
					})
				}
				return
			}
		}
	}
	wg.Add(2)
	go readPipe(stdoutPipe)
	go readPipe(stderrPipe)
	wg.Wait()

	exitErr := cmd.Wait()
	endAt := time.Now()

	r.mu.Lock()
	r.cmd = nil
	exitCode := 0
	var finalErr error
	if exitErr != nil {
		if ee, ok := exitErr.(*exec.ExitError); ok {
			exitCode = ee.ExitCode()
		} else {
			finalErr = exitErr
		}
	}
	r.last = &Run{Args: args, StartAt: startAt, EndAt: endAt, ExitCode: exitCode, Err: finalErr}
	if ctx.Err() != nil {
		r.appendLineLocked(process.OutputLine{
			Text: "─── stopped by user ───",
			Time: endAt,
		})
		r.setStateLocked(StateStopped)
	} else if exitErr != nil {
		// finalErr is set when cmd.Wait() failed for a reason other than a
		// non-zero exit (process couldn't be started, signal-on-OS issue,
		// etc.). exitCode stays 0 in that path, so rendering "exited with
		// code 0" + IsError is contradictory. Show the underlying error
		// message instead.
		footer := fmt.Sprintf("─── exited with code %d ───", exitCode)
		if finalErr != nil {
			footer = fmt.Sprintf("─── process error: %v ───", finalErr)
		}
		r.appendLineLocked(process.OutputLine{
			Text:    footer,
			IsError: true,
			Time:    endAt,
		})
		r.setStateLocked(StateErrored)
	} else {
		r.appendLineLocked(process.OutputLine{
			Text: "─── exit code 0 ───",
			Time: endAt,
		})
		r.setStateLocked(StateStopped)
	}
	r.mu.Unlock()
}

func (r *Runner) failStart(args Args, err error) {
	r.mu.Lock()
	r.appendLineLocked(process.OutputLine{
		Text:    fmt.Sprintf("Failed to start: %v", err),
		IsError: true,
		Time:    time.Now(),
	})
	r.last = &Run{Args: args, StartAt: time.Now(), EndAt: time.Now(), Err: err}
	r.setStateLocked(StateErrored)
	r.mu.Unlock()
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
