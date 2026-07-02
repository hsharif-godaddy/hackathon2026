package process

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/airo-ai-builder/dev-runner/internal/config"
)

// State represents a process lifecycle state.
type State int

const (
	StateStopped State = iota
	StateStarting
	StateRunning
	StateErrored
)

func (s State) String() string {
	switch s {
	case StateStopped:
		return "Stopped"
	case StateStarting:
		return "Starting"
	case StateRunning:
		return "Running"
	case StateErrored:
		return "Errored"
	default:
		return "Unknown"
	}
}

const (
	DefaultMaxLines     = 10000
	ShutdownTimeout     = 30 * time.Second
	DefaultBellDebounce = 10 * time.Second
)

// OutputLine represents a single line of output from a process.
type OutputLine struct {
	Text    string
	IsError bool
	Time    time.Time
}

// ManagedProcess wraps an OS process with lifecycle management.
type ManagedProcess struct {
	Config  config.ProcessConfig
	Dir     string
	State   State
	Lines   []OutputLine
	StartAt time.Time

	ErrorCount    int
	Healthy       *bool
	LastBellTime  time.Time
	OnOutput      func(processIndex int, line OutputLine) // Must be set before the first call to Start.
	OnStateChange func(processIndex int, state State)

	mu       sync.RWMutex
	cmd      *exec.Cmd
	cancel   context.CancelFunc
	done     chan struct{} // closed when run() exits
	maxLines int
	index    int
}

// Manager coordinates multiple managed processes.
type Manager struct {
	Processes []*ManagedProcess
}

// NewManager creates a Manager from config.
func NewManager(processes []config.ProcessConfig, projectRoot string) *Manager {
	mgr := &Manager{}
	for i, p := range processes {
		mp := &ManagedProcess{
			Config:   p,
			Dir:      resolveDir(projectRoot, p.Dir),
			State:    StateStopped,
			Lines:    make([]OutputLine, 0, DefaultMaxLines),
			maxLines: DefaultMaxLines,
			index:    i,
		}
		mgr.Processes = append(mgr.Processes, mp)
	}
	return mgr
}

func resolveDir(root, dir string) string {
	if dir == "." {
		return root
	}
	return filepath.Join(root, dir)
}

// StartAll starts every process.
func (m *Manager) StartAll() {
	for _, p := range m.Processes {
		p.Start()
	}
}

// StopAll stops every process gracefully.
func (m *Manager) StopAll() {
	var wg sync.WaitGroup
	for _, p := range m.Processes {
		wg.Add(1)
		go func(proc *ManagedProcess) {
			defer wg.Done()
			proc.Stop()
		}(p)
	}
	wg.Wait()
}

// Start launches the process with PTY allocation.
func (p *ManagedProcess) Start() {
	p.mu.Lock()
	if p.State == StateRunning || p.State == StateStarting {
		p.mu.Unlock()
		return
	}
	p.setState(StateStarting)
	p.mu.Unlock()

	ctx, cancel := context.WithCancel(context.Background())
	// Allocate done before launching run() so a Stop() that races with
	// startup can always observe a non-nil channel and wait on it.
	done := make(chan struct{})
	p.mu.Lock()
	p.cancel = cancel
	p.done = done
	p.mu.Unlock()

	go p.run(ctx, done)
}

