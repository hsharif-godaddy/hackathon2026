package hooks

import (
	"bufio"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/airo-ai-builder/dev-runner/internal/config"
)

// HookOutput represents a line of output from a hook command.
type HookOutput struct {
	HookName string
	Line     string
	IsError  bool
	Time     time.Time
}

// Runner executes hook commands sequentially.
type Runner struct {
	ProjectRoot string
	OnOutput    func(HookOutput)
}

// RunHooks executes a list of hook configs in order.
// Stops on first non-optional failure. Returns the failing hook's error.
func (r *Runner) RunHooks(ctx context.Context, hooks []config.HookConfig) error {
	for _, h := range hooks {
		if ctx != nil && ctx.Err() != nil {
			return ctx.Err()
		}

		name := h.Name
		if name == "" {
			name = h.Command
		}

		r.emit(HookOutput{
			HookName: name,
			Line:     fmt.Sprintf("Running: %s", h.Command),
			Time:     time.Now(),
		})

		var hookCtx context.Context
		if ctx != nil {
			hookCtx = ctx
		} else {
			hookCtx = context.Background()
		}

		err := r.runOne(hookCtx, h)
		if err != nil {
			r.emit(HookOutput{
				HookName: name,
				Line:     fmt.Sprintf("Failed: %v", err),
				IsError:  true,
				Time:     time.Now(),
			})
			if !h.Optional {
				return fmt.Errorf("hook %q failed: %w", name, err)
			}
			r.emit(HookOutput{
				HookName: name,
				Line:     "Continuing (hook is optional)",
				Time:     time.Now(),
			})
		} else {
			r.emit(HookOutput{
				HookName: name,
				Line:     "Completed successfully",
				Time:     time.Now(),
			})
		}
	}
	return nil
}

func (r *Runner) runOne(ctx context.Context, h config.HookConfig) error {
	dir := r.ProjectRoot
	if h.Dir != "" && h.Dir != "." {
		dir = filepath.Join(r.ProjectRoot, h.Dir)
	}

	if strings.TrimSpace(h.Command) == "" {
		return fmt.Errorf("empty command")
	}

	// Don't use CommandContext — it only kills the direct child, not the
	// process group. We manage cancellation ourselves via SIGTERM to the group.
	cmd := exec.Command("sh", "-c", h.Command)
	cmd.Dir = dir
	cmd.Env = os.Environ()
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return fmt.Errorf("stdout pipe: %w", err)
	}
	cmd.Stderr = cmd.Stdout

	if err := cmd.Start(); err != nil {
		return fmt.Errorf("start: %w", err)
	}

	// Kill the entire process group when the context is cancelled.
	// Escalate to SIGKILL if SIGTERM doesn't work within 3 seconds.
	doneCh := make(chan struct{})
	go func() {
		select {
		case <-ctx.Done():
			if cmd.Process != nil {
				_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGTERM)
				// Wait briefly, then escalate to SIGKILL
				select {
				case <-doneCh:
				case <-time.After(3 * time.Second):
					_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
				}
			}
		case <-doneCh:
		}
	}()

	name := h.Name
	if name == "" {
		name = h.Command
	}

	// Use ReadString instead of Scanner to handle arbitrarily long lines
	br := bufio.NewReader(stdout)
	for {
		line, err := br.ReadString('\n')
		if line != "" {
			line = strings.TrimRight(line, "\r\n")
			r.emit(HookOutput{
				HookName: name,
				Line:     line,
				Time:     time.Now(),
			})
		}
		if err != nil {
			break
		}
	}

	waitErr := cmd.Wait()
	close(doneCh)

	// If context was cancelled, don't report the signal-induced exit as a failure
	if ctx.Err() != nil {
		return ctx.Err()
	}
	return waitErr
}

func (r *Runner) emit(out HookOutput) {
	if r.OnOutput != nil {
		r.OnOutput(out)
	}
}