// Stop sends SIGTERM to the entire process group and waits for it to drain,
// then SIGKILLs any survivors. Polls the pgroup rather than cmd.Wait() because
// cmd.Wait returns when the direct child exits (e.g., pnpm), not when
// grandchildren do — `node --watch` in particular orphans its server child
// to init while the server is mid graceful-shutdown.
func (p *ManagedProcess) Stop() {
	p.mu.RLock()
	cancel := p.cancel
	cmd := p.cmd
	state := p.State
	done := p.done
	p.mu.RUnlock()

	if state == StateStopped {
		return
	}

	// Cancel context first so run() knows this is an intentional shutdown
	// (must happen before SIGTERM, otherwise the process can exit and run()
	// sees exitErr with ctx.Err()==nil, setting StateErrored instead of StateStopped)
	if cancel != nil {
		cancel()
	}

	pgid := 0
	if cmd != nil && cmd.Process != nil {
		pgid = cmd.Process.Pid
		if err := syscall.Kill(-pgid, syscall.SIGTERM); err != nil && !errors.Is(err, syscall.ESRCH) {
			p.logSignalError("SIGTERM", pgid, err)
		}
	}

	if pgid > 0 {
		// Poll the pgroup for liveness up to ShutdownTimeout, giving the
		// graceful shutdown handlers (server.close, websocket drain, git
		// flush, etc.) time to run. Exits early on ESRCH (pgroup empty) or
		// when run() observes cmd.Wait returning (which closes done).
		deadline := time.Now().Add(ShutdownTimeout)
		drained := false
		for time.Now().Before(deadline) {
			// Honor an early-exit signal from run() so we don't keep polling
			// for the full deadline if the kernel happens to reassign pgid
			// to an unrelated group after our processes have already exited.
			if done != nil {
				select {
				case <-done:
					drained = true
				default:
				}
			}
			if drained {
				break
			}
			err := syscall.Kill(-pgid, 0)
			if errors.Is(err, syscall.ESRCH) {
				drained = true
				break
			}
			// Other errors (EPERM, EINVAL, etc.) leave the pgroup state
			// unknown — keep polling and let the deadline escalate to SIGKILL.
			time.Sleep(100 * time.Millisecond)
		}
		// Only SIGKILL if survivors are confirmed alive. Avoids a tiny
		// PID-reuse race where the kernel could reassign pgid between
		// drain detection and an unconditional kill.
		if !drained {
			if err := syscall.Kill(-pgid, syscall.SIGKILL); err != nil && !errors.Is(err, syscall.ESRCH) {
				p.logSignalError("SIGKILL", pgid, err)
			}
		}
	}

	// Wait briefly for run() to observe the exit and update state.
	if done != nil {
		select {
		case <-done:
		case <-time.After(3 * time.Second):
			// run() didn't exit in time. Force visible state to Stopped so
			// the UI reflects reality. If run() eventually exits it will
			// overwrite the state again, which is benign.
			p.mu.Lock()
			p.setState(StateStopped)
			p.mu.Unlock()
		}
		return
	}

	// No run() goroutine — process never started.
	p.mu.Lock()
	p.setState(StateStopped)
	p.mu.Unlock()
}

// logSignalError records a non-ESRCH failure from a kill syscall to the
// process pane so the user can see when SIGTERM/SIGKILL didn't land
// (e.g., EPERM under unusual sandboxing).
func (p *ManagedProcess) logSignalError(name string, pgid int, err error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.addLine(OutputLine{
		Text:    fmt.Sprintf("Failed to %s pgroup %d: %v", name, pgid, err),
		IsError: true,
		Time:    time.Now(),
	})
}

// Restart stops then starts the process.
func (p *ManagedProcess) Restart() {
	p.Stop()
	p.Start()
}

// ClearLines removes all stored output lines.
func (p *ManagedProcess) ClearLines() {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.Lines = make([]OutputLine, 0, p.maxLines)
}

// ClearErrors resets the error count.
func (p *ManagedProcess) ClearErrors() {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.ErrorCount = 0
}

// AddSystemLine appends an informational line to the process output buffer.
// Used by the TUI to inject system messages (e.g. credential status) into the
// "All" pane without a backing subprocess write.
func (p *ManagedProcess) AddSystemLine(text string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.addLine(OutputLine{Text: text, IsError: false, Time: time.Now()})
}

// GetLines returns a copy of current output lines.
func (p *ManagedProcess) GetLines() []OutputLine {
	p.mu.RLock()
	defer p.mu.RUnlock()
	out := make([]OutputLine, len(p.Lines))
	copy(out, p.Lines)
	return out
}

// GetState returns the current process state.
func (p *ManagedProcess) GetState() State {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.State
}

func (p *ManagedProcess) run(ctx context.Context, done chan struct{}) {
	defer func() {
		close(done)
		p.mu.Lock()
		// Only clear if we still own the channel. If a stale run() is
		// finishing while a newer Start() has already replaced p.done,
		// don't clobber the newer generation.
		if p.done == done {
			p.done = nil
		}
		p.mu.Unlock()
	}()

	parts := strings.Fields(p.Config.Command)
	if len(parts) == 0 {
		p.mu.Lock()
		p.setState(StateErrored)
		p.mu.Unlock()
		return
	}

	// Check if Stop() was called between Start() and run() starting
	if ctx.Err() != nil {
		p.mu.Lock()
		p.setState(StateStopped)
		p.mu.Unlock()
		return
	}

	// Execute through shell so pipes, &&, env vars, etc. work.
	cmd := exec.Command("sh", "-c", p.Config.Command)
	cmd.Dir = p.Dir
	cmd.Env = append(os.Environ(), "FORCE_COLOR=1", "TERM=xterm-256color")
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}

	stdoutPipe, err := cmd.StdoutPipe()
	if err != nil {
		p.mu.Lock()
		p.addLine(OutputLine{Text: fmt.Sprintf("Failed to create stdout pipe: %v", err), IsError: true, Time: time.Now()})
		p.setState(StateErrored)
		p.mu.Unlock()
		return
	}
	stderrPipe, err := cmd.StderrPipe()
	if err != nil {
		p.mu.Lock()
		p.addLine(OutputLine{Text: fmt.Sprintf("Failed to create stderr pipe: %v", err), IsError: true, Time: time.Now()})
		p.setState(StateErrored)
		p.mu.Unlock()
		return
	}

	// Hold the lock across Start + cmd assignment so Stop() never sees
	// a running process with p.cmd still nil.
	p.mu.Lock()
	if err := cmd.Start(); err != nil {
		p.addLine(OutputLine{Text: fmt.Sprintf("Failed to start: %v", err), IsError: true, Time: time.Now()})
		p.setState(StateErrored)
		p.mu.Unlock()
		return
	}
	p.cmd = cmd
	p.StartAt = time.Now()
	p.setState(StateRunning)
	p.mu.Unlock()

	scanner := NewScanner(p.Config.ErrorPatterns)

	var wg sync.WaitGroup
	readPipe := func(r io.Reader) {
		defer wg.Done()
		br := bufio.NewReader(r)
		for {
			line, err := br.ReadString('\n')
			if line != "" {
				line = strings.TrimRight(line, "\r\n")
				isErr := scanner.IsError(line)
				ol := OutputLine{Text: line, IsError: isErr, Time: time.Now()}

				p.mu.Lock()
				p.addLine(ol)
				if isErr {
					p.ErrorCount++
				}
				p.mu.Unlock()

				if p.OnOutput != nil {
					p.OnOutput(p.index, ol)
				}
			}
			if err != nil {
				break
			}
		}
	}

	wg.Add(2)
	go readPipe(stdoutPipe)
	go readPipe(stderrPipe)
	wg.Wait()

	exitErr := cmd.Wait()

	p.mu.Lock()
	p.cmd = nil // Clear stale handle so Stop() doesn't signal a dead PID
	if ctx.Err() != nil {
		p.setState(StateStopped)
	} else if exitErr != nil {
		p.addLine(OutputLine{
			Text:    fmt.Sprintf("Process exited: %v", exitErr),
			IsError: true,
			Time:    time.Now(),
		})
		p.setState(StateErrored)
	} else {
		p.addLine(OutputLine{
			Text: "Process exited successfully",
			Time: time.Now(),
		})
		p.setState(StateStopped)
	}
	p.mu.Unlock()
}

func (p *ManagedProcess) addLine(line OutputLine) {
	if len(p.Lines) >= p.maxLines {
		drop := p.maxLines / 10
		if drop < 1 {
			drop = 1
		}
		p.Lines = p.Lines[drop:]
	}
	p.Lines = append(p.Lines, line)
}

// setState updates the process state and notifies the callback.
// The callback must be non-blocking (e.g. Bubble Tea's program.Send).
func (p *ManagedProcess) setState(s State) {
	p.State = s
	if p.OnStateChange != nil {
		p.OnStateChange(p.index, s)
	}
}
